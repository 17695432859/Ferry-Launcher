use serde::Serialize;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use crate::util::data_dir;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModEntry {
    pub file_name: String,
    pub display_name: String,
    pub version: Option<String>,
    pub loader: Option<String>,
    pub enabled: bool,
    pub size_bytes: u64,
    pub description: Option<String>,
}

pub fn mods_dir(game_dir: &str) -> PathBuf {
    Path::new(game_dir).join("mods")
}

fn read_entry(zip: &mut zip::ZipArchive<fs::File>, name: &str) -> Option<String> {
    let mut file = zip.by_name(name).ok()?;
    let mut buffer = String::new();
    file.read_to_string(&mut buffer).ok()?;
    Some(buffer)
}

fn json_field(raw: &str, key: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(raw).ok()?;
    match value.get(key)? {
        serde_json::Value::String(text) => Some(text.clone()),
        serde_json::Value::Number(num) => Some(num.to_string()),
        _ => None,
    }
}

/// mods.toml / neoforge.mods.toml 的极简解析：只取第一个 [[mods]] 块的字段
fn toml_field(raw: &str, key: &str) -> Option<String> {
    for line in raw.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix(key) {
            let rest = rest.trim_start();
            if let Some(value) = rest.strip_prefix('=') {
                let value = value.trim();
                let value = value.trim_matches('"').trim_matches('\'');
                if !value.is_empty() {
                    return Some(value.to_string());
                }
            }
        }
    }
    None
}

fn read_metadata(path: &Path) -> (Option<String>, Option<String>, Option<String>, Option<String>) {
    let Ok(file) = fs::File::open(path) else {
        return (None, None, None, None);
    };
    let Ok(mut archive) = zip::ZipArchive::new(file) else {
        return (None, None, None, None);
    };

    if let Some(raw) = read_entry(&mut archive, "fabric.mod.json") {
        let name = json_field(&raw, "name").or_else(|| json_field(&raw, "id"));
        let version = json_field(&raw, "version");
        let description = json_field(&raw, "description");
        return (name, version, Some("fabric".into()), description);
    }
    if let Some(raw) = read_entry(&mut archive, "quilt.mod.json") {
        let name = json_field(&raw, "name").or_else(|| json_field(&raw, "id"));
        let version = json_field(&raw, "version");
        return (name, version, Some("quilt".into()), None);
    }
    for (entry, loader) in [
        ("META-INF/neoforge.mods.toml", "neoforge"),
        ("META-INF/mods.toml", "forge"),
    ] {
        if let Some(raw) = read_entry(&mut archive, entry) {
            let name = toml_field(&raw, "displayName").or_else(|| toml_field(&raw, "modId"));
            let version = toml_field(&raw, "version");
            let description = toml_field(&raw, "description");
            return (name, version, Some(loader.into()), description);
        }
    }
    (None, None, None, None)
}

fn pretty_name(file_name: &str) -> String {
    let base = file_name
        .trim_end_matches(".disabled")
        .trim_end_matches(".jar");
    let mut parts: Vec<&str> = base.split('-').collect();
    if parts.len() > 1 {
        // 末尾是版本号的话去掉，留下可读的名字
        if parts.last().is_some_and(|p| p.chars().next().is_some_and(|c| c.is_ascii_digit())) {
            parts.pop();
        }
    }
    parts.join(" ")
}

pub fn list_mods(game_dir: &str) -> Vec<ModEntry> {
    let dir = mods_dir(game_dir);
    let Ok(entries) = fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut result = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy().to_string();
        let lower = file_name.to_lowercase();
        if !(lower.ends_with(".jar") || lower.ends_with(".jar.disabled")) {
            continue;
        }
        let enabled = !lower.ends_with(".disabled");
        let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
        let (name, version, loader, description) = read_metadata(&path);
        result.push(ModEntry {
            file_name: file_name.clone(),
            display_name: name.unwrap_or_else(|| pretty_name(&file_name)),
            version,
            loader,
            enabled,
            size_bytes,
            description,
        });
    }
    result.sort_by(|a, b| {
        a.display_name
            .to_lowercase()
            .cmp(&b.display_name.to_lowercase())
    });
    result
}

fn resolve_file(game_dir: &str, file_name: &str) -> Result<PathBuf, String> {
    let safe = Path::new(file_name)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or_else(|| "BAD_NAME".to_string())?;
    let path = mods_dir(game_dir).join(safe);
    if !path.is_file() {
        return Err("NOT_FOUND".into());
    }
    Ok(path)
}

pub fn toggle_mod(game_dir: &str, file_name: &str, enabled: bool) -> Result<Vec<ModEntry>, String> {
    let path = resolve_file(game_dir, file_name)?;
    let name = path
        .file_name()
        .ok_or("BAD_FILENAME")?
        .to_string_lossy()
        .to_string();
    let next_name = if enabled {
        name.trim_end_matches(".disabled").to_string()
    } else if name.to_lowercase().ends_with(".jar") {
        format!("{name}.disabled")
    } else {
        name.clone()
    };
    if next_name != name {
        fs::rename(&path, path.with_file_name(&next_name)).map_err(|e| e.to_string())?;
    }
    Ok(list_mods(game_dir))
}

pub fn delete_mod(game_dir: &str, file_name: &str) -> Result<Vec<ModEntry>, String> {
    let path = resolve_file(game_dir, file_name)?;
    trash::delete(&path).map_err(|_| "TRASH_FAILED".to_string())?;
    Ok(list_mods(game_dir))
}

/// 把用户选中的 jar 拷进 mods，重名直接跳过
pub fn import_mods(game_dir: &str, files: &[PathBuf]) -> Result<(usize, usize), String> {
    let dir = mods_dir(game_dir);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut added = 0;
    let mut skipped = 0;
    for file in files {
        let Some(name) = file.file_name().map(|n| n.to_string_lossy().to_string()) else {
            skipped += 1;
            continue;
        };
        if !name.to_lowercase().ends_with(".jar") {
            skipped += 1;
            continue;
        }
        let target = dir.join(&name);
        if target.exists() {
            skipped += 1;
            continue;
        }
        if fs::copy(file, &target).is_ok() {
            added += 1;
        } else {
            skipped += 1;
        }
    }
    Ok((added, skipped))
}

/// 实例目录下各子目录；不存在就建出来，方便一键打开
pub fn ensure_sub_dir(game_dir: &str, sub: &str) -> Result<PathBuf, String> {
    let base = Path::new(game_dir);
    let target = if sub.is_empty() {
        base.to_path_buf()
    } else {
        base.join(sub)
    };
    fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    Ok(target)
}

pub fn netplay_dir() -> PathBuf {
    let dir = data_dir().join("netplay");
    let _ = fs::create_dir_all(&dir);
    dir
}
