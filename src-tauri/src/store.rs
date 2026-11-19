use serde::{Deserialize, Serialize};
use std::sync::Mutex;

use crate::util::{clamp, data_file, read_json, read_json_with_backup, write_json};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub theme: String,
    pub accent: String,
    pub blur: i64,
    pub background_animation: bool,
    pub background_mode: String,
    pub background_path: Option<String>,
    pub background_dim: i64,
    pub ui_scale: i64,
    pub download_source: String,
    pub default_memory_mb: i64,
    pub locale: String,
    pub last_account_id: Option<String>,
    pub onboarding_done: bool,
    /// 全局默认 Java 路径，实例没单独指定时用它
    pub default_java_path: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "dark".into(),
            accent: "#4c6fff".into(),
            blur: 24,
            background_animation: true,
            background_mode: "builtin".into(),
            background_path: None,
            background_dim: 35,
            ui_scale: 100,
            download_source: "bmclapi".into(),
            default_memory_mb: 4096,
            locale: "zh-CN".into(),
            last_account_id: None,
            onboarding_done: false,
            default_java_path: None,
        }
    }
}

impl AppSettings {
    /// 与 Electron 版一致：每个字段都夹到合理区间，脏数据不进内存
    pub fn sanitized(mut self) -> Self {
        if self.theme != "dark" && self.theme != "light" && self.theme != "system" {
            self.theme = "dark".into();
        }
        if !is_hex_color(&self.accent) {
            self.accent = "#4c6fff".into();
        }
        self.blur = clamp(self.blur, 0, 40);
        self.background_dim = clamp(self.background_dim, 0, 80);
        self.ui_scale = clamp(self.ui_scale, 90, 125);
        self.default_memory_mb = clamp(self.default_memory_mb, 1024, 32768);
        if self.background_mode != "builtin" && self.background_mode != "custom" {
            self.background_mode = "builtin".into();
        }
        if self.download_source != "official" && self.download_source != "bmclapi" {
            self.download_source = "bmclapi".into();
        }
        if self.locale != "zh-CN" && self.locale != "en" {
            self.locale = "zh-CN".into();
        }
        self
    }
}

fn is_hex_color(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 7
        && bytes[0] == b'#'
        && bytes[1..].iter().all(|b| b.is_ascii_hexdigit())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Instance {
    pub id: String,
    pub name: String,
    pub mc_version: String,
    pub loader: String,
    #[serde(default)]
    pub loader_version: Option<String>,
    pub cover_seed: String,
    /// ISO 时间字符串，与渲染层 `lastPlayedAt: string | null` 保持一致
    pub last_played_at: Option<String>,
    pub total_playtime_ms: i64,
    pub memory_mb: i64,
    pub java_path: Option<String>,
    pub game_dir: String,
    #[serde(default)]
    pub version_id: Option<String>,
    #[serde(default)]
    pub jvm_args: Option<String>,
    #[serde(default)]
    pub isolated: Option<bool>,
    /// 自定义图标文件路径，为空则按加载器画内置像素图标
    #[serde(default)]
    pub icon: Option<String>,
}

#[derive(Default)]
pub struct AppState {
    pub settings: Mutex<Option<AppSettings>>,
    pub instances: Mutex<Option<Vec<Instance>>>,
}

/// 实例实际的游戏目录。
///
/// 版本隔离打开时，mods / saves / logs / config 都在 `versions/<id>/` 下面，
/// 而不是 `.minecraft` 根目录——导入 PCL / HMCL 整合包时几乎都是这个形态。
pub fn dir_of(instance: &Instance) -> String {
    if instance.isolated == Some(true) {
        let version = instance
            .version_id
            .clone()
            .unwrap_or_else(|| instance.mc_version.clone());
        return std::path::Path::new(&instance.game_dir)
            .join("versions")
            .join(version)
            .to_string_lossy()
            .to_string();
    }
    instance.game_dir.clone()
}

fn settings_path() -> std::path::PathBuf {
    data_file("settings.json")
}

fn instances_path() -> std::path::PathBuf {
    data_file("instances.json")
}

pub fn load_settings(state: &AppState) -> AppSettings {
    let mut guard = state.settings.lock().unwrap();
    if let Some(cached) = guard.as_ref() {
        return cached.clone();
    }
    let loaded = read_json::<AppSettings>(&settings_path())
        .map(|s| s.sanitized())
        .unwrap_or_default();
    *guard = Some(loaded.clone());
    loaded
}

pub fn save_settings(state: &AppState, patch: serde_json::Value) -> Result<AppSettings, String> {
    let current = load_settings(state);
    let mut merged = serde_json::to_value(&current).map_err(|e| e.to_string())?;
    if let (Some(target), Some(incoming)) = (merged.as_object_mut(), patch.as_object()) {
        for (key, value) in incoming {
            if target.contains_key(key) && !value.is_null() {
                target.insert(key.clone(), value.clone());
            }
        }
    }
    let parsed = serde_json::from_value::<AppSettings>(merged).map_err(|e| e.to_string())?;
    let next = parsed.sanitized();
    write_json(&settings_path(), &next)?;
    *state.settings.lock().unwrap() = Some(next.clone());
    Ok(next)
}

pub fn load_instances(state: &AppState) -> Vec<Instance> {
    let mut guard = state.instances.lock().unwrap();
    if let Some(cached) = guard.as_ref() {
        return cached.clone();
    }
    let loaded = read_json_with_backup::<Vec<Instance>>(&instances_path()).unwrap_or_default();
    // 老记录没有 isolated 字段：按版本目录里有没有 mods / saves 之类的实物来判断，
    // 免得导入过的整合包在界面上一直显示 0 个 mod
    let mut list = loaded;
    let mut patched = false;
    for item in list.iter_mut() {
        if item.isolated.is_none() {
            let version = item
                .version_id
                .clone()
                .unwrap_or_else(|| item.mc_version.clone());
            let version_dir = std::path::Path::new(&item.game_dir).join("versions").join(version);
            if ["mods", "saves", "config", "resourcepacks", "options.txt"]
                .iter()
                .any(|name| version_dir.join(name).exists())
            {
                item.isolated = Some(true);
                patched = true;
            }
        }
    }
    if patched {
        let _ = write_json(&instances_path(), &list);
    }
    *guard = Some(list.clone());
    list
}

fn persist_instances(state: &AppState, list: &[Instance]) -> Result<(), String> {
    write_json(&instances_path(), &list.to_vec())?;
    *state.instances.lock().unwrap() = Some(list.to_vec());
    Ok(())
}

fn same_slot(a: &Instance, b: &Instance) -> bool {
    a.game_dir.to_lowercase() == b.game_dir.to_lowercase()
        && a.version_id.clone().unwrap_or_default() == b.version_id.clone().unwrap_or_default()
}

pub fn add_instances(state: &AppState, drafts: Vec<Instance>) -> Result<Vec<Instance>, String> {
    let mut list = load_instances(state);
    let mut accepted = Vec::new();
    for draft in drafts {
        if list.iter().any(|item| same_slot(item, &draft)) {
            continue;
        }
        list.push(draft.clone());
        accepted.push(draft);
    }
    if !accepted.is_empty() {
        persist_instances(state, &list)?;
    }
    Ok(accepted)
}

pub fn update_instance(
    state: &AppState,
    id: &str,
    patch: serde_json::Value,
) -> Result<Vec<Instance>, String> {
    let mut list = load_instances(state);
    if let Some(item) = list.iter_mut().find(|item| item.id == id) {
        if let Some(name) = patch.get("name").and_then(|v| v.as_str()) {
            let trimmed = name.trim();
            if !trimmed.is_empty() {
                item.name = trimmed.chars().take(48).collect();
            }
        }
        if let Some(memory) = patch.get("memoryMb").and_then(|v| v.as_i64()) {
            item.memory_mb = ((memory + 256) / 512) * 512;
            item.memory_mb = clamp(item.memory_mb, 1024, 32768);
        }
        if patch.get("javaPath").is_some() {
            item.java_path = patch
                .get("javaPath")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
        }
        if let Some(args) = patch.get("jvmArgs").and_then(|v| v.as_str()) {
            item.jvm_args = Some(args.chars().take(2000).collect());
        }
        if let Some(isolated) = patch.get("isolated").and_then(|v| v.as_bool()) {
            item.isolated = Some(isolated);
        }
        // null 表示恢复成内置图标
        if patch.get("icon").is_some() {
            item.icon = patch
                .get("icon")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
        }
    }
    persist_instances(state, &list)?;
    Ok(list)
}

pub fn remove_instance(state: &AppState, id: &str) -> Result<Vec<Instance>, String> {
    let mut list = load_instances(state);
    list.retain(|item| item.id != id);
    persist_instances(state, &list)?;
    Ok(list)
}

pub fn find_instance(state: &AppState, id: &str) -> Option<Instance> {
    load_instances(state).into_iter().find(|item| item.id == id)
}

/// 游戏退出后累加时长，并记下最后一次游玩时间
pub fn record_playtime(state: &AppState, id: &str, delta_ms: i64) -> Result<(), String> {
    let mut list = load_instances(state);
    if let Some(item) = list.iter_mut().find(|item| item.id == id) {
        item.total_playtime_ms += delta_ms.max(0);
        item.last_played_at = Some(iso_now());
    }
    persist_instances(state, &list)
}

/// 不引入 chrono，自己把 unix 时间换算成 ISO8601（UTC）
fn iso_now() -> String {
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0);
    let days = seconds.div_euclid(86_400);
    let rest = seconds.rem_euclid(86_400);
    let (hour, minute, second) = (rest / 3600, (rest % 3600) / 60, rest % 60);

    // Howard Hinnant 的 civil_from_days
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { y + 1 } else { y };
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}
