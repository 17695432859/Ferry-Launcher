//! 本机 Java 探测。
//!
//! 不查注册表（环境里 reg.exe 可能被拦，而且注册表里的路径经常是残留），
//! 直接扫常见安装目录 + PATH + JAVA_HOME，再用 `java -XshowSettings:properties -version`
//! 读真实版本号。慢一点，但结果可信。

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaInfo {
    pub path: String,
    /// 原始版本串，如 17.0.9 / 1.8.0_392
    pub version: String,
    /// 主版本号，如 8 / 17 / 21
    pub major: u32,
    pub vendor: String,
    pub arch: String,
}

fn java_exe(home: &Path) -> PathBuf {
    if cfg!(windows) {
        home.join("bin").join("java.exe")
    } else {
        home.join("bin").join("java")
    }
}

/// 用 java 自己报出来的属性判断版本，比解析路径可靠
pub fn probe(path: &Path) -> Option<JavaInfo> {
    if !path.is_file() {
        return None;
    }
    let output = Command::new(path)
        .arg("-XshowSettings:properties")
        .arg("-version")
        .output()
        .ok()?;
    let mut text = String::from_utf8_lossy(&output.stderr).to_string();
    text.push_str(&String::from_utf8_lossy(&output.stdout));

    let mut version = String::new();
    let mut vendor = String::new();
    let mut arch = String::new();
    for line in text.lines() {
        let line = line.trim();
        if let Some(value) = line.strip_prefix("java.version =") {
            version = value.trim().to_string();
        } else if let Some(value) = line.strip_prefix("java.vendor =") {
            vendor = value.trim().to_string();
        } else if let Some(value) = line.strip_prefix("os.arch =") {
            arch = value.trim().to_string();
        }
    }
    if version.is_empty() {
        // 有些精简版只打第一行：openjdk version "17.0.9" 2023-10-17
        for line in text.lines() {
            if let Some(start) = line.find('"') {
                if let Some(end) = line[start + 1..].find('"') {
                    version = line[start + 1..start + 1 + end].to_string();
                    break;
                }
            }
        }
    }
    if version.is_empty() {
        return None;
    }

    let major = version
        .split(['.', '_', '-'])
        .next()
        .and_then(|first| first.parse::<u32>().ok())
        .map(|first| if first == 1 { 0 } else { first })
        .unwrap_or(0);
    let major = if major == 0 {
        // 1.8.0_392 → 8
        version
            .split('.')
            .nth(1)
            .and_then(|second| second.parse::<u32>().ok())
            .unwrap_or(8)
    } else {
        major
    };

    Some(JavaInfo {
        path: path.to_string_lossy().to_string(),
        version,
        major,
        vendor,
        arch,
    })
}

/// 可能装着 java 的目录。宁可多列，探测是并行的，多扫几个几乎不花时间。
fn candidate_roots(game_dirs: &[String]) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(home) = std::env::var("JAVA_HOME") {
        roots.push(PathBuf::from(home));
    }

    let looks_java = |path: &Path| -> bool {
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        [
            "java", "jdk", "jre", "zulu", "corretto", "temurin", "graal", "semeru", "bellsoft",
            "adoptium", "microsoft", "openjdk", "liberica", "dragonwell",
        ]
        .iter()
        .any(|key| name.contains(key))
    };

    // 常见 vendor 根目录下钻一层
    #[cfg(windows)]
    {
        let mut bases: Vec<PathBuf> = [
            r"C:/Program Files",
            r"C:/Program Files (x86)",
            r"C:/ProgramData/Oracle/Java",
            r"C:/Program Files/Common Files/Oracle/Java",
        ]
        .iter()
        .map(PathBuf::from)
        .collect();
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            bases.push(PathBuf::from(&local).join("Programs"));
            bases.push(PathBuf::from(&local).join("Java"));
        }
        if let Ok(profile) = std::env::var("USERPROFILE") {
            bases.push(PathBuf::from(&profile).join(".jdks"));
            bases.push(PathBuf::from(&profile).join("scoop").join("apps"));
        }
        for base in bases {
            let Ok(entries) = std::fs::read_dir(&base) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() && looks_java(&path) {
                    roots.push(path);
                }
            }
        }
    }

    // 整合包目录旁边经常躺着启动器自带的 JRE（比如 D:/PCL/java17），
    // 往上翻几层，把兄弟目录里带 java / jdk 字样的都收进来
    for dir in game_dirs {
        let mut cursor = Some(Path::new(dir));
        for _ in 0..4 {
            let Some(current) = cursor else { break };
            if let Ok(entries) = std::fs::read_dir(current) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() && looks_java(&path) {
                        roots.push(path);
                    }
                }
            }
            cursor = current.parent();
        }
    }

    #[cfg(target_os = "macos")]
    {
        roots.push(PathBuf::from("/Library/Java/JavaVirtualMachines"));
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        for base in ["/usr/lib/jvm", "/usr/java", "/opt/java"] {
            roots.push(PathBuf::from(base));
        }
    }
    roots
}

/// 启动器自己下载的运行时（原版启动器会在 .minecraft/runtime 下放 jre）
fn runtime_roots(game_dirs: &[String]) -> Vec<PathBuf> {
    let mut result = Vec::new();
    for dir in game_dirs {
        let runtime = Path::new(dir).join("runtime");
        let Ok(entries) = std::fs::read_dir(&runtime) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            // runtime/java-runtime-gamma/windows-x64/java-runtime-gamma/bin/java.exe
            for nested in std::fs::read_dir(&path).into_iter().flatten().flatten() {
                let nested_path = nested.path();
                if nested_path.is_dir() {
                    for leaf in std::fs::read_dir(&nested_path).into_iter().flatten().flatten() {
                        result.push(leaf.path());
                    }
                }
            }
            result.push(path);
        }
    }
    result
}

/// 把目录展开成 java 可执行文件候选
fn exe_candidates(roots: &[PathBuf]) -> Vec<PathBuf> {
    let mut list: Vec<PathBuf> = Vec::new();
    let mut push = |exe: PathBuf| {
        if exe.is_file() {
            list.push(exe);
        }
    };
    for root in roots {
        let direct = java_exe(root);
        if direct.is_file() {
            push(direct);
            continue;
        }
        let Ok(entries) = std::fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten() {
            let home = entry.path();
            // macOS 是 Contents/Home
            let home = if home.join("Contents").join("Home").is_dir() {
                home.join("Contents").join("Home")
            } else {
                home
            };
            push(java_exe(&home));
        }
    }
    list
}

pub fn detect(game_dirs: &[String]) -> Vec<JavaInfo> {
    let mut roots = candidate_roots(game_dirs);
    roots.extend(runtime_roots(game_dirs));

    let mut candidates = exe_candidates(&roots);
    // PATH 里的 java 也要（可能是 shim / 便携版）
    let path_var = std::env::var("PATH").unwrap_or_default();
    for dir in std::env::split_paths(&path_var) {
        let exe = java_exe(&dir);
        if exe.is_file() {
            candidates.push(exe);
        }
    }

    let mut seen: HashSet<String> = HashSet::new();
    candidates.retain(|exe| seen.insert(exe.to_string_lossy().to_lowercase()));

    // 每个探测都要起一次 JVM，串行扫几十个太慢，这里并行跑
    let total = candidates.len();
    let cursor = std::sync::atomic::AtomicUsize::new(0);
    let found = std::sync::Mutex::new(Vec::new());
    std::thread::scope(|scope| {
        for _ in 0..total.min(8).max(1) {
            scope.spawn(|| loop {
                let index = cursor.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                if index >= total {
                    break;
                }
                if let Some(info) = probe(&candidates[index]) {
                    found.lock().unwrap().push(info);
                }
            });
        }
    });

    let mut result = found.into_inner().unwrap_or_default();
    result.sort_by(|a, b| b.major.cmp(&a.major).then(a.version.cmp(&b.version)));
    result
}

/// Minecraft 各版本需要的 Java 主版本
pub fn required_major(mc_version: &str) -> u32 {
    let parts: Vec<u32> = mc_version
        .split('.')
        .take(2)
        .filter_map(|part| part.parse::<u32>().ok())
        .collect();
    let minor = parts.get(1).copied().unwrap_or(0);
    let patch = mc_version
        .split('.')
        .nth(2)
        .and_then(|part| part.parse::<u32>().ok())
        .unwrap_or(0);
    if minor >= 21 {
        return 21;
    }
    if minor == 20 && patch >= 5 {
        return 21;
    }
    if minor >= 18 {
        return 17;
    }
    if minor == 17 {
        return 16;
    }
    8
}

/// 给某个版本挑一个最合适的 Java：优先主版本刚好够用且最高的
pub fn pick(list: &[JavaInfo], mc_version: &str, preferred: Option<&str>) -> Option<JavaInfo> {
    if let Some(preferred) = preferred {
        if let Some(found) = list.iter().find(|info| info.path.eq_ignore_ascii_case(preferred)) {
            return Some(found.clone());
        }
    }
    let need = required_major(mc_version);
    let mut ok: Vec<&JavaInfo> = list.iter().filter(|info| info.major >= need).collect();
    ok.sort_by_key(|info| info.major);
    ok.first().map(|info| (*info).clone()).or_else(|| list.first().cloned())
}

/* ==========================================================================
   按需下载运行时
   ========================================================================== */

/// 下载一个官方 JRE（Adoptium Temurin）并解压到 `{data}/runtime/jdk{major}`。
///
/// 1.21 需要 Java 21，而很多机器上只装了 8/17；与其让 JVM 静默崩在 boot layer，
/// 不如这里直接把运行时拉下来。返回解压后 java 可执行文件的路径。
pub fn download_major(major: u32) -> Result<String, String> {
    let target = crate::util::data_file(&format!("runtime/jdk{major}"));
    let root = std::path::Path::new(&target);
    let exe = java_exe(root);
    if exe.is_file() {
        return Ok(exe.to_string_lossy().to_string());
    }
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;

    let arch = if cfg!(target_arch = "aarch64") { "aarch64" } else { "x64" };
    let archive = root.join(format!("jdk{major}.zip"));
    let _ = std::fs::remove_file(&archive);

    // 国内镜像优先，直连 Adoptium 放最后（它要跳 GitHub，慢）
    let mut last_error = String::from("JAVA_DOWNLOAD_FAILED");
    let mut fetched = false;
    for base in mirror_bases(major, arch) {
        match download_from_mirror(&base, &archive) {
            Ok(()) => {
                fetched = true;
                break;
            }
            Err(error) => last_error = error,
        }
    }
    if !fetched {
        let url = format!(
            "https://api.adoptium.net/v3/binary/latest/{major}/ga/windows/{arch}/jre/hotspot/normal/eclipse"
        );
        crate::http::download(&url, &archive, None, None, None).map_err(|error| {
            format!("{last_error} / {error}")
        })?;
    }

    let file = std::fs::File::open(&archive).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|e| e.to_string())?;
        let Some(rel) = entry.enclosed_name() else {
            continue;
        };
        // 压缩包里有一层 jdk-21.x.y-jre/ 前缀，去掉它再落盘
        let mut parts = rel.components();
        parts.next();
        let stripped: std::path::PathBuf = parts.as_path().to_path_buf();
        if stripped.as_os_str().is_empty() {
            continue;
        }
        let out = root.join(&stripped);
        if entry.is_dir() {
            let _ = std::fs::create_dir_all(&out);
            continue;
        }
        if let Some(parent) = out.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let mut sink = std::fs::File::create(&out).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut sink).map_err(|e| e.to_string())?;
    }
    let _ = std::fs::remove_file(&archive);

    let exe = java_exe(root);
    if !exe.is_file() {
        return Err("JAVA_UNPACK_FAILED".into());
    }
    Ok(exe.to_string_lossy().to_string())
}

/// Adoptium 的国内镜像。返回目录页地址，里面挑最新的 zip。
fn mirror_bases(major: u32, arch: &str) -> Vec<String> {
    let arch = if arch == "aarch64" { "aarch64" } else { "x64" };
    vec![
        format!("https://mirrors.tuna.tsinghua.edu.cn/Adoptium/{major}/jre/{arch}/windows/"),
        format!("https://mirrors.ustc.edu.cn/adoptium/{major}/jre/{arch}/windows/"),
        format!("https://mirrors.aliyun.com/adoptium/{major}/jre/{arch}/windows/"),
    ]
}

/// 从镜像目录页里挑版本号最大的 zip，然后下载
fn download_from_mirror(base: &str, dest: &std::path::Path) -> Result<(), String> {
    let response = crate::http::client()
        .get(base)
        .send()
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {} {base}", response.status().as_u16()));
    }
    let html = response.text().map_err(|e| e.to_string())?;
    let Some(name) = pick_newest_zip(&html) else {
        return Err(format!("NO_ZIP {base}"));
    };
    crate::http::download(&format!("{base}{name}"), dest, None, None, None).map(|_| ())
}

/// 目录页里形如 <a href="OpenJDK21U-jre_x64_windows_hotspot_21.0.5_11.zip"> 的链接
fn pick_newest_zip(html: &str) -> Option<String> {
    let mut best: Option<String> = None;
    let mut rest = html;
    while let Some(position) = rest.find(".zip") {
        let end = position + 4;
        let start = rest[..end]
            .rfind(|c| c == '"' || c == '\'' || c == '>')
            .map(|index| index + 1)
            .unwrap_or(0);
        let name = &rest[start..end];
        if !name.is_empty() && !name.contains('/') && name.to_lowercase().ends_with(".zip") {
            let candidate = name.to_string();
            best = match best {
                // 按版本号数字比，别按字典序：21.0.9 字典序比 21.0.13 大，会挑到旧版
                Some(current) if version_key(&current) >= version_key(&candidate) => Some(current),
                _ => Some(candidate),
            };
        }
        rest = &rest[end..];
    }
    best
}

/// 从文件名里抽出数字段做版本比较
fn version_key(name: &str) -> Vec<u64> {
    let mut groups: Vec<u64> = Vec::new();
    let mut current = String::new();
    for ch in name.chars() {
        if ch.is_ascii_digit() {
            current.push(ch);
        } else if !current.is_empty() {
            groups.push(current.parse().unwrap_or(0));
            current.clear();
        }
    }
    if !current.is_empty() {
        groups.push(current.parse().unwrap_or(0));
    }
    groups
}
