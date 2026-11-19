import type {
  AccountSummary,
  AppInfo,
  AppSettings,
  ContentItem,
  ContentKind,
  ContentPreview,
  DeviceCode,
  EasyTierConfig,
  Instance,
  InstallOutcome,
  InstallProgress,
  InstallRequest,
  JavaInfo,
  LaunchEvent,
  LaunchLog,
  LaunchOutcome,
  LoaderVersion,
  ModEntry,
  ModInstallProgress,
  ModSearchHit,
  ModUpdate,
  NetplayProviderId,
  NetplayRuntime,
  NetplayStatus,
  RoomCodeInfo,
  ScanWarning,
  VersionSummary,
  WindowState
} from './types'

/** 渲染层可调用的 IPC 通道，白名单唯一来源 */
export const IPC = {
  appInfo: 'app:info',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  instancesList: 'instances:list',
  instancesImport: 'instances:import',
  instancesRemove: 'instances:remove',
  instancesReveal: 'instances:reveal',
  instancesOpenPath: 'instances:open-path',
  instancesUpdate: 'instances:update',
  instancesPreflight: 'instances:preflight',
  backgroundPick: 'background:pick',
  backgroundLoad: 'background:load',
  modsList: 'mods:list',
  modsToggle: 'mods:toggle',
  modsDelete: 'mods:delete',
  modsImport: 'mods:import',
  instanceExport: 'instance:export',
  instancePickJava: 'instance:pick-java',
  netplayRuntime: 'netplay:runtime',
  netplayInstall: 'netplay:install',
  netplayStatus: 'netplay:status',
  netplayStatusEvent: 'netplay:status-event',
  netplayInstallProgress: 'netplay:install-progress',
  netplayHost: 'netplay:host',
  netplayJoin: 'netplay:join',
  netplayStop: 'netplay:stop',
  netplayEasyTierConfig: 'netplay:easytier-config',
  netplayEasyTierSave: 'netplay:easytier-save',
  netplayCodeGenerate: 'netplay:code-generate',
  netplayCodeParse: 'netplay:code-parse',
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
  windowState: 'window:state'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

export type BackgroundPickResult =
  | { ok: true; path: string }
  | { ok: false; reason: 'cancelled' | 'too-large' | 'unsupported' | 'read-error'; message?: string }

/** 启动前预检的步骤标识 */
export type PreflightStepId = 'dir' | 'version' | 'writable' | 'java'

export interface JavaDownloadResult {
  ok: boolean
  path?: string
  info?: JavaInfo | null
  message?: string
}

export interface PreflightStep {
  id: PreflightStepId
  ok: boolean
  detail?: string
}

/** 可在界面上直接修改的实例字段 */
export interface InstancePatch {
  name?: string
  memoryMb?: number
  javaPath?: string | null
  jvmArgs?: string
  isolated?: boolean
}

export type ExportOutcome =
  | { ok: true; path: string; entries: number }
  | { ok: false; reason: 'cancelled' | 'empty' | 'error'; message?: string }

/** 选图标的结果 */
export type IconPickResult =
  | { ok: true; path: string }
  | { ok: false; reason: 'cancelled' | 'missing' | 'too-large' | 'unsupported' | 'error' }

export interface ModImportOutcome {
  added: number
  skipped: number
  cancelled: boolean
}

/** 实例目录下可一键打开的子目录 */
export type InstanceSubPath = '' | 'mods' | 'saves' | 'logs' | 'resourcepacks'

/** 运行时下载安装的结果 */
export type NetplayInstallOutcome =
  | { ok: true; runtime: NetplayRuntime }
  | { ok: false; reason: 'network' | 'unsupported' | 'extract' | 'write'; message: string }

/** 联机操作的结果，失败时带上可直接展示的原因 */
export type NetplayOutcome =
  | { ok: true; status: NetplayStatus }
  | { ok: false; reason: string; message: string }

/** 运行时下载进度 */
export interface NetplayInstallProgress {
  /** 部分实现（Tauri 侧）按调用上下文推断，不带这个字段 */
  provider?: NetplayProviderId
  received: number
  total: number
  /** connect 连源中 / download 下载中 / extract 解压中 */
  phase?: 'connect' | 'download' | 'extract'
}

/** 导入已有实例目录的结果；一个目录里可能一次导入多个版本 */
export type ImportOutcome =
  | { ok: true; instances: Instance[]; warnings: ScanWarning[]; skipped: number }
  | { ok: false; reason: 'cancelled' }
  | { ok: false; reason: 'not-a-game-dir' | 'unsupported' | 'read-error' | 'duplicate'; message: string }

/** 新建实例（安装完成后调用） */
export type CreateInstanceOutcome =
  | { ok: true; instance: Instance }
  | { ok: false; message: string }

export interface CreateInstanceRequest {
  name: string
  mcVersion: string
  loader: string
  loaderVersion: string | null
  gameDir: string
  versionId: string
}

/** 微软设备码轮询结果 */
export type MsPollResult =
  | { status: 'ok'; account: AccountSummary }
  | { status: 'pending' }
  | { status: 'error'; message: string }

/** preload 暴露给渲染层的 API 契约 */
export interface FerryApi {
  getAppInfo(): Promise<AppInfo>
  getSettings(): Promise<AppSettings>
  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  listInstances(): Promise<Instance[]>
  importInstance(): Promise<ImportOutcome>
  updateInstance(id: string, patch: InstancePatch): Promise<Instance[]>
  preflightInstance(id: string): Promise<PreflightStep[]>
  pickBackground(): Promise<BackgroundPickResult>
  loadBackground(path: string | null): Promise<string | null>
  listMods(id: string): Promise<ModEntry[]>
  toggleMod(id: string, fileName: string, enabled: boolean): Promise<ModEntry[]>
  deleteMod(id: string, fileName: string): Promise<ModEntry[]>
  importMods(id: string): Promise<ModImportOutcome>
  exportInstance(id: string, includeSaves: boolean): Promise<ExportOutcome>
  pickJava(): Promise<string | null>
  /** 选一张本地图片作为实例图标，成功后返回新路径 */
  pickInstanceIcon(id: string): Promise<IconPickResult>
  /** 恢复成内置像素图标 */
  clearInstanceIcon(id: string): Promise<Instance[]>
  removeInstance(id: string): Promise<Instance[]>
  revealInstance(id: string, subPath?: InstanceSubPath): Promise<void>
  netplay: {
    runtime(provider: NetplayProviderId): Promise<NetplayRuntime>
    install(provider: NetplayProviderId): Promise<NetplayInstallOutcome>
    status(): Promise<NetplayStatus>
    host(room: string, playerName: string): Promise<NetplayOutcome>
    join(room: string, playerName: string): Promise<NetplayOutcome>
    stop(): Promise<NetplayStatus>
    /** 生成符合 Scaffolding 协议的联机码 */
    generateCode(): Promise<RoomCodeInfo>
    /** 解析联机码，拿到等价的 EasyTier 网络名与密钥 */
    parseCode(code: string): Promise<(RoomCodeInfo & { ok: true }) | { ok: false; reason: string }>
    getEasyTierConfig(): Promise<EasyTierConfig>
    saveEasyTierConfig(config: EasyTierConfig): Promise<NetplayOutcome>
    onStatus(listener: (status: NetplayStatus) => void): () => void
    onInstallProgress(listener: (progress: NetplayInstallProgress) => void): () => void
  }

  /* ---- 内容管理 ---- */
  listContent(id: string, kind: ContentKind): Promise<ContentItem[]>
  previewContent(id: string, kind: ContentKind, key: string): Promise<ContentPreview>
  toggleContent(id: string, kind: ContentKind, key: string, enabled: boolean): Promise<ContentItem[]>
  deleteContent(id: string, kind: ContentKind, key: string): Promise<ContentItem[]>
  importContent(id: string, kind: ContentKind): Promise<ModImportOutcome>
  checkModUpdates(id: string): Promise<ModUpdate[]>
  upgradeMod(id: string, key: string, url: string, fileName: string): Promise<ContentItem[]>
  searchMods(id: string, query: string, limit?: number): Promise<ModSearchHit[]>
  downloadMod(id: string, projectId: string): Promise<ContentItem[]>
  cancelModDownload(): Promise<void>
  onModInstallProgress(listener: (progress: ModInstallProgress) => void): () => void

  /* ---- 账户 ---- */
  accounts: {
    list(): Promise<AccountSummary[]>
    addOffline(name: string): Promise<AccountSummary>
    loginLittleSkin(apiRoot: string, username: string, password: string): Promise<AccountSummary>
    refresh(id: string): Promise<AccountSummary>
    remove(id: string): Promise<AccountSummary[]>
    /** 切换账户下的角色 */
    selectProfile(id: string, profileId: string): Promise<AccountSummary>
    /** 上传皮肤，data 是 base64 PNG（可带 data: 前缀） */
    uploadSkin(id: string, data: string, model: 'classic' | 'slim'): Promise<AccountSummary>
    startMicrosoft(clientId?: string): Promise<DeviceCode>
    pollMicrosoft(deviceCode: string, clientId?: string): Promise<MsPollResult>
  }

  /* ---- 版本安装 ---- */
  versions: {
    manifest(source: 'official' | 'bmclapi'): Promise<VersionSummary[]>
    loaders(mcVersion: string, loader: string): Promise<LoaderVersion[]>
    install(request: InstallRequest): Promise<InstallOutcome>
    cancel(): Promise<void>
    onProgress(listener: (progress: InstallProgress) => void): () => void
  }

  /* ---- Java 与启动 ---- */
  detectJava(): Promise<JavaInfo[]>
  /** 下载并解压一个运行时，返回解压后的 java 路径 */
  downloadJava(major: number): Promise<JavaDownloadResult>
  /** 拉远程图片转 data URL（皮肤、头像） */
  fetchImage(url: string): Promise<string | null>
  openUrl(url: string): Promise<void>
  pickFolder(title: string): Promise<string | null>
  createInstance(request: CreateInstanceRequest): Promise<CreateInstanceOutcome>
  launch(instanceId: string, accountId?: string | null): Promise<LaunchOutcome>
  stopLaunch(): Promise<{ ok: boolean; message?: string }>
  isLaunching(): Promise<boolean>
  onLaunchState(listener: (event: LaunchEvent) => void): () => void
  onLaunchLog(listener: (log: LaunchLog) => void): () => void

  window: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<WindowState>
    close(): Promise<void>
    onStateChange(listener: (state: WindowState) => void): () => void
  }
}
