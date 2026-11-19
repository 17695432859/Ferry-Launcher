# Ferry Launcher

一个给 Minecraft Java 版用的启动器。单个 exe，不用装运行库，双击就跑。

当前版本 0.1.0，Windows x64，产物约 5.7 MB。

仓库地址：https://github.com/17695432859/Ferry-Launcher （GitHub 仓库名不允许空格，使用 `Ferry-Launcher`）

## 它做什么

- **导入已有游戏**：选一个 `.minecraft` 目录，里面所有版本一次性加进来；PCL / HMCL 整合包那种版本隔离布局（`mods`、`saves`、`config` 放在 `versions/<id>/` 下）也能认出来。
- **装版本**：原版、Fabric、Forge、NeoForge、Quilt；版本清单走官方源或 BMCLAPI 镜像，镜像抽风会自动回退官方源。
- **账户**：LittleSkin 外置登录、微软登录、离线账户。一个账户下的多个角色可以切换，令牌静默刷新，token 存系统凭据库。角色切换遇到 `Access token already has a profile assigned` 时会用凭据库里的密码重新换令牌。
- **皮肤**：账户页有 3D 皮肤预览，支持 slim / classic 模型。
- **内容管理**：按实例看 mod、存档、日志、资源包；能预览、启用/禁用、删除、导入、检查更新。mod 的元数据从 jar 内部读。
- **联机**：陶瓦联机和 EasyTier 直连，房间码/联机码生成与解析。两个运行时都能在应用内下载安装。
- **Java**：多线程扫描本机 Java（含 PCL 自带的 JRE），1.21+ 需要 Java 21 但没有时可以一键从清华镜像下载。启动前校验主版本，版本不对直接提示而不是闪退。
- **启动**：拼完整 JVM 参数、SHA1 校验、并发下载、解压原生库、捕获日志；崩溃了给提示而不是无声退出。
- **外观**：毛玻璃面板、主题深浅、强调色、模糊强度、背景动画、UI 缩放 90–125%、自定义背景图，全部持久化。中英双语。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 壳 | Tauri 2 + WebView2，无边框窗口，单文件 MSVC 静态链接 |
| 渲染 | React 18 + TypeScript + Tailwind + Framer Motion + Zustand |
| 后端 | Rust，命令白名单 IPC，严格 CSP，渲染层碰不到 Node / fs |
| 打包 | `scripts/build-tauri.mjs`，产物 `dist/FerryLauncher-0.1.0.exe` |

旧 Electron 壳相关的脚本和配置还留在仓库里，但默认构建走 Tauri。

## 目录

```
src/
  renderer/src/     界面、页面、组件、主题、i18n
  preload/          Electron 兼容层（Tauri 下不会用到）
  shared/           前后端共享类型、IPC 常量、翻译表
src-tauri/
  src/
    launch.rs       启动参数拼装与进程管理
    auth.rs         Yggdrasil / 微软 / 离线账户
    install.rs      版本清单、加载器版本、下载
    java.rs         Java 探测与下载
    content.rs      mod / 存档 / 日志 / 资源包
    netplay.rs      陶瓦 / EasyTier 运行时与联机
    scan.rs         导入目录扫描
    store.rs        实例与设置持久化（原子写 + 备份回退）
    lib.rs          命令注册
  tests/backend.rs  后端测试
scripts/           构建、截图、宣传片脚本
demo-profile/       录宣传片用的演示档案
promo/              宣传片成片与配乐
```

## 构建

需要 Node.js、Rust 稳定版（MSVC 工具链）和 Windows SDK。

```bash
npm install
npm run typecheck     # 类型检查
npm run dev           # 开发模式（Vite + Tauri dev）
npm run dist          # 打包单文件 exe → dist/FerryLauncher-0.1.0.exe
```

`rust-toolchain.toml` 固定 `stable-x86_64-pc-windows-msvc`，`.cargo/config.toml` 开了 `+crt-static`，所以产物不依赖 VC 运行库。

后端测试：

```bash
cargo test --release --test backend -j 2 --manifest-path src-tauri/Cargo.toml
```

`-j` 别开太高，本机实测 2 比较稳。

## 数据位置

默认放在 `%APPDATA%\ferry-launcher`。实例、账户、设置都写这里，写盘用「临时文件 → 备份旧文件 → 原子改名」，读取失败会回退 `.bak`。

环境变量 `FERRY_DATA_DIR` 可以把整个数据目录指到别处，录屏或测试时用它指向演示档案，不会碰到真实数据。

## 宣传片

`promo/FerryLauncher-promo.mp4`：70 秒，1080p30，实机内录 + 原创合成配乐。画面通过 CDP 驱动真实界面，用 ffmpeg 30fps 抓窗口，不是截图拼接。脚本在 `scripts/promo/`。

## 已知限制

- 只做了 Windows x64；WebView2 需要系统自带或安装 Evergreen Runtime。
- 微软账户走的是 XSTS 链路的一部分，复杂场景下可能还需要补 token 刷新逻辑。
- Modrinth / CurseForge 的 mod 中心、M5 引导流程还没做完。
- Win7 兼容未验证。
