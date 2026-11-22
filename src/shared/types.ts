/**
 * 跨进程共享的数据结构。
 * main / preload / renderer 只允许依赖本文件与 ipc.ts，禁止反向依赖。
 */

export type ThemeMode = 'dark' | 'light' | 'system'
export type DownloadSource = 'official' | 'bmclapi'
export type Locale = 'zh-CN' | 'en'

export type LoaderKind = 'vanilla' | 'fabric' | 'forge' | 'neoforge' | 'quilt'

export interface AppSettings {
  /** 主题模式，跟随系统时由渲染层监听 prefers-color-scheme */
  theme: ThemeMode
  /** 强调色，十六进制 #rrggbb */
  accent: string
  /** 毛玻璃模糊强度 0–40 px */
  blur: number
  /** 背景动画开关（无自定义图片时生效） */
  backgroundAnimation: boolean
  /** 背景来源：builtin 用自带的程序化背景，custom 用用户选的图片 */
  backgroundMode: 'builtin' | 'custom'
  /** 自定义背景图的绝对路径，null 表示还没选 */
  backgroundPath: string | null
  /** 背景遮罩强度 0–80，保证文字对比度 */
  backgroundDim: number
  /** 界面缩放 90–125 (%) */
  uiScale: number
  downloadSource: DownloadSource
  /** 默认内存分配 (MB) */
  defaultMemoryMb: number
  locale: Locale
  /** 上次使用的账户 id，启动时静默 refresh 的目标 */
  lastAccountId: string | null
  onboardingDone: boolean
  /** 全局默认 Java 路径，实例没单独指定时用它 */
  defaultJavaPath: string | null
  /** CurseForge API Key，填了之后 Mod 下载走 CurseForge */
  curseforgeApiKey: string | null
}

/** mods 目录里的一个条目，元数据从 jar 内部读取 */
export interface ModEntry {
  fileName: string
  displayName: string
  version: string | null
  loader: 'fabric' | 'forge' | 'neoforge' | 'quilt' | null
  enabled: boolean
  sizeBytes: number
  description: string | null
}

export interface Instance {
  id: string
  name: string
  /** Minecraft 版本号，如 1.20.4 */
  mcVersion: string
  loader: LoaderKind
  /** 加载器版本，原版为 null */
  loaderVersion: string | null
  /** 决定程序化封面的渐变配色，创建实例时生成后不再变 */
  coverSeed: string
  /** ISO 时间字符串，从未游玩为 null */
  lastPlayedAt: string | null
  totalPlaytimeMs: number
  memoryMb: number
  javaPath: string | null
  gameDir: string
  /** versions/<id> 里的那个 id；同一个 .minecraft 下多版本靠它区分 */
  versionId?: string
  /** 额外 JVM 参数，M4 拼参数时追加 */
  jvmArgs?: string
  /** 版本隔离，默认开启 */
  isolated?: boolean
  /** 自定义图标文件路径，空则由加载器决定内置像素图标 */
  icon?: string | null
}

export type AccountKind = 'littleskin' | 'offline' | 'microsoft'

/** 一个账户下的角色（LittleSkin 一个账号常有多个） */
export interface Profile {
  id: string
  name: string
}

/** 渲染层可见的账户信息，绝不含 token */
export interface AccountSummary {
  id: string
  kind: AccountKind
  /** 登录源展示名，如 LittleSkin */
  sourceName: string
  /** Yggdrasil 根地址，离线账户为 null */
  apiRoot: string | null
  profileName: string
  /** 登录账号名（外置登录常是邮箱），离线账户为 null */
  userName: string | null
  uuid: string
  skinUrl: string | null
  capeUrl: string | null
  skinModel: 'classic' | 'slim' | null
  /** 该账户可选的角色，uuid 指向当前选中的那个 */
  profiles: Profile[]
}

export interface AppInfo {
  name: string
  version: string
  platform: NodeJS.Platform
  electron: string
  chrome: string
  node: string
  /** 系统语言，用于首次启动推断 locale */
  systemLocale: string
  /** 是否支持原生 mica/acrylic（Windows 11） */
  nativeBackdrop: boolean
  /** 应用数据目录，新建实例时默认装在这里 */
  dataDir: string
}

export interface WindowState {
  maximized: boolean
  focused: boolean
}

/** 导入目录时的非致命提示，渲染层按 code 翻译，避免主进程产出多语言文案 */
export type ScanWarning =
  | { code: 'multiple-versions'; count: number; chosen: string }
  | { code: 'no-version-json' }
  | { code: 'mods-without-version' }

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  accent: '#4c6fff',
  blur: 24,
  backgroundAnimation: true,
  backgroundMode: 'builtin',
  backgroundPath: null,
  backgroundDim: 35,
  uiScale: 100,
  downloadSource: 'bmclapi',
  defaultMemoryMb: 4096,
  locale: 'zh-CN',
  lastAccountId: null,
  onboardingDone: false,
  defaultJavaPath: null,
  curseforgeApiKey: null
}

export const BLUR_RANGE = { min: 0, max: 40 } as const
export const UI_SCALE_RANGE = { min: 90, max: 125 } as const
export const MEMORY_RANGE = { min: 1024, max: 32768, step: 512 } as const

/** 6 个预设强调色，浅色主题下也能保持 4.5:1 对比 */
export const ACCENT_PRESETS = [
  { id: 'azure', label: 'Azure', value: '#4c6fff' },
  { id: 'mint', label: 'Mint', value: '#12a594' },
  { id: 'violet', label: 'Violet', value: '#7c5cbf' },
  { id: 'amber', label: 'Amber', value: '#c77d2e' },
  { id: 'rose', label: 'Rose', value: '#c2455e' },
  { id: 'cyan', label: 'Cyan', value: '#0e7c93' }
] as const

/* ==========================================================================
   联机（netplay）
   ========================================================================== */

export type NetplayProviderId = 'terracotta' | 'easytier'

/** 运行时安装状态：没装 / 已装某版本 / 安装中 */
export interface NetplayRuntime {
  provider: NetplayProviderId
  installed: boolean
  version: string | null
  path: string | null
}

/**
 * 联机会话阶段。Terracotta 的状态机比这更细，
 * 这里统一成 UI 能直接消费的几档。
 */
export type NetplayPhase =
  | 'idle'
  | 'installing'
  | 'starting'
  | 'scanning'
  | 'waiting'
  | 'connecting'
  | 'connected'
  | 'hosting'
  | 'error'

export interface NetplayPeer {
  id: string
  hostname: string
  ip: string | null
  latencyMs: number | null
}

export interface NetplayStatus {
  provider: NetplayProviderId | null
  phase: NetplayPhase
  /** 房间号（Terracotta 是 6 位数字码） */
  roomCode: string | null
  playerName: string | null
  /** 客人侧要连的地址，例如 127.0.0.1:25565 */
  joinAddress: string | null
  /** 本机在虚拟局域网里的地址 */
  virtualIp: string | null
  peers: NetplayPeer[]
  message: string | null
  errorCode: string | null
}

export const IDLE_NETPLAY_STATUS: NetplayStatus = {
  provider: null,
  phase: 'idle',
  roomCode: null,
  playerName: null,
  joinAddress: null,
  virtualIp: null,
  peers: [],
  message: null,
  errorCode: null
}

/** EasyTier 直连模式的配置，持久化在 settings.json 里 */
export interface EasyTierConfig {
  /** Scaffolding 联机码，形如 U/NNNN-NNNN-SSSS-SSSS */
  code: string
  networkName: string
  networkSecret: string
  /** 公共中继节点，一行一个 */
  peers: string
  /** host 会把 hostname 设成 scaffolding-mc-server-{port}，供联机中心发现 */
  role: 'host' | 'guest'
  port?: number
}

/** 生成的联机码，以及它对应的 EasyTier 网络参数 */
export interface RoomCodeInfo {
  code: string
  networkName: string
  networkSecret: string
}

/* ==========================================================================
   内容管理：mods / 资源包 / 存档 / 日志
   ========================================================================== */

export type ContentKind = 'mods' | 'resourcepacks' | 'saves' | 'logs'

export interface ContentItem {
  /** 目录内的文件名 / 文件夹名，作为稳定 key */
  key: string
  name: string
  version: string | null
  description: string | null
  sizeBytes: number
  /** 秒级时间戳 */
  modified: number
  enabled: boolean
  canToggle: boolean
  hasIcon: boolean
  /** mod 的 sha1，用于查 Modrinth 更新 */
  sha1: string | null
  /** 加载器 / 存档模式之类的附加信息 */
  note: string | null
}

export interface PreviewField {
  label: string
  value: string
}

export interface ContentPreview {
  kind: 'image' | 'text' | 'none'
  image: string | null
  text: string | null
  fields: PreviewField[]
}

export interface ModUpdate {
  key: string
  currentVersion: string | null
  latestVersion: string
  projectId: string
  projectTitle: string
  downloadUrl: string
  fileName: string
}

/** Modrinth 搜索结果（只保留界面需要的字段） */
export interface ModSearchHit {
  source: 'modrinth' | 'curseforge'
  projectId: string
  slug: string
  title: string
  description: string
  iconUrl: string | null
  author: string
  downloads: number
  categories: string[]
  versions: string[]
  latestVersion: string | null
}

/** 崩溃自动分析 */
export interface CrashCause {
  id: string
  title: string
  detail: string
  fix: string
  severity: 'high' | 'medium' | 'low'
  evidence: string
}

export interface CrashReport {
  crashed: boolean
  exitCode: number
  summary: string
  causes: CrashCause[]
  tail: string[]
  sources: string[]
}

/** Mod 搜索的一页结果 */
export interface ModSearchPage {
  hits: ModSearchHit[]
  total: number
}

export interface ModInstallProgress {
  instanceId: string
  projectId: string
  phase: 'resolve' | 'download' | 'done'
  received: number
  total: number
}

/* ==========================================================================
   版本安装
   ========================================================================== */

export interface VersionSummary {
  id: string
  /** release | snapshot | old_beta | old_alpha */
  kind: string
  releaseTime: string
}

export interface LoaderVersion {
  version: string
  stable: boolean
}

export interface InstallProgress {
  stage: string
  detail: string
  current: number
  total: number
}

export interface InstallRequest {
  mcVersion: string
  loader: string
  loaderVersion?: string | null
  gameDir: string
  source: DownloadSource
  javaPath?: string | null
}

export type InstallOutcome =
  | { ok: true; versionId: string }
  | { ok: false; reason: 'cancelled' | 'no-java' | 'error'; message: string }

/* ==========================================================================
   Java 与启动
   ========================================================================== */

export interface JavaInfo {
  path: string
  version: string
  major: number
  vendor: string
  arch: string
  /** 从哪儿发现的：env / registry / jdk / path / minecraft / runtime */
  source: string
}

export interface LaunchEvent {
  phase: 'resolving' | 'natives' | 'spawning' | 'running' | 'exited'
  message: string
  pid: number | null
}

export interface LaunchLog {
  line: string
  stream: 'stdout' | 'stderr'
}

export type LaunchOutcome =
  | { ok: true; pid: number }
  | { ok: false; reason: 'no-account' | 'auth-expired' | 'java-too-old' | 'error'; message: string }

/* ==========================================================================
   微软登录
   ========================================================================== */

export interface DeviceCode {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}
