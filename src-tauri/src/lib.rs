pub mod auth;
pub mod content;
pub mod content_types;
pub mod crash;
pub mod curseforge;
pub mod export;
pub mod http;
pub mod install;
pub mod java;
pub mod launch;
pub mod modrinth;
pub mod mods;
pub mod netplay;
pub mod roomcode;
pub mod scan;
pub mod store;
pub mod util;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, Window};
use tauri_plugin_dialog::DialogExt;

use launch::LaunchState;
use netplay::NetplayState;
use store::{AppState, Instance};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    name: String,
    version: String,
    platform: String,
    electron: String,
    chrome: String,
    node: String,
    system_locale: String,
    native_backdrop: bool,
    data_dir: String,
}

#[tauri::command]
fn app_info(app: AppHandle) -> AppInfo {
    AppInfo {
        name: "Ferry Launcher".into(),
        version: app.package_info().version.to_string(),
        platform: std::env::consts::OS.to_string(),
        electron: "webview2".into(),
        chrome: String::new(),
        node: String::new(),
        system_locale: sys_locale(),
        native_backdrop: cfg!(windows),
        data_dir: util::data_dir().to_string_lossy().to_string(),
    }
}

fn sys_locale() -> String {
    std::env::var("LANG")
        .or_else(|_| std::env::var("LC_ALL"))
        .unwrap_or_else(|_| "zh-CN".into())
}

#[tauri::command]
fn settings_get(state: State<'_, AppState>) -> serde_json::Value {
    serde_json::to_value(store::load_settings(&state)).unwrap_or(serde_json::json!({}))
}

#[tauri::command]
fn settings_set(state: State<'_, AppState>, patch: serde_json::Value) -> serde_json::Value {
    match store::save_settings(&state, patch) {
        Ok(next) => serde_json::to_value(next).unwrap_or(serde_json::json!({})),
        Err(_) => serde_json::to_value(store::load_settings(&state)).unwrap_or(serde_json::json!({})),
    }
}

/* ==========================================================================
   实例
   ========================================================================== */

#[tauri::command]
fn instances_list(state: State<'_, AppState>) -> Vec<Instance> {
    store::load_instances(&state)
}

fn build_draft(
    candidate: &scan::ScanCandidate,
    index: usize,
    stamp: &str,
    memory_mb: i64,
) -> Instance {
    Instance {
        id: format!("imported-{stamp}-{index}"),
        name: candidate.suggested_name.clone(),
        mc_version: candidate.mc_version.clone(),
        loader: candidate.loader.clone(),
        loader_version: candidate.loader_version.clone(),
        cover_seed: format!(
            "{}#{}",
            candidate.game_dir,
            candidate.version_id.clone().unwrap_or_default()
        ),
        last_played_at: None,
        total_playtime_ms: 0,
        memory_mb,
        java_path: None,
        game_dir: candidate.game_dir.clone(),
        version_id: candidate.version_id.clone(),
        jvm_args: None,
        isolated: if candidate.isolated { Some(true) } else { None },
        icon: None,
    }
}

#[tauri::command]
fn instances_import(app: AppHandle, state: State<'_, AppState>) -> serde_json::Value {
    let picked = app
        .dialog()
        .file()
        .set_title("选择已有的游戏目录")
        .blocking_pick_folder();
    let Some(path) = picked else {
        return serde_json::json!({ "ok": false, "reason": "cancelled" });
    };
    let Some(dir) = path.as_path() else {
        return serde_json::json!({ "ok": false, "reason": "cancelled" });
    };
    let candidates = scan::scan_all(dir, 0);
    if candidates.is_empty() {
        return serde_json::json!({
            "ok": false,
            "reason": "not-a-game-dir",
            "message": dir.to_string_lossy()
        });
    }
    let settings = store::load_settings(&state);
    let stamp = util::short_id();
    let drafts: Vec<Instance> = candidates
        .iter()
        .enumerate()
        .map(|(index, candidate)| build_draft(candidate, index, &stamp, settings.default_memory_mb))
        .collect();
    let total = drafts.len();
    match store::add_instances(&state, drafts) {
        Ok(accepted) => {
            if accepted.is_empty() {
                return serde_json::json!({
                    "ok": false,
                    "reason": "duplicate",
                    "message": dir.to_string_lossy()
                });
            }
            let warnings: Vec<scan::ScanWarning> =
                candidates.iter().flat_map(|c| c.warnings.clone()).collect();
            serde_json::json!({
                "ok": true,
                "instances": accepted,
                "warnings": warnings,
                "skipped": total - accepted.len()
            })
        }
        Err(message) => serde_json::json!({ "ok": false, "reason": "read-error", "message": message }),
    }
}

/// 新建实例：安装完成后把版本注册进实例列表
#[tauri::command]
fn instances_create(
    state: State<'_, AppState>,
    name: String,
    mc_version: String,
    loader: String,
    loader_version: Option<String>,
    game_dir: String,
    version_id: String,
) -> serde_json::Value {
    let settings = store::load_settings(&state);
    let stamp = util::short_id();
    let draft = Instance {
        id: format!("new-{stamp}"),
        name: if name.trim().is_empty() {
            format!("{mc_version} · {loader}")
        } else {
            name.trim().to_string()
        },
        mc_version,
        loader,
        loader_version,
        cover_seed: format!("{game_dir}#{version_id}"),
        last_played_at: None,
        total_playtime_ms: 0,
        memory_mb: settings.default_memory_mb,
        java_path: None,
        game_dir,
        version_id: Some(version_id),
        jvm_args: None,
        isolated: Some(true),
        icon: None,
    };
    match store::add_instances(&state, vec![draft]) {
        Ok(accepted) => serde_json::json!({ "ok": true, "instance": accepted.first() }),
        Err(message) => serde_json::json!({ "ok": false, "message": message }),
    }
}

#[tauri::command]
fn instances_update(
    state: State<'_, AppState>,
    id: String,
    patch: serde_json::Value,
) -> Vec<Instance> {
    store::update_instance(&state, &id, patch).unwrap_or_else(|_| store::load_instances(&state))
}

#[tauri::command]
fn instances_remove(state: State<'_, AppState>, id: String) -> Vec<Instance> {
    purge_icons(&id);
    store::remove_instance(&state, &id).unwrap_or_else(|_| store::load_instances(&state))
}

#[tauri::command]
fn instances_preflight(state: State<'_, AppState>, id: String) -> serde_json::Value {
    let Some(instance) = store::find_instance(&state, &id) else {
        return serde_json::json!([]);
    };
    let dir = Path::new(&instance.game_dir);
    let dir_ok = dir.is_dir();
    let version_id = instance
        .version_id
        .clone()
        .unwrap_or_else(|| instance.mc_version.clone());
    let version_ok = dir
        .join("versions")
        .join(&version_id)
        .join(format!("{version_id}.json"))
        .is_file();
    let writable = std::fs::metadata(dir)
        .map(|meta| !meta.permissions().readonly())
        .unwrap_or(false);
    let java = java::detect(&[instance.game_dir.clone()]);
    let picked = java::pick(&java, &instance.mc_version, instance.java_path.as_deref());
    serde_json::json!([
        { "id": "dir", "ok": dir_ok, "detail": instance.game_dir },
        { "id": "version", "ok": version_ok, "detail": version_id },
        { "id": "writable", "ok": writable },
        { "id": "java", "ok": picked.is_some(), "detail": picked.map(|info| info.version).unwrap_or_default() }
    ])
}

#[tauri::command]
fn instances_open_path(app: AppHandle, state: State<'_, AppState>, id: String, sub_path: String) {
    let Some(instance) = store::find_instance(&state, &id) else {
        return;
    };
    if let Ok(target) = mods::ensure_sub_dir(&instance.game_dir, &sub_path) {
        let _ = tauri_plugin_opener::open_path(&target, None::<&str>);
        let _ = app;
    }
}

#[tauri::command]
fn background_pick(app: AppHandle, state: State<'_, AppState>) -> serde_json::Value {
    let picked = app
        .dialog()
        .file()
        .set_title("选择背景图片")
        .add_filter("图片", &["png", "jpg", "jpeg", "webp", "bmp", "gif"])
        .blocking_pick_file();
    let Some(path) = picked else {
        return serde_json::json!({ "ok": false, "reason": "cancelled" });
    };
    let Some(source) = path.as_path() else {
        return serde_json::json!({ "ok": false, "reason": "cancelled" });
    };
    let size = std::fs::metadata(source).map(|m| m.len()).unwrap_or(0);
    if size > 16 * 1024 * 1024 {
        return serde_json::json!({ "ok": false, "reason": "too-large" });
    }
    let ext = source
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !["png", "jpg", "jpeg", "webp", "bmp", "gif"].contains(&ext.as_str()) {
        return serde_json::json!({ "ok": false, "reason": "unsupported" });
    }
    let target_dir = util::data_dir().join("backgrounds");
    let _ = std::fs::create_dir_all(&target_dir);
    let target = target_dir.join(format!("bg-{}.{ext}", util::short_id()));
    match std::fs::copy(source, &target) {
        Ok(_) => {
            let _ = store::save_settings(
                &state,
                serde_json::json!({ "backgroundPath": target.to_string_lossy(), "backgroundMode": "custom" }),
            );
            serde_json::json!({ "ok": true, "path": target.to_string_lossy() })
        }
        Err(_) => serde_json::json!({ "ok": false, "reason": "read-error" }),
    }
}

#[tauri::command]
fn background_load(path: Option<String>) -> Option<String> {
    let path = path?;
    let bytes = std::fs::read(&path).ok()?;
    let ext = Path::new(&path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_else(|| "png".into());
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "gif" => "image/gif",
        _ => "image/png",
    };
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Some(format!("data:{mime};base64,{encoded}"))
}

/* ==========================================================================
   内容：mods / 资源包 / 存档 / 日志
   ========================================================================== */

#[tauri::command]
fn content_list(state: State<'_, AppState>, id: String, kind: String) -> Vec<content::ContentItem> {
    match store::find_instance(&state, &id) {
        Some(instance) => content::list(&store::dir_of(&instance), &kind),
        None => Vec::new(),
    }
}

#[tauri::command]
fn content_preview(
    state: State<'_, AppState>,
    id: String,
    kind: String,
    key: String,
) -> content::ContentPreview {
    match store::find_instance(&state, &id) {
        Some(instance) => content::preview(&store::dir_of(&instance), &kind, &key),
        None => content::ContentPreview::default(),
    }
}

#[tauri::command]
fn content_toggle(
    state: State<'_, AppState>,
    id: String,
    kind: String,
    key: String,
    enabled: bool,
) -> Result<Vec<content::ContentItem>, String> {
    let instance = store::find_instance(&state, &id).ok_or("NOT_FOUND")?;
    content::toggle(&store::dir_of(&instance), &kind, &key, enabled)
}

#[tauri::command]
fn content_delete(
    state: State<'_, AppState>,
    id: String,
    kind: String,
    key: String,
) -> Result<Vec<content::ContentItem>, String> {
    let instance = store::find_instance(&state, &id).ok_or("NOT_FOUND")?;
    content::delete(&store::dir_of(&instance), &kind, &key)
}

#[tauri::command]
fn content_import(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    kind: String,
) -> serde_json::Value {
    let Some(instance) = store::find_instance(&state, &id) else {
        return serde_json::json!({ "added": 0, "skipped": 0, "cancelled": true });
    };
    let filters: &[&str] = if kind == "mods" { &["jar"] } else { &["zip"] };
    let picked = app.dialog().file().add_filter("文件", filters).blocking_pick_files();
    let Some(paths) = picked else {
        return serde_json::json!({ "added": 0, "skipped": 0, "cancelled": true });
    };
    let files: Vec<PathBuf> = paths
        .iter()
        .filter_map(|p| p.as_path().map(|p| p.to_path_buf()))
        .collect();
    match content::import(&store::dir_of(&instance), &kind, &files) {
        Ok((added, skipped)) => {
            serde_json::json!({ "added": added, "skipped": skipped, "cancelled": false })
        }
        Err(message) => serde_json::json!({
            "added": 0,
            "skipped": files.len(),
            "cancelled": false,
            "message": message
        }),
    }
}

#[tauri::command]
fn content_updates(state: State<'_, AppState>, id: String) -> Vec<content::ModUpdate> {
    let Some(instance) = store::find_instance(&state, &id) else {
        return Vec::new();
    };
    content::check_updates(&store::dir_of(&instance), &instance.mc_version, &instance.loader)
}

#[tauri::command]
fn content_upgrade(
    state: State<'_, AppState>,
    id: String,
    key: String,
    url: String,
    file_name: String,
) -> Result<Vec<content::ContentItem>, String> {
    let instance = store::find_instance(&state, &id).ok_or("NOT_FOUND")?;
    content::upgrade(&store::dir_of(&instance), &key, &url, &file_name)
}

/* ==========================================================================
   旧版 mods 接口（保持兼容）
   ========================================================================== */

#[tauri::command]
fn mods_list(state: State<'_, AppState>, id: String) -> Vec<content::ContentItem> {
    match store::find_instance(&state, &id) {
        Some(instance) => content::list(&store::dir_of(&instance), "mods"),
        None => Vec::new(),
    }
}

#[tauri::command]
fn mods_toggle(
    state: State<'_, AppState>,
    id: String,
    file_name: String,
    enabled: bool,
) -> Vec<content::ContentItem> {
    match store::find_instance(&state, &id) {
        Some(instance) => {
            content::toggle(&store::dir_of(&instance), "mods", &file_name, enabled).unwrap_or_default()
        }
        None => Vec::new(),
    }
}

#[tauri::command]
fn mods_delete(
    state: State<'_, AppState>,
    id: String,
    file_name: String,
) -> Result<Vec<content::ContentItem>, String> {
    let instance = store::find_instance(&state, &id).ok_or("NOT_FOUND")?;
    content::delete(&store::dir_of(&instance), "mods", &file_name)
}

#[tauri::command]
fn mods_import(app: AppHandle, state: State<'_, AppState>, id: String) -> serde_json::Value {
    let Some(instance) = store::find_instance(&state, &id) else {
        return serde_json::json!({ "added": 0, "skipped": 0, "cancelled": true });
    };
    let picked = app.dialog().file().add_filter("Mod", &["jar"]).blocking_pick_files();
    let Some(paths) = picked else {
        return serde_json::json!({ "added": 0, "skipped": 0, "cancelled": true });
    };
    let files: Vec<PathBuf> = paths
        .iter()
        .filter_map(|p| p.as_path().map(|p| p.to_path_buf()))
        .collect();
    match content::import(&store::dir_of(&instance), "mods", &files) {
        Ok((added, skipped)) => {
            serde_json::json!({ "added": added, "skipped": skipped, "cancelled": false })
        }
        Err(message) => serde_json::json!({
            "added": 0,
            "skipped": files.len(),
            "cancelled": false,
            "message": message
        }),
    }
}

/* ==========================================================================
   Modrinth mod 下载
   ========================================================================== */

#[derive(Default)]
pub struct ModDownloadState {
    cancel: Mutex<Option<Arc<AtomicBool>>>,
}

/// 填了 CurseForge Key（或环境变量）就走 CurseForge，否则退回 Modrinth。
fn curseforge_key(state: &AppState) -> Option<String> {
    std::env::var("CURSEFORGE_API_KEY")
        .ok()
        .or_else(|| store::load_settings(state).curseforge_api_key.clone())
        .map(|key| key.trim().to_string())
        .filter(|key| !key.is_empty())
}

#[tauri::command(async)]
fn mod_search(
    state: State<'_, AppState>,
    id: String,
    query: String,
    limit: Option<u32>,
) -> Result<Vec<modrinth::SearchHit>, String> {
    let instance = store::find_instance(&state, &id).ok_or("NOT_FOUND")?;
    let query = query.trim();
    let limit = limit.unwrap_or(20).clamp(1, 50);
    if let Some(key) = curseforge_key(&state) {
        let page = curseforge::search(
            &key,
            query,
            &instance.mc_version,
            &instance.loader,
            "",
            "mod",
            limit,
            1,
        )?;
        return Ok(page.hits);
    }
    let page = modrinth::search(query, &instance.mc_version, &instance.loader, "", "mod", limit, 1)?;
    Ok(page.hits)
}

/// 全局 Mod 搜索：不依赖任何实例，筛选条件由界面显式传入。
/// source: all / curseforge / modrinth；category 为空表示不限类型。
#[tauri::command(async)]
fn mod_search_global(
    state: State<'_, AppState>,
    query: String,
    game_version: Option<String>,
    loader: Option<String>,
    source: Option<String>,
    category: Option<String>,
    content_type: Option<String>,
    limit: Option<u32>,
    page: Option<u32>,
) -> Result<modrinth::SearchPage, String> {
    let query = query.trim();
    let content_type = content_types::normalize(content_type.as_deref().unwrap_or("mod"));
    let game_version = game_version.unwrap_or_default();
    let loader = loader.unwrap_or_default();
    let category = category.unwrap_or_default();
    let source = source
        .unwrap_or_else(|| "all".into())
        .trim()
        .to_ascii_lowercase();
    let limit = limit.unwrap_or(24).clamp(1, 50);
    let page = page.unwrap_or(1).max(1);

    let key = curseforge_key(&state);
    if source == "curseforge" && key.is_none() {
        return Err("NO_CURSEFORGE_KEY".into());
    }

    let use_curseforge = (source == "curseforge" || source == "all") && key.is_some();
    let use_modrinth = source == "modrinth" || source == "all";

    // 两个来源时各取半页，合起来正好是一页，total 相加。
    let per_source = if use_curseforge && use_modrinth {
        (limit / 2).max(1)
    } else {
        limit
    };

    let mut hits: Vec<modrinth::SearchHit> = Vec::new();
    let mut total: u64 = 0;
    if use_curseforge {
        let result = curseforge::search(
            key.as_deref().unwrap_or(""),
            query,
            &game_version,
            &loader,
            category.trim(),
            content_type,
            per_source,
            page,
        )?;
        total += result.total;
        hits.extend(result.hits);
    }
    if use_modrinth {
        let result = modrinth::search(
            query,
            &game_version,
            &loader,
            category.trim(),
            content_type,
            per_source,
            page,
        )?;
        total += result.total;
        hits.extend(result.hits);
    }

    // 同时搜索两个来源时按下载量降序，避免某一来源固定霸占前面。
    // 单来源时保留 API 原本的相关度排序。
    if use_curseforge && use_modrinth {
        hits.sort_by(|a, b| b.downloads.cmp(&a.downloads));
    }
    Ok(modrinth::SearchPage { hits, total })
}

#[tauri::command(async)]
fn mod_download(
    app: AppHandle,
    state: State<'_, AppState>,
    download_state: State<'_, ModDownloadState>,
    id: String,
    project_id: String,
    source: Option<String>,
    game_version: Option<String>,
    loader: Option<String>,
    content_type: Option<String>,
) -> Result<Vec<content::ContentItem>, String> {
    let instance = store::find_instance(&state, &id).ok_or("NOT_FOUND")?;
    let game_dir = store::dir_of(&instance);
    let content_type = content_types::normalize(content_type.as_deref().unwrap_or("mod"));
    // 全局下载页可以让用户选择目标版本/加载器；不传时沿用实例自身配置。
    let game_version = game_version
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| instance.mc_version.clone());
    let loader = loader
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| instance.loader.clone());
    let source = source
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    let emit = |phase: &str, received: u64, total: u64| {
        let _ = app.emit(
            "mod:install-progress",
            serde_json::json!({
                "instanceId": id,
                "projectId": project_id,
                "phase": phase,
                "received": received,
                "total": total,
            }),
        );
    };

    emit("resolve", 0, 0);
    let (version, file) = if source == "modrinth" {
        modrinth::resolve_file(&project_id, &game_version, &loader, content_type)?
    } else if source == "curseforge" {
        let key = curseforge_key(&state).ok_or("NO_CURSEFORGE_KEY")?;
        curseforge::resolve_file(&key, &project_id, &game_version, &loader, content_type)?
    } else if let Some(key) = curseforge_key(&state) {
        curseforge::resolve_file(&key, &project_id, &game_version, &loader, content_type)?
    } else {
        modrinth::resolve_file(&project_id, &game_version, &loader, content_type)?
    };
    let file_name = std::path::Path::new(&file.filename)
        .file_name()
        .ok_or("BAD_FILENAME")?
        .to_string_lossy()
        .to_string();
    let dest_dir = std::path::Path::new(&game_dir).join(content_types::subdir(content_type));
    std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    let dest = dest_dir.join(&file_name);

    let cancel = Arc::new(AtomicBool::new(false));
    *crate::util::lock(&download_state.cancel) = Some(cancel.clone());

    let instance_id = id.clone();
    let emit_project = project_id.clone();
    let app_for_progress = app.clone();
    let mut on_progress = move |received: u64, total: u64| {
        let _ = app_for_progress.emit(
            "mod:install-progress",
            serde_json::json!({
                "instanceId": instance_id,
                "projectId": emit_project,
                "phase": "download",
                "received": received,
                "total": total,
            }),
        );
    };

    let expected = file.hashes.get("sha1").map(|s| s.as_str());
    let result = http::download(
        &file.url,
        &dest,
        expected,
        Some(&cancel),
        Some(&mut on_progress),
    );
    *crate::util::lock(&download_state.cancel) = None;
    result.map_err(|e| e.to_string())?;

    emit("done", 1, 1);
    let _ = version; // 版本信息留给以后做版本列表，当前下载完直接刷新列表
    let kind = content_types::subdir(content_type);
    Ok(if kind == "mods" || kind == "resourcepacks" {
        content::list(&game_dir, kind)
    } else {
        Vec::new()
    })
}

#[tauri::command]
fn crash_analyze(state: State<'_, AppState>, id: String) -> Result<crash::Report, String> {
    let instance = store::find_instance(&state, &id).ok_or("NOT_FOUND")?;
    Ok(crash::analyze(&store::dir_of(&instance), 0))
}

#[tauri::command]
fn mod_download_cancel(state: State<'_, ModDownloadState>) {
    if let Some(flag) = crate::util::lock(&state.cancel).as_ref() {
        flag.store(true, Ordering::SeqCst);
    }
}

/* ==========================================================================
   导出 / Java
   ========================================================================== */

#[tauri::command]
fn instance_export(app: AppHandle, state: State<'_, AppState>, id: String, include_saves: bool) -> serde_json::Value {
    let Some(instance) = store::find_instance(&state, &id) else {
        return serde_json::json!({ "ok": false, "reason": "error", "message": "NOT_FOUND" });
    };
    let default_name = format!("{}-{}.zip", instance.name, instance.mc_version);
    let picked = app
        .dialog()
        .file()
        .set_file_name(default_name)
        .add_filter("Zip", &["zip"])
        .blocking_save_file();
    let Some(path) = picked else {
        return serde_json::json!({ "ok": false, "reason": "cancelled" });
    };
    let Some(target) = path.as_path() else {
        return serde_json::json!({ "ok": false, "reason": "cancelled" });
    };
    serde_json::to_value(export::export_instance(&instance, include_saves, target))
        .unwrap_or(serde_json::json!({ "ok": false, "reason": "error" }))
}

#[tauri::command]
fn instance_pick_java(app: AppHandle) -> Option<String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Java", &["exe"])
        .blocking_pick_file();
    picked.and_then(|p| p.as_path().map(|p| p.to_string_lossy().to_string()))
}

const ICON_EXTS: [&str; 5] = ["png", "jpg", "jpeg", "webp", "gif"];

fn icon_dir() -> std::path::PathBuf {
    util::data_dir().join("icons")
}

/// 删掉某个实例留在数据目录里的所有图标文件
fn purge_icons(id: &str) {
    let dir = icon_dir();
    let prefix = format!("{id}.");
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if entry.file_name().to_string_lossy().starts_with(&prefix) {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
}

/// 选一张本地图片当实例图标，拷进数据目录（原图删了也不影响）
#[tauri::command]
fn instance_icon_pick(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> serde_json::Value {
    if store::find_instance(&state, &id).is_none() {
        return serde_json::json!({ "ok": false, "reason": "missing" });
    }
    let picked = app
        .dialog()
        .file()
        .set_title("选择图标图片")
        .add_filter("图片", &ICON_EXTS)
        .blocking_pick_file();
    let Some(path) = picked else {
        return serde_json::json!({ "ok": false, "reason": "cancelled" });
    };
    let Some(source) = path.as_path() else {
        return serde_json::json!({ "ok": false, "reason": "cancelled" });
    };
    let size = std::fs::metadata(source).map(|m| m.len()).unwrap_or(0);
    if size > 8 * 1024 * 1024 {
        return serde_json::json!({ "ok": false, "reason": "too-large" });
    }
    let ext = source
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !ICON_EXTS.contains(&ext.as_str()) {
        return serde_json::json!({ "ok": false, "reason": "unsupported" });
    }

    let dir = icon_dir();
    let _ = std::fs::create_dir_all(&dir);
    purge_icons(&id);
    let target = dir.join(format!("{id}.{ext}"));
    if std::fs::copy(source, &target).is_err() {
        return serde_json::json!({ "ok": false, "reason": "error" });
    }
    let path_text = target.to_string_lossy().to_string();
    let _ = store::update_instance(&state, &id, serde_json::json!({ "icon": path_text }));
    serde_json::json!({ "ok": true, "path": path_text })
}

/// 恢复成内置图标：清掉文件并置空字段
#[tauri::command]
fn instance_icon_clear(state: State<'_, AppState>, id: String) -> Vec<Instance> {
    purge_icons(&id);
    store::update_instance(&state, &id, serde_json::json!({ "icon": null }))
        .unwrap_or_else(|_| store::load_instances(&state))
}

#[tauri::command]
fn java_detect(state: State<'_, AppState>) -> Vec<java::JavaInfo> {
    let dirs: Vec<String> = store::load_instances(&state)
        .into_iter()
        .map(|item| item.game_dir)
        .collect();
    java::detect(&dirs)
}

/// 按需下载运行时（1.21 需要 Java 21，本机没有就别硬启动）
///
/// `async` 让 Tauri 把这段阻塞下载丢到线程池，主线程继续跑事件循环，
/// 否则下载期间窗口会卡住、进度事件也发不出去。
#[tauri::command(async)]
fn java_download(major: u32) -> serde_json::Value {
    match java::download_major(major) {
        Ok(path) => {
            let info = java::probe(std::path::Path::new(&path));
            serde_json::json!({ "ok": true, "path": path, "info": info })
        }
        Err(message) => serde_json::json!({ "ok": false, "message": message }),
    }
}

/* ==========================================================================
   账户
   ========================================================================== */

#[tauri::command]
fn accounts_list() -> Vec<auth::AccountSummary> {
    auth::summaries()
}

#[tauri::command]
fn accounts_offline(name: String) -> Result<auth::AccountSummary, String> {
    auth::add_offline(&name)
}

#[tauri::command]
fn accounts_login_littleskin(
    api_root: String,
    username: String,
    password: String,
) -> Result<auth::AccountSummary, String> {
    let root = if api_root.trim().is_empty() {
        auth::LITTLESKIN_ROOT
    } else {
        api_root.trim()
    };
    auth::yggdrasil_login(root, &username, &password)
}

#[tauri::command]
fn accounts_refresh(id: String) -> Result<auth::AccountSummary, String> {
    auth::yggdrasil_refresh(&id)
}

#[tauri::command]
fn accounts_remove(id: String) -> Vec<auth::AccountSummary> {
    auth::remove_account(&id)
}

#[tauri::command]
fn accounts_select_profile(id: String, profile_id: String) -> Result<auth::AccountSummary, String> {
    auth::select_profile(&id, &profile_id)
}

/// 皮肤上传：渲染层传 base64（不带 data: 前缀），这里解成 PNG 字节再走 multipart
#[tauri::command]
fn accounts_upload_skin(
    id: String,
    data: String,
    model: String,
) -> Result<auth::AccountSummary, String> {
    use base64::Engine;
    let raw = data.split(",").last().unwrap_or(&data);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(raw.trim())
        .map_err(|e| e.to_string())?;
    if bytes.len() < 64 || bytes.len() > 2 * 1024 * 1024 {
        return Err("SKIN_SIZE".into());
    }
    auth::upload_skin(&id, bytes, &model)
}

#[tauri::command]
fn accounts_ms_start(client_id: Option<String>) -> Result<auth::DeviceCode, String> {
    auth::microsoft_device_code(client_id.as_deref().unwrap_or(""))
}

#[tauri::command]
fn accounts_ms_poll(client_id: Option<String>, device_code: String) -> serde_json::Value {
    match auth::microsoft_poll(client_id.as_deref().unwrap_or(""), &device_code) {
        Ok(Some(account)) => serde_json::json!({ "status": "ok", "account": account }),
        Ok(None) => serde_json::json!({ "status": "pending" }),
        Err(error) => serde_json::json!({ "status": "error", "message": error }),
    }
}

/* ==========================================================================
   版本安装
   ========================================================================== */

#[derive(Default)]
pub struct InstallState {
    cancel: Mutex<Option<Arc<AtomicBool>>>,
}

#[tauri::command]
fn versions_manifest(source: String) -> Result<Vec<install::VersionSummary>, String> {
    install::manifest(&source)
}

#[tauri::command]
fn versions_loaders(
    mc_version: String,
    loader: String,
) -> Result<Vec<install::LoaderVersion>, String> {
    install::loader_versions(&mc_version, &loader)
}

#[tauri::command]
fn install_start(
    app: AppHandle,
    state: State<'_, InstallState>,
    request: install::InstallRequest,
) -> serde_json::Value {
    let cancel = Arc::new(AtomicBool::new(false));
    *crate::util::lock(&state.cancel) = Some(cancel.clone());
    match install::install(&app, &request, &cancel) {
        Ok(version_id) => serde_json::json!({ "ok": true, "versionId": version_id }),
        Err(message) => {
            let reason = if message == "CANCELLED" {
                "cancelled"
            } else if message == "NO_JAVA" {
                "no-java"
            } else {
                "error"
            };
            serde_json::json!({ "ok": false, "reason": reason, "message": message })
        }
    }
}

#[tauri::command]
fn install_cancel(state: State<'_, InstallState>) {
    if let Some(flag) = crate::util::lock(&state.cancel).as_ref() {
        flag.store(true, Ordering::SeqCst);
    }
}

/* ==========================================================================
   启动
   ========================================================================== */

#[tauri::command]
fn launch_start(
    app: AppHandle,
    state: State<'_, AppState>,
    launch_state: State<'_, LaunchState>,
    id: String,
    account_id: Option<String>,
) -> serde_json::Value {
    let Some(instance) = store::find_instance(&state, &id) else {
        return serde_json::json!({ "ok": false, "reason": "error", "message": "NOT_FOUND" });
    };
    let account = account_id
        .as_deref()
        .and_then(auth::find)
        .or_else(|| {
            let settings = store::load_settings(&state);
            settings
                .last_account_id
                .as_deref()
                .and_then(auth::find)
        });
    let Some(account) = account else {
        return serde_json::json!({ "ok": false, "reason": "no-account", "message": "" });
    };
    // 外置登录的 token 是一次性的：authlib-injector 在游戏里刷新一次，启动器手上的就废了。
    // 所以每次启动前先自己刷一遍，拿最新 token 再拼参数。
    let account = if account.api_root.is_some() {
        match auth::yggdrasil_refresh(&account.id) {
            Ok(_) => auth::find(&account.id).unwrap_or(account),
            Err(error) => {
                let expired = error.contains("InvalidToken")
                    || error.contains("ForbiddenOperationException")
                    || error.contains("TOKEN");
                return serde_json::json!({
                    "ok": false,
                    "reason": if expired { "auth-expired" } else { "error" },
                    "message": error
                });
            }
        }
    } else {
        account
    };
    let account_id = account.id.clone();
    let preferred_java = store::load_settings(&state).default_java_path;
    match launch::launch(
        &app,
        &launch_state,
        &instance,
        &account,
        Some(account_id),
        preferred_java,
    ) {
        Ok(pid) => serde_json::json!({ "ok": true, "pid": pid }),
        Err(message) => {
            // JAVA_TOO_OLD <need> <found>：渲染层要拿这两个数字去提示用户
            if let Some(rest) = message.strip_prefix("JAVA_TOO_OLD ") {
                let mut parts = rest.split_whitespace();
                let need = parts.next().unwrap_or("0");
                let found = parts.next().unwrap_or("0");
                return serde_json::json!({
                    "ok": false,
                    "reason": "java-too-old",
                    "message": format!("{need}|{found}")
                });
            }
            serde_json::json!({ "ok": false, "reason": "error", "message": message })
        }
    }
}

#[tauri::command]
fn launch_stop(launch_state: State<'_, LaunchState>) -> serde_json::Value {
    match launch::stop(&launch_state) {
        Ok(_) => serde_json::json!({ "ok": true }),
        Err(message) => serde_json::json!({ "ok": false, "message": message }),
    }
}

#[tauri::command]
fn launch_status(launch_state: State<'_, LaunchState>) -> bool {
    launch::is_running(&launch_state)
}

/* ==========================================================================
   联机
   ========================================================================== */

#[tauri::command]
fn netplay_runtime(provider: String) -> serde_json::Value {
    netplay::runtime_info(&provider)
}

/// 下载联机运行时。`async` 同上：30MB 的下载不能占着主线程。
#[tauri::command(async)]
fn netplay_install(app: AppHandle, provider: String) -> serde_json::Value {
    if provider == "easytier" {
        netplay::install_easytier(&app)
    } else {
        netplay::install_terracotta(&app)
    }
}

#[tauri::command]
fn netplay_status(state: State<'_, NetplayState>) -> serde_json::Value {
    serde_json::to_value(netplay::status(&state)).unwrap_or(serde_json::json!({}))
}

#[tauri::command]
fn netplay_host(
    app: AppHandle,
    state: State<'_, NetplayState>,
    room: String,
    player_name: String,
) -> serde_json::Value {
    netplay::host(&app, &state, &room, &player_name)
}

#[tauri::command]
fn netplay_join(
    app: AppHandle,
    state: State<'_, NetplayState>,
    room: String,
    player_name: String,
) -> serde_json::Value {
    if room.trim().is_empty() {
        return serde_json::json!({ "ok": false, "reason": "invalid", "message": "EMPTY_ROOM" });
    }
    netplay::join(&app, &state, room.trim(), &player_name)
}

/// 生成一个符合 Scaffolding 协议的联机码（陶瓦 / EasyTier 通用）
#[tauri::command]
fn netplay_code_generate() -> serde_json::Value {
    netplay::generate_code()
}

/// 解析用户粘贴的联机码，顺带返回等价的 EasyTier 网络名与密钥
#[tauri::command]
fn netplay_code_parse(code: String) -> serde_json::Value {
    netplay::parse_code(&code)
}

#[tauri::command]
fn netplay_stop(state: State<'_, NetplayState>) -> serde_json::Value {
    serde_json::to_value(netplay::stop(&state)).unwrap_or(serde_json::json!({}))
}

#[tauri::command]
fn netplay_easytier_config() -> serde_json::Value {
    let path = util::data_dir().join("easytier.json");
    util::read_json::<serde_json::Value>(&path).unwrap_or_else(|| {
        serde_json::json!({ "code": "", "networkName": "", "networkSecret": "", "peers": "", "role": "host" })
    })
}

#[tauri::command]
fn netplay_easytier_save(state: State<'_, NetplayState>, config: serde_json::Value) -> serde_json::Value {
    let path = util::data_dir().join("easytier.json");
    let _ = util::write_json(&path, &config);
    netplay::start_easytier(&state, &config)
}

/* ==========================================================================
   窗口
   ========================================================================== */

/// 把远程图片转成 data URL：渲染层直接用会被 CORS 挡住（WebGL 上传纹理要求同源）
#[tauri::command]
fn net_fetch_image(url: String) -> Option<String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return None;
    }
    let response = http::client().get(&url).send().ok()?;
    if !response.status().is_success() {
        return None;
    }
    let bytes = response.bytes().ok()?;
    if bytes.is_empty() || bytes.len() > 8 * 1024 * 1024 {
        return None;
    }
    let mime = if bytes.starts_with(&[0xFF, 0xD8]) {
        "image/jpeg"
    } else {
        "image/png"
    };
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Some(format!("data:{mime};base64,{encoded}"))
}

#[tauri::command]
fn pick_folder(app: AppHandle, title: String) -> Option<String> {
    app.dialog()
        .file()
        .set_title(title)
        .blocking_pick_folder()
        .and_then(|path| path.as_path().map(|p| p.to_string_lossy().to_string()))
}

/// 用系统默认浏览器打开链接（微软登录页之类）
#[tauri::command]
fn open_url(url: String) {
    if url.starts_with("https://") || url.starts_with("http://") {
        let _ = tauri_plugin_opener::open_url(&url, None::<&str>);
    }
}

#[tauri::command]
fn window_minimize(window: Window) {
    let _ = window.minimize();
}

#[tauri::command]
fn window_toggle_maximize(window: Window) -> serde_json::Value {
    let maximized = window.is_maximized().unwrap_or(false);
    if maximized {
        let _ = window.unmaximize();
    } else {
        let _ = window.maximize();
    }
    serde_json::json!({
        "maximized": window.is_maximized().unwrap_or(false),
        "focused": window.is_focused().unwrap_or(true)
    })
}

#[tauri::command]
fn window_close(window: Window) {
    let _ = window.close();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// panic 兜底：追加到数据目录下的 ferry-crash.log。
/// 不弹窗、不退出进程——大部分 panic 发生在某个后台线程里，
/// 只让那一次操作失败即可，没必要把整个启动器带走。
fn install_panic_hook() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let path = util::data_file("ferry-crash.log");
        if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
            use std::io::Write;
            let location = info
                .location()
                .map(|loc| format!("{}:{}", loc.file(), loc.line()))
                .unwrap_or_else(|| "unknown".into());
            let message = if let Some(text) = info.payload().downcast_ref::<&str>() {
                (*text).to_string()
            } else if let Some(text) = info.payload().downcast_ref::<String>() {
                text.clone()
            } else {
                "unknown panic".into()
            };
            let _ = writeln!(file, "[{}] {location}: {message}", util::now_stamp());
        }
        // 保留默认行为（debug 下仍会打印到控制台），但不 abort
        if cfg!(debug_assertions) {
            default_hook(info);
        }
    }));
}

pub fn run() {
    // 把 panic 写进 ferry-crash.log，方便事后定位；进程本身继续跑。
    install_panic_hook();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .manage(NetplayState::default())
        .manage(LaunchState::default())
        .manage(InstallState::default())
        .manage(ModDownloadState::default())
        .invoke_handler(tauri::generate_handler![
            app_info,
            settings_get,
            settings_set,
            instances_list,
            instances_import,
            instances_create,
            instances_update,
            instances_remove,
            instances_preflight,
            instances_open_path,
            background_pick,
            background_load,
            content_list,
            content_preview,
            content_toggle,
            content_delete,
            content_import,
            content_updates,
            content_upgrade,
            mods_list,
            mods_toggle,
            mods_delete,
            mods_import,
            mod_search,
            mod_search_global,
            mod_download,
            mod_download_cancel,
            crash_analyze,
            instance_export,
            instance_pick_java,
            instance_icon_pick,
            instance_icon_clear,
            java_detect,
            java_download,
            net_fetch_image,
            open_url,
            pick_folder,
            accounts_list,
            accounts_offline,
            accounts_login_littleskin,
            accounts_refresh,
            accounts_remove,
            accounts_select_profile,
            accounts_upload_skin,
            accounts_ms_start,
            accounts_ms_poll,
            versions_manifest,
            versions_loaders,
            install_start,
            install_cancel,
            launch_start,
            launch_stop,
            launch_status,
            netplay_runtime,
            netplay_install,
            netplay_status,
            netplay_host,
            netplay_join,
            netplay_code_generate,
            netplay_code_parse,
            netplay_stop,
            netplay_easytier_config,
            netplay_easytier_save,
            window_minimize,
            window_toggle_maximize,
            window_close
        ])
        .build(tauri::generate_context!());

    let app = match app {
        Ok(app) => app,
        Err(error) => {
            // 构建失败（比如 WebView2 运行时缺失）时写日志并退出，
            // 而不是 panic 出栈让用户看到「应用闪一下就没了」。
            let path = util::data_file("ferry-crash.log");
            let _ = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)
                .and_then(|mut file| {
                    use std::io::Write;
                    writeln!(file, "[{}] build failed: {error}", util::now_stamp())
                });
            return;
        }
    };

    app.run(|handle, event| {
        // 退出时把联机进程收掉，别留孤儿 terracotta / easytier-core
        if matches!(event, tauri::RunEvent::Exit) {
            let state = handle.state::<NetplayState>();
            netplay::dispose(&state);
            let launch_state = handle.state::<LaunchState>();
            let _ = launch::stop(&launch_state);
        }
    });
}
