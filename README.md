# Ferry Launcher

轻量级 Minecraft 启动器，Windows x64 单文件 exe（约 10 MB，免安装）。
界面按 PCL（Plain Craft Launcher）的交互逻辑重构：左侧版本列表 + 主界面大启动按钮，右上角账号入口。

当前版本 **0.2.1**

仓库地址：https://github.com/17695432859/Ferry-Launcher

## 功能

- **实例管理**：扫描/导入本地 `.minecraft` 与各版本整合包目录，左侧列表一键切换版本。
- **启动**：预检目录、版本文件、写权限、Java 后拉起游戏；启动中显示进度环，再点一次结束进程。
- **下载中心**：
  - 游戏版本：原版 / Fabric / Forge / NeoForge / Quilt 安装。
  - 资源下载：Mod、整合包、数据包、资源包、光影包，支持 Modrinth 与 CurseForge 双源，每页 24 条分页（首页 / 上一页 / 页码直达 / 下一页 / 末页）。
- **Java 探测**：七路扫描（`JAVA_HOME`、注册表、常见安装目录、`.jdks`、启动器自带运行时、Minecraft 官方运行时、各盘根目录、`PATH`），优先读 `release` 元数据，全机约 300 ms；支持按 MC 版本自动挑选，也可一键下载 Java 21。
- **账户**：LittleSkin 外置登录、离线账户、微软正版账户（XSTS 链路），多角色切换，皮肤头像。
- **崩溃分析**：游戏异常退出后自动分析 `logs/` 与 `crash-reports/`，识别 Java 版本不匹配、内存不足、显卡初始化失败、缺前置、类缺失、存档损坏、版本不兼容、登录失效、磁盘权限、配置异常等 10 类问题，给出严重程度、原因、修复建议与日志原文依据。
- **联机**：房间码 + 中继隧道。
- **界面**：全局纯白底、窗口 14px 圆角（透明窗口 + 根容器裁剪）。

## 构建

需要 Node.js 20+、Rust（工具链见 `rust-toolchain.toml`，MSVC）、WebView2 Evergreen Runtime。

```bash
npm install
npm run typecheck
npm run dist        # -> dist/FerryLauncher-0.2.1.exe
```

`npm run dist` 会把前端产物打到 `out/tauri`，Rust 目标目录移到 `%TEMP%\ferry-build`（避开杀软实时扫描），编译完成后把 exe 拷回 `dist/`。

## 已知限制

- 只做了 Windows x64；Win7 兼容未验证。
- 微软账户走的是 XSTS 链路的一部分，复杂场景下可能还需要补 token 刷新逻辑。
- CurseForge 搜索需要用户自己的 API Key（官方不允许在分发软件里内置第三方 key）；M5 引导流程还没做完。
