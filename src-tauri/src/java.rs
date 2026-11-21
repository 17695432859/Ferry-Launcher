//! 本机 Java 探测。
//!
//! 探测顺序（谁先命中用谁）：
//! 1. `JAVA_HOME` 环境变量
//! 2. 注册表 `HKLM/HKCU\SOFTWARE\JavaSoft\*`（Java 官方安装器登记的位置）
//! 3. 常见安装容器目录：`C:\Program Files`、`%LOCALAPPDATA%\Programs`、
//!    `%USERPROFILE%\.jdks`、`.gradle\jdks`、`scoop\apps`……
//! 4. 启动器自己下载的运行时（`%APPDATA%\ferry-launcher\runtime`）
//! 5. 官方 Minecraft 启动器的运行时（`%APPDATA%\.minecraft\runtime`）
//! 6. 各盘根目录（`D:\jdk21`、`D:\桌面\xxx\jdk` 这种不好归类的位置）
//! 7. 系统 `PATH`
//!
//! 注册表通过 `winreg` 直接调 Win32 API，不依赖 `reg.exe`——
//! 后者在很多受限环境里会被安全策略拦掉。
//!
//! 版本号优先读 JDK 根目录下的 `release` 文件，读不到再起一次 JVM 问它自己。

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
    /// 从哪儿发现的，用来在设置页标明来源
    pub source: String,
}

/// 来源的稳定标识，前端按这个翻译
pub const SOURCE_ENV: &str = "env";
pub const SOURCE_REGISTRY: &str = "registry";
pub const SOURCE_JDK: &str = "jdk";
pub const SOURCE_PATH: &str = "path";
pub const SOURCE_MINECRAFT: &str = "minecraft";
pub const SOURCE_RUNTIME: &str = "runtime";

fn java_exe(home: &Path) -> PathBuf {
    if cfg!(windows) {
        home.join("bin").join("java.exe")
    } else {
        home.join("bin").join("java")
    }
}

/// 从版本串里取主版本号：21.0.7 → 21，1.8.0_392 → 8
fn major_of(version: &str) -> u32 {
    let first = version
        .split(['.', '_', '-'])
        .next()
        .and_then(|part| part.parse::<u32>().ok())
        .unwrap_or(0);
    if first == 1 {
        // 1.8.0_392 → 8
        return version
            .split('.')
            .nth(1)
            .and_then(|part| part.parse::<u32>().ok())
            .unwrap_or(8);
    }
    first
}

/// JDK 根目录下的 release 文件带版本号，不用起 JVM 就能读到
fn read_release(root: &Path) -> Option<(String, String, String)> {
    let text = std::fs::read_to_string(root.join("release")).ok()?;
    let mut version = String::new();
    let mut vendor = String::new();
    let mut arch = String::new();
    for line in text.lines() {
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let value = value.trim().trim_matches('"').to_string();
        match key.trim() {
            "JAVA_VERSION" => version = value,
            "IMPLEMENTOR" if vendor.is_empty() => vendor = value,
            "OS_ARCH" => arch = value,
            _ => {}
        }
    }
    if version.is_empty() {
        return None;
    }
    Some((version, vendor, normalize_arch(&arch)))
}

/// release 里写的是 x86_64，JVM 自己报的是 amd64，统一一下
fn normalize_arch(arch: &str) -> String {
    match arch {
        "x86_64" | "x64" | "amd64" => "amd64".to_string(),
        "aarch64" | "arm64" => "aarch64".to_string(),
        "x86" | "i386" | "i686" => "x86".to_string(),
        other => other.to_string(),
    }
}

/// 起一次 JVM，问它自己的版本（release 文件读不到时的兜底）
fn probe_jvm(exe: &Path, source: &str) -> Option<JavaInfo> {
    let output = Command::new(exe)
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

    Some(JavaInfo {
        path: exe.to_string_lossy().to_string(),
        major: major_of(&version),
        version,
        vendor,
        arch: normalize_arch(&arch),
        source: source.to_string(),
    })
}

/// 探测一个 java 可执行文件。优先读 release 文件，读不到再起 JVM。
pub fn probe(path: &Path) -> Option<JavaInfo> {
    probe_at(path, SOURCE_JDK)
}

pub fn probe_at(exe: &Path, source: &str) -> Option<JavaInfo> {
    if !exe.is_file() {
        return None;
    }
    if let Some(root) = exe.parent().and_then(|parent| parent.parent()) {
        if let Some((version, vendor, arch)) = read_release(root) {
            return Some(JavaInfo {
                path: exe.to_string_lossy().to_string(),
                major: major_of(&version),
                version,
                vendor,
                arch,
                source: source.to_string(),
            });
        }
    }
    probe_jvm(exe, source)
}

/* ==========================================================================
   目录扫描
   ========================================================================== */

/// 目录名里带这些词的，多半是 JDK / JRE
fn looks_java(path: &Path) -> bool {
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    [
        "java",
        "jdk",
        "jre",
        "zulu",
        "corretto",
        "temurin",
        "graal",
        "semeru",
        "bellsoft",
        "adoptium",
        "adoptopenjdk",
        "openjdk",
        "liberica",
        "dragonwell",
        "jetbrains",
        "microsoft",
    ]
    .iter()
    .any(|key| name.contains(key))
}

/// 明显不是 Java 安装位置的目录，扫的时候直接跳过，省时间
fn is_junk_dir(name: &str) -> bool {
    matches!(
        name,
        "$recycle.bin"
            | "system volume information"
            | "windows"
            | "windows.old"
            | "recovery"
            | "$winreagent"
            | "driverstore"
            | "perflogs"
            | "node_modules"
            | ".git"
            | ".svn"
            | "packages"
            | "windowsapps"
            | "temp"
            | "tmp"
            | "crashpad"
            | "gpucache"
            | "idle"
            | "systray"
            | "users"
            | "program files"
            | "program files (x86)"
            | "programdata"
    )
}

/// 单个容器目录最多看多少个子目录，防止在超大目录上卡死
const WALK_BUDGET: usize = 8000;

/// 在 root 往下最多 depth 层，找 `bin/java(.exe)`。
/// 命中一个 JDK 根目录就不再往里钻（JDK 里面不会再有别的 JDK）。
fn walk_java_exes(root: &Path, depth: usize, budget: &mut usize, out: &mut Vec<PathBuf>) {
    if depth <= 0 || *budget == 0 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        if *budget == 0 {
            return;
        }
        *budget -= 1;
        let path = entry.path();
        // file_type 走目录句柄里已有的信息，不额外发起 stat；
        // 但符号链接 / 目录联接在 Windows 上会被标成「不是目录」，
        // 这里得跟一下，否则用联接指过去的 JDK 会被整片漏掉。
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let is_dir = if file_type.is_symlink() {
            path.is_dir()
        } else {
            file_type.is_dir()
        };
        if !is_dir {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if is_junk_dir(&name) {
            continue;
        }
        let path = entry.path();
        let exe = java_exe(&path);
        if exe.is_file() {
            out.push(exe);
            continue;
        }
        walk_java_exes(&path, depth - 1, budget, out);
    }
}

/// 注册表里登记的 Java 安装位置（Java 官方安装器 / 部分 IDE 会写）
#[cfg(windows)]
fn registry_java_roots() -> Vec<PathBuf> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    let mut roots: Vec<PathBuf> = Vec::new();
    let local = RegKey::predef(HKEY_LOCAL_MACHINE);
    let user = RegKey::predef(HKEY_CURRENT_USER);

    for subkey in [
        r"SOFTWARE\JavaSoft\JDK",
        r"SOFTWARE\JavaSoft\Java Runtime Environment",
        r"SOFTWARE\JavaSoft\Java Development Kit",
        r"SOFTWARE\WOW6432Node\JavaSoft\JDK",
        r"SOFTWARE\WOW6432Node\JavaSoft\Java Runtime Environment",
        r"SOFTWARE\WOW6432Node\JavaSoft\Java Development Kit",
    ] {
        collect_java_home(&local, subkey, &mut roots);
    }
    for subkey in [
        r"SOFTWARE\JavaSoft\Java Development Kit",
        r"SOFTWARE\JavaSoft\JDK",
    ] {
        collect_java_home(&user, subkey, &mut roots);
    }
    roots
}

#[cfg(windows)]
fn collect_java_home(hive: &winreg::RegKey, subkey: &str, roots: &mut Vec<PathBuf>) {
    let Ok(key) = hive.open_subkey(subkey) else {
        return;
    };
    for name in key.enum_keys().flatten() {
        let Ok(sub) = key.open_subkey(&name) else {
            continue;
        };
        if let Ok(home) = sub.get_value::<String, _>("JavaHome") {
            roots.push(PathBuf::from(home));
        }
    }
    // 老的 JRE 只登记一个 CurrentVersion
    if let Ok(current) = key.get_value::<String, _>("CurrentVersion") {
        if let Ok(sub) = key.open_subkey(&current) {
            if let Ok(home) = sub.get_value::<String, _>("JavaHome") {
                roots.push(PathBuf::from(home));
            }
        }
    }
}

/// 需要往下钻的容器目录：(路径, 来源, 深度)
fn scan_containers(game_dirs: &[String]) -> Vec<(PathBuf, &'static str, usize)> {
    let mut list: Vec<(PathBuf, &'static str, usize)> = Vec::new();

    // 启动器自己下载的运行时
    list.push((crate::util::data_dir().join("runtime"), SOURCE_RUNTIME, 2));

    // 官方 Minecraft 启动器的运行时——很多人的 Java 21 就躺在这
    if let Ok(appdata) = std::env::var("APPDATA") {
        list.push((
            PathBuf::from(&appdata).join(".minecraft").join("runtime"),
            SOURCE_MINECRAFT,
            2,
        ));
    }

    #[cfg(windows)]
    {
        list.push((PathBuf::from(r"C:\Program Files"), SOURCE_JDK, 3));
        list.push((PathBuf::from(r"C:\Program Files (x86)"), SOURCE_JDK, 3));
        list.push((PathBuf::from(r"C:\ProgramData\Oracle\Java"), SOURCE_JDK, 2));
        list.push((PathBuf::from(r"C:\ProgramData\Amazon Corretto"), SOURCE_JDK, 2));
        list.push((PathBuf::from(r"C:\ProgramData\AdoptOpenJDK"), SOURCE_JDK, 2));
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            list.push((PathBuf::from(&local).join("Programs"), SOURCE_JDK, 3));
            list.push((PathBuf::from(&local).join("Java"), SOURCE_JDK, 2));
            list.push((PathBuf::from(&local).join("Microsoft"), SOURCE_JDK, 2));
        }
        if let Ok(profile) = std::env::var("USERPROFILE") {
            list.push((PathBuf::from(&profile).join(".jdks"), SOURCE_JDK, 2));
            list.push((PathBuf::from(&profile).join(".gradle").join("jdks"), SOURCE_JDK, 2));
            list.push((PathBuf::from(&profile).join("scoop").join("apps"), SOURCE_JDK, 3));
        }

        // 各盘根目录：像 D:\jdk21、D:\桌面\xxx\jdk 这种不好归类的位置
        for letter in "CDEFGHIJKLMNOPQRSTUVWXYZ".chars() {
            let root = PathBuf::from(format!("{letter}:\\"));
            if !root.is_dir() {
                continue;
            }
            list.push((root.clone(), SOURCE_JDK, 3));
            list.push((root.join("Program Files"), SOURCE_JDK, 3));
            list.push((root.join("Program Files (x86)"), SOURCE_JDK, 3));
            list.push((root.join("Java"), SOURCE_JDK, 2));
            list.push((root.join("jdk"), SOURCE_JDK, 2));
            list.push((root.join("jre"), SOURCE_JDK, 2));
        }
    }

    #[cfg(target_os = "macos")]
    {
        list.push((
            PathBuf::from("/Library/Java/JavaVirtualMachines"),
            SOURCE_JDK,
            2,
        ));
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        list.push((PathBuf::from("/usr/lib/jvm"), SOURCE_JDK, 2));
        list.push((PathBuf::from("/usr/java"), SOURCE_JDK, 2));
        list.push((PathBuf::from("/opt/java"), SOURCE_JDK, 2));
    }

    // 整合包目录旁边经常躺着启动器自带的 JRE（比如 D:/PCL/java17）
    for dir in game_dirs {
        let mut cursor = Some(Path::new(dir));
        for _ in 0..4 {
            let Some(current) = cursor else { break };
            if let Ok(entries) = std::fs::read_dir(current) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if !path.is_dir() || !looks_java(&path) {
                        continue;
                    }
                    let exe = java_exe(&path);
                    if exe.is_file() {
                        list.push((path.clone(), SOURCE_JDK, 0));
                    } else if let Ok(children) = std::fs::read_dir(&path) {
                        for child in children.flatten() {
                            let child_path = child.path();
                            if !child_path.is_dir() {
                                continue;
                            }
                            let exe = java_exe(&child_path);
                            if exe.is_file() {
                                list.push((child_path.clone(), SOURCE_JDK, 0));
                            }
                        }
                    }
                }
            }
            cursor = current.parent();
        }
    }

    list
}

/// 启动器自己下载的运行时（%APPDATA%/ferry-launcher/runtime/jdk21 之类）
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

/// 一个待探测的 java 可执行文件
struct Candidate {
    exe: PathBuf,
    source: &'static str,
}

fn collect_candidates(game_dirs: &[String]) -> Vec<Candidate> {
    let mut out: Vec<Candidate> = Vec::new();

    // ---- 1. 本身就是 JDK 根目录的地方 ----
    let mut homes: Vec<(PathBuf, &'static str)> = Vec::new();
    if let Ok(home) = std::env::var("JAVA_HOME") {
        homes.push((PathBuf::from(home), SOURCE_ENV));
    }
    #[cfg(windows)]
    homes.extend(
        registry_java_roots()
            .into_iter()
            .map(|path| (path, SOURCE_REGISTRY)),
    );
    for (dir, source) in homes {
        let exe = java_exe(&dir);
        if exe.is_file() {
            out.push(Candidate { exe, source });
        }
    }

    // ---- 2. 需要往下钻的容器目录（并行跑，不然慢） ----
    let containers = scan_containers(game_dirs);
    let found: std::sync::Mutex<Vec<(PathBuf, &'static str)>> = std::sync::Mutex::new(Vec::new());
    std::thread::scope(|scope| {
        for (dir, source, depth) in &containers {
            let dir = dir.clone();
            let source = *source;
            let depth = *depth;
            // 只借用不转移：Mutex 本身留在外层，线程结束后统一取结果
            let sink = &found;
            scope.spawn(move || {
                let mut budget = WALK_BUDGET;
                let mut local: Vec<PathBuf> = Vec::new();
                if depth == 0 {
                    // 已经是确定的 JDK 根目录
                    let exe = java_exe(&dir);
                    if exe.is_file() {
                        local.push(exe);
                    }
                } else {
                    walk_java_exes(&dir, depth, &mut budget, &mut local);
                }
                crate::util::lock(sink).extend(local.into_iter().map(|exe| (exe, source)));
            });
        }
    });
    out.extend(
        found
            .into_inner()
            .unwrap_or_default()
            .into_iter()
            .map(|(exe, source)| Candidate { exe, source }),
    );

    // ---- 3. 实例目录下的 runtime（官方启动器结构） ----
    for root in runtime_roots(game_dirs) {
        let exe = java_exe(&root);
        if exe.is_file() {
            out.push(Candidate {
                exe,
                source: SOURCE_MINECRAFT,
            });
        }
    }

    // ---- 4. PATH 里的 java ----
    // 注意：Oracle 的 javapath 里 java.exe 就在目录根上，不在 bin 下
    let path_var = std::env::var("PATH").unwrap_or_default();
    for dir in std::env::split_paths(&path_var) {
        let direct = if cfg!(windows) {
            dir.join("java.exe")
        } else {
            dir.join("java")
        };
        if direct.is_file() {
            out.push(Candidate {
                exe: direct,
                source: SOURCE_PATH,
            });
        }
        let exe = java_exe(&dir);
        if exe.is_file() {
            out.push(Candidate {
                exe,
                source: SOURCE_PATH,
            });
        }
    }

    out
}

pub fn detect(game_dirs: &[String]) -> Vec<JavaInfo> {
    let candidates = collect_candidates(game_dirs);

    // 同一个安装可能有多个路径（javapath 的软链指向真正的 jdk），
    // 按真实路径去重，避免设置页里出现两条一模一样的 Java
    let mut seen: HashSet<String> = HashSet::new();
    let mut unique: Vec<Candidate> = Vec::new();
    for candidate in candidates {
        let key = std::fs::canonicalize(&candidate.exe)
            .unwrap_or_else(|_| candidate.exe.clone())
            .to_string_lossy()
            .to_lowercase();
        if seen.insert(key) {
            unique.push(candidate);
        }
    }

    // 每个探测都要起一次 JVM，串行扫几十个太慢，这里并行跑
    let total = unique.len();
    let cursor = std::sync::atomic::AtomicUsize::new(0);
    let found = std::sync::Mutex::new(Vec::new());
    std::thread::scope(|scope| {
        for _ in 0..total.min(8).max(1) {
            scope.spawn(|| loop {
                let index = cursor.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                if index >= total {
                    break;
                }
                let candidate = &unique[index];
                if let Some(info) = probe_at(&candidate.exe, candidate.source) {
                    crate::util::lock(&found).push(info);
                }
            });
        }
    });

    let mut result = found.into_inner().unwrap_or_default();

    // 同一份安装可能有多个入口（Oracle 的 javapath 会复制一份 java.exe），
    // 版本和厂商都一样就当成同一个，只保留来源更靠谱的那条
    result.sort_by(|a, b| {
        source_rank(&a.source)
            .cmp(&source_rank(&b.source))
            .then_with(|| a.path.len().cmp(&b.path.len()))
    });
    let mut seen_installs: HashSet<String> = HashSet::new();
    result.retain(|info| {
        seen_installs.insert(format!(
            "{}|{}|{}|{}",
            info.major, info.version, info.vendor, info.arch
        ))
    });

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

/// 同主版本时优先用哪来源：用户自己装的比启动器下载的更可信
fn source_rank(source: &str) -> u8 {
    match source {
        SOURCE_ENV => 0,
        SOURCE_REGISTRY => 1,
        SOURCE_JDK => 2,
        SOURCE_PATH => 3,
        SOURCE_MINECRAFT => 4,
        SOURCE_RUNTIME => 5,
        _ => 6,
    }
}

/// 给某个版本挑一个最合适的 Java：优先主版本刚好够用且最低的
pub fn pick(list: &[JavaInfo], mc_version: &str, preferred: Option<&str>) -> Option<JavaInfo> {
    if let Some(preferred) = preferred {
        if let Some(found) = list
            .iter()
            .find(|info| info.path.eq_ignore_ascii_case(preferred))
        {
            return Some(found.clone());
        }
    }
    let need = required_major(mc_version);
    let mut ok: Vec<&JavaInfo> = list.iter().filter(|info| info.major >= need).collect();
    ok.sort_by(|a, b| {
        a.major
            .cmp(&b.major)
            .then_with(|| source_rank(&a.source).cmp(&source_rank(&b.source)))
            .then_with(|| a.version.cmp(&b.version))
    });
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_major_versions() {
        assert_eq!(major_of("21.0.13"), 21);
        assert_eq!(major_of("17.0.19"), 17);
        assert_eq!(major_of("1.8.0_392"), 8);
        assert_eq!(major_of("25.0.2"), 25);
    }

    #[test]
    fn normalizes_arch_names() {
        assert_eq!(normalize_arch("x86_64"), "amd64");
        assert_eq!(normalize_arch("aarch64"), "aarch64");
    }

    #[test]
    fn skips_obvious_junk_directories() {
        assert!(is_junk_dir("windows"));
        assert!(is_junk_dir("$recycle.bin"));
        assert!(!is_junk_dir("jdk-21"));
        assert!(!is_junk_dir("java-runtime-delta"));
    }

    /// Windows 上目录联接 / 符号链接在 DirEntry 里被标成「不是目录」，
    /// 早期版本因此漏掉了整个联接出来的 JDK。
    #[test]
    #[cfg(windows)]
    fn follows_symlinked_java_dirs() {
        use std::os::windows::fs::symlink_dir;

        let base = std::env::temp_dir().join("ferry-java-link-test");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("real").join("bin")).expect("建目录");
        std::fs::write(base.join("real").join("bin").join("java.exe"), b"").expect("建文件");
        if symlink_dir(base.join("real"), base.join("link")).is_err() {
            println!("跳过：当前环境没有创建符号链接的权限");
            let _ = std::fs::remove_dir_all(&base);
            return;
        }

        let mut budget = 100;
        let mut found: Vec<PathBuf> = Vec::new();
        walk_java_exes(&base, 2, &mut budget, &mut found);
        let hit = found
            .iter()
            .any(|path| path.to_string_lossy().contains("link"));
        let _ = std::fs::remove_dir_all(&base);
        assert!(hit, "没跟着符号链接找到 java.exe: {found:?}");
    }
}

#[cfg(test)]
mod local_probe {
    use super::*;

    /// 手动跑：列出本机所有能探测到的 Java
    #[test]
    #[ignore]
    fn lists_installed_java() {
        let started = std::time::Instant::now();
        let list = detect(&[]);
        println!("耗时 {:?}, 共 {} 个", started.elapsed(), list.len());
        for info in &list {
            println!("  {} | {} | {} | {}", info.major, info.version, info.source, info.path);
        }
    }
}
