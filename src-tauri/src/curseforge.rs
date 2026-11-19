//! CurseForge API v1 的只读客户端。
//!
//! 官方 API 需要 x-api-key（在 CurseForge 开发者后台申请），所以密钥从设置里读，
//! 不硬编码任何第三方的 key。填了 key 之后 Mod 搜索/下载自动切到 CurseForge。

use reqwest::Url;
use serde::Deserialize;

use crate::modrinth::{ModFile, ModVersion, SearchHit};

const BASE: &str = "https://api.curseforge.com/v1";

#[derive(Debug, Deserialize)]
struct SearchResponse {
    #[serde(default)]
    data: Vec<CfMod>,
}

#[derive(Debug, Deserialize)]
struct FilesResponse {
    #[serde(default)]
    data: Vec<CfFile>,
}

#[derive(Debug, Deserialize)]
struct CfMod {
    id: i64,
    #[serde(default)]
    slug: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    summary: String,
    #[serde(default)]
    thumbnail_url: Option<String>,
    #[serde(default)]
    download_count: u64,
    #[serde(default)]
    authors: Vec<CfAuthor>,
    #[serde(default)]
    latest_files: Vec<CfFile>,
}

#[derive(Debug, Deserialize)]
struct CfAuthor {
    #[serde(default)]
    name: String,
}

#[derive(Debug, Deserialize, Clone)]
struct CfFile {
    id: i64,
    #[serde(default)]
    display_name: String,
    #[serde(default)]
    file_name: String,
    #[serde(default)]
    download_url: Option<String>,
    #[serde(default)]
    file_date: String,
    #[serde(default)]
    length: u64,
    #[serde(default)]
    release_type: i32,
    #[serde(default)]
    is_alternate: bool,
    #[serde(default)]
    game_versions: Vec<String>,
    #[serde(default)]
    mod_loaders: Vec<CfLoader>,
    #[serde(default)]
    hashes: Vec<CfHash>,
}

#[derive(Debug, Deserialize, Clone)]
struct CfLoader {
    id: i32,
    #[serde(default)]
    is_primary: bool,
}

#[derive(Debug, Deserialize, Clone)]
struct CfHash {
    algo: i32,
    value: String,
}

/// 启动器 loader → CurseForge modLoaderType
fn loader_type(loader: &str) -> Option<i32> {
    match loader.trim().to_ascii_lowercase().as_str() {
        "forge" => Some(1),
        "fabric" | "optifabric" => Some(4),
        "quilt" => Some(5),
        "neoforge" => Some(6),
        _ => None,
    }
}

fn file_url(file: &CfFile) -> String {
    if let Some(url) = &file.download_url {
        if !url.is_empty() {
            return url.clone();
        }
    }
    format!(
        "https://mediafilez.forgecdn.net/files/{}/{}/{}",
        file.id / 1000,
        file.id % 1000,
        file.file_name
    )
}

fn sha1(file: &CfFile) -> Option<String> {
    file.hashes
        .iter()
        .find(|h| h.algo == 1)
        .map(|h| h.value.clone())
}

fn to_hit(mod_: &CfMod) -> SearchHit {
    let mut versions = Vec::new();
    let mut categories = Vec::new();
    for file in &mod_.latest_files {
        for version in &file.game_versions {
            if !versions.contains(version) {
                versions.push(version.clone());
            }
        }
        for loader in &file.mod_loaders {
            let name = match loader.id {
                1 => "forge",
                4 => "fabric",
                5 => "quilt",
                6 => "neoforge",
                _ => continue,
            };
            if !categories.iter().any(|c| c == name) {
                categories.push(name.into());
            }
        }
    }
    SearchHit {
        source: "curseforge".into(),
        project_id: mod_.id.to_string(),
        slug: if mod_.slug.is_empty() {
            mod_.name.to_ascii_lowercase().replace(' ', "-")
        } else {
            mod_.slug.clone()
        },
        title: mod_.name.clone(),
        description: mod_.summary.clone(),
        icon_url: mod_.thumbnail_url.clone(),
        author: mod_.authors.first().map(|a| a.name.clone()).unwrap_or_default(),
        downloads: mod_.download_count,
        categories,
        versions,
        latest_version: mod_.latest_files.first().map(|f| f.display_name.clone()),
    }
}

pub fn search(
    key: &str,
    query: &str,
    game_version: &str,
    loader: &str,
    limit: u32,
) -> Result<Vec<SearchHit>, String> {
    let mut url = Url::parse(&format!("{BASE}/mods/search")).map_err(|e| e.to_string())?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("gameId", "432");
        pairs.append_pair("classId", "6");
        pairs.append_pair("searchFilter", query);
        pairs.append_pair("pageSize", &limit.min(50).to_string());
        pairs.append_pair("pageIndex", "1");
        if !game_version.trim().is_empty() {
            pairs.append_pair("gameVersion", game_version.trim());
        }
        if let Some(loader) = loader_type(loader) {
            pairs.append_pair("modLoaderType", &loader.to_string());
        }
    }
    let response: SearchResponse = crate::http::get_json_with_header(url.as_str(), "x-api-key", key)?;
    Ok(response.data.iter().map(to_hit).collect())
}

pub fn resolve_file(
    key: &str,
    project_id: &str,
    game_version: &str,
    loader: &str,
) -> Result<(ModVersion, ModFile), String> {
    let loader = loader_type(loader).ok_or("UNSUPPORTED_LOADER")?;
    let mut url = Url::parse(&format!("{BASE}/mods/{project_id}/files")).map_err(|e| e.to_string())?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("gameVersion", game_version);
        pairs.append_pair("modLoaderType", &loader.to_string());
        pairs.append_pair("pageSize", "50");
        pairs.append_pair("index", "0");
    }
    let response: FilesResponse = crate::http::get_json_with_header(url.as_str(), "x-api-key", key)?;

    let mut candidates: Vec<&CfFile> = response
        .data
        .iter()
        .filter(|f| {
            (f.game_versions.iter().any(|v| v == game_version))
                && (f.mod_loaders.iter().any(|l| l.id == loader) || f.mod_loaders.is_empty())
                && !f.is_alternate
        })
        .collect();
    candidates.sort_by(|a, b| {
        let release = (b.release_type == 1).cmp(&(a.release_type == 1));
        release.then_with(|| b.file_date.cmp(&a.file_date))
    });

    let file = candidates.first().ok_or("NO_COMPATIBLE_VERSION")?;
    let version = ModVersion {
        id: file.id.to_string(),
        name: file.display_name.clone(),
        version_number: file.display_name.clone(),
        version_type: if file.release_type == 1 {
            "release".into()
        } else {
            "beta".into()
        },
        game_versions: file.game_versions.clone(),
        loaders: file
            .mod_loaders
            .iter()
            .map(|l| match l.id {
                1 => "forge".into(),
                4 => "fabric".into(),
                5 => "quilt".into(),
                6 => "neoforge".into(),
                _ => "other".into(),
            })
            .collect(),
        files: vec![ModFile {
            filename: file.file_name.clone(),
            url: file_url(file),
            size: file.length,
            primary: true,
            hashes: sha1(file)
                .map(|s| {
                    let mut map = std::collections::HashMap::new();
                    map.insert("sha1".into(), s);
                    map
                })
                .unwrap_or_default(),
        }],
    };
    let mod_file = version.files[0].clone();
    Ok((version, mod_file))
}
