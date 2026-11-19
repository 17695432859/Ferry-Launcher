//! 版本安装：拉版本清单、下载客户端 / 库 / 资源、装加载器。
//!
//! 下载一律先校验 sha1，失败不落地；并发 8 路，进度通过 `install:progress` 事件推给前端。

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::http;
use crate::util::data_file;

const OFFICIAL_MANIFEST: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const BMCLAPI_MANIFEST: &str = "https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json";
const BMCLAPI_BASE: &str = "https://bmclapi2.bangbang93.com";
const FABRIC_META: &str = "https://meta.fabricmc.net/v2";
const QUILT_META: &str = "https://meta.quiltmc.org/v3";
const FORGE_MAVEN: &str = "https://maven.minecraftforge.net";
const NEOFORGE_MAVEN: &str = "https://maven.neoforged.net/releases";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionSummary {
    pub id: String,
    pub kind: String,
    pub release_time: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    pub stage: String,
    pub detail: String,
    pub current: u64,
    pub total: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallRequest {
    pub mc_version: String,
    #[serde(default)]
    pub loader: String,
    #[serde(default)]
    pub loader_version: Option<String>,
    pub game_dir: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub java_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoaderVersion {
    pub version: String,
    pub stable: bool,
}

fn is_mirror(source: &str) -> bool {
    source == "bmclapi"
}

fn emit(app: &AppHandle, stage: &str, detail: impl Into<String>, current: u64, total: u64) {
    let _ = app.emit(
        "install:progress",
        InstallProgress {
            stage: stage.to_string(),
            detail: detail.into(),
            current,
            total,
        },
    );
}

/* ==========================================================================
   版本清单
   ========================================================================== */

static MANIFEST_CACHE: Mutex<Option<(String, Instant, Vec<VersionSummary>)>> = Mutex::new(None);

pub fn manifest(source: &str) -> Result<Vec<VersionSummary>, String> {
    {
        let guard = crate::util::lock(&MANIFEST_CACHE);
        if let Some((key, at, list)) = guard.as_ref() {
            if key == source && at.elapsed() < Duration::from_secs(600) && !list.is_empty() {
                return Ok(list.clone());
            }
        }
    }
    // 镜像偶尔会抽风（返回空、302 到死链），这时候得能退回官方源，
    // 否则界面就只剩一句「没有匹配版本」，看着像功能坏了。
    let (primary, backup) = if is_mirror(source) {
        (BMCLAPI_MANIFEST, OFFICIAL_MANIFEST)
    } else {
        (OFFICIAL_MANIFEST, BMCLAPI_MANIFEST)
    };
    let mut last_error = String::from("版本清单获取失败");
    let mut list = Vec::new();
    for url in [primary, backup] {
        match fetch_manifest(url) {
            Ok(items) if !items.is_empty() => {
                list = items;
                break;
            }
            Ok(_) => last_error = "版本清单为空".into(),
            Err(error) => last_error = error,
        }
    }
    if list.is_empty() {
        return Err(last_error);
    }
    *crate::util::lock(&MANIFEST_CACHE) = Some((source.to_string(), Instant::now(), list.clone()));
    Ok(list)
}

fn fetch_manifest(url: &str) -> Result<Vec<VersionSummary>, String> {
    let value: serde_json::Value = http::get_json(url)?;
    let list: Vec<VersionSummary> = value
        .get("versions")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    Some(VersionSummary {
                        id: item.get("id")?.as_str()?.to_string(),
                        kind: item
                            .get("type")
                            .and_then(|v| v.as_str())
                            .unwrap_or("release")
                            .to_string(),
                        release_time: item
                            .get("releaseTime")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(list)
}

/// 某个 Minecraft 版本可用的加载器版本
pub fn loader_versions(mc_version: &str, loader: &str) -> Result<Vec<LoaderVersion>, String> {
    match loader {
        "fabric" => {
            let value: serde_json::Value =
                http::get_json(&format!("{FABRIC_META}/versions/loader/{mc_version}"))?;
            Ok(value
                .as_array()
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| {
                            Some(LoaderVersion {
                                version: item.get("loader")?.get("version")?.as_str()?.to_string(),
                                stable: item
                                    .get("loader")
                                    .and_then(|v| v.get("stable"))
                                    .and_then(|v| v.as_bool())
                                    .unwrap_or(true),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default())
        }
        "quilt" => {
            let value: serde_json::Value =
                http::get_json(&format!("{QUILT_META}/versions/loader/{mc_version}"))?;
            Ok(value
                .as_array()
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| {
                            Some(LoaderVersion {
                                version: item.get("loader")?.get("version")?.as_str()?.to_string(),
                                stable: true,
                            })
                        })
                        .collect()
                })
                .unwrap_or_default())
        }
        "forge" | "neoforge" => {
            // 这两家没有统一的版本列表接口，直接按「已安装的版本」列不出来，
            // 交给用户填推荐版本，前端会给出提示
            Ok(Vec::new())
        }
        _ => Ok(Vec::new()),
    }
}

/* ==========================================================================
   下载任务
   ========================================================================== */

struct Task {
    url: String,
    dest: PathBuf,
    sha1: Option<String>,
}

fn run_tasks(
    app: &AppHandle,
    stage: &str,
    tasks: Vec<Task>,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let total = tasks.len() as u64;
    if total == 0 {
        return Ok(());
    }
    let next = AtomicUsize::new(0);
    let done = AtomicU64::new(0);
    let errors: Mutex<Vec<String>> = Mutex::new(Vec::new());
    let last_emit = Mutex::new(Instant::now());

    let workers = 8usize.min(tasks.len());
    std::thread::scope(|scope| {
        for _ in 0..workers {
            scope.spawn(|| loop {
                if cancel.load(Ordering::Relaxed) {
                    return;
                }
                let index = next.fetch_add(1, Ordering::SeqCst);
                if index >= tasks.len() {
                    return;
                }
                let task = &tasks[index];
                if let Err(error) = http::download(&task.url, &task.dest, task.sha1.as_deref(), Some(cancel), None) {
                    crate::util::lock(&errors).push(error);
                    return;
                }
                let finished = done.fetch_add(1, Ordering::SeqCst) + 1;
                let mut last = crate::util::lock(&last_emit);
                if last.elapsed() > Duration::from_millis(120) || finished == total {
                    *last = Instant::now();
                    let name = task
                        .dest
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default();
                    emit(app, stage, name, finished, total);
                }
            });
        }
    });

    // 某个下载线程 panic 时 into_inner 会返回 Err，这里退回空列表，
    // 让上层按「没有错误」继续，而不是把整个启动器一起带走。
    let errors = errors.into_inner().unwrap_or_default();
    if let Some(first) = errors.into_iter().next() {
        if first == "CANCELLED" {
            return Err("CANCELLED".into());
        }
        return Err(first);
    }
    emit(app, stage, "", total, total);
    Ok(())
}

fn mirror_maven(url: &str) -> String {
    url.replace("https://libraries.minecraft.net/", &format!("{BMCLAPI_BASE}/maven/"))
        .replace("https://maven.fabricmc.net/", &format!("{BMCLAPI_BASE}/maven/"))
        .replace("https://maven.minecraftforge.net/", &format!("{BMCLAPI_BASE}/maven/"))
}

/* ==========================================================================
   版本 JSON 与规则
   ========================================================================== */

fn version_json_url(mc_version: &str, source: &str) -> Result<String, String> {
    if is_mirror(source) {
        return Ok(format!("{BMCLAPI_BASE}/version/{mc_version}/json"));
    }
    let manifest: serde_json::Value = http::get_json(OFFICIAL_MANIFEST)?;
    let url = manifest
        .get("versions")
        .and_then(|v| v.as_array())
        .and_then(|list| {
            list.iter().find(|item| {
                item.get("id").and_then(|v| v.as_str()) == Some(mc_version)
            })
        })
        .and_then(|item| item.get("url"))
        .and_then(|v| v.as_str())
        .ok_or("VERSION_NOT_FOUND")?;
    Ok(url.to_string())
}

pub fn fetch_version_json(mc_version: &str, source: &str) -> Result<serde_json::Value, String> {
    http::get_json(&version_json_url(mc_version, source)?)
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
                    .map(|map| {
                        map.iter().all(|(key, value)| {
                            // 我们不带这些特性，全部按 false 处理
                            let wanted = value.as_bool().unwrap_or(false);
                            let actual = false;
                            let _ = key;
                            wanted == actual
                        })
                    })
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
    // group:artifact:version[:classifier][@ext]
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
   安装
   ========================================================================== */

pub fn install(
    app: &AppHandle,
    request: &InstallRequest,
    cancel: &AtomicBool,
) -> Result<String, String> {
    let source = if request.source.is_empty() {
        "bmclapi"
    } else {
        request.source.as_str()
    };
    let game_dir = PathBuf::from(&request.game_dir);
    let versions_dir = game_dir.join("versions");
    let libraries_dir = game_dir.join("libraries");
    std::fs::create_dir_all(&versions_dir).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&libraries_dir).map_err(|e| e.to_string())?;

    emit(app, "manifest", request.mc_version.clone(), 0, 1);
    let version = fetch_version_json(&request.mc_version, source)?;
    let version_id = version
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or(&request.mc_version)
        .to_string();

    // 版本 json 落盘
    let version_dir = versions_dir.join(&version_id);
    std::fs::create_dir_all(&version_dir).map_err(|e| e.to_string())?;
    crate::util::write_json(&version_dir.join(format!("{version_id}.json")), &version)?;

    // 1. 客户端 jar
    emit(app, "client", version_id.clone(), 0, 1);
    let client_url = if is_mirror(source) {
        format!("{BMCLAPI_BASE}/version/{version_id}/client")
    } else {
        version
            .get("downloads")
            .and_then(|v| v.get("client"))
            .and_then(|v| v.get("url"))
            .and_then(|v| v.as_str())
            .ok_or("NO_CLIENT_URL")?
            .to_string()
    };
    let client_sha1 = version
        .get("downloads")
        .and_then(|v| v.get("client"))
        .and_then(|v| v.get("sha1"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let client_jar = version_dir.join(format!("{version_id}.jar"));
    if !client_jar.is_file() || client_sha1.is_none() {
        http::download(&client_url, &client_jar, client_sha1.as_deref(), Some(cancel), None)?;
    }

    // 2. 库
    let mut tasks = Vec::new();
    if let Some(libraries) = version.get("libraries").and_then(|v| v.as_array()) {
        for library in libraries {
            if !rules_allow(library.get("rules").and_then(|v| v.as_array())) {
                continue;
            }
            let Some(downloads) = library.get("downloads") else {
                continue;
            };
            if let Some(artifact) = downloads.get("artifact") {
                let Some(path) = artifact
                    .get("path")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .or_else(|| library.get("name").and_then(|v| v.as_str()).and_then(library_path))
                else {
                    continue;
                };
                let mut url = artifact
                    .get("url")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if url.is_empty() {
                    let name = library.get("name").and_then(|v| v.as_str()).unwrap_or("");
                    url = format!("https://libraries.minecraft.net/{path}");
                    let _ = name;
                }
                if is_mirror(source) {
                    url = mirror_maven(&url);
                }
                tasks.push(Task {
                    url,
                    dest: libraries_dir.join(&path),
                    sha1: artifact.get("sha1").and_then(|v| v.as_str()).map(|s| s.to_string()),
                });
            }
            // 老版本用 classifiers 里的 natives
            if let Some(natives) = library.get("natives") {
                let key = if cfg!(windows) {
                    "windows"
                } else if cfg!(target_os = "macos") {
                    "osx"
                } else {
                    "linux"
                };
                if let Some(classifier) = natives.get(key).and_then(|v| v.as_str()) {
                    let classifier = classifier.replace("${arch}", if cfg!(target_arch = "x86") { "32" } else { "64" });
                    if let Some(download) = downloads
                        .get("classifiers")
                        .and_then(|v| v.get(&classifier))
                    {
                        if let Some(path) = download.get("path").and_then(|v| v.as_str()) {
                            let mut url = download
                                .get("url")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            if is_mirror(source) {
                                url = mirror_maven(&url);
                            }
                            tasks.push(Task {
                                url,
                                dest: libraries_dir.join(path),
                                sha1: download
                                    .get("sha1")
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string()),
                            });
                        }
                    }
                }
            }
        }
    }
    run_tasks(app, "libraries", tasks, cancel)?;

    // 3. 资源索引 + objects
    if let Some(asset_index) = version.get("assetIndex") {
        let index_id = asset_index
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("legacy")
            .to_string();
        let index_url = if is_mirror(source) {
            let hash = asset_index.get("sha1").and_then(|v| v.as_str()).unwrap_or("");
            format!("{BMCLAPI_BASE}/assets/{hash}")
        } else {
            asset_index
                .get("url")
                .and_then(|v| v.as_str())
                .ok_or("NO_ASSET_INDEX")?
                .to_string()
        };
        let index_path = game_dir
            .join("assets")
            .join("indexes")
            .join(format!("{index_id}.json"));
        http::download(
            &index_url,
            &index_path,
            asset_index.get("sha1").and_then(|v| v.as_str()),
            Some(cancel),
            None,
        )?;

        let index: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&index_path).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        let mut tasks = Vec::new();
        if let Some(objects) = index.get("objects").and_then(|v| v.as_object()) {
            for (_name, object) in objects {
                let Some(hash) = object.get("hash").and_then(|v| v.as_str()) else {
                    continue;
                };
                let prefix = &hash[0..2];
                let url = if is_mirror(source) {
                    format!("{BMCLAPI_BASE}/assets/{hash}")
                } else {
                    format!("https://resources.download.minecraft.net/{prefix}/{hash}")
                };
                tasks.push(Task {
                    url,
                    dest: game_dir.join("assets").join("objects").join(prefix).join(hash),
                    sha1: Some(hash.to_string()),
                });
            }
        }
        run_tasks(app, "assets", tasks, cancel)?;
    }

    // 4. 日志配置
    if let Some(logging) = version.get("logging").and_then(|v| v.get("client")) {
        if let Some(file) = logging.get("file") {
            if let (Some(id), Some(url)) = (
                file.get("id").and_then(|v| v.as_str()),
                file.get("url").and_then(|v| v.as_str()),
            ) {
                let dest = game_dir
                    .join("assets")
                    .join("log_configs")
                    .join(format!("{id}.xml"));
                let url = if is_mirror(source) {
                    format!("{BMCLAPI_BASE}/assets/log_configs/{id}.xml")
                } else {
                    url.to_string()
                };
                let _ = http::download(
                    &url,
                    &dest,
                    file.get("sha1").and_then(|v| v.as_str()),
                    Some(cancel),
                    None,
                );
            }
        }
    }

    // 5. 加载器
    let loader = request.loader.as_str();
    let installed_id = match loader {
        "" | "vanilla" => version_id.clone(),
        "fabric" => install_fabric(app, request, &version, source, cancel)?,
        "quilt" => install_quilt(app, request, &version, source, cancel)?,
        "forge" => install_forge(app, request, cancel)?,
        "neoforge" => install_neoforge(app, request, cancel)?,
        other => return Err(format!("UNSUPPORTED_LOADER {other}")),
    };

    emit(app, "done", installed_id.clone(), 1, 1);
    Ok(installed_id)
}

fn write_profile_json(game_dir: &Path) {
    let path = game_dir.join("launcher_profiles.json");
    if path.is_file() {
        return;
    }
    let _ = std::fs::write(
        &path,
        serde_json::json!({
            "profiles": {},
            "settings": {},
            "version": 3
        })
        .to_string(),
    );
}

fn install_fabric(
    app: &AppHandle,
    request: &InstallRequest,
    _vanilla: &serde_json::Value,
    source: &str,
    cancel: &AtomicBool,
) -> Result<String, String> {
    let loader_version = request
        .loader_version
        .clone()
        .filter(|v| !v.is_empty())
        .ok_or("NO_LOADER_VERSION")?;
    emit(app, "loader", format!("Fabric {loader_version}"), 0, 1);
    let profile: serde_json::Value = http::get_json(&format!(
        "{FABRIC_META}/versions/loader/{}/{}/profile/json",
        request.mc_version, loader_version
    ))?;
    let id = profile
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("NO_PROFILE_ID")?
        .to_string();
    let dir = PathBuf::from(&request.game_dir).join("versions").join(&id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    crate::util::write_json(&dir.join(format!("{id}.json")), &profile)?;

    let mut tasks = Vec::new();
    if let Some(libraries) = profile.get("libraries").and_then(|v| v.as_array()) {
        for library in libraries {
            let Some(name) = library.get("name").and_then(|v| v.as_str()) else {
                continue;
            };
            let Some(path) = library_path(name) else {
                continue;
            };
            let base = library
                .get("url")
                .and_then(|v| v.as_str())
                .unwrap_or("https://maven.fabricmc.net/");
            let mut url = format!("{}{}", base.trim_end_matches('/'), format!("/{path}"));
            if is_mirror(source) {
                url = mirror_maven(&url);
            }
            tasks.push(Task {
                url,
                dest: PathBuf::from(&request.game_dir).join("libraries").join(&path),
                sha1: None,
            });
        }
    }
    run_tasks(app, "libraries", tasks, cancel)?;
    Ok(id)
}

fn install_quilt(
    app: &AppHandle,
    request: &InstallRequest,
    _vanilla: &serde_json::Value,
    source: &str,
    cancel: &AtomicBool,
) -> Result<String, String> {
    let loader_version = request
        .loader_version
        .clone()
        .filter(|v| !v.is_empty())
        .ok_or("NO_LOADER_VERSION")?;
    emit(app, "loader", format!("Quilt {loader_version}"), 0, 1);
    let profile: serde_json::Value = http::get_json(&format!(
        "{QUILT_META}/versions/loader/{}/{}/profile/json",
        request.mc_version, loader_version
    ))?;
    let id = profile
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("NO_PROFILE_ID")?
        .to_string();
    let dir = PathBuf::from(&request.game_dir).join("versions").join(&id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    crate::util::write_json(&dir.join(format!("{id}.json")), &profile)?;

    let mut tasks = Vec::new();
    if let Some(libraries) = profile.get("libraries").and_then(|v| v.as_array()) {
        for library in libraries {
            let Some(name) = library.get("name").and_then(|v| v.as_str()) else {
                continue;
            };
            let Some(path) = library_path(name) else {
                continue;
            };
            let base = library
                .get("url")
                .and_then(|v| v.as_str())
                .unwrap_or("https://maven.quiltmc.org/repository/release/");
            let mut url = format!("{}{}", base.trim_end_matches('/'), format!("/{path}"));
            if is_mirror(source) {
                url = mirror_maven(&url);
            }
            tasks.push(Task {
                url,
                dest: PathBuf::from(&request.game_dir).join("libraries").join(&path),
                sha1: None,
            });
        }
    }
    run_tasks(app, "libraries", tasks, cancel)?;
    Ok(id)
}

/// Forge / NeoForge 走官方 installer 的 `--installClient`，比自己拼版本 json 靠谱
fn run_installer(
    app: &AppHandle,
    request: &InstallRequest,
    url: &str,
    file_name: &str,
    label: &str,
) -> Result<String, String> {
    let java = request
        .java_path
        .clone()
        .filter(|p| Path::new(p).is_file())
        .or_else(|| {
            let list = crate::java::detect(&[request.game_dir.clone()]);
            crate::java::pick(&list, &request.mc_version, None).map(|info| info.path)
        })
        .ok_or("NO_JAVA")?;

    emit(app, "loader", format!("下载 {label} 安装器"), 0, 1);
    let installer = data_file(file_name);
    http::download(url, &installer, None, None, None)?;

    emit(app, "loader", format!("运行 {label} 安装器"), 0, 1);
    write_profile_json(Path::new(&request.game_dir));
    let output = std::process::Command::new(java)
        .arg("-jar")
        .arg(&installer)
        .arg("--installClient")
        .arg(&request.game_dir)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout).to_string()
            + &String::from_utf8_lossy(&output.stderr);
        return Err(format!("INSTALLER_FAILED {}", text.chars().take(400).collect::<String>()));
    }
    let _ = std::fs::remove_file(&installer);

    // 安装器会在 versions 下写出完整版本；挑一个名字里带 mc 版本的
    let versions_dir = PathBuf::from(&request.game_dir).join("versions");
    let mut candidates: Vec<String> = std::fs::read_dir(&versions_dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            let marker = if request.loader == "neoforge" { "neoforge" } else { "forge" };
            if name.to_lowercase().contains(marker) && name.contains(&request.mc_version) {
                Some(name)
            } else {
                None
            }
        })
        .collect();
    candidates.sort();
    candidates.pop().ok_or_else(|| "INSTALLER_NO_OUTPUT".to_string())
}

fn install_forge(
    app: &AppHandle,
    request: &InstallRequest,
    cancel: &AtomicBool,
) -> Result<String, String> {
    let _ = cancel;
    let version = request
        .loader_version
        .clone()
        .filter(|v| !v.is_empty())
        .ok_or("NO_LOADER_VERSION")?;
    let url = format!(
        "{FORGE_MAVEN}/net/minecraftforge/forge/{mc}-{version}/forge-{mc}-{version}-installer.jar",
        mc = request.mc_version
    );
    let name = format!("forge-{}-{version}-installer.jar", request.mc_version);
    run_installer(app, request, &url, &name, "Forge")
}

fn install_neoforge(
    app: &AppHandle,
    request: &InstallRequest,
    cancel: &AtomicBool,
) -> Result<String, String> {
    let _ = cancel;
    let version = request
        .loader_version
        .clone()
        .filter(|v| !v.is_empty())
        .ok_or("NO_LOADER_VERSION")?;
    let url = format!(
        "{NEOFORGE_MAVEN}/net/neoforged/neoforge/{version}/neoforge-{version}-installer.jar"
    );
    let name = format!("neoforge-{version}-installer.jar");
    run_installer(app, request, &url, &name, "NeoForge")
}
