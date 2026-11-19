use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

/// 取互斥锁，遇到「毒锁」直接恢复内部数据继续用。
///
/// 默认的 `lock().unwrap()` 在某个线程持锁时 panic 之后会永久失败，
/// 之后每一次访问都 panic，最终表现就是整个启动器莫名其妙退出。
/// 这里宁可继续用可能不一致的数据，也不让一次局部错误扩散成全局崩溃。
pub fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

/// 所有持久化数据都放在 %APPDATA%/ferry-launcher，和 Electron 版一致，
/// 这样两个壳可以共用同一份用户数据。
///
/// `FERRY_DATA_DIR` 可以整体改到别处：录宣传片、跑自动化测试时用它指向一份
/// 演示档案，免得动到用户自己的实例和账户。
pub fn data_dir() -> PathBuf {
    if let Some(custom) = std::env::var_os("FERRY_DATA_DIR") {
        let dir = PathBuf::from(custom);
        let _ = fs::create_dir_all(&dir);
        return dir;
    }
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    let dir = base.join("ferry-launcher");
    let _ = fs::create_dir_all(&dir);
    dir
}

pub fn data_file(name: &str) -> PathBuf {
    data_dir().join(name)
}

/// 简单的本地时间戳，给崩溃日志用（不引第三方时间库）。
pub fn now_stamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // 东八区偏移；只用于日志可读性，不参与业务计算
    let local = secs + 8 * 3600;
    let days = local / 86400;
    let rem = local % 86400;
    let (year, month, day) = civil_from_days(days as i64);
    format!(
        "{year:04}-{month:02}-{day:02} {:02}:{:02}:{:02}",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// Howard Hinnant 的 days-from-civil 逆运算，避免为了一个时间戳引入 chrono。
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

pub fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Option<T> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

/// 读不到或者解析失败时退回 `.bak`。
///
/// 之前进程被强杀（taskkill /F）正好撞上写盘，文件会被截断成空，
/// 下次启动读出来就是空列表，等于把用户数据全丢了。这里给一条后路。
pub fn read_json_with_backup<T: serde::de::DeserializeOwned>(path: &Path) -> Option<T> {
    if let Some(value) = read_json::<T>(path) {
        return Some(value);
    }
    read_json::<T>(&path.with_extension("json.bak"))
}

/// 原子写：先写 `.tmp` 再改名，同时留一份 `.bak`。
/// 强杀 / 断电都不会留下半个文件。
pub fn write_json<T: serde::Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;

    let temp = path.with_extension("json.tmp");
    {
        use std::io::Write;
        let mut file = fs::File::create(&temp).map_err(|e| e.to_string())?;
        file.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
    }

    // 旧文件先备份，再让新文件顶上
    if path.is_file() {
        let backup = path.with_extension("json.bak");
        let _ = fs::copy(path, &backup);
    }
    fs::rename(&temp, path).map_err(|e| e.to_string())
}

pub fn is_dir(path: &Path) -> bool {
    path.is_dir()
}

/// 生成一个短 id，够本地唯一即可
pub fn short_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{:x}", nanos)
}

pub fn clamp(value: i64, min: i64, max: i64) -> i64 {
    value.max(min).min(max)
}

/// 把 `%APPDATA%\ferry-launcher\instances\<id>` 这类目录建好
pub fn ensure_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| e.to_string())
}
