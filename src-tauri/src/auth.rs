//! 账户：LittleSkin（Yggdrasil 外置登录）、离线账户、微软账户。
//!
//! token 不落渲染层：渲染层只看 AccountSummary。token 本体优先放系统凭据库
//! （Windows 凭据管理器 / macOS 钥匙串 / libsecret），拿不到才退回 accounts.json。

use std::path::PathBuf;

use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::http;
use crate::util::{data_file, read_json_with_backup, short_id, write_json};

pub const LITTLESKIN_ROOT: &str = "https://littleskin.cn/api/yggdrasil";
/// 微软 OAuth 的公共客户端 id（第三方启动器通用），用户可在设置里覆盖
pub const DEFAULT_MS_CLIENT_ID: &str = "00000000402b5328";

/// 一个账户下可以挂多个角色（LittleSkin 很常见）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Account {
    pub id: String,
    pub kind: String,
    pub source_name: String,
    pub api_root: Option<String>,
    pub profile_name: String,
    pub uuid: String,
    pub skin_url: Option<String>,
    pub cape_url: Option<String>,
    pub skin_model: Option<String>,
    pub access_token: Option<String>,
    pub client_token: Option<String>,
    pub refresh_token: Option<String>,
    pub user_name: Option<String>,
    /// 该账户可选的角色，第一个是登录时选中的
    pub profiles: Vec<Profile>,
}

/// 渲染层可见的部分，不含任何 token
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSummary {
    pub id: String,
    pub kind: String,
    pub source_name: String,
    pub api_root: Option<String>,
    pub profile_name: String,
    pub user_name: Option<String>,
    pub uuid: String,
    pub skin_url: Option<String>,
    pub cape_url: Option<String>,
    pub skin_model: Option<String>,
    pub profiles: Vec<Profile>,
}

impl Account {
    pub fn summary(&self) -> AccountSummary {
        AccountSummary {
            id: self.id.clone(),
            kind: self.kind.clone(),
            source_name: self.source_name.clone(),
            api_root: self.api_root.clone(),
            profile_name: self.profile_name.clone(),
            user_name: self.user_name.clone(),
            uuid: self.uuid.clone(),
            skin_url: self.skin_url.clone(),
            cape_url: self.cape_url.clone(),
            skin_model: self.skin_model.clone(),
            profiles: self.profiles.clone(),
        }
    }
}

fn accounts_path() -> PathBuf {
    data_file("accounts.json")
}

pub fn load_accounts() -> Vec<Account> {
    let mut list = read_json_with_backup::<Vec<Account>>(&accounts_path()).unwrap_or_default();
    for account in list.iter_mut() {
        if account.access_token.is_none() {
            account.access_token = keyring_get(&account.id, "access");
        }
        if account.refresh_token.is_none() {
            account.refresh_token = keyring_get(&account.id, "refresh");
        }
    }
    list
}

fn persist(list: &[Account]) -> Result<(), String> {
    // 先写凭据库，成功的话磁盘上就不留 token
    let mut disk = list.to_vec();
    for account in disk.iter_mut() {
        if let Some(token) = account.access_token.clone() {
            if keyring_set(&account.id, "access", &token) {
                account.access_token = None;
            }
        }
        if let Some(token) = account.refresh_token.clone() {
            if keyring_set(&account.id, "refresh", &token) {
                account.refresh_token = None;
            }
        }
    }
    write_json(&accounts_path(), &disk)
}

fn keyring_entry(id: &str, slot: &str) -> Option<keyring::Entry> {
    keyring::Entry::new("FerryLauncher", &format!("{id}:{slot}")).ok()
}

fn keyring_get(id: &str, slot: &str) -> Option<String> {
    keyring_entry(id, slot)?.get_password().ok()
}

fn keyring_set(id: &str, slot: &str, value: &str) -> bool {
    keyring_entry(id, slot)
        .map(|entry| entry.set_password(value).is_ok())
        .unwrap_or(false)
}

pub fn remove_account(id: &str) -> Vec<AccountSummary> {
    let mut list = load_accounts();
    list.retain(|account| account.id != id);
    let _ = persist(&list);
    if let Some(entry) = keyring_entry(id, "access") {
        let _ = entry.delete_credential();
    }
    if let Some(entry) = keyring_entry(id, "refresh") {
        let _ = entry.delete_credential();
    }
    if let Some(entry) = keyring_entry(id, "password") {
        let _ = entry.delete_credential();
    }
    list.iter().map(|account| account.summary()).collect()
}

pub fn summaries() -> Vec<AccountSummary> {
    load_accounts().iter().map(|account| account.summary()).collect()
}

pub fn find(id: &str) -> Option<Account> {
    load_accounts().into_iter().find(|account| account.id == id)
}

/// 离线账户的 UUID 和原版一致：md5("OfflinePlayer:<name>") 打上 v3 标记
pub fn offline_uuid(name: &str) -> String {
    let digest = md5::compute(format!("OfflinePlayer:{name}").as_bytes());
    let mut bytes = digest.0;
    bytes[6] = (bytes[6] & 0x0f) | 0x30;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex = hex::encode(bytes);
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

pub fn add_offline(name: &str) -> Result<AccountSummary, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 16 {
        return Err("BAD_NAME".into());
    }
    let account = Account {
        id: format!("offline-{}", short_id()),
        kind: "offline".into(),
        source_name: "离线".into(),
        api_root: None,
        profile_name: trimmed.to_string(),
        uuid: offline_uuid(trimmed),
        skin_url: None,
        cape_url: None,
        skin_model: None,
        access_token: Some("0".into()),
        client_token: None,
        refresh_token: None,
        user_name: Some(trimmed.to_string()),
        profiles: Vec::new(),
    };
    let mut list = load_accounts();
    list.retain(|item| item.profile_name.to_lowercase() != trimmed.to_lowercase());
    list.push(account.clone());
    persist(&list)?;
    Ok(account.summary())
}

/* ==========================================================================
   Yggdrasil（LittleSkin）
   ========================================================================== */

fn yggdrasil_error(text: &str) -> String {
    serde_json::from_str::<serde_json::Value>(text)
        .ok()
        .and_then(|value| {
            value
                .get("errorMessage")
                .or_else(|| value.get("error"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| text.to_string())
}

/// 登录成功后的统一处理：拿皮肤、存盘
fn finish_yggdrasil(
    root: &str,
    access_token: String,
    client_token: Option<String>,
    profile_name: String,
    profile_id: String,
    user_name: Option<String>,
) -> AccountSummary {
    let mut account = Account {
        id: format!("ys-{}", short_id()),
        kind: "littleskin".into(),
        source_name: if root.contains("littleskin") {
            "LittleSkin".into()
        } else {
            "外置登录".into()
        },
        api_root: Some(root.to_string()),
        profile_name,
        uuid: profile_id,
        skin_url: None,
        cape_url: None,
        skin_model: None,
        access_token: Some(access_token),
        client_token,
        refresh_token: None,
        user_name,
        profiles: Vec::new(),
    };
    refresh_textures(&mut account);
    let mut list = load_accounts();
    // 同一账户重新登录（换角色要重登）沿用原 id，settings.lastAccountId 才不会失效
    let existing = list.iter().find(|item| {
        item.api_root == account.api_root
            && ((account.user_name.is_some() && item.user_name == account.user_name)
                || item.uuid == account.uuid)
    });
    if let Some(found) = existing {
        account.id = found.id.clone();
    }
    // 同一个用户名重新登录应该覆盖旧记录，而不是多出一个账户
    list.retain(|item| {
        if item.api_root != account.api_root {
            return true;
        }
        if account.user_name.is_some() && item.user_name == account.user_name {
            return false;
        }
        item.uuid != account.uuid
    });
    list.push(account.clone());
    let _ = persist(&list);
    account.summary()
}

fn parse_profile(value: &serde_json::Value) -> Option<Profile> {
    let id = value.get("id").and_then(|v| v.as_str())?;
    let name = value.get("name").and_then(|v| v.as_str()).unwrap_or(id);
    Some(Profile {
        id: id.to_string(),
        name: name.to_string(),
    })
}

struct AuthOutcome {
    access_token: String,
    client_token: String,
    profiles: Vec<Profile>,
    /// 服务端登录时自动绑定的角色；多角色时通常为空，需要客户端 refresh 选
    selected: Option<Profile>,
}

/// POST /authserver/authenticate。角色切换失败时也会复用（换新令牌）。
fn authenticate(root: &str, username: &str, password: &str) -> Result<AuthOutcome, String> {
    let client_token = short_id();
    let body = serde_json::json!({
        "username": username,
        "password": password,
        "clientToken": client_token,
        "agent": { "name": "Minecraft", "version": 1 },
        "requestUser": false
    });
    let url = format!("{root}/authserver/authenticate");
    let response = http::client()
        .post(&url)
        .json(&body)
        .send()
        .map_err(|e| e.to_string())?;
    let status = response.status();
    let text = response.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(yggdrasil_error(&text));
    }
    let value: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let access_token = value
        .get("accessToken")
        .and_then(|v| v.as_str())
        .ok_or("NO_TOKEN")?
        .to_string();
    let client_token = value
        .get("clientToken")
        .and_then(|v| v.as_str())
        .unwrap_or(&client_token)
        .to_string();
    let profiles = value
        .get("availableProfiles")
        .and_then(|v| v.as_array())
        .map(|list| list.iter().filter_map(parse_profile).collect())
        .unwrap_or_default();
    let selected = value.get("selectedProfile").and_then(parse_profile);
    Ok(AuthOutcome {
        access_token,
        client_token,
        profiles,
        selected,
    })
}

pub fn yggdrasil_login(
    root: &str,
    username: &str,
    password: &str,
) -> Result<AccountSummary, String> {
    let root = root.trim_end_matches('/');
    let outcome = authenticate(root, username, password)?;
    let selected = outcome
        .selected
        .clone()
        .or_else(|| outcome.profiles.first().cloned())
        .ok_or("NO_PROFILE")?;
    let mut summary = finish_yggdrasil(
        root,
        outcome.access_token,
        Some(outcome.client_token),
        selected.name,
        selected.id,
        Some(username.to_string()),
    );
    // 密码存进系统凭据库：令牌一旦绑了角色就不能改绑，切角色只能拿它重新登录换新令牌
    let _ = keyring_set(&summary.id, "password", password);
    let mut list = load_accounts();
    if let Some(slot) = list.iter_mut().find(|item| item.id == summary.id) {
        slot.profiles = outcome.profiles.clone();
    }
    let _ = persist(&list);
    summary.profiles = outcome.profiles;
    Ok(summary)
}

fn refresh_token(id: &str) -> Result<AccountSummary, String> {
    let account = find(id).ok_or("NOT_FOUND")?;
    let root = account.api_root.clone().ok_or("NOT_YGGDRASIL")?;
    let access_token = account.access_token.clone().ok_or("NO_TOKEN")?;
    let body = serde_json::json!({
        "accessToken": access_token,
        "clientToken": account.client_token,
        "requestUser": false
    });
    let url = format!("{}/authserver/refresh", root.trim_end_matches('/'));
    let response = http::client()
        .post(&url)
        .json(&body)
        .send()
        .map_err(|e| e.to_string())?;
    let status = response.status();
    let text = response.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(yggdrasil_error(&text));
    }
    let value: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let mut updated = account.clone();
    updated.access_token = value
        .get("accessToken")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or(updated.access_token);
    if let Some(profile) = value.get("selectedProfile") {
        if let Some(name) = profile.get("name").and_then(|v| v.as_str()) {
            updated.profile_name = name.to_string();
        }
        if let Some(uuid) = profile.get("id").and_then(|v| v.as_str()) {
            updated.uuid = uuid.to_string();
        }
    }
    refresh_textures(&mut updated);
    let mut list = load_accounts();
    if let Some(slot) = list.iter_mut().find(|item| item.id == id) {
        *slot = updated.clone();
    }
    persist(&list)?;
    Ok(updated.summary())
}

/// 刷新 token。游戏里 authlib-injector 一刷新，启动器手上的 token 就作废了，
/// 这时候不能直接报「登录失效」，用凭据库里存的密码静默重登一次即可。
pub fn yggdrasil_refresh(id: &str) -> Result<AccountSummary, String> {
    match refresh_token(id) {
        Ok(summary) => Ok(summary),
        Err(err) => {
            let account = find(id).ok_or("NOT_FOUND")?;
            let Some(password) = keyring_get(&account.id, "password") else {
                return Err(err);
            };
            let Some(username) = account.user_name.clone() else {
                return Err(err);
            };
            let Some(root) = account.api_root.clone() else {
                return Err(err);
            };
            let outcome = authenticate(&root, &username, &password)?;
            let selected = outcome
                .selected
                .clone()
                .or_else(|| outcome.profiles.first().cloned());
            let mut updated = account.clone();
            updated.access_token = Some(outcome.access_token);
            updated.client_token = Some(outcome.client_token);
            if !outcome.profiles.is_empty() {
                updated.profiles = outcome.profiles;
            }
            if let Some(profile) = selected {
                updated.profile_name = profile.name;
                updated.uuid = profile.id;
            }
            updated.skin_url = None;
            updated.cape_url = None;
            refresh_textures(&mut updated);
            save_account(&updated)?;
            Ok(updated.summary())
        }
    }
}

/// refresh 时带上 selectedProfile 就是「选角色」，但规范要求原令牌未绑定角色，
/// 否则服务端返回 400 Access token already has a profile assigned。
fn refresh_with_profile(account: &Account, profile: &Profile) -> Result<AccountSummary, String> {
    let root = account.api_root.clone().ok_or("NOT_YGGDRASIL")?;
    let token = account.access_token.clone().ok_or("NO_TOKEN")?;
    let body = serde_json::json!({
        "accessToken": token,
        "clientToken": account.client_token,
        "selectedProfile": { "id": profile.id, "name": profile.name },
        "requestUser": false
    });
    let url = format!("{}/authserver/refresh", root.trim_end_matches('/'));
    let response = http::client()
        .post(&url)
        .json(&body)
        .send()
        .map_err(|e| e.to_string())?;
    let status = response.status();
    let text = response.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(yggdrasil_error(&text));
    }

    let mut updated = account.clone();
    updated.profile_name = profile.name.clone();
    updated.uuid = profile.id.clone();
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
        if let Some(new_token) = value.get("accessToken").and_then(|v| v.as_str()) {
            updated.access_token = Some(new_token.to_string());
        }
    }
    updated.skin_url = None;
    updated.cape_url = None;
    refresh_textures(&mut updated);

    let mut list = load_accounts();
    if let Some(slot) = list.iter_mut().find(|item| item.id == account.id) {
        *slot = updated.clone();
    }
    persist(&list)?;
    Ok(updated.summary())
}

fn save_account(account: &Account) -> Result<(), String> {
    let mut list = load_accounts();
    if let Some(slot) = list.iter_mut().find(|item| item.id == account.id) {
        *slot = account.clone();
    }
    persist(&list)
}

/// 切换账户下的角色。
///
/// 规范里令牌一旦绑定了角色就不能再改绑，所以两条路：
/// 1. 令牌没绑角色（多角色账户登录时常见）→ refresh + selectedProfile 直接选；
/// 2. 已经绑死 → 用凭据库里存的密码重新 authenticate 换一个未绑定的新令牌，再选一次。
pub fn select_profile(id: &str, profile_id: &str) -> Result<AccountSummary, String> {
    let account = find(id).ok_or("NOT_FOUND")?;
    let root = account.api_root.clone().ok_or("NOT_YGGDRASIL")?;
    let profile = account
        .profiles
        .iter()
        .find(|item| item.id == profile_id)
        .cloned()
        .ok_or("NO_PROFILE")?;

    match refresh_with_profile(&account, &profile) {
        Ok(summary) => Ok(summary),
        Err(err) if err.contains("already has a profile") => {
            let password = keyring_get(&account.id, "password").ok_or("PROFILE_LOCKED")?;
            let username = account.user_name.clone().ok_or("PROFILE_LOCKED")?;
            let outcome = authenticate(&root, &username, &password)?;
            let already_target = outcome
                .selected
                .as_ref()
                .map(|item| item.id == profile.id)
                .unwrap_or(false);

            // 新令牌先落盘，profile 列表也一起更新
            let mut fresh = account.clone();
            fresh.access_token = Some(outcome.access_token);
            fresh.client_token = Some(outcome.client_token);
            if !outcome.profiles.is_empty() {
                fresh.profiles = outcome.profiles;
            }
            if already_target {
                fresh.profile_name = profile.name.clone();
                fresh.uuid = profile.id.clone();
                fresh.skin_url = None;
                fresh.cape_url = None;
                refresh_textures(&mut fresh);
                save_account(&fresh)?;
                return Ok(fresh.summary());
            }
            if outcome.selected.is_some() {
                // 服务端又把新令牌绑到了别的角色上，没得选
                save_account(&fresh)?;
                return Err("PROFILE_LOCKED".into());
            }
            save_account(&fresh)?;
            refresh_with_profile(&fresh, &profile)
        }
        Err(err) => Err(err),
    }
}

/// 上传皮肤。LittleSkin 走 /user/profile/{uuid}/skin，multipart 里带 model 和 file。
pub fn upload_skin(id: &str, png: Vec<u8>, model: &str) -> Result<AccountSummary, String> {
    let account = find(id).ok_or("NOT_FOUND")?;
    let root = account.api_root.clone().ok_or("NOT_YGGDRASIL")?;
    let token = account.access_token.clone().ok_or("NO_TOKEN")?;
    let url = format!(
        "{}/user/profile/{}/skin",
        root.trim_end_matches('/'),
        account.uuid
    );
    let model_text = if model == "slim" { "slim" } else { "classic" };

    let build = || -> Result<reqwest::blocking::multipart::Form, String> {
        let part = reqwest::blocking::multipart::Part::bytes(png.clone())
            .file_name("skin.png")
            .mime_str("image/png")
            .map_err(|e| e.to_string())?;
        Ok(reqwest::blocking::multipart::Form::new()
            .text("model", model_text.to_string())
            .part("file", part))
    };

    let client = http::client();
    let mut response = client
        .put(&url)
        .bearer_auth(&token)
        .multipart(build()?)
        .send()
        .map_err(|e| e.to_string())?;
    if response.status().as_u16() == 405 {
        // 少数实现只认 POST
        response = client
            .post(&url)
            .bearer_auth(&token)
            .multipart(build()?)
            .send()
            .map_err(|e| e.to_string())?;
    }
    let status = response.status();
    let text = response.text().unwrap_or_default();
    if !status.is_success() {
        return Err(yggdrasil_error(&text));
    }

    let mut updated = account.clone();
    updated.skin_model = Some(model_text.to_string());
    updated.skin_url = None;
    refresh_textures(&mut updated);
    let mut list = load_accounts();
    if let Some(slot) = list.iter_mut().find(|item| item.id == id) {
        *slot = updated.clone();
    }
    persist(&list)?;
    Ok(updated.summary())
}

/// 拉皮肤 / 披风。失败不影响登录。
pub fn refresh_textures(account: &mut Account) {
    let Some(root) = account.api_root.clone() else {
        return;
    };
    let url = format!(
        "{}/sessionserver/session/minecraft/profile/{}",
        root.trim_end_matches('/'),
        account.uuid
    );
    let Ok(value) = http::get_json::<serde_json::Value>(&url) else {
        return;
    };
    let Some(properties) = value.get("properties").and_then(|v| v.as_array()) else {
        return;
    };
    for property in properties {
        if property.get("name").and_then(|v| v.as_str()) != Some("textures") {
            continue;
        }
        let Some(encoded) = property.get("value").and_then(|v| v.as_str()) else {
            continue;
        };
        let Ok(decoded) = base64::engine::general_purpose::STANDARD.decode(encoded) else {
            continue;
        };
        let Ok(textures) = serde_json::from_slice::<serde_json::Value>(&decoded) else {
            continue;
        };
        let Some(map) = textures.get("textures") else {
            continue;
        };
        if let Some(skin) = map.get("SKIN") {
            account.skin_url = skin.get("url").and_then(|v| v.as_str()).map(|s| s.to_string());
            account.skin_model = skin
                .get("metadata")
                .and_then(|v| v.get("model"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
        }
        if let Some(cape) = map.get("CAPE") {
            account.cape_url = cape.get("url").and_then(|v| v.as_str()).map(|s| s.to_string());
        }
    }
}

/* ==========================================================================
   微软账户：设备码流程
   ========================================================================== */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCode {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: i64,
    pub interval: i64,
}

pub fn microsoft_device_code(client_id: &str) -> Result<DeviceCode, String> {
    let client_id = if client_id.trim().is_empty() {
        DEFAULT_MS_CLIENT_ID
    } else {
        client_id.trim()
    };
    let response = http::client()
        .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode")
        .form(&[
            ("client_id", client_id),
            ("scope", "XboxLive.signin offline_access"),
        ])
        .send()
        .map_err(|e| e.to_string())?;
    let status = response.status();
    let text = response.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("HTTP {} · {text}", status.as_u16()));
    }
    let value: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    Ok(DeviceCode {
        device_code: value
            .get("device_code")
            .and_then(|v| v.as_str())
            .ok_or("NO_DEVICE_CODE")?
            .to_string(),
        user_code: value
            .get("user_code")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        verification_uri: value
            .get("verification_uri")
            .and_then(|v| v.as_str())
            .unwrap_or("https://microsoft.com/link")
            .to_string(),
        expires_in: value.get("expires_in").and_then(|v| v.as_i64()).unwrap_or(900),
        interval: value.get("interval").and_then(|v| v.as_i64()).unwrap_or(5),
    })
}

/// 轮询设备码结果。返回 Ok(None) 表示还没授权。
pub fn microsoft_poll(client_id: &str, device_code: &str) -> Result<Option<AccountSummary>, String> {
    let client_id = if client_id.trim().is_empty() {
        DEFAULT_MS_CLIENT_ID
    } else {
        client_id.trim()
    };
    let response = http::client()
        .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/token")
        .form(&[
            ("client_id", client_id),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ("device_code", device_code),
        ])
        .send()
        .map_err(|e| e.to_string())?;
    let status = response.status();
    let text = response.text().map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_str(&text).unwrap_or(serde_json::json!({}));
    if !status.is_success() {
        return match value.get("error").and_then(|v| v.as_str()) {
            Some("authorization_pending") | Some("slow_down") => Ok(None),
            Some("expired_token") => Err("EXPIRED".into()),
            Some("authorization_declined") => Err("DECLINED".into()),
            _ => Err(format!("HTTP {} · {text}", status.as_u16())),
        };
    }
    let access_token = value
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or("NO_TOKEN")?
        .to_string();
    let refresh_token = value
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // Xbox Live → XSTS → Minecraft
    let xbl = http::post_json::<serde_json::Value>(
        "https://user.auth.xboxlive.com/user/authenticate",
        &serde_json::json!({
            "Properties": {
                "AuthMethod": "RPS",
                "SiteName": "user.auth.xboxlive.com",
                "RpsTicket": format!("d={access_token}")
            },
            "RelyingParty": "http://auth.xboxlive.com",
            "TokenType": "JWT"
        }),
    )?;
    let xbl_token = xbl
        .get("Token")
        .and_then(|v| v.as_str())
        .ok_or("XBL_FAILED")?
        .to_string();
    let xsts = http::post_json::<serde_json::Value>(
        "https://xsts.auth.xboxlive.com/xsts/authorize",
        &serde_json::json!({
            "Properties": { "SandboxId": "RETAIL", "UserTokens": [xbl_token] },
            "RelyingParty": "rp://api.minecraftservices.com/",
            "TokenType": "JWT"
        }),
    )?;
    let xsts_token = xsts
        .get("Token")
        .and_then(|v| v.as_str())
        .ok_or("XSTS_FAILED")?
        .to_string();
    let user_hash = xsts
        .get("DisplayClaims")
        .and_then(|v| v.get("xui"))
        .and_then(|v| v.as_array())
        .and_then(|list| list.first())
        .and_then(|first| first.get("uhs"))
        .and_then(|v| v.as_str())
        .ok_or("XSTS_FAILED")?
        .to_string();

    let minecraft = http::post_json::<serde_json::Value>(
        "https://api.minecraftservices.com/authentication/login_with_xbox",
        &serde_json::json!({ "identityToken": format!("XBL3.0 x={user_hash};{xsts_token}") }),
    )?;
    let mc_token = minecraft
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or("MC_LOGIN_FAILED")?
        .to_string();

    let profile = {
        let response = http::client()
            .get("https://api.minecraftservices.com/minecraft/profile")
            .bearer_auth(&mc_token)
            .send()
            .map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            return Err("NO_PROFILE".into());
        }
        response
            .json::<serde_json::Value>()
            .map_err(|e| e.to_string())?
    };

    let name = profile
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or("NO_PROFILE")?
        .to_string();
    let uuid = profile
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("NO_PROFILE")?
        .to_string();

    let mut account = Account {
        id: format!("ms-{}", short_id()),
        kind: "microsoft".into(),
        source_name: "Microsoft".into(),
        api_root: None,
        profile_name: name.clone(),
        uuid: uuid.clone(),
        skin_url: None,
        cape_url: None,
        skin_model: None,
        access_token: Some(mc_token),
        client_token: None,
        refresh_token,
        user_name: Some(name),
        profiles: Vec::new(),
    };
    // 正版皮肤走官方会话服
    let url = format!("https://sessionserver.mojang.com/session/minecraft/profile/{uuid}");
    if let Ok(value) = http::get_json::<serde_json::Value>(&url) {
        if let Some(properties) = value.get("properties").and_then(|v| v.as_array()) {
            for property in properties {
                if property.get("name").and_then(|v| v.as_str()) != Some("textures") {
                    continue;
                }
                if let Some(encoded) = property.get("value").and_then(|v| v.as_str()) {
                    if let Ok(decoded) =
                        base64::engine::general_purpose::STANDARD.decode(encoded)
                    {
                        if let Ok(textures) = serde_json::from_slice::<serde_json::Value>(&decoded) {
                            if let Some(skin) = textures.get("textures").and_then(|v| v.get("SKIN")) {
                                account.skin_url =
                                    skin.get("url").and_then(|v| v.as_str()).map(|s| s.to_string());
                                account.skin_model = skin
                                    .get("metadata")
                                    .and_then(|v| v.get("model"))
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string());
                            }
                            if let Some(cape) = textures.get("textures").and_then(|v| v.get("CAPE")) {
                                account.cape_url =
                                    cape.get("url").and_then(|v| v.as_str()).map(|s| s.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    let mut list = load_accounts();
    list.retain(|item| item.uuid != account.uuid);
    list.push(account.clone());
    persist(&list)?;
    Ok(Some(account.summary()))
}
