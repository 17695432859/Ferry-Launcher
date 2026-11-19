use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

use crate::util::{is_dir, read_json};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanWarning {
    pub code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chosen: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanCandidate {
    pub game_dir: String,
    pub version_id: Option<String>,
    pub mc_version: String,
    pub loader: String,
    pub loader_version: Option<String>,
    pub suggested_name: String,
    /// 版本隔离：mods / saves / logs 在 versions/<id>/ 里，而不是 .minecraft 根目录
    pub isolated: bool,
    pub warnings: Vec<ScanWarning>,
}

/// 版本目录里有没有游戏内容。有就说明这个版本是隔离的（PCL / HMCL 的常见布局）
fn looks_isolated(version_dir: &Path) -> bool {
    ["mods", "saves", "config", "resourcepacks", "options.txt"]
        .iter()
        .any(|name| version_dir.join(name).exists())
}

const SKIP_DIRS: &[&str] = &[
    "assets",
    "libraries",
    "logs",
    "crash-reports",
    "cache",
    "runtime",
    "jre",
    "java",
    "node_modules",
    "screenshots",
    "shaderpacks",
    "resourcepacks",
    "mods",
    "saves",
    "config",
    "backups",
    "downloads",
    "versions",
];

fn version_json(dir: &Path, folder: &str) -> Option<Value> {
    read_json::<Value>(&dir.join("versions").join(folder).join(format!("{folder}.json")))
}

fn split_version(raw: &str) -> Option<String> {
    let bytes: Vec<char> = raw.chars().collect();
    let mut start = None;
    for (index, ch) in bytes.iter().enumerate() {
        if ch.is_ascii_digit() {
            start = Some(index);
            break;
        }
    }
    let start = start?;
    let rest: String = bytes[start..].iter().collect();
    let end = rest
        .find(|c: char| !(c.is_ascii_digit() || c == '.' || c == '-' || c == '+' || c.is_alphanumeric()))
        .unwrap_or(rest.len());
    let candidate = &rest[..end];
    if candidate.is_empty() {
        None
    } else {
        Some(candidate.to_string())
    }
}

fn library_version(libs: &[Value], needle: &str) -> Option<String> {
    for lib in libs {
        let name = lib.get("name").and_then(|v| v.as_str()).unwrap_or("");
        if name.to_lowercase().contains(needle) {
            let parts: Vec<&str> = name.split(':').collect();
            if parts.len() >= 3 {
                let raw = parts[2];
                // net.minecraftforge:forge:1.20.1-47.2.0 → 47.2.0
                if let Some((head, tail)) = raw.rsplit_once('-') {
                    if head.split('.').count() >= 2 && head.chars().next().is_some_and(|c| c.is_ascii_digit()) {
                        return Some(tail.to_string());
                    }
                }
                return Some(raw.to_string());
            }
        }
    }
    None
}

fn detect_loader(json: &Value) -> (String, Option<String>) {
    let libs = json
        .get("libraries")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let main_class = json
        .get("mainClass")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_lowercase();
    let has = |needle: &str| {
        libs.iter().any(|lib| {
            lib.get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_lowercase()
                .contains(needle)
        })
    };
    if has("net.neoforged") || main_class.contains("neoforge") {
        return ("neoforge".into(), library_version(&libs, "net.neoforged"));
    }
    if has("org.quiltmc") || main_class.contains("quilt") {
        return ("quilt".into(), library_version(&libs, "org.quiltmc"));
    }
    if has("net.fabricmc") || main_class.contains("fabricmc") {
        return ("fabric".into(), library_version(&libs, "net.fabricmc"));
    }
    if has("net.minecraftforge") || main_class.contains("forge") {
        return ("forge".into(), library_version(&libs, "net.minecraftforge"));
    }
    ("vanilla".into(), None)
}

fn parse_loader_tag(raw: Option<&str>) -> (String, Option<String>) {
    let Some(raw) = raw else {
        return ("vanilla".into(), None);
    };
    let lower = raw.to_lowercase();
    if lower.contains("neoforge") {
        return ("neoforge".into(), split_version(raw));
    }
    if lower.contains("quilt") {
        return ("quilt".into(), split_version(raw));
    }
    if lower.contains("fabric") {
        return ("fabric".into(), split_version(raw));
    }
    if lower.contains("forge") {
        return ("forge".into(), split_version(raw));
    }
    ("vanilla".into(), None)
}

fn candidate_from_version(root: &Path, folder: &str) -> Option<ScanCandidate> {
    let json = version_json(root, folder)?;
    let (loader, loader_version) = detect_loader(&json);
    let mc_version = json
        .get("clientVersion")
        .and_then(|v| v.as_str())
        .or_else(|| json.get("inheritsFrom").and_then(|v| v.as_str()))
        .or_else(|| json.get("id").and_then(|v| v.as_str()))
        .unwrap_or(folder)
        .to_string();
    Some(ScanCandidate {
        game_dir: root.to_string_lossy().to_string(),
        isolated: looks_isolated(&root.join("versions").join(folder)),
        version_id: Some(folder.to_string()),
        mc_version,
        loader,
        loader_version,
        suggested_name: folder.to_string(),
        warnings: Vec::new(),
    })
}

fn scan_single(dir: &Path) -> Option<ScanCandidate> {
    let fallback_name = dir
        .file_name()
        .map(|n| n.to_string_lossy().trim_start_matches('.').to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "Minecraft".into());

    // Prism / MultiMC
    if let Some(mmc) = read_json::<Value>(&dir.join("mmc-pack.json")) {
        let components = mmc
            .get("components")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let pick = |uid: &str| -> Option<String> {
            components
                .iter()
                .find(|c| c.get("uid").and_then(|v| v.as_str()) == Some(uid))
                .and_then(|c| c.get("version").and_then(|v| v.as_str()))
                .map(|s| s.to_string())
        };
        if let Some(mc) = pick("net.minecraft") {
            let loaders = [
                ("net.neoforged", "neoforge"),
                ("org.quiltmc.quilt-loader", "quilt"),
                ("net.fabricmc.fabric-loader", "fabric"),
                ("net.minecraftforge", "forge"),
            ];
            for (uid, kind) in loaders {
                if let Some(version) = pick(uid) {
                    return Some(ScanCandidate {
                        game_dir: dir.to_string_lossy().to_string(),
                        isolated: false,
                        version_id: None,
                        mc_version: mc,
                        loader: kind.into(),
                        loader_version: Some(version),
                        suggested_name: fallback_name,
                        warnings: Vec::new(),
                    });
                }
            }
            return Some(ScanCandidate {
                game_dir: dir.to_string_lossy().to_string(),
                isolated: false,
                version_id: None,
                mc_version: mc,
                loader: "vanilla".into(),
                loader_version: None,
                suggested_name: fallback_name,
                warnings: Vec::new(),
            });
        }
    }

    // CurseForge
    if let Some(curse) = read_json::<Value>(&dir.join("minecraftinstance.json")) {
        if let Some(mc) = curse.get("gameVersion").and_then(|v| v.as_str()) {
            let base = curse.get("baseModLoader");
            let tag = base
                .and_then(|b| b.get("name"))
                .and_then(|v| v.as_str())
                .or_else(|| {
                    base.and_then(|b| b.get("mavenVersionString"))
                        .and_then(|v| v.as_str())
                });
            let (loader, loader_version) = parse_loader_tag(tag);
            let name = curse
                .get("name")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or(fallback_name);
            return Some(ScanCandidate {
                game_dir: dir.to_string_lossy().to_string(),
                isolated: false,
                version_id: None,
                mc_version: mc.to_string(),
                loader,
                loader_version,
                suggested_name: name,
                warnings: Vec::new(),
            });
        }
    }

    // 目录本身就是单个版本档案
    let profile_name = dir.file_name().map(|n| n.to_string_lossy().to_string())?;
    if let Some(json) = read_json::<Value>(&dir.join(format!("{profile_name}.json"))) {
        if json.get("id").is_some() {
            let (loader, loader_version) = detect_loader(&json);
            let mc = json
                .get("clientVersion")
                .and_then(|v| v.as_str())
                .or_else(|| json.get("inheritsFrom").and_then(|v| v.as_str()))
                .or_else(|| json.get("id").and_then(|v| v.as_str()))
                .unwrap_or(&profile_name)
                .to_string();
            return Some(ScanCandidate {
                game_dir: dir.to_string_lossy().to_string(),
                isolated: false,
                version_id: None,
                mc_version: mc,
                loader,
                loader_version,
                suggested_name: fallback_name,
                warnings: Vec::new(),
            });
        }
    }
    None
}

/// 扫一个目录里所有的游戏：.minecraft 下每个版本算一个实例
pub fn scan_all(dir: &Path, depth: usize) -> Vec<ScanCandidate> {
    if depth > 2 || !is_dir(dir) {
        return Vec::new();
    }

    let versions_dir: PathBuf = dir.join("versions");
    if is_dir(&versions_dir) {
        let mut found = Vec::new();
        if let Ok(entries) = fs::read_dir(&versions_dir) {
            for entry in entries.flatten() {
                if !entry.path().is_dir() {
                    continue;
                }
                let folder = entry.file_name().to_string_lossy().to_string();
                if let Some(candidate) = candidate_from_version(dir, &folder) {
                    found.push(candidate);
                }
            }
        }
        if !found.is_empty() {
            return found;
        }
    }

    if let Some(single) = scan_single(dir) {
        return vec![single];
    }

    let mut nested = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            if !entry.path().is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            nested.extend(scan_all(&entry.path(), depth + 1));
        }
    }
    nested
}
