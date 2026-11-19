use serde::Serialize;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;

use crate::mods::list_mods;
use crate::store::Instance;

const CONFIG_DIRS: &[&str] = &["mods", "config", "defaultconfigs", "resourcepacks", "shaderpacks"];
const CONFIG_FILES: &[&str] = &["options.txt", "optionsof.txt", "servers.dat"];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOutcome {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entries: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

fn collect(dir: &Path, relative: &str, out: &mut Vec<(PathBuf, String)>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let rel = format!("{relative}/{name}");
        if path.is_dir() {
            collect(&path, &rel, out);
        } else if path.is_file() {
            out.push((path, rel));
        }
    }
}

/// 导出实例为整合包 zip：只读原目录，不改不删
pub fn export_instance(instance: &Instance, include_saves: bool, target: &Path) -> ExportOutcome {
    let root = Path::new(&instance.game_dir);
    let mut files: Vec<(PathBuf, String)> = Vec::new();

    for dir in CONFIG_DIRS {
        collect(&root.join(dir), dir, &mut files);
    }
    if include_saves {
        collect(&root.join("saves"), "saves", &mut files);
    }
    for file in CONFIG_FILES {
        let path = root.join(file);
        if path.is_file() {
            files.push((path, (*file).to_string()));
        }
    }

    if files.is_empty() {
        return ExportOutcome {
            ok: false,
            path: None,
            entries: None,
            reason: Some("empty".into()),
            message: None,
        };
    }

    let mods = list_mods(&instance.game_dir);
    let manifest = serde_json::json!({
        "format": "ferry-instance/1",
        "exportedAt": now_iso8601(),
        "name": instance.name,
        "mcVersion": instance.mc_version,
        "loader": instance.loader,
        "loaderVersion": instance.loader_version,
        "memoryMb": instance.memory_mb,
        "isolated": instance.isolated.unwrap_or(true),
        "mods": mods.iter().map(|m| serde_json::json!({"fileName": m.file_name, "enabled": m.enabled})).collect::<Vec<_>>()
    });

    let Ok(file) = File::create(target) else {
        return error("无法创建文件");
    };
    let mut writer = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    let mut count = 0usize;
    for (path, rel) in &files {
        if writer.start_file(rel.as_str(), options).is_err() {
            continue;
        }
        if let Ok(mut source) = File::open(path) {
            let mut buffer = Vec::new();
            if source.read_to_end(&mut buffer).is_ok() && writer.write_all(&buffer).is_ok() {
                count += 1;
            }
        }
    }
    if writer
        .start_file("ferry-instance.json", options)
        .is_ok()
    {
        let text = serde_json::to_string_pretty(&manifest).unwrap_or_default();
        let _ = writer.write_all(text.as_bytes());
    }
    let _ = writer.finish();

    ExportOutcome {
        ok: true,
        path: Some(target.to_string_lossy().to_string()),
        entries: Some(count),
        reason: None,
        message: None,
    }
}

fn error(message: &str) -> ExportOutcome {
    ExportOutcome {
        ok: false,
        path: None,
        entries: None,
        reason: Some("error".into()),
        message: Some(message.to_string()),
    }
}

fn now_iso8601() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}
