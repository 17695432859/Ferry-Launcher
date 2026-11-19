//! 崩溃日志自动分析。
//!
//! 只读实例 logs / crash-reports，不联网。输出给界面的是可直接阅读的结论：
//! 命中了什么问题、依据是哪行日志、建议怎么修。规则按「具体 → 泛化」排序，
//! 一次崩溃可以同时命中多条（比如内存不足往往伴随加载失败）。

use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
pub struct Cause {
    pub id: String,
    pub title: String,
    pub detail: String,
    pub fix: String,
    pub severity: String,
    /// 触发这条规则的原文，方便用户自己核对
    pub evidence: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Report {
    pub crashed: bool,
    pub exit_code: i32,
    pub summary: String,
    pub causes: Vec<Cause>,
    /// 最近几行原文，界面上可折叠查看
    pub tail: Vec<String>,
    pub sources: Vec<String>,
}

struct Rule {
    id: &'static str,
    title: &'static str,
    detail: &'static str,
    fix: &'static str,
    severity: &'static str,
    /// 返回 true 表示命中
    test: fn(&str) -> bool,
    /// 从日志里提取证据时用的关键字
    evidence: &'static str,
}

fn first_line_containing<'a>(haystack: &'a str, needle: &str) -> String {
    haystack
        .lines()
        .find(|line| line.to_ascii_lowercase().contains(&needle.to_ascii_lowercase()))
        .unwrap_or("")
        .trim()
        .chars()
        .take(240)
        .collect()
}

fn has(text: &str, needle: &str) -> bool {
    text.to_ascii_lowercase().contains(&needle.to_ascii_lowercase())
}

fn has_any(text: &str, needles: &[&str]) -> bool {
    needles.iter().any(|n| has(text, n))
}

const RULES: &[Rule] = &[
    Rule {
        id: "java-version",
        title: "Java 版本不匹配",
        detail: "游戏版本需要的 Java 比当前使用的更高。新版 Minecraft 需要 Java 17 或 21。",
        fix: "在实例设置里换一个更高版本的 Java，或用设置页的自动搜索 Java 功能重新扫描。",
        severity: "high",
        test: |t| has_any(t, &["unsupportedclassversionerror", "class file version", "requires java ", "java version must be"]),
        evidence: "UnsupportedClassVersionError",
    },
    Rule {
        id: "memory",
        title: "内存不足",
        detail: "Java 堆内存耗尽，通常是分配内存太小，或者装了太多大型 Mod。",
        fix: "在实例设置里把内存调到 4096 MB 以上（物理内存足够时）；同时检查是否同时开了多个占内存的程序。",
        severity: "high",
        test: |t| has_any(t, &["outofmemoryerror", "java heap space", "metaspace", "unable to create new native thread"]),
        evidence: "OutOfMemoryError",
    },
    Rule {
        id: "graphics",
        title: "显卡驱动或 OpenGL 初始化失败",
        detail: "LWJGL / OpenGL 无法初始化，常见于显卡驱动过旧或远程桌面环境。",
        fix: "更新显卡驱动；关闭其他占用显卡的程序；不要通过远程桌面启动游戏。",
        severity: "high",
        test: |t| has_any(t, &["opengl", "lwjgl", "glfw", "failed to create window", "could not create", "native crash", "hs_err_pid"]),
        evidence: "OpenGL",
    },
    Rule {
        id: "missing-mod",
        title: "缺少前置 Mod",
        detail: "某个 Mod 依赖的库没有安装，或依赖版本不匹配。",
        fix: "按提示装上前 Modrinth / CurseForge 页面里写的前置，并确认加载器类型一致。",
        severity: "high",
        test: |t| has_any(t, &["modloadingexception", "missing dependency", "dependency violation", "could not be resolved", "no mod present"]) ,
        evidence: "ModLoadingException",
    },
    Rule {
        id: "class-not-found",
        title: "类缺失 / Mod 文件损坏",
        detail: "Java 找不到某个类，一般是 Mod 的 jar 不完整、版本装错或文件冲突。",
        fix: "删掉报错里提到的那个 Mod，重新下载对应游戏版本和加载器的 jar；再检查 mods 目录里有没有同名旧文件。",
        severity: "medium",
        test: |t| has_any(t, &["classnotfoundexception", "noclassdeffounderror", "nosuchmethoderror", "duplicate mod"]),
        evidence: "ClassNotFoundException",
    },
    Rule {
        id: "corrupt-save",
        title: "存档数据损坏",
        detail: "读取世界时 NBT 数据异常，可能是非正常退出导致的。",
        fix: "先从 saves 目录备份该存档，再用启动器的实例导出功能整体备份；删除存档里的 session.lock 后重试。",
        severity: "medium",
        test: |t| has_any(t, &["error reading nbt", "corrupted", "unexpected end of stream", "failed to load level", "exception reading chunk"]),
        evidence: "Exception",
    },
    Rule {
        id: "version-conflict",
        title: "Mod 与游戏版本不兼容",
        detail: "Mod 声明支持的 game version 与当前实例不一致。",
        fix: "换一个支持当前游戏版本的 Mod 版本，或者给这个 Mod 单独建一个对应版本的实例。",
        severity: "medium",
        test: |t| has_any(t, &["incompatible", "not compatible", "unsupported minecraft version", "wrong minecraft version"]),
        evidence: "incompatible",
    },
    Rule {
        id: "auth",
        title: "账户登录失效",
        detail: "启动器或游戏内的登录令牌已经过期。",
        fix: "在账户页对该账户点一次刷新，或者重新登录。",
        severity: "medium",
        test: |t| has_any(t, &["forbidden", "invalid token", "authentication", "account does not have", "not authenticated"]),
        evidence: "Forbidden",
    },
    Rule {
        id: "disk",
        title: "磁盘空间或权限问题",
        detail: "写入游戏目录失败，可能是磁盘满了或者目录不可写。",
        fix: "检查目标磁盘剩余空间；确认游戏目录没有被设为只读，也没有被杀毒软件锁定。",
        severity: "medium",
        test: |t| has_any(t, &["no space left", "access is denied", "permission denied", "failed to save", "could not write"]),
        evidence: "Access is denied",
    },
    Rule {
        id: "config",
        title: "配置文件异常",
        detail: "Mod 的配置文件格式错误，加载时解析失败。",
        fix: "按报错提示找到 config 目录里对应的配置文件，先改名备份再启动，让 Mod 重新生成一份。",
        severity: "low",
        test: |t| has_any(t, &["config", "parse error", "json syntax", "toml"]),
        evidence: "config",
    },
];

/// 从实例目录里收集这次崩溃相关的文本。
fn read_logs(game_dir: &Path) -> (String, Vec<String>) {
    let mut combined = String::new();
    let mut sources = Vec::new();

    let log_dir = game_dir.join("logs");
    let mut files: Vec<std::path::PathBuf> = Vec::new();
    for name in ["ferry-latest.log", "latest.log", "debug.log"] {
        let path = log_dir.join(name);
        if path.is_file() {
            files.push(path);
        }
    }
    if let Ok(entries) = std::fs::read_dir(log_dir.join("crash-reports")) {
        let mut crash_files: Vec<_> = entries.filter_map(Result::ok).map(|e| e.path()).filter(|p| p.is_file()).collect();
        crash_files.sort_by_key(|p| std::fs::metadata(p).and_then(|m| m.modified()).ok());
        files.extend(crash_files.into_iter().rev().take(2));
    }

    for file in files {
        if let Ok(text) = std::fs::read_to_string(&file) {
            let name = file.file_name().unwrap_or_default().to_string_lossy().to_string();
            sources.push(name.clone());
            combined.push_str("\n=== ");
            combined.push_str(&name);
            combined.push_str(" ===\n");
            combined.push_str(&text);
        }
    }
    // 日志可能很大，规则匹配只看后 400KB，足够覆盖堆栈且避免卡 UI
    if combined.len() > 400_000 {
        combined = combined[combined.len() - 400_000..].to_string();
    }
    (combined, sources)
}

pub fn analyze(game_dir: &str, exit_code: i32) -> Report {
    let (text, sources) = read_logs(Path::new(game_dir));
    let crashed = exit_code != 0 || has_any(&text, &["---- minecraft crash report ----", "exception in thread \"main\""]);

    let mut causes: Vec<Cause> = RULES
        .iter()
        .filter(|rule| (rule.test)(&text))
        .map(|rule| Cause {
            id: rule.id.into(),
            title: rule.title.into(),
            detail: rule.detail.into(),
            fix: rule.fix.into(),
            severity: rule.severity.into(),
            evidence: first_line_containing(&text, rule.evidence),
        })
        .collect();
    let severity_rank = |s: &str| match s {
        "high" => 0,
        "medium" => 1,
        _ => 2,
    };
    causes.sort_by_key(|cause| severity_rank(&cause.severity));

    let tail: Vec<String> = text
        .lines()
        .rev()
        .take(14)
        .filter(|line| !line.trim().is_empty())
        .map(|line| line.chars().take(300).collect())
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();

    let summary = if !crashed {
        "游戏正常退出，没有发现崩溃堆栈。".into()
    } else if causes.is_empty() {
        format!("检测到异常退出（代码 {exit_code}），但日志里没有匹配到已知问题。可以在下面查看原始日志的最后几行。")
    } else {
        format!("发现 {} 个可疑问题，最可能的原因是：{}", causes.len(), causes[0].title)
    };

    Report {
        crashed,
        exit_code,
        summary,
        causes,
        tail,
        sources,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_memory_crash() {
        let text = "Exception in thread \"main\" java.lang.OutOfMemoryError: Java heap space\n\tat net.minecraft.client.main.Main";
        let causes: Vec<&str> = RULES
            .iter()
            .filter(|r| (r.test)(text))
            .map(|r| r.id)
            .collect();
        assert!(causes.contains(&"memory"), "{causes:?}");
    }

    #[test]
    fn detects_java_version() {
        let text = "java.lang.UnsupportedClassVersionError: net/minecraft/Main has been compiled by a more recent version of the Java Runtime";
        let causes: Vec<&str> = RULES
            .iter()
            .filter(|r| (r.test)(text))
            .map(|r| r.id)
            .collect();
        assert!(causes.contains(&"java-version"), "{causes:?}");
    }

    #[test]
    fn detects_mod_dependency() {
        let text = "net.minecraftforge.fml.common.ModLoadingException: Missing dependency: jei";
        let causes: Vec<&str> = RULES
            .iter()
            .filter(|r| (r.test)(text))
            .map(|r| r.id)
            .collect();
        assert!(causes.contains(&"missing-mod"), "{causes:?}");
    }

    #[test]
    fn normal_log_has_no_causes() {
        let text = "[14:02:11] [main/INFO]: Loaded 148 recipes\n[14:02:12] [main/INFO]: OpenAL initialized";
        assert!(RULES.iter().all(|r| !(r.test)(text)));
    }

    #[test]
    fn evidence_is_first_matching_line() {
        let text = "some header\nException in thread \"main\" java.lang.OutOfMemoryError: Java heap space\nmore lines";
        assert!(first_line_containing(text, "OutOfMemoryError").contains("OutOfMemoryError"));
    }
}
