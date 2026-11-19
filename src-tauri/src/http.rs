//! 统一的 HTTP 访问层。
//!
//! 全部是阻塞调用：Tauri 命令跑在独立线程池里，用阻塞 client 比到处 spawn async 简单，
//! 也方便把下载进度直接通过事件推给前端。

use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use sha1::{Digest, Sha1};

pub const UA: &str = "FerryLauncher/0.1.0 (+https://github.com/ferry-launcher)";

pub fn client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .user_agent(UA)
        .timeout(Duration::from_secs(60))
        .connect_timeout(Duration::from_secs(15))
        .build()
        .unwrap_or_else(|_| reqwest::blocking::Client::new())
}

pub fn get_json<T: serde::de::DeserializeOwned>(url: &str) -> Result<T, String> {
    let response = client().get(url).send().map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {} {}", response.status().as_u16(), url));
    }
    response.json::<T>().map_err(|e| e.to_string())
}

pub fn get_text(url: &str) -> Result<String, String> {
    let response = client().get(url).send().map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {} {}", response.status().as_u16(), url));
    }
    response.text().map_err(|e| e.to_string())
}

pub fn post_json<T: serde::de::DeserializeOwned>(
    url: &str,
    body: &serde_json::Value,
) -> Result<T, String> {
    let response = client()
        .post(url)
        .json(body)
        .send()
        .map_err(|e| e.to_string())?;
    let status = response.status();
    let text = response.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("HTTP {} {}", status.as_u16(), text));
    }
    serde_json::from_str(&text).map_err(|e| format!("{e} · {text}"))
}

/// 文件内容的 sha1（小写十六进制），文件不存在返回 None
pub fn sha1_of(path: &Path) -> Option<String> {
    let mut file = std::fs::File::open(path).ok()?;
    let mut hasher = Sha1::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).ok()?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Some(hex::encode(hasher.finalize()))
}

/// 下载到目标路径。目标已存在且 sha1 一致时直接跳过，返回 false 表示没动。
///
/// 先写 `.part` 再改名，中途失败不会留下半个「看起来存在」的文件。
pub fn download(
    url: &str,
    dest: &Path,
    expected_sha1: Option<&str>,
    cancel: Option<&AtomicBool>,
    mut on_progress: Option<&mut dyn FnMut(u64, u64)>,
) -> Result<bool, String> {
    if dest.is_file() {
        if let Some(expected) = expected_sha1 {
            if sha1_of(dest).as_deref() == Some(expected) {
                return Ok(false);
            }
        } else if dest.metadata().map(|m| m.len()).unwrap_or(0) > 0 {
            return Ok(false);
        }
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mut response = client().get(url).send().map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {} {}", response.status().as_u16(), url));
    }
    let total = response.content_length().unwrap_or(0);
    let part = dest.with_extension(format!(
        "{}.part",
        dest.extension()
            .map(|e| e.to_string_lossy().to_string())
            .unwrap_or_default()
    ));

    let mut hasher = Sha1::new();
    let mut received: u64 = 0;
    {
        let mut file = std::fs::File::create(&part).map_err(|e| e.to_string())?;
        let mut buffer = vec![0u8; 128 * 1024];
        loop {
            if let Some(flag) = cancel {
                if flag.load(Ordering::Relaxed) {
                    drop(file);
                    let _ = std::fs::remove_file(&part);
                    return Err("CANCELLED".into());
                }
            }
            let read = response.read(&mut buffer).map_err(|e| e.to_string())?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
            file.write_all(&buffer[..read]).map_err(|e| e.to_string())?;
            received += read as u64;
            if let Some(callback) = on_progress.as_mut() {
                callback(received, total);
            }
        }
    }

    let digest = hex::encode(hasher.finalize());
    if let Some(expected) = expected_sha1 {
        if !expected.eq_ignore_ascii_case(&digest) {
            let _ = std::fs::remove_file(&part);
            return Err(format!("SHA1_MISMATCH {url}"));
        }
    }
    std::fs::rename(&part, dest).map_err(|e| e.to_string())?;
    Ok(true)
}
