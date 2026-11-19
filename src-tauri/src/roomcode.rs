//! 联机房间码，完全按 Scaffolding 协议（Terracotta / EasyTier 官方格式）实现。
//!
//! 房间码形如 `U/NNNN-NNNN-SSSS-SSSS`：
//! - 字符表是 0-9 与 A-H、J-N、P-Z（去掉容易看错的 I 和 O），共 34 个；
//! - 按「0-9、A-H、J-N、P-Z」顺序映射到 0..33；
//! - 把这 16 位当作小端序整数，必须能被 7 整除；
//! - 前 8 位是 EasyTier 网络名后缀，后 8 位是网络密钥。
//!
//! 对应关系（协议原文的例子）：
//! 房间码 `U/YNZE-U61D-2206-HXRG` → 网络名 `scaffolding-mc-YNZE-U61D`、密钥 `2206-HXRG`。

pub const ALPHABET: &[u8; 34] = b"0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const PREFIX: &str = "U/";
const NETWORK_PREFIX: &str = "scaffolding-mc-";

/// 每个字符对应的数值，非法字符返回 None
pub fn digit_of(byte: u8) -> Option<u32> {
    ALPHABET
        .iter()
        .position(|c| *c == byte)
        .map(|index| index as u32)
}

/// 把 16 位数字当作小端序整数取模
fn modulus(digits: &[u32; 16]) -> u32 {
    // 34 ≡ 6 (mod 7)，从最低位往高位累加即可
    let mut value: u64 = 0;
    let mut power: u64 = 1;
    for digit in digits.iter() {
        value = (value + *digit as u64 * power) % 7;
        power = (power * 34) % 7;
    }
    value as u32
}

fn random_bytes(buffer: &mut [u8]) -> bool {
    getrandom::getrandom(buffer).is_ok()
}

/// 生成一个符合协议的房间码。
///
/// 做法：随机填 15 位，最后一位穷举所有 34 个候选，挑出能让整体被 7 整除的那几个再随机选一个，
/// 比「生成后不停重试」更确定，也不会因为取模偏差导致分布不均。
pub fn generate() -> String {
    let mut digits = [0u32; 16];
    let mut bytes = [0u8; 16];
    if !random_bytes(&mut bytes) {
        // 系统随机数不可用时退化到时间戳，至少不会 panic
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        bytes.copy_from_slice(&nanos.to_le_bytes());
    }
    for index in 1..16 {
        digits[index] = (bytes[index] as u32) % 34;
    }

    let mut candidates: Vec<u32> = Vec::with_capacity(5);
    for candidate in 0..34u32 {
        digits[0] = candidate;
        if modulus(&digits) == 0 {
            candidates.push(candidate);
        }
    }
    if candidates.is_empty() {
        // 理论上不会发生，兜底给全 0
        digits[0] = 0;
    } else {
        digits[0] = candidates[(bytes[0] as usize) % candidates.len()];
    }

    format(&digits)
}

fn format(digits: &[u32; 16]) -> String {
    let text: String = digits
        .iter()
        .map(|digit| ALPHABET[*digit as usize] as char)
        .collect();
    format!(
        "{PREFIX}{}-{}-{}-{}",
        &text[0..4],
        &text[4..8],
        &text[8..12],
        &text[12..16]
    )
}

/// 规范化用户输入：去空格、转大写、补 `U/` 前缀
pub fn normalize(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .to_uppercase();
    let body = cleaned.strip_prefix(PREFIX).unwrap_or(&cleaned).to_string();
    format!("{PREFIX}{body}")
}

/// 校验并返回 (网络名, 密钥)
pub fn parse(raw: &str) -> Option<(String, String)> {
    let normalized = normalize(raw);
    let body = normalized.strip_prefix(PREFIX)?;
    let parts: Vec<&str> = body.split('-').collect();
    if parts.len() != 4 {
        return None;
    }
    let joined: String = parts.concat();
    if joined.len() != 16 {
        return None;
    }
    let mut digits = [0u32; 16];
    for (index, byte) in joined.bytes().enumerate() {
        digits[index] = digit_of(byte)?;
    }
    if modulus(&digits) != 0 {
        return None;
    }
    let network_name = format!("{NETWORK_PREFIX}{}-{}", parts[0], parts[1]);
    let network_secret = format!("{}-{}", parts[2], parts[3]);
    Some((network_name, network_secret))
}

pub fn is_valid(raw: &str) -> bool {
    parse(raw).is_some()
}

/// 从 EasyTier 的网络名 + 密钥反推房间码（用户手填配置时用）
pub fn from_network(network_name: &str, network_secret: &str) -> Option<String> {
    let name = network_name.strip_prefix(NETWORK_PREFIX)?;
    let raw = format!("{name}-{network_secret}");
    let normalized = normalize(&raw);
    if parse(&normalized).is_some() {
        Some(normalized)
    } else {
        None
    }
}

/// 给联机中心用的 hostname：`scaffolding-mc-server-{port}`
pub fn center_hostname(port: u16) -> String {
    format!("scaffolding-mc-server-{port}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn official_example_round_trips() {
        let (name, secret) = parse("U/YNZE-U61D-2206-HXRG").expect("官方示例应当合法");
        assert_eq!(name, "scaffolding-mc-YNZE-U61D");
        assert_eq!(secret, "2206-HXRG");
        assert_eq!(
            from_network(&name, &secret).as_deref(),
            Some("U/YNZE-U61D-2206-HXRG")
        );
    }

    #[test]
    fn generated_codes_are_valid() {
        for _ in 0..200 {
            let code = generate();
            assert!(is_valid(&code), "{code} 应当合法");
            assert_eq!(code.len(), 21);
        }
    }

    #[test]
    fn rejects_bad_input() {
        // I 和 O 不在字符表里
        assert!(!is_valid("U/IIII-IIII-IIII-IIII"));
        assert!(!is_valid("U/OOOO-OOOO-OOOO-OOOO"));
        // 位数不对
        assert!(!is_valid("U/AAAA-AAAA-AAAA-AAA"));
        // 不是联机码
        assert!(!is_valid("hello"));
        assert!(!is_valid(""));
    }
}
