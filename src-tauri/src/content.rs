//! 实例内容管理：mods / 资源包 / 存档 / 日志。
//!
//! 四类内容的共同点是「列出来 → 看一眼 → 决定留不留」，所以统一成一个模型，
//! 前端只按 kind 切列表，不用为每类写一套 IPC。
//!
//! 删除一律走回收站（trash crate），不做 rm。

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::http;

pub const KINDS: [&str; 4] = ["mods", "resourcepacks", "saves", "logs"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentItem {
    /// 目录内的文件名或文件夹名，作为稳定 key
    pub key: String,
    pub name: String,
    pub version: Option<String>,
    pub description: Option<String>,
    pub size_bytes: u64,
    /// 秒级时间戳
    pub modified: i64,
    pub enabled: bool,
    pub can_toggle: bool,
    pub has_icon: bool,
    /// mod 的 sha1，用来查 Modrinth 更新
    pub sha1: Option<String>,
    /// 附加信息，如加载器 / 存档模式
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewField {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ContentPreview {
    /// image | text | none
    pub kind: String,
    pub image: Option<String>,
    pub text: Option<String>,
    pub fields: Vec<PreviewField>,
}

fn modified_of(path: &Path) -> i64 {
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

fn dir_size(path: &Path) -> u64 {
    let mut total = 0u64;
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    for entry in entries.flatten() {
        let child = entry.path();
        match fs::symlink_metadata(&child) {
            Ok(meta) if meta.is_dir() => total += dir_size(&child),
            Ok(meta) => total += meta.len(),
            Err(_) => {}
        }
    }
    total
}

fn data_url(bytes: &[u8]) -> String {
    use base64::Engine;
    // 绝大多数是 png；jpg 只在少数资源包里出现，按魔数判断
    let mime = if bytes.starts_with(&[0xFF, 0xD8]) {
        "image/jpeg"
    } else if bytes.starts_with(b"GIF8") {
        "image/gif"
    } else {
        "image/png"
    };
    format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

fn sub_dir(game_dir: &str, kind: &str) -> Result<PathBuf, String> {
    if !KINDS.contains(&kind) {
        return Err("BAD_KIND".into());
    }
    Ok(Path::new(game_dir).join(kind))
}

fn safe_child(base: &Path, key: &str) -> Result<PathBuf, String> {
    let name = Path::new(key)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or_else(|| "BAD_NAME".to_string())?;
    if name.is_empty() || name == "." || name == ".." {
        return Err("BAD_NAME".into());
    }
    let path = base.join(name);
    if !path.exists() {
        return Err("NOT_FOUND".into());
    }
    Ok(path)
}

/* ==========================================================================
   mods
   ========================================================================== */

struct ModMeta {
    name: Option<String>,
    version: Option<String>,
    loader: Option<String>,
    description: Option<String>,
    icon: Option<Vec<u8>>,
}

fn zip_text(archive: &mut zip::ZipArchive<fs::File>, name: &str) -> Option<String> {
    let mut entry = archive.by_name(name).ok()?;
    let mut text = String::new();
    entry.read_to_string(&mut text).ok()?;
    Some(text)
}

fn zip_bytes(archive: &mut zip::ZipArchive<fs::File>, name: &str) -> Option<Vec<u8>> {
    let mut entry = archive.by_name(name).ok()?;
    if entry.size() > 4 * 1024 * 1024 {
        return None;
    }
    let mut bytes = Vec::new();
    entry.read_to_end(&mut bytes).ok()?;
    Some(bytes)
}

fn json_str(raw: &str, key: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(raw).ok()?;
    match value.get(key)? {
        serde_json::Value::String(text) => Some(text.clone()),
        serde_json::Value::Number(num) => Some(num.to_string()),
        _ => None,
    }
}

/// mods.toml 的极简解析：只取第一个 [[mods]] 块
fn toml_field(raw: &str, key: &str) -> Option<String> {
    for line in raw.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix(key) {
            if let Some(value) = rest.trim_start().strip_prefix('=') {
                let value = value.trim().trim_matches('"').trim_matches('\'');
                if !value.is_empty() {
                    return Some(value.to_string());
                }
            }
        }
    }
    None
}

fn read_mod_meta(path: &Path) -> ModMeta {
    let empty = ModMeta {
        name: None,
        version: None,
        loader: None,
        description: None,
        icon: None,
    };
    let Ok(file) = fs::File::open(path) else {
        return empty;
    };
    let Ok(mut archive) = zip::ZipArchive::new(file) else {
        return empty;
    };

    // Fabric / Quilt：fabric.mod.json 里带 icon 字段（字符串或尺寸表）
    if let Some(raw) = zip_text(&mut archive, "fabric.mod.json") {
        let loader = "fabric";
        let icon_path = serde_json::from_str::<serde_json::Value>(&raw)
            .ok()
            .and_then(|value| value.get("icon").cloned())
            .and_then(|icon| match icon {
                serde_json::Value::String(text) => Some(text),
                serde_json::Value::Object(map) => map
                    .get("128")
                    .or_else(|| map.get("64"))
                    .or_else(|| map.values().next())
                    .and_then(|v| v.as_str().map(|s| s.to_string())),
                _ => None,
            });
        let icon = icon_path
            .and_then(|path| zip_bytes(&mut archive, path.trim_start_matches('/')))
            .or_else(|| zip_bytes(&mut archive, "pack.png"))
            .or_else(|| zip_bytes(&mut archive, "icon.png"))
            .or_else(|| zip_bytes(&mut archive, "logo.png"));
        return ModMeta {
            name: json_str(&raw, "name").or_else(|| json_str(&raw, "id")),
            version: json_str(&raw, "version"),
            loader: Some(loader.into()),
            description: json_str(&raw, "description"),
            icon,
        };
    }
    if let Some(raw) = zip_text(&mut archive, "quilt.mod.json") {
        let icon = zip_bytes(&mut archive, "pack.png").or_else(|| zip_bytes(&mut archive, "icon.png"));
        return ModMeta {
            name: json_str(&raw, "name").or_else(|| json_str(&raw, "id")),
            version: json_str(&raw, "version"),
            loader: Some("quilt".into()),
            description: None,
            icon,
        };
    }
    for (entry, loader) in [
        ("META-INF/neoforge.mods.toml", "neoforge"),
        ("META-INF/mods.toml", "forge"),
    ] {
        if let Some(raw) = zip_text(&mut archive, entry) {
            let icon = zip_bytes(&mut archive, "pack.png")
                .or_else(|| zip_bytes(&mut archive, "icon.png"))
                .or_else(|| zip_bytes(&mut archive, "logo.png"));
            return ModMeta {
                name: toml_field(&raw, "displayName").or_else(|| toml_field(&raw, "modId")),
                version: toml_field(&raw, "version"),
                loader: Some(loader.into()),
                description: toml_field(&raw, "description"),
                icon,
            };
        }
    }
    let icon = zip_bytes(&mut archive, "pack.png")
        .or_else(|| zip_bytes(&mut archive, "icon.png"))
        .or_else(|| zip_bytes(&mut archive, "logo.png"));
    ModMeta {
        icon,
        ..empty
    }
}

fn pretty_name(file_name: &str) -> String {
    let base = file_name
        .trim_end_matches(".disabled")
        .trim_end_matches(".jar")
        .trim_end_matches(".zip");
    let mut parts: Vec<&str> = base.split('-').collect();
    if parts.len() > 1
        && parts
            .last()
            .is_some_and(|p| p.chars().next().is_some_and(|c| c.is_ascii_digit()))
    {
        parts.pop();
    }
    parts.join(" ")
}

fn list_mods(game_dir: &str) -> Vec<ContentItem> {
    let dir = Path::new(game_dir).join("mods");
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
        let meta = read_mod_meta(&path);
        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        let has_icon = meta.icon.is_some();
        result.push(ContentItem {
            key: file_name.clone(),
            name: meta
                .name
                .unwrap_or_else(|| pretty_name(&file_name)),
            version: meta.version,
            description: meta.description,
            size_bytes: size,
            modified: modified_of(&path),
            enabled,
            can_toggle: true,
            has_icon,
            sha1: if enabled || lower.ends_with(".jar.disabled") {
                http::sha1_of(&path)
            } else {
                None
            },
            note: meta.loader,
        });
    }
    result.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    result
}

/* ==========================================================================
   资源包
   ========================================================================== */

fn pack_description(raw: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(raw).ok()?;
    let description = value.get("pack")?.get("description")?;
    match description {
        serde_json::Value::String(text) => Some(text.clone()),
        serde_json::Value::Object(map) => map
            .get("text")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        serde_json::Value::Array(items) => {
            let text: String = items
                .iter()
                .filter_map(|item| match item {
                    serde_json::Value::String(text) => Some(text.clone()),
                    serde_json::Value::Object(map) => {
                        map.get("text").and_then(|v| v.as_str()).map(|s| s.to_string())
                    }
                    _ => None,
                })
                .collect();
            if text.is_empty() {
                None
            } else {
                Some(text)
            }
        }
        _ => None,
    }
}

fn pack_format(raw: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(raw).ok()?;
    let pack = value.get("pack")?;
    let format = pack.get("pack_format")?;
    Some(format.to_string())
}

fn list_resourcepacks(game_dir: &str) -> Vec<ContentItem> {
    let dir = Path::new(game_dir).join("resourcepacks");
    let Ok(entries) = fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut result = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let raw_name = entry.file_name().to_string_lossy().to_string();
        let lower = raw_name.to_lowercase();
        if !(lower.ends_with(".zip") || lower.ends_with(".zip.disabled") || path.is_dir()) {
            continue;
        }
        // 资源包被禁用时，zip 会加 .disabled 后缀，文件夹则整体改名
        let enabled = !lower.ends_with(".disabled");
        let is_zip = lower.ends_with(".zip") || lower.ends_with(".zip.disabled");

        let (description, format, icon) = if is_zip {
            match fs::File::open(&path).ok().and_then(|f| zip::ZipArchive::new(f).ok()) {
                Some(mut archive) => {
                    let meta = zip_text(&mut archive, "pack.mcmeta");
                    (
                        meta.as_deref().and_then(pack_description),
                        meta.as_deref().and_then(pack_format),
                        zip_bytes(&mut archive, "pack.png"),
                    )
                }
                None => (None, None, None),
            }
        } else {
            let meta = fs::read_to_string(path.join("pack.mcmeta")).ok();
            (
                meta.as_deref().and_then(pack_description),
                meta.as_deref().and_then(pack_format),
                fs::read(path.join("pack.png")).ok(),
            )
        };

        let size = if path.is_dir() {
            dir_size(&path)
        } else {
            entry.metadata().map(|m| m.len()).unwrap_or(0)
        };
        let has_icon = icon.is_some();
        result.push(ContentItem {
            key: raw_name.clone(),
            name: description.clone().unwrap_or_else(|| pretty_name(&raw_name)),
            version: format.map(|value| format!("format {value}")),
            description,
            size_bytes: size,
            modified: modified_of(&path),
            enabled,
            can_toggle: true,
            has_icon,
            sha1: None,
            note: None,
        });
    }
    result.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    result
}

/* ==========================================================================
   存档：level.dat 是 gzip 压缩的 NBT
   ========================================================================== */

#[derive(Debug, Clone)]
enum Nbt {
    Byte(i8),
    Short(i16),
    Int(i32),
    Long(i64),
    Float(f32),
    Double(f64),
    Str(String),
    List(Vec<Nbt>),
    Compound(Vec<(String, Nbt)>),
    IntArray(Vec<i32>),
    LongArray(Vec<i64>),
    ByteArray(Vec<i8>),
}

fn read_nbt_string(cursor: &mut &[u8]) -> Option<String> {
    if cursor.len() < 2 {
        return None;
    }
    let length = u16::from_be_bytes([cursor[0], cursor[1]]) as usize;
    if cursor.len() < 2 + length {
        return None;
    }
    let text = String::from_utf8_lossy(&cursor[2..2 + length]).to_string();
    *cursor = &cursor[2 + length..];
    Some(text)
}

fn take<'a>(cursor: &mut &'a [u8], count: usize) -> Option<&'a [u8]> {
    if cursor.len() < count {
        return None;
    }
    let (head, tail) = cursor.split_at(count);
    *cursor = tail;
    Some(head)
}

fn read_nbt_payload(cursor: &mut &[u8], tag: u8) -> Option<Nbt> {
    Some(match tag {
        1 => Nbt::Byte(take(cursor, 1)?[0] as i8),
        2 => Nbt::Short(i16::from_be_bytes(take(cursor, 2)?.try_into().ok()?)),
        3 => Nbt::Int(i32::from_be_bytes(take(cursor, 4)?.try_into().ok()?)),
        4 => Nbt::Long(i64::from_be_bytes(take(cursor, 8)?.try_into().ok()?)),
        5 => Nbt::Float(f32::from_be_bytes(take(cursor, 4)?.try_into().ok()?)),
        6 => Nbt::Double(f64::from_be_bytes(take(cursor, 8)?.try_into().ok()?)),
        7 => {
            let length = i32::from_be_bytes(take(cursor, 4)?.try_into().ok()?);
            if length < 0 {
                return Some(Nbt::ByteArray(Vec::new()));
            }
            let bytes = take(cursor, length as usize)?;
            Nbt::ByteArray(bytes.iter().map(|b| *b as i8).collect())
        }
        8 => Nbt::Str(read_nbt_string(cursor)?),
        9 => {
            let element = take(cursor, 1)?[0];
            let length = i32::from_be_bytes(take(cursor, 4)?.try_into().ok()?);
            let mut items = Vec::new();
            for _ in 0..length.max(0) {
                items.push(read_nbt_payload(cursor, element)?);
            }
            Nbt::List(items)
        }
        10 => {
            let mut fields = Vec::new();
            loop {
                let kind = take(cursor, 1)?[0];
                if kind == 0 {
                    break;
                }
                let name = read_nbt_string(cursor)?;
                let value = read_nbt_payload(cursor, kind)?;
                fields.push((name, value));
            }
            Nbt::Compound(fields)
        }
        11 => {
            let length = i32::from_be_bytes(take(cursor, 4)?.try_into().ok()?);
            let mut items = Vec::new();
            for _ in 0..length.max(0) {
                items.push(i32::from_be_bytes(take(cursor, 4)?.try_into().ok()?));
            }
            Nbt::IntArray(items)
        }
        12 => {
            let length = i32::from_be_bytes(take(cursor, 4)?.try_into().ok()?);
            let mut items = Vec::new();
            for _ in 0..length.max(0) {
                items.push(i64::from_be_bytes(take(cursor, 8)?.try_into().ok()?));
            }
            Nbt::LongArray(items)
        }
        _ => return None,
    })
}

fn parse_level_dat(path: &Path) -> Option<Nbt> {
    let raw = fs::read(path).ok()?;
    let mut decoded = Vec::new();
    // 现代存档是 gzip；极少数情况是未压缩的，直接兜底
    match flate2::read::GzDecoder::new(raw.as_slice()).read_to_end(&mut decoded) {
        Ok(_) if !decoded.is_empty() => {}
        _ => decoded = raw,
    }
    let mut cursor: &[u8] = decoded.as_slice();
    let tag = *cursor.first()?;
    if tag != 10 {
        return None;
    }
    cursor = &cursor[1..];
    let _root_name = read_nbt_string(&mut cursor)?;
    read_nbt_payload(&mut cursor, 10)
}

fn nbt_get<'a>(value: &'a Nbt, key: &str) -> Option<&'a Nbt> {
    match value {
        Nbt::Compound(fields) => fields.iter().find(|(name, _)| name == key).map(|(_, v)| v),
        _ => None,
    }
}

fn nbt_text(value: &Nbt) -> String {
    match value {
        Nbt::Str(text) => text.clone(),
        Nbt::Byte(number) => number.to_string(),
        Nbt::Short(number) => number.to_string(),
        Nbt::Int(number) => number.to_string(),
        Nbt::Long(number) => number.to_string(),
        Nbt::Float(number) => number.to_string(),
        Nbt::Double(number) => number.to_string(),
        _ => String::new(),
    }
}

fn game_mode_name(value: i64) -> &'static str {
    match value {
        0 => "生存",
        1 => "创造",
        2 => "冒险",
        3 => "旁观",
        _ => "未知",
    }
}

fn list_saves(game_dir: &str) -> Vec<ContentItem> {
    let dir = Path::new(game_dir).join("saves");
    let Ok(entries) = fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut result = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let key = entry.file_name().to_string_lossy().to_string();
        let level = parse_level_dat(&path.join("level.dat"));
        let name = level
            .as_ref()
            .and_then(|nbt| nbt_get(nbt, "Data"))
            .and_then(|data| nbt_get(data, "LevelName"))
            .map(nbt_text)
            .filter(|text| !text.is_empty())
            .unwrap_or_else(|| key.clone());
        let mode = level
            .as_ref()
            .and_then(|nbt| nbt_get(nbt, "Data"))
            .and_then(|data| nbt_get(data, "GameType"))
            .map(|value| game_mode_name(nbt_text(value).parse().unwrap_or(-1)))
            .unwrap_or("未知");
        let has_icon = path.join("icon.png").is_file();
        result.push(ContentItem {
            key: key.clone(),
            name,
            version: None,
            description: None,
            size_bytes: dir_size(&path),
            modified: modified_of(&path),
            enabled: true,
            can_toggle: false,
            has_icon,
            sha1: None,
            note: Some(mode.to_string()),
        });
    }
    result.sort_by(|a, b| b.modified.cmp(&a.modified));
    result
}

/* ==========================================================================
   日志
   ========================================================================== */

fn list_logs(game_dir: &str) -> Vec<ContentItem> {
    let dir = Path::new(game_dir).join("logs");
    let Ok(entries) = fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut result = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let key = entry.file_name().to_string_lossy().to_string();
        let lower = key.to_lowercase();
        if !(lower.ends_with(".log") || lower.ends_with(".txt") || lower.ends_with(".log.gz")) {
            continue;
        }
        result.push(ContentItem {
            key: key.clone(),
            name: key.clone(),
            version: None,
            description: None,
            size_bytes: entry.metadata().map(|m| m.len()).unwrap_or(0),
            modified: modified_of(&path),
            enabled: true,
            can_toggle: false,
            has_icon: false,
            sha1: None,
            note: None,
        });
    }
    result.sort_by(|a, b| b.modified.cmp(&a.modified));
    result
}

/* ==========================================================================
   对外接口
   ========================================================================== */

pub fn list(game_dir: &str, kind: &str) -> Vec<ContentItem> {
    match kind {
        "mods" => list_mods(game_dir),
        "resourcepacks" => list_resourcepacks(game_dir),
        "saves" => list_saves(game_dir),
        "logs" => list_logs(game_dir),
        _ => Vec::new(),
    }
}

pub fn preview(game_dir: &str, kind: &str, key: &str) -> ContentPreview {
    let base = Path::new(game_dir).join(kind);
    let Ok(path) = safe_child(&base, key) else {
        return ContentPreview::default();
    };
    let mut fields = Vec::new();
    match kind {
        "mods" => {
            let meta = read_mod_meta(&path);
            if let Some(loader) = meta.loader {
                fields.push(PreviewField {
                    label: "Loader".into(),
                    value: loader,
                });
            }
            if let Some(version) = meta.version.clone() {
                fields.push(PreviewField {
                    label: "Version".into(),
                    value: version,
                });
            }
            if let Some(description) = meta.description.clone() {
                fields.push(PreviewField {
                    label: "Description".into(),
                    value: description.clone(),
                });
            }
            ContentPreview {
                kind: if meta.icon.is_some() { "image".into() } else { "none".into() },
                image: meta.icon.as_deref().map(data_url),
                text: None,
                fields,
            }
        }
        "resourcepacks" => {
            let (description, format, icon) = if path.is_dir() {
                let meta = fs::read_to_string(path.join("pack.mcmeta")).ok();
                (
                    meta.as_deref().and_then(pack_description),
                    meta.as_deref().and_then(pack_format),
                    fs::read(path.join("pack.png")).ok(),
                )
            } else {
                match fs::File::open(&path).ok().and_then(|f| zip::ZipArchive::new(f).ok()) {
                    Some(mut archive) => {
                        let meta = zip_text(&mut archive, "pack.mcmeta");
                        (
                            meta.as_deref().and_then(pack_description),
                            meta.as_deref().and_then(pack_format),
                            zip_bytes(&mut archive, "pack.png"),
                        )
                    }
                    None => (None, None, None),
                }
            };
            if let Some(format) = format {
                fields.push(PreviewField {
                    label: "Pack format".into(),
                    value: format,
                });
            }
            if let Some(description) = description {
                fields.push(PreviewField {
                    label: "Description".into(),
                    value: description,
                });
            }
            ContentPreview {
                kind: if icon.is_some() { "image".into() } else { "none".into() },
                image: icon.as_deref().map(data_url),
                text: None,
                fields,
            }
        }
        "saves" => {
            let level = parse_level_dat(&path.join("level.dat"));
            if let Some(data) = level.as_ref().and_then(|nbt| nbt_get(nbt, "Data")) {
                for (key, label) in [
                    ("LevelName", "Name"),
                    ("GameType", "Mode"),
                    ("Difficulty", "Difficulty"),
                    ("LastPlayed", "Last played"),
                ] {
                    if let Some(value) = nbt_get(data, key) {
                        let text = if key == "GameType" {
                            game_mode_name(nbt_text(value).parse().unwrap_or(-1)).to_string()
                        } else if key == "LastPlayed" {
                            format_epoch(nbt_text(value).parse().unwrap_or(0))
                        } else {
                            nbt_text(value)
                        };
                        fields.push(PreviewField {
                            label: label.into(),
                            value: text,
                        });
                    }
                }
                if let Some(version) = nbt_get(data, "Version").and_then(|v| nbt_get(v, "Name")) {
                    fields.push(PreviewField {
                        label: "Version".into(),
                        value: nbt_text(version),
                    });
                }
            }
            let icon = fs::read(path.join("icon.png")).ok();
            ContentPreview {
                kind: if icon.is_some() { "image".into() } else { "none".into() },
                image: icon.as_deref().map(data_url),
                text: None,
                fields,
            }
        }
        "logs" => {
            let text = read_log_tail(&path, 64 * 1024).unwrap_or_default();
            ContentPreview {
                kind: "text".into(),
                image: None,
                text: Some(text),
                fields,
            }
        }
        _ => ContentPreview::default(),
    }
}

fn format_epoch(millis: i64) -> String {
    if millis <= 0 {
        return "-".into();
    }
    // 只做「多久以前」的粗粒度展示，避免引入时区库
    let seconds = millis / 1000;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let delta = (now - seconds).max(0);
    if delta < 3600 {
        format!("{} 分钟前", delta / 60)
    } else if delta < 86400 {
        format!("{} 小时前", delta / 3600)
    } else {
        format!("{} 天前", delta / 86400)
    }
}

fn read_log_tail(path: &Path, limit: usize) -> Option<String> {
    let raw = fs::read(path).ok()?;
    let bytes = if path.to_string_lossy().to_lowercase().ends_with(".gz") {
        let mut decoded = Vec::new();
        flate2::read::GzDecoder::new(raw.as_slice())
            .read_to_end(&mut decoded)
            .ok()?;
        decoded
    } else {
        raw
    };
    let slice = if bytes.len() > limit {
        &bytes[bytes.len() - limit..]
    } else {
        &bytes[..]
    };
    Some(String::from_utf8_lossy(slice).to_string())
}

pub fn toggle(game_dir: &str, kind: &str, key: &str, enabled: bool) -> Result<Vec<ContentItem>, String> {
    if kind != "mods" && kind != "resourcepacks" {
        return Err("NOT_TOGGLEABLE".into());
    }
    let base = Path::new(game_dir).join(kind);
    let path = safe_child(&base, key)?;
    let Some(os_name) = path.file_name() else {
        return Err("BAD_FILENAME".into());
    };
    let name = os_name.to_string_lossy().to_string();
    let next = if enabled {
        name.trim_end_matches(".disabled").to_string()
    } else if name.to_lowercase().ends_with(".disabled") {
        name.clone()
    } else {
        format!("{name}.disabled")
    };
    if next != name {
        fs::rename(&path, path.with_file_name(&next)).map_err(|e| e.to_string())?;
    }
    Ok(list(game_dir, kind))
}

pub fn delete(game_dir: &str, kind: &str, key: &str) -> Result<Vec<ContentItem>, String> {
    let base = Path::new(game_dir).join(kind);
    let path = safe_child(&base, key)?;
    trash::delete(&path).map_err(|_| "TRASH_FAILED".to_string())?;
    Ok(list(game_dir, kind))
}

/// 把外部文件导入到某个内容目录（资源包 / 存档压缩包）
pub fn import(game_dir: &str, kind: &str, files: &[PathBuf]) -> Result<(usize, usize), String> {
    if kind != "resourcepacks" && kind != "mods" {
        return Err("NOT_IMPORTABLE".into());
    }
    let dir = Path::new(game_dir).join(kind);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut added = 0;
    let mut skipped = 0;
    for file in files {
        let Some(name) = file.file_name().map(|n| n.to_string_lossy().to_string()) else {
            skipped += 1;
            continue;
        };
        let lower = name.to_lowercase();
        let ok = if kind == "mods" {
            lower.ends_with(".jar")
        } else {
            lower.ends_with(".zip")
        };
        if !ok {
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

/* ==========================================================================
   Modrinth 更新检查
   ========================================================================== */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModUpdate {
    pub key: String,
    pub current_version: Option<String>,
    pub latest_version: String,
    pub project_id: String,
    pub project_title: String,
    pub download_url: String,
    pub file_name: String,
}

/// 用 sha1 反查 Modrinth，再问每个项目的最新版本
pub fn check_updates(game_dir: &str, mc_version: &str, loader: &str) -> Vec<ModUpdate> {
    let mods = list_mods(game_dir);
    let hashes: Vec<String> = mods.iter().filter_map(|item| item.sha1.clone()).collect();
    if hashes.is_empty() {
        return Vec::new();
    }

    let body = serde_json::json!({ "hashes": hashes, "algorithm": "sha1" });
    let found: serde_json::Value = match crate::http::post_json(
        "https://api.modrinth.com/v2/version_files",
        &body,
    ) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    let Some(map) = found.as_object() else {
        return Vec::new();
    };

    let mut updates = Vec::new();
    for item in mods {
        let Some(hash) = item.sha1.as_ref() else {
            continue;
        };
        let Some(current) = map.get(hash) else {
            continue;
        };
        let Some(project_id) = current.get("project_id").and_then(|v| v.as_str()) else {
            continue;
        };
        let loaders = format!("[\"{loader}\"]");
        let url = format!(
            "https://api.modrinth.com/v2/project/{project_id}/version?game_versions=[\"{mc_version}\"]&loaders={loaders}"
        );
        let Ok(versions) = crate::http::get_json::<Vec<serde_json::Value>>(&url) else {
            continue;
        };
        let Some(latest) = versions.first() else {
            continue;
        };
        let latest_id = latest.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let current_id = current.get("id").and_then(|v| v.as_str()).unwrap_or("");
        if latest_id.is_empty() || latest_id == current_id {
            continue;
        }
        let Some(file) = latest
            .get("files")
            .and_then(|v| v.as_array())
            .and_then(|files| files.first())
        else {
            continue;
        };
        updates.push(ModUpdate {
            key: item.key.clone(),
            current_version: item.version.clone(),
            latest_version: latest
                .get("version_number")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            project_id: project_id.to_string(),
            project_title: item.name.clone(),
            download_url: file
                .get("url")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            file_name: file
                .get("filename")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
        });
    }
    updates
}

/// 下载新版并替换旧文件（旧文件进回收站）
pub fn upgrade(
    game_dir: &str,
    old_key: &str,
    url: &str,
    file_name: &str,
) -> Result<Vec<ContentItem>, String> {
    let dir = Path::new(game_dir).join("mods");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe_name = Path::new(file_name)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or_else(|| "BAD_NAME".to_string())?;
    let target = dir.join(&safe_name);
    crate::http::download(url, &target, None, None, None)?;
    if old_key != safe_name {
        let old = safe_path(&dir, old_key)?;
        if old.exists() {
            let _ = trash::delete(&old);
        }
    }
    Ok(list_mods(game_dir))
}

fn safe_path(base: &Path, key: &str) -> Result<PathBuf, String> {
    let name = Path::new(key)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or_else(|| "BAD_NAME".to_string())?;
    Ok(base.join(name))
}
