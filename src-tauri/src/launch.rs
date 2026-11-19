//! 启动链：拼参数、解 natives、拉 authlib-injector、起进程、收日志。
//!
//! 参数拼装严格按版本 json 来：`arguments.jvm` / `arguments.game` 里的规则先过一遍，
//! 再把 `${...}` 占位符替换掉；老版本只有 `minecraftArguments` 的走另一条分支。

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::auth::Account;
use crate::http;
use crate::store::Instance;
use crate::util::data_file;

#[derive(Clone, Default)]
pub struct LaunchState {
    pub child: Arc<Mutex<Option<Child>>>,
    pub running: Arc<AtomicBool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchEvent {
    pub phase: String,
    pub message: String,
    pub pid: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchLog {
    pub line: String,
    pub stream: String,
}

fn emit_state(app: &AppHandle, phase: &str, message: impl Into<String>, pid: Option<u32>) {
    let _ = app.emit(
        "launch:state",
        LaunchEvent {
            phase: phase.to_string(),
            message: message.into(),
            pid,
        },
    );
}

/* ==========================================================================
   版本 json 合并
   ========================================================================== */

fn read_version_json(game_dir: &Path, version_id: &str) -> Result<serde_json::Value, String> {
    let path = game_dir
        .join("versions")
        .join(version_id)
        .join(format!("{version_id}.json"));
    let text = std::fs::read_to_string(&path).map_err(|_| format!("NO_VERSION_JSON {version_id}"))?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

fn merge_child(parent: &serde_json::Value, child: &serde_json::Value) -> serde_json::Value {
    let mut merged = parent.clone();
    let Some(target) = merged.as_object_mut() else {
        return child.clone();
    };
    let Some(source) = child.as_object() else {
        return merged;
    };

    for (key, value) in source {
        match key.as_str() {
            "libraries" => {
                let mut libraries = target
                    .get("libraries")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                if let Some(extra) = value.as_array() {
                    libraries.extend(extra.iter().cloned());
                }
                target.insert("libraries".into(), serde_json::Value::Array(libraries));
            }
            "arguments" => {
                let mut arguments = target
                    .get("arguments")
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({}));
                if let (Some(dest), Some(src)) = (arguments.as_object_mut(), value.as_object()) {
                    for (kind, list) in src {
                        let mut merged_list = dest
                            .get(kind)
                            .and_then(|v| v.as_array())
                            .cloned()
                            .unwrap_or_default();
                        if let Some(extra) = list.as_array() {
                            merged_list.extend(extra.iter().cloned());
                        }
                        dest.insert(kind.clone(), serde_json::Value::Array(merged_list));
                    }
                }
                target.insert("arguments".into(), arguments);
            }
            _ => {
                target.insert(key.clone(), value.clone());
            }
        }
    }
    merged
}

pub fn load_merged(game_dir: &Path, version_id: &str) -> Result<serde_json::Value, String> {
    let mut version = read_version_json(game_dir, version_id)?;
    if let Some(parent_id) = version
        .get("inheritsFrom")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
    {
        let parent = load_merged(game_dir, &parent_id)?;
        version = merge_child(&parent, &version);
        if let Some(target) = version.as_object_mut() {
            // 合并后保留子版本自己的 id，但 client jar 通常来自父版本
            if !target.contains_key("jar") {
                target.insert("jar".into(), serde_json::Value::String(parent_id));
            }
        }
    }
    Ok(version)
}

fn rules_allow(rules: Option<&Vec<serde_json::Value>>) -> bool {
    let Some(rules) = rules else {
        return true;
    };
    if rules.is_empty() {
        return true;
    }
    let mut allowed = false;
    for rule in rules {
        let action = rule.get("action").and_then(|v| v.as_str()).unwrap_or("allow");
        let matches = match rule.get("os") {
            Some(os) => {
                let name = os.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let arch = os.get("arch").and_then(|v| v.as_str()).unwrap_or("");
                let name_ok = name.is_empty()
                    || (name == "windows" && cfg!(windows))
                    || (name == "osx" && cfg!(target_os = "macos"))
                    || (name == "linux" && cfg!(target_os = "linux"));
                let arch_ok = arch.is_empty()
                    || (arch == "x86" && cfg!(target_arch = "x86"))
                    || (arch.contains("arm") && cfg!(target_arch = "aarch64"));
                name_ok && arch_ok
            }
            None => match rule.get("features") {
                Some(features) => features
                    .as_object()
                    .map(|map| map.values().all(|value| !value.as_bool().unwrap_or(false)))
                    .unwrap_or(true),
                None => true,
            },
        };
        if matches {
            allowed = action == "allow";
        }
    }
    allowed
}

fn library_path(name: &str) -> Option<String> {
    let (coords, ext) = match name.split_once('@') {
        Some((left, right)) => (left, right),
        None => (name, "jar"),
    };
    let parts: Vec<&str> = coords.split(':').collect();
    if parts.len() < 3 {
        return None;
    }
    let group = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version = parts[2];
    let classifier = parts.get(3).map(|c| format!("-{c}")).unwrap_or_default();
    Some(format!(
        "{group}/{artifact}/{version}/{artifact}-{version}{classifier}.{ext}"
    ))
}

/* ==========================================================================
   natives
   ========================================================================== */

fn extract_natives(
    version: &serde_json::Value,
    libraries_dir: &Path,
    natives_dir: &Path,
) -> Result<(), String> {
    std::fs::create_dir_all(natives_dir).map_err(|e| e.to_string())?;
    let Some(libraries) = version.get("libraries").and_then(|v| v.as_array()) else {
        return Ok(());
    };
    let key = if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "osx"
    } else {
        "linux"
    };

    for library in libraries {
        if !rules_allow(library.get("rules").and_then(|v| v.as_array())) {
            continue;
        }
        // 新格式：downloads.classifiers["natives-windows"]
        let mut jar_path: Option<PathBuf> = None;
        let mut excludes: Vec<String> = Vec::new();
        if let Some(classifiers) = library.get("downloads").and_then(|v| v.get("classifiers")) {
            let classifier = format!("natives-{key}");
            if let Some(download) = classifiers.get(&classifier) {
                if let Some(path) = download.get("path").and_then(|v| v.as_str()) {
                    jar_path = Some(libraries_dir.join(path));
                }
            }
        }
        // 老格式：natives["windows"] = "natives-windows-<ver>"
        if jar_path.is_none() {
            if let Some(natives) = library.get("natives") {
                if let Some(classifier) = natives.get(key).and_then(|v| v.as_str()) {
                    let classifier = classifier
                        .replace("${arch}", if cfg!(target_arch = "x86") { "32" } else { "64" });
                    if let Some(name) = library.get("name").and_then(|v| v.as_str()) {
                        let base = name.rsplit(':').next().unwrap_or("");
                        let _ = base;
                        if let Some(path) =
                            library_path(&format!("{}:{}", name, classifier))
                        {
                            jar_path = Some(libraries_dir.join(path));
                        }
                    }
                }
            }
        }
        if let Some(extract) = library.get("extract") {
            if let Some(list) = extract.get("exclude").and_then(|v| v.as_array()) {
                excludes = list
                    .iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect();
            }
        }

        let Some(jar_path) = jar_path else {
            continue;
        };
        if !jar_path.is_file() {
            continue;
        }
        let Ok(file) = std::fs::File::open(&jar_path) else {
            continue;
        };
        let Ok(mut archive) = zip::ZipArchive::new(file) else {
            continue;
        };
        for index in 0..archive.len() {
            let Ok(mut entry) = archive.by_index(index) else {
                continue;
            };
            let name = entry.name().to_string();
            if name.ends_with('/') || name.starts_with("META-INF/") {
                continue;
            }
            if excludes.iter().any(|rule| name.starts_with(rule)) {
                continue;
            }
            let target = natives_dir.join(&name);
            if let Some(parent) = target.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Ok(mut out) = std::fs::File::create(&target) {
                let _ = std::io::copy(&mut entry, &mut out);
            }
        }
    }
    Ok(())
}

/* ==========================================================================
   authlib-injector
   ========================================================================== */

fn ensure_authlib_injector() -> Option<PathBuf> {
    let target = data_file("authlib-injector.jar");
    if target.is_file() {
        return Some(target);
    }
    let meta: serde_json::Value = http::get_json(
        "https://bmclapi2.bangbang93.com/mirrors/authlib-injector/artifact/latest.json",
    )
    .ok()?;
    let url = meta.get("download_url").and_then(|v| v.as_str())?;
    http::download(url, &target, None, None, None).ok()?;
    Some(target)
}

/* ==========================================================================
   启动
   ========================================================================== */

fn substitute(template: &str, vars: &[(&str, String)]) -> String {
    let mut result = template.to_string();
    for (key, value) in vars {
        result = result.replace(&format!("${{{key}}}"), value);
    }
    result
}

pub fn launch(
    app: &AppHandle,
    state: &LaunchState,
    instance: &Instance,
    account: &Account,
    account_id: Option<String>,
    preferred_java: Option<String>,
) -> Result<u32, String> {
    if state.running.load(Ordering::SeqCst) {
        return Err("ALREADY_RUNNING".into());
    }
    let root = PathBuf::from(&instance.game_dir);
    // 版本隔离：mods / saves / logs 落在 versions/<id> 下，游戏 cwd 也跟着走
    let game_dir = PathBuf::from(crate::store::dir_of(instance));
    let version_id = instance
        .version_id
        .clone()
        .unwrap_or_else(|| instance.mc_version.clone());

    emit_state(app, "resolving", version_id.clone(), None);
    let version = load_merged(&root, &version_id)?;

    // Java
    let java = instance
        .java_path
        .clone()
        .filter(|path| Path::new(path).is_file())
        // 手动指定的 java 也要探一次版本，不然 1.21 配 Java 17 会静默崩在 boot layer
        .and_then(|path| crate::java::probe(Path::new(&path)))
        .or_else(|| {
            let detected = crate::java::detect(&[instance.game_dir.clone()]);
            crate::java::pick(&detected, &instance.mc_version, preferred_java.as_deref())
        })
        .ok_or("NO_JAVA")?;

    // 版本对不上就别硬启动了，JVM 只会吐一句 boot layer 错误然后退出
    let need = crate::java::required_major(&instance.mc_version);
    if java.major > 0 && java.major < need {
        return Err(format!("JAVA_TOO_OLD {} {}", need, java.major));
    }

    let natives_dir = root
        .join("versions")
        .join(&version_id)
        .join("natives");
    emit_state(app, "natives", "", None);
    extract_natives(&version, &root.join("libraries"), &natives_dir)?;

    // classpath：库 + 客户端 jar
    let jar_id = version
        .get("jar")
        .and_then(|v| v.as_str())
        .unwrap_or(&version_id)
        .to_string();
    let mut classpath: Vec<String> = Vec::new();
    if let Some(libraries) = version.get("libraries").and_then(|v| v.as_array()) {
        for library in libraries {
            if !rules_allow(library.get("rules").and_then(|v| v.as_array())) {
                continue;
            }
            let Some(downloads) = library.get("downloads") else {
                continue;
            };
            let Some(artifact) = downloads.get("artifact") else {
                continue;
            };
            if let Some(path) = artifact.get("path").and_then(|v| v.as_str()) {
                let full = root.join("libraries").join(path);
                if full.is_file() {
                    classpath.push(full.to_string_lossy().to_string());
                }
            }
        }
    }
    let client_jar = root
        .join("versions")
        .join(&jar_id)
        .join(format!("{jar_id}.jar"));
    if client_jar.is_file() {
        classpath.push(client_jar.to_string_lossy().to_string());
    }
    let classpath = classpath.join(if cfg!(windows) { ";" } else { ":" });

    // 资源
    let asset_index_id = version
        .get("assetIndex")
        .and_then(|v| v.get("id"))
        .and_then(|v| v.as_str())
        .unwrap_or("legacy")
        .to_string();
    let assets_root = root.join("assets");

    // 账户
    let (uuid, token) = match account.kind.as_str() {
        "offline" => (crate::auth::offline_uuid(&account.profile_name), "0".to_string()),
        _ => (
            account.uuid.clone(),
            account.access_token.clone().unwrap_or_else(|| "0".into()),
        ),
    };
    let user_type = if account.kind == "microsoft" || account.kind == "littleskin" {
        "mojang"
    } else {
        "legacy"
    };

    let vars: Vec<(&str, String)> = vec![
        ("auth_player_name", account.profile_name.clone()),
        ("version_name", version_id.clone()),
        ("game_directory", game_dir.to_string_lossy().to_string()),
        // Forge / NeoForge 的 jvm 参数里 -DlibraryDirectory 和 -p 模块路径都靠这两个，
        // 少一个就会只剩 "Unknown module: cpw.mods.securejarhandler" 然后静默退出
        ("library_directory", root.join("libraries").to_string_lossy().to_string()),
        ("classpath_separator", if cfg!(windows) { ";" } else { ":" }.to_string()),
        ("assets_root", assets_root.to_string_lossy().to_string()),
        ("game_assets", assets_root.to_string_lossy().to_string()),
        ("assets_index_name", asset_index_id.clone()),
        ("auth_uuid", uuid.clone()),
        ("auth_access_token", token.clone()),
        ("auth_session", format!("token:{token}:{uuid}")),
        ("user_type", user_type.to_string()),
        ("version_type", "Ferry".into()),
        ("natives_directory", natives_dir.to_string_lossy().to_string()),
        ("launcher_name", "FerryLauncher".into()),
        ("launcher_version", "0.1.0".into()),
        ("classpath", classpath.clone()),
        ("user_properties", "{}".into()),
        ("clientid", String::new()),
        ("auth_xuid", String::new()),
    ];

    let mut command = Command::new(&java.path);
    command.current_dir(&game_dir);

    // JVM 参数
    command.arg(format!("-Xmx{}M", instance.memory_mb));
    command.arg(format!("-Xms{}M", (instance.memory_mb / 2).max(512)));
    if account.api_root.is_some() {
        if let Some(injector) = ensure_authlib_injector() {
            let root = account.api_root.clone().unwrap_or_default();
            command.arg(format!("-javaagent:{}={root}", injector.to_string_lossy()));
        }
    }

    let mut jvm_args: Vec<String> = Vec::new();
    if let Some(arguments) = version.get("arguments").and_then(|v| v.get("jvm")) {
        for entry in arguments.as_array().into_iter().flatten() {
            match entry {
                serde_json::Value::String(text) => jvm_args.push(substitute(text, &vars)),
                serde_json::Value::Object(map) => {
                    let rules = map.get("rules").and_then(|v| v.as_array());
                    if rules_allow(rules) {
                        let values = map.get("value");
                        match values {
                            Some(serde_json::Value::String(text)) => {
                                jvm_args.push(substitute(text, &vars))
                            }
                            Some(serde_json::Value::Array(list)) => {
                                for item in list {
                                    if let Some(text) = item.as_str() {
                                        jvm_args.push(substitute(text, &vars));
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }
                _ => {}
            }
        }
    } else {
        jvm_args.push("-Djava.library.path=${natives_directory}".into());
        jvm_args.push("-cp".into());
        jvm_args.push("${classpath}".into());
        jvm_args = jvm_args
            .iter()
            .map(|item| substitute(item, &vars))
            .collect();
    }
    for arg in jvm_args {
        command.arg(arg);
    }
    if let Some(extra) = instance.jvm_args.as_deref() {
        for arg in extra.split_whitespace() {
            command.arg(arg);
        }
    }

    // 主类
    let main_class = version
        .get("mainClass")
        .and_then(|v| v.as_str())
        .ok_or("NO_MAIN_CLASS")?;
    command.arg(main_class);

    // 游戏参数
    let mut game_args: Vec<String> = Vec::new();
    if let Some(arguments) = version.get("arguments").and_then(|v| v.get("game")) {
        for entry in arguments.as_array().into_iter().flatten() {
            match entry {
                serde_json::Value::String(text) => game_args.push(substitute(text, &vars)),
                serde_json::Value::Object(map) => {
                    let rules = map.get("rules").and_then(|v| v.as_array());
                    if rules_allow(rules) {
                        if let Some(serde_json::Value::Array(list)) = map.get("value") {
                            for item in list {
                                if let Some(text) = item.as_str() {
                                    game_args.push(substitute(text, &vars));
                                }
                            }
                        } else if let Some(text) = map.get("value").and_then(|v| v.as_str()) {
                            game_args.push(substitute(text, &vars));
                        }
                    }
                }
                _ => {}
            }
        }
    } else if let Some(legacy) = version.get("minecraftArguments").and_then(|v| v.as_str()) {
        for arg in legacy.split_whitespace() {
            game_args.push(substitute(arg, &vars));
        }
    }
    for arg in game_args {
        command.arg(arg);
    }

    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }

    emit_state(app, "spawning", java.path.clone(), None);
    let mut child = command.spawn().map_err(|e| format!("SPAWN_FAILED {e}"))?;
    let pid = child.id();

    let log_path = game_dir.join("logs").join("ferry-latest.log");
    let _ = std::fs::create_dir_all(game_dir.join("logs"));
    let log_file = Arc::new(Mutex::new(
        std::fs::File::create(&log_path).ok().map(std::io::BufWriter::new),
    ));
    // 第一行留完整命令行：崩了要看得出到底传了什么参数
    if let Ok(mut guard) = log_file.lock() {
        if let Some(writer) = guard.as_mut() {
            let _ = writeln!(writer, "=== command ===\n{command:?}\n=== output ===");
            let _ = writer.flush();
        }
    }

    let mut readers = Vec::new();
    if let Some(stdout) = child.stdout.take() {
        readers.push(("stdout".to_string(), Box::new(stdout) as Box<dyn std::io::Read + Send>));
    }
    if let Some(stderr) = child.stderr.take() {
        readers.push(("stderr".to_string(), Box::new(stderr) as Box<dyn std::io::Read + Send>));
    }
    for (stream, reader) in readers {
        let app = app.clone();
        let log_file = log_file.clone();
        std::thread::spawn(move || {
            let buffered = BufReader::new(reader);
            for line in buffered.lines().map_while(Result::ok) {
                if let Ok(mut guard) = log_file.lock() {
                    if let Some(writer) = guard.as_mut() {
                        let _ = writeln!(writer, "{line}");
                        // 每行都刷盘，游戏跑着的时候日志页也能实时看到
                        let _ = writer.flush();
                    }
                }
                let _ = app.emit(
                    "launch:log",
                    LaunchLog {
                        line: line.clone(),
                        stream: stream.clone(),
                    },
                );
            }
        });
    }

    *state.child.lock().unwrap() = Some(child);
    state.running.store(true, Ordering::SeqCst);
    emit_state(app, "running", String::new(), Some(pid));

    // 守护线程：进程退出后复位状态并记录游玩时长
    let app = app.clone();
    let guard_state = state.clone();
    let instance_id = instance.id.clone();
    let refresh_account = account_id.clone();
    let started = std::time::Instant::now();
    let exit_log = log_file.clone();
    let game_dir_for_guard = game_dir.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(800));
        let mut guard = guard_state.child.lock().unwrap();
        let Some(child) = guard.as_mut() else {
            break;
        };
        match child.try_wait() {
            Ok(Some(status)) => {
                let code = status.code().unwrap_or(-1);
                if let Ok(mut writer) = exit_log.lock() {
                    if let Some(writer) = writer.as_mut() {
                        let _ = writeln!(writer, "=== exited with code {code} ===");
                        let _ = writer.flush();
                    }
                }
                // 游戏里 authlib-injector 会刷新 token，这里同步回启动器
                if let Some(id) = refresh_account.clone() {
                    std::thread::spawn(move || {
                        let _ = crate::auth::yggdrasil_refresh(&id);
                    });
                }
                *guard = None;
                guard_state.running.store(false, Ordering::SeqCst);
                emit_state(&app, "exited", format!("{code}"), Some(pid));
                // 异常退出时立刻跑一次日志分析，界面直接弹结论，不用用户自己翻 latest.log
                if code != 0 {
                    let crash_app = app.clone();
                    let crash_dir = game_dir_for_guard.clone();
                    std::thread::spawn(move || {
                        let report = crate::crash::analyze(&crash_dir.to_string_lossy(), code);
                        let _ = crash_app.emit("crash:analysis", report);
                    });
                }
                let app_state = app.state::<crate::store::AppState>();
                let _ = crate::store::record_playtime(
                    &app_state,
                    &instance_id,
                    started.elapsed().as_millis() as i64,
                );
                break;
            }
            Ok(None) => {}
            Err(_) => break,
        }
    });

    Ok(pid)
}

pub fn stop(state: &LaunchState) -> Result<(), String> {
    let mut guard = state.child.lock().unwrap();
    if let Some(child) = guard.as_mut() {
        child.kill().map_err(|e| e.to_string())?;
    }
    *guard = None;
    state.running.store(false, Ordering::SeqCst);
    Ok(())
}

pub fn is_running(state: &LaunchState) -> bool {
    state.running.load(Ordering::SeqCst)
}
