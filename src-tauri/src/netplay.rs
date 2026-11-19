use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

use crate::mods::netplay_dir;
use crate::roomcode;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetplayStatus {
    pub provider: Option<String>,
    pub phase: String,
    pub room_code: Option<String>,
    pub player_name: Option<String>,
    pub join_address: Option<String>,
    pub virtual_ip: Option<String>,
    pub peers: Vec<serde_json::Value>,
    pub message: Option<String>,
    pub error_code: Option<String>,
}

impl Default for NetplayStatus {
    fn default() -> Self {
        Self {
            provider: None,
            phase: "idle".into(),
            room_code: None,
            player_name: None,
            join_address: None,
            virtual_ip: None,
            peers: Vec::new(),
            message: None,
            error_code: None,
        }
    }
}

struct Session {
    child: Child,
    port: u16,
    status: NetplayStatus,
}

pub struct NetplayState {
    session: Arc<Mutex<Option<Session>>>,
}

impl Default for NetplayState {
    fn default() -> Self {
        Self {
            session: Arc::new(Mutex::new(None)),
        }
    }
}

fn terracotta_dir() -> PathBuf {
    let dir = netplay_dir().join("terracotta");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn easytier_dir() -> PathBuf {
    let dir = netplay_dir().join("easytier");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn exe_name(base: &str) -> String {
    if cfg!(windows) {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

fn http_get(port: u16, route: &str) -> Option<serde_json::Value> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .ok()?;
    let response = client
        .get(format!("http://127.0.0.1:{port}{route}"))
        .send()
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let text = response.text().ok()?;
    if text.is_empty() {
        None
    } else {
        serde_json::from_str(&text).ok()
    }
}

/// 等 terracotta 把 {"port": N} 写进端口文件
fn wait_for_port(file: &Path, timeout: Duration) -> Option<u16> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if let Ok(raw) = fs::read_to_string(file) {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) {
                if let Some(port) = value.get("port").and_then(|v| v.as_u64()) {
                    return Some(port as u16);
                }
            }
        }
        thread::sleep(Duration::from_millis(200));
    }
    None
}

fn map_state(raw: &serde_json::Value, current: &NetplayStatus) -> NetplayStatus {
    let state = raw.get("state").and_then(|v| v.as_str()).unwrap_or("");
    let mut next = current.clone();
    next.message = None;
    next.error_code = None;
    match state {
        "waiting" => {
            next.phase = "waiting".into();
            next.join_address = None;
        }
        "host-scanning" => next.phase = "scanning".into(),
        "host-starting" => {
            next.phase = "starting".into();
            if let Some(room) = raw.get("room").and_then(|v| v.as_str()) {
                next.room_code = Some(room.to_string());
            }
        }
        "host-ok" => {
            next.phase = "hosting".into();
            if let Some(room) = raw.get("room").and_then(|v| v.as_str()) {
                next.room_code = Some(room.to_string());
            }
        }
        "guest-connecting" | "guest-starting" => {
            next.phase = "connecting".into();
            if let Some(room) = raw.get("room").and_then(|v| v.as_str()) {
                next.room_code = Some(room.to_string());
            }
        }
        "guest-ok" => {
            next.phase = "connected".into();
            next.join_address = raw.get("url").and_then(|v| v.as_str()).map(|s| s.to_string());
        }
        "exception" => {
            next.phase = "error".into();
            let kind = raw.get("type").and_then(|v| v.as_i64()).unwrap_or(0);
            next.error_code = Some(format!("TC{kind}"));
            next.message = Some(exception_text(kind));
        }
        _ => {}
    }
    next
}

fn exception_text(kind: i64) -> String {
    match kind {
        0 => "房主网络不可达".into(),
        1 => "房主连接被重置".into(),
        2 => "客人侧虚拟网络异常退出".into(),
        3 => "房主侧虚拟网络异常退出".into(),
        4 => "联机端口被重置".into(),
        5 => "房间握手失败".into(),
        _ => "联机异常".into(),
    }
}

fn spawn_poller(app: AppHandle, session: Arc<Mutex<Option<Session>>>) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(1000));
        let mut guard = match session.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        let Some(current) = guard.as_mut() else {
            return;
        };
        if let Some(raw) = http_get(current.port, "/state") {
            current.status = map_state(&raw, &current.status);
        }
        let status = current.status.clone();
        let _ = app.emit("netplay:status-event", status);
    });
}

fn fail(reason: &str, message: &str) -> serde_json::Value {
    serde_json::json!({ "ok": false, "reason": reason, "message": message })
}

fn ok_status(status: &NetplayStatus) -> serde_json::Value {
    serde_json::json!({ "ok": true, "status": status })
}

/// 把安装阶段推给前端，进度条才不会一直停在「已下载 0.0 MB」
fn emit_install(app: &AppHandle, phase: &str, received: u64, total: u64) {
    let _ = app.emit(
        "netplay:install-progress",
        serde_json::json!({ "phase": phase, "received": received, "total": total }),
    );
}

/// 按顺序试每个源，边下边推进度。整包读进内存（最大约 30MB），够用且省一个临时文件。
///
/// 镜像之间速度差得离谱（实测 ghproxy 只有 20KB/s，gh-proxy 有 480KB/s），
/// 所以不能「第一个能连上就用」——先下 20 秒看速率，太慢就换下一个源。
fn fetch_with_progress(
    app: &AppHandle,
    client: &reqwest::blocking::Client,
    urls: &[String],
) -> Result<Vec<u8>, String> {
    let mut last_error = String::from("下载失败");
    for url in urls {
        emit_install(app, "connect", 0, 0);
        let mut response = match client.get(url).send() {
            Ok(response) => response,
            Err(error) => {
                last_error = error.to_string();
                continue;
            }
        };
        if !response.status().is_success() {
            last_error = format!("HTTP {}", response.status().as_u16());
            continue;
        }
        let total = response.content_length().unwrap_or(0);
        let mut data: Vec<u8> = Vec::with_capacity(total.min(64 * 1024 * 1024) as usize);
        let mut buffer = vec![0u8; 128 * 1024];
        let mut received: u64 = 0;
        let mut broken = false;
        let mut slow = false;
        let started = Instant::now();
        let mut last_emit = Instant::now();
        loop {
            match response.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    data.extend_from_slice(&buffer[..read]);
                    received += read as u64;
                    if last_emit.elapsed() >= Duration::from_millis(120) {
                        last_emit = Instant::now();
                        emit_install(app, "download", received, total);
                    }
                    // 20 秒还不到 1.5MB（≈75KB/s）就判定这个源太慢，换下一个
                    if received < 1_500_000 && started.elapsed() >= Duration::from_secs(20) {
                        slow = true;
                        break;
                    }
                }
                Err(error) => {
                    last_error = error.to_string();
                    broken = true;
                    break;
                }
            }
        }
        if slow {
            last_error = "下载源速度过慢".to_string();
            continue;
        }
        if broken || data.is_empty() {
            if data.is_empty() && !broken {
                last_error = "空响应".to_string();
            }
            continue;
        }
        // 有 content-length 时必须是完整包，否则解压会莫名其妙失败
        if total > 0 && received != total {
            last_error = format!("只下到 {received}/{total} 字节");
            continue;
        }
        emit_install(app, "download", received, total);
        return Ok(data);
    }
    Err(last_error)
}

/// 下载 tar.gz 并解出 terracotta 可执行文件
pub fn install_terracotta(app: &AppHandle) -> serde_json::Value {
    let os = if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    };
    let arch = if cfg!(target_arch = "x86_64") {
        "x86_64"
    } else {
        "arm64"
    };
    let version = "0.4.2";
    let asset = format!("terracotta-{version}-{os}-{arch}-pkg.tar.gz");
    let urls = [
        format!("https://gitee.com/burningtnt/Terracotta/releases/download/v{version}/{asset}"),
        format!("https://github.com/burningtnt/Terracotta/releases/download/v{version}/{asset}"),
    ];

    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
    {
        Ok(client) => client,
        Err(error) => return fail("network", &error.to_string()),
    };

    let bytes = match fetch_with_progress(app, &client, &urls) {
        Ok(bytes) => bytes,
        Err(message) => return fail("network", &message),
    };
    emit_install(app, "extract", bytes.len() as u64, bytes.len() as u64);

    let decoder = flate2::read::GzDecoder::new(bytes.as_slice());
    let mut archive = tar::Archive::new(decoder);
    let dir = terracotta_dir();
    let target = dir.join(exe_name("terracotta"));
    let mut found = false;
    if let Ok(entries) = archive.entries() {
        for entry in entries.flatten() {
            let path = match entry.path() {
                Ok(path) => path.to_path_buf(),
                Err(_) => continue,
            };
            let name = path.file_name().map(|n| n.to_string_lossy().to_string());
            let Some(name) = name else { continue };
            if name.starts_with("terracotta-") && name.contains(os) {
                let mut file = match fs::File::create(&target) {
                    Ok(file) => file,
                    Err(_) => continue,
                };
                let mut reader = entry;
                if std::io::copy(&mut reader, &mut file).is_ok() {
                    found = true;
                }
            } else if name.to_lowercase().ends_with(".dll") {
                if let Ok(mut data) = fs::File::create(dir.join(&name)) {
                    let mut reader = entry;
                    let _ = std::io::copy(&mut reader, &mut data);
                }
            }
        }
    }
    if !found {
        return fail("extract", "发行包里没有主程序");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&target, fs::Permissions::from_mode(0o755));
    }
    let _ = fs::write(dir.join("version.json"), format!("{{\"version\":\"{version}\"}}"));
    serde_json::json!({
        "ok": true,
        "runtime": {
            "provider": "terracotta",
            "installed": true,
            "version": version,
            "path": target.to_string_lossy()
        }
    })
}

pub fn install_easytier(app: &AppHandle) -> serde_json::Value {
    let os = if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    };
    let arch = if cfg!(target_arch = "x86_64") {
        "x86_64"
    } else if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else {
        "x86_64"
    };
    let version = "2.6.4";
    let asset = format!("easytier-{os}-{arch}-v{version}.zip");
    let github = format!("https://github.com/EasyTier/EasyTier/releases/download/v{version}/{asset}");
    // GitHub 在国内经常拉不动，先走加速镜像，最后一个才是直连。
    // 顺序按实测速率排：gh-proxy 约 480KB/s、ghfast 约 200KB/s、ghproxy 只有 20KB/s；
    // 早先用的 github.moeyy.xyz 现在已经连不上，去掉了。
    let urls = [
        format!("https://gh-proxy.com/{github}"),
        format!("https://ghfast.top/{github}"),
        format!("https://ghproxy.net/{github}"),
        github.clone(),
    ];

    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
    {
        Ok(client) => client,
        Err(error) => return fail("network", &error.to_string()),
    };

    let body = match fetch_with_progress(app, &client, &urls) {
        Ok(body) => body,
        Err(message) => return fail("network", &message),
    };
    emit_install(app, "extract", body.len() as u64, body.len() as u64);

    let reader = std::io::Cursor::new(body);
    let mut archive = match zip::ZipArchive::new(reader) {
        Ok(archive) => archive,
        Err(error) => return fail("extract", &error.to_string()),
    };
    let dir = easytier_dir();
    for index in 0..archive.len() {
        let Ok(mut file) = archive.by_index(index) else {
            continue;
        };
        let Some(name) = file.enclosed_name().map(|p| p.file_name().unwrap_or_default().to_owned()) else {
            continue;
        };
        let name = name.to_string_lossy().to_string();
        if name.is_empty() || file.is_dir() {
            continue;
        }
        let target = dir.join(&name);
        let mut out = match fs::File::create(&target) {
            Ok(out) => out,
            Err(_) => continue,
        };
        let mut buffer = Vec::new();
        if file.read_to_end(&mut buffer).is_ok() {
            let _ = std::io::Write::write_all(&mut out, &buffer);
        }
    }
    let _ = fs::write(dir.join("version.json"), format!("{{\"version\":\"{version}\"}}"));
    serde_json::json!({
        "ok": true,
        "runtime": {
            "provider": "easytier",
            "installed": true,
            "version": version,
            "path": dir.join(exe_name("easytier-core")).to_string_lossy()
        }
    })
}

pub fn runtime_info(provider: &str) -> serde_json::Value {
    let (dir, files) = if provider == "easytier" {
        (easytier_dir(), vec![exe_name("easytier-core"), exe_name("easytier-cli")])
    } else {
        (terracotta_dir(), vec![exe_name("terracotta")])
    };
    let installed = files.iter().all(|name| dir.join(name).is_file());
    let version = fs::read_to_string(dir.join("version.json"))
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|value| value.get("version").and_then(|v| v.as_str()).map(|s| s.to_string()));
    serde_json::json!({
        "provider": provider,
        "installed": installed,
        "version": version,
        "path": if installed { Some(dir.join(&files[0]).to_string_lossy().to_string()) } else { None }
    })
}

fn ensure_terracotta_running(app: &AppHandle, state: &NetplayState) -> Result<NetplayStatus, String> {
    let mut guard = crate::util::lock(&state.session);
    if let Some(current) = guard.as_ref() {
        return Ok(current.status.clone());
    }
    let binary = terracotta_dir().join(exe_name("terracotta"));
    if !binary.is_file() {
        return Err("NOT_INSTALLED".into());
    }
    let port_file = netplay_dir().join("terracotta-port.json");
    let _ = fs::remove_file(&port_file);

    let mut command = Command::new(&binary);
    command.arg("--hmcl").arg(&port_file);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let child = command.spawn().map_err(|e| e.to_string())?;
    let port = wait_for_port(&port_file, Duration::from_secs(12)).ok_or("TIMEOUT")?;

    let status = NetplayStatus {
        provider: Some("terracotta".into()),
        phase: "waiting".into(),
        ..Default::default()
    };
    *guard = Some(Session {
        child,
        port,
        status: status.clone(),
    });
    drop(guard);
    spawn_poller(app.clone(), state.session.clone());
    Ok(status)
}

pub fn host(app: &AppHandle, state: &NetplayState, room: &str, player: &str) -> serde_json::Value {
    match ensure_terracotta_running(app, state) {
        Ok(_) => {}
        Err(error) => {
            let reason = if error == "TIMEOUT" { "timeout" } else { "not-installed" };
            return fail(reason, &error);
        }
    }
    let port = {
        let guard = crate::util::lock(&state.session);
        match guard.as_ref() {
            Some(session) => session.port,
            None => return fail("error", "NOT_RUNNING"),
        }
    };
    // 和官方一致：房主不指定房间码，让陶瓦自己用密码学随机数生成
    // `U/NNNN-NNNN-SSSS-SSSS`，生成结果从 /state 的 room 字段读回来。
    let route = if room.trim().is_empty() {
        format!("/state/scanning?player={}", urlencode(player))
    } else {
        format!(
            "/state/scanning?room={}&player={}",
            urlencode(&roomcode::normalize(room)),
            urlencode(player)
        )
    };
    let _ = http_get(port, &route);
    let status = {
        let mut guard = crate::util::lock(&state.session);
        if let Some(session) = guard.as_mut() {
            session.status.phase = "scanning".into();
            session.status.room_code = None;
            session.status.clone()
        } else {
            NetplayStatus::default()
        }
    };
    ok_status(&status)
}

pub fn join(app: &AppHandle, state: &NetplayState, room: &str, player: &str) -> serde_json::Value {
    // 邀请码格式不对就没必要拉起陶瓦了，直接按官方 400 的语义返回
    let Some((_, _)) = roomcode::parse(room) else {
        return fail("invalid", "BAD_ROOM_CODE");
    };
    let code = roomcode::normalize(room);
    match ensure_terracotta_running(app, state) {
        Ok(_) => {}
        Err(error) => {
            let reason = if error == "TIMEOUT" { "timeout" } else { "not-installed" };
            return fail(reason, &error);
        }
    }
    let port = {
        let guard = crate::util::lock(&state.session);
        match guard.as_ref() {
            Some(session) => session.port,
            None => return fail("error", "NOT_RUNNING"),
        }
    };
    let route = format!(
        "/state/guesting?room={}&player={}",
        urlencode(&code),
        urlencode(player)
    );
    let _ = http_get(port, &route);
    let status = {
        let mut guard = crate::util::lock(&state.session);
        if let Some(session) = guard.as_mut() {
            session.status.phase = "connecting".into();
            session.status.room_code = Some(code.clone());
            session.status.clone()
        } else {
            NetplayStatus::default()
        }
    };
    ok_status(&status)
}

pub fn stop(state: &NetplayState) -> NetplayStatus {
    let mut guard = crate::util::lock(&state.session);
    if let Some(mut session) = guard.take() {
        let _ = http_get(session.port, "/state/ide");
        let _ = session.child.kill();
    }
    NetplayStatus::default()
}

pub fn status(state: &NetplayState) -> NetplayStatus {
    let guard = crate::util::lock(&state.session);
    match guard.as_ref() {
        Some(session) => session.status.clone(),
        None => NetplayStatus::default(),
    }
}

pub fn start_easytier(state: &NetplayState, config: &serde_json::Value) -> serde_json::Value {
    let binary = easytier_dir().join(exe_name("easytier-core"));
    if !binary.is_file() {
        return fail("not-installed", "运行时未安装");
    }

    // 优先用联机码推导网络名和密钥（和陶瓦/Scaffolding 官方完全一致的编码），
    // 这样在 EasyTier 直连模式下生成的码，陶瓦那边也能直接用。
    let code = config
        .get("code")
        .and_then(|v| v.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let (name, secret) = match code.as_deref().map(roomcode::parse) {
        Some(Some(pair)) => pair,
        Some(None) => return fail("invalid", "BAD_ROOM_CODE"),
        None => {
            let name = config.get("networkName").and_then(|v| v.as_str()).unwrap_or("");
            let secret = config.get("networkSecret").and_then(|v| v.as_str()).unwrap_or("");
            if name.is_empty() || secret.is_empty() {
                return fail("invalid", "网络名和密码不能为空");
            }
            (name.to_string(), secret.to_string())
        }
    };

    let role = config.get("role").and_then(|v| v.as_str()).unwrap_or("host");
    let port = config
        .get("port")
        .and_then(|v| v.as_u64())
        .filter(|value| *value > 1024 && *value <= 65535)
        .unwrap_or(25565) as u16;
    // 联机中心靠 hostname 被发现：scaffolding-mc-server-{端口}
    let hostname = if role == "host" {
        roomcode::center_hostname(port)
    } else {
        "scaffolding-mc-client".to_string()
    };

    let mut command = Command::new(&binary);
    command
        .arg("--network-name")
        .arg(&name)
        .arg("--network-secret")
        .arg(&secret)
        .arg("--hostname")
        .arg(&hostname);
    if let Some(peers) = config.get("peers").and_then(|v| v.as_str()) {
        for peer in peers.split(['\n', ',', ';', ' ']).filter(|p| !p.trim().is_empty()) {
            command.arg("-p").arg(peer.trim());
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    match command.spawn() {
        Ok(child) => {
            let status = NetplayStatus {
                provider: Some("easytier".into()),
                phase: "connecting".into(),
                room_code: code.clone(),
                message: Some(name.to_string()),
                ..Default::default()
            };
            *crate::util::lock(&state.session) = Some(Session {
                child,
                port: 0,
                status: status.clone(),
            });
            ok_status(&status)
        }
        Err(error) => fail("error", &error.to_string()),
    }
}

/// 生成联机码，并给出等价的 EasyTier 网络名 / 密钥
pub fn generate_code() -> serde_json::Value {
    let code = roomcode::generate();
    let (name, secret) = roomcode::parse(&code).unwrap_or_default();
    serde_json::json!({
        "code": code,
        "networkName": name,
        "networkSecret": secret
    })
}

/// 解析用户粘贴的联机码
pub fn parse_code(raw: &str) -> serde_json::Value {
    match roomcode::parse(raw) {
        Some((name, secret)) => serde_json::json!({
            "ok": true,
            "code": roomcode::normalize(raw),
            "networkName": name,
            "networkSecret": secret
        }),
        None => serde_json::json!({ "ok": false, "reason": "BAD_ROOM_CODE" }),
    }
}

fn urlencode(raw: &str) -> String {
    raw.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            ' ' => "%20".into(),
            other => other
                .to_string()
                .bytes()
                .map(|b| format!("%{b:02X}"))
                .collect::<Vec<_>>()
                .join(""),
        })
        .collect()
}

pub fn dispose(state: &NetplayState) {
    let mut guard = crate::util::lock(&state.session);
    if let Some(mut session) = guard.take() {
        let _ = session.child.kill();
    }
}

#[allow(dead_code)]
fn _unused(_: &mut Child) {}
