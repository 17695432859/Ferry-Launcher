//! Modrinth 公开 API 的极简客户端。
//!
//! 只做两件事：搜索 mod、解析出与当前游戏版本/加载器兼容的 release 文件。
//! 不需要 token；按 Modrinth 要求提供可识别的 User-Agent（见 http::UA）。

use reqwest::Url;
use serde::{Deserialize, Serialize};

const BASE: &str = "https://api.modrinth.com/v2";

fn default_source() -> String {
    "modrinth".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    #[serde(default = "default_source")]
    pub source: String,
    #[serde(default, alias = "project_id")]
    pub project_id: String,
    #[serde(default)]
    pub slug: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default, alias = "icon_url")]
    pub icon_url: Option<String>,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub downloads: u64,
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(default)]
    pub versions: Vec<String>,
    #[serde(default, alias = "latest_version")]
    pub latest_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SearchResponse {
    #[serde(default)]
    hits: Vec<SearchHit>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModFile {
    pub filename: String,
    pub url: String,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub primary: bool,
    #[serde(default)]
    pub hashes: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModVersion {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub version_number: String,
    #[serde(default)]
    pub version_type: String,
    #[serde(default)]
    pub game_versions: Vec<String>,
    #[serde(default)]
    pub loaders: Vec<String>,
    #[serde(default)]
    pub files: Vec<ModFile>,
}

/// 把启动器内部的 loader id 映射到 Modrinth 的 category/loader id。
pub fn normalize_loader(loader: &str) -> Option<&'static str> {
    match loader.trim().to_ascii_lowercase().as_str() {
        "fabric" | "optifabric" => Some("fabric"),
        "forge" => Some("forge"),
        "neoforge" => Some("neoforge"),
        "quilt" => Some("quilt"),
        _ => None,
    }
}

fn json_array(values: &[String]) -> String {
    serde_json::to_string(values).unwrap_or_else(|_| "[]".into())
}

/// 搜索 mod。game_version / loader 传空字符串表示不筛选。
pub fn search(
    query: &str,
    game_version: &str,
    loader: &str,
    limit: u32,
) -> Result<Vec<SearchHit>, String> {
    let mut facets: Vec<Vec<String>> = vec![vec!["project_type:mod".into()]];
    if let Some(loader) = normalize_loader(loader) {
        facets.push(vec![format!("categories:{loader}")]);
    }
    if !game_version.trim().is_empty() {
        facets.push(vec![format!("versions:{}", game_version.trim())]);
    }

    let mut url = Url::parse(&format!("{BASE}/search")).map_err(|e| e.to_string())?;
    url.query_pairs_mut()
        .append_pair("query", query)
        .append_pair("facets", &serde_json::to_string(&facets).map_err(|e| e.to_string())?)
        .append_pair("limit", &limit.to_string())
        .append_pair("index", "relevance");

    let response: SearchResponse = crate::http::get_json(url.as_str())?;
    Ok(response.hits)
}

/// 找一个与 game_version / loader 匹配的最新 release，返回主文件。
pub fn resolve_file(
    project_id: &str,
    game_version: &str,
    loader: &str,
) -> Result<(ModVersion, ModFile), String> {
    let loader = normalize_loader(loader).ok_or("UNSUPPORTED_LOADER")?;
    let loaders = vec![loader.to_string()];
    let versions = vec![game_version.to_string()];

    let fetch = |releases_only: bool| -> Result<Vec<ModVersion>, String> {
        let mut url = Url::parse(&format!("{BASE}/project/{project_id}/version"))
            .map_err(|e| e.to_string())?;
        {
            let mut pairs = url.query_pairs_mut();
            pairs.append_pair("loaders", &json_array(&loaders));
            pairs.append_pair("game_versions", &json_array(&versions));
            pairs.append_pair("limit", "10");
            if releases_only {
                pairs.append_pair("version_types", "[\"release\"]");
            }
        }
        crate::http::get_json(url.as_str())
    };

    let mut list = fetch(true)?;
    if list.is_empty() {
        list = fetch(false)?;
    }

    for version in list {
        if let Some(file) = version
            .files
            .iter()
            .find(|f| f.primary)
            .or_else(|| version.files.first())
            .cloned()
        {
            return Ok((version, file));
        }
    }
    Err("NO_COMPATIBLE_VERSION".into())
}
