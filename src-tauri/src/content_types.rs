//! 统一的下载内容类型：Mod / 整合包 / 数据包 / 资源包 / 光影包。
//!
//! 两个平台的分类口径不同，这里收口成启动器内部的五种 id，
//! 其余模块只认这里的映射，避免到处散落魔法数字。

/// 启动器内部 id，顺序即界面显示顺序。
pub const ALL: [&str; 5] = ["mod", "modpack", "datapack", "resourcepack", "shader"];

pub fn normalize(value: &str) -> &str {
    let id = value.trim().to_ascii_lowercase();
    match id.as_str() {
        "modpack" | "modpacks" | "pack" => "modpack",
        "datapack" | "datapacks" | "data-pack" => "datapack",
        "resourcepack" | "resourcepacks" | "texturepack" | "texture-pack" => "resourcepack",
        "shader" | "shaders" | "shaderpack" => "shader",
        "mod" | "mods" | "" => "mod",
        _ => "mod",
    }
}

/// Modrinth 的 project_type facet 值。
pub fn modrinth_project_type(value: &str) -> &'static str {
    match normalize(value) {
        "modpack" => "modpack",
        "datapack" => "datapack",
        "resourcepack" => "resourcepack",
        "shader" => "shader",
        _ => "mod",
    }
}

/// CurseForge 的 classId（gameId 432 = Minecraft）。
/// 来源：PCL2-CE 的 CompType → classId 映射。
pub fn curseforge_class_id(value: &str) -> i32 {
    match normalize(value) {
        "modpack" => 4471,
        "datapack" => 6945,
        "resourcepack" => 12,
        "shader" => 6552,
        _ => 6,
    }
}

/// 该类型是否需要按加载器筛选（数据包 / 资源包 / 光影包与加载器无关）。
pub fn uses_loader(value: &str) -> bool {
    matches!(normalize(value), "mod" | "modpack")
}

/// 内容落到实例目录下的子目录。
pub fn subdir(value: &str) -> &'static str {
    match normalize(value) {
        "modpack" => "modpacks",
        "datapack" => "datapacks",
        "resourcepack" => "resourcepacks",
        "shader" => "shaderpacks",
        _ => "mods",
    }
}

/// 项目主页 URL 中的分类段。
pub fn curseforge_slug_segment(value: &str) -> &'static str {
    match normalize(value) {
        "modpack" => "modpacks",
        "datapack" => "data-packs",
        "resourcepack" => "texture-packs",
        "shader" => "shaders",
        _ => "mc-mods",
    }
}

pub fn modrinth_slug_segment(value: &str) -> &'static str {
    match normalize(value) {
        "modpack" => "modpack",
        "datapack" => "datapack",
        "resourcepack" => "resourcepack",
        "shader" => "shader",
        _ => "mod",
    }
}
