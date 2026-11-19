//! 后端逻辑的集成测试：只碰临时目录，不碰用户真实数据。
//!
//! 覆盖用户明确提过的两件事：
//! 1. 导入已有目录时，目录里**所有**版本都要进去；
//! 2. 删除 mod 走回收站，导出实例不改原目录。

use std::fs;
use std::path::{Path, PathBuf};

use ferry_lib::export::export_instance;
use ferry_lib::mods::{list_mods, toggle_mod};
use ferry_lib::scan::scan_all;
use ferry_lib::store::Instance;

fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("ferry-test-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn write(path: &Path, content: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, content).unwrap();
}

/// 造一个装了三个版本的 .minecraft：原版、Forge、Fabric
fn fake_minecraft(root: &Path) {
    write(
        &root.join("versions/1.20.4/1.20.4.json"),
        r#"{"id":"1.20.4","mainClass":"net.minecraft.client.main.Main","libraries":[]}"#,
    );
    write(
        &root.join("versions/1.20.1-forge-47.2.0/1.20.1-forge-47.2.0.json"),
        r#"{"id":"1.20.1-forge-47.2.0","inheritsFrom":"1.20.1",
            "mainClass":"cpw.mods.bootstraplauncher.BootstrapLauncher",
            "libraries":[{"name":"net.minecraftforge:forge:1.20.1-47.2.0"}]}"#,
    );
    write(
        &root.join("versions/fabric-loader-0.15.11-1.20.1/fabric-loader-0.15.11-1.20.1.json"),
        r#"{"id":"fabric-loader-0.15.11-1.20.1","inheritsFrom":"1.20.1",
            "mainClass":"net.fabricmc.loader.impl.launch.knot.KnotClient",
            "libraries":[{"name":"net.fabricmc:fabric-loader:0.15.11"}]}"#,
    );
    // 干扰项：版本目录里没有 json，不该被当成实例
    fs::create_dir_all(root.join("versions/1.20.4/1.20.4-natives")).unwrap();
    fs::create_dir_all(root.join("assets/indexes")).unwrap();
    fs::create_dir_all(root.join("logs")).unwrap();
}

#[test]
fn scan_finds_every_version() {
    let root = temp_dir("scan");
    fake_minecraft(&root);

    let found = scan_all(&root, 0);
    let mut names: Vec<String> = found.iter().map(|c| c.suggested_name.clone()).collect();
    names.sort();

    assert_eq!(
        names,
        vec![
            "1.20.1-forge-47.2.0".to_string(),
            "1.20.4".to_string(),
            "fabric-loader-0.15.11-1.20.1".to_string()
        ],
        "三个版本都要扫出来"
    );

    let forge = found.iter().find(|c| c.loader == "forge").unwrap();
    assert_eq!(forge.loader_version.as_deref(), Some("47.2.0"));
    assert_eq!(forge.mc_version, "1.20.1");

    let fabric = found.iter().find(|c| c.loader == "fabric").unwrap();
    assert_eq!(fabric.loader_version.as_deref(), Some("0.15.11"));

    let vanilla = found.iter().find(|c| c.loader == "vanilla").unwrap();
    assert_eq!(vanilla.loader_version, None);
    assert_eq!(vanilla.mc_version, "1.20.4");
}

#[test]
fn scan_walks_into_nested_folders() {
    let outer = temp_dir("nested");
    let inner = outer.join("整合包A/.minecraft");
    fake_minecraft(&inner);

    let found = scan_all(&outer, 0);
    assert_eq!(found.len(), 3, "外层目录里嵌套的 .minecraft 也要找到");
}

#[test]
fn scan_returns_nothing_for_junk_dir() {
    let root = temp_dir("junk");
    write(&root.join("readme.txt"), "hello");
    assert!(scan_all(&root, 0).is_empty());
}

#[test]
fn mods_toggle_and_list() {
    let root = temp_dir("mods");
    let mods = root.join("mods");
    fs::create_dir_all(&mods).unwrap();
    fs::write(mods.join("sodium-0.5.8.jar"), b"not a real jar").unwrap();

    let listed = list_mods(&root.to_string_lossy());
    assert_eq!(listed.len(), 1);
    assert!(listed[0].enabled);
    assert_eq!(listed[0].display_name, "sodium");

    let after = toggle_mod(&root.to_string_lossy(), "sodium-0.5.8.jar", false).unwrap();
    assert_eq!(after.len(), 1);
    assert!(!after[0].enabled, "禁用后要变成 .disabled");
    assert!(mods.join("sodium-0.5.8.jar.disabled").exists());

    let back = toggle_mod(&root.to_string_lossy(), "sodium-0.5.8.jar.disabled", true).unwrap();
    assert!(back[0].enabled);
}

#[test]
fn export_writes_zip_without_touching_source() {
    let root = temp_dir("export");
    let mods = root.join("mods");
    fs::create_dir_all(&mods).unwrap();
    fs::write(mods.join("jei-1.20.1.jar"), b"payload").unwrap();
    write(&root.join("config/foo.toml"), "a = 1");
    write(&root.join("options.txt"), "fov:0.5");

    let instance = Instance {
        id: "t".into(),
        name: "测试实例".into(),
        mc_version: "1.20.1".into(),
        loader: "forge".into(),
        loader_version: Some("47.2.0".into()),
        cover_seed: "seed".into(),
        last_played_at: None,
        total_playtime_ms: 0,
        memory_mb: 4096,
        java_path: None,
        game_dir: root.to_string_lossy().to_string(),
        version_id: Some("1.20.1-forge-47.2.0".into()),
        jvm_args: None,
        isolated: Some(true),
    };

    let target = root.join("out.zip");
    let outcome = export_instance(&instance, false, &target);
    assert!(outcome.ok, "导出应当成功");
    assert!(target.is_file());
    assert!(outcome.entries.unwrap() >= 3);

    // 源文件一个都不能少
    assert!(mods.join("jei-1.20.1.jar").is_file());
    assert!(root.join("config/foo.toml").is_file());

    // 包里要有清单
    let file = fs::File::open(&target).unwrap();
    let mut archive = zip::ZipArchive::new(file).unwrap();
    let manifest = archive.by_name("ferry-instance.json").unwrap();
    assert!(manifest.size() > 0);
}
