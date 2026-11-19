import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { FerryApi, ModDownloadOptions, ModSearchOptions, NetplayInstallProgress } from '@shared/ipc'
import type {
  CrashReport,
  InstallProgress,
  LaunchEvent,
  LaunchLog,
  ModInstallProgress,
  NetplayStatus,
  RoomCodeInfo
} from '@shared/types'

/**
 * Tauri 壳下的 FerryApi 实现。
 * 方法名与 Electron preload 完全一致，渲染层不需要改任何调用点。
 */
export function createTauriFerry(): FerryApi {
  return {
    getAppInfo: () => invoke('app_info'),
    getSettings: () => invoke('settings_get'),
    saveSettings: (patch) => invoke('settings_set', { patch }),
    listInstances: () => invoke('instances_list'),
    importInstance: () => invoke('instances_import'),
    createInstance: (request) =>
      invoke('instances_create', {
        name: request.name,
        mcVersion: request.mcVersion,
        loader: request.loader,
        loaderVersion: request.loaderVersion,
        gameDir: request.gameDir,
        versionId: request.versionId
      }),
    updateInstance: (id, patch) => invoke('instances_update', { id, patch }),
    removeInstance: (id) => invoke('instances_remove', { id }),
    preflightInstance: (id) => invoke('instances_preflight', { id }),
    pickBackground: () => invoke('background_pick'),
    loadBackground: (path) => invoke('background_load', { path }),

    listContent: (id, kind) => invoke('content_list', { id, kind }),
    previewContent: (id, kind, key) => invoke('content_preview', { id, kind, key }),
    toggleContent: (id, kind, key, enabled) => invoke('content_toggle', { id, kind, key, enabled }),
    deleteContent: (id, kind, key) => invoke('content_delete', { id, kind, key }),
    importContent: (id, kind) => invoke('content_import', { id, kind }),
    checkModUpdates: (id) => invoke('content_updates', { id }),
    upgradeMod: (id, key, url, fileName) => invoke('content_upgrade', { id, key, url, fileName }),
    searchMods: (id, query, limit) => invoke('mod_search', { id, query, limit: limit ?? 20 }),
    searchModsGlobal: (query, options?: ModSearchOptions) =>
      invoke('mod_search_global', {
        query,
        gameVersion: options?.gameVersion ?? '',
        loader: options?.loader ?? '',
        source: options?.source ?? 'all',
        category: options?.category ?? '',
        contentType: options?.contentType ?? 'mod',
        limit: options?.limit ?? 24
      }),
    downloadMod: (id, projectId, options?: ModDownloadOptions) =>
      invoke('mod_download', {
        id,
        projectId,
        source: options?.source ?? null,
        gameVersion: options?.gameVersion ?? null,
        loader: options?.loader ?? null,
        contentType: options?.contentType ?? 'mod'
      }),
    cancelModDownload: () => invoke('mod_download_cancel'),
    onModInstallProgress: (listener: (progress: ModInstallProgress) => void) => {
      let dispose: (() => void) | null = null
      void listen<ModInstallProgress>('mod:install-progress', (event) => listener(event.payload)).then(
        (unlisten) => {
          dispose = unlisten
        }
      )
      return () => dispose?.()
    },

    analyzeCrash: (id) => invoke('crash_analyze', { id }),
    onCrashAnalysis: (listener: (report: CrashReport) => void) => {
      let dispose: (() => void) | null = null
      void listen<CrashReport>('crash:analysis', (event) => listener(event.payload)).then(
        (unlisten) => {
          dispose = unlisten
        }
      )
      return () => dispose?.()
    },

    // 兼容旧接口
    listMods: (id) => invoke('mods_list', { id }),
    toggleMod: (id, fileName, enabled) => invoke('mods_toggle', { id, fileName, enabled }),
    deleteMod: (id, fileName) => invoke('mods_delete', { id, fileName }),
    importMods: (id) => invoke('mods_import', { id }),

    exportInstance: (id, includeSaves) => invoke('instance_export', { id, includeSaves }),
    pickJava: () => invoke('instance_pick_java'),
    pickInstanceIcon: (id) => invoke('instance_icon_pick', { id }),
    clearInstanceIcon: (id) => invoke('instance_icon_clear', { id }),
    detectJava: () => invoke('java_detect'),
    downloadJava: (major) => invoke('java_download', { major }),
    fetchImage: (url) => invoke('net_fetch_image', { url }),
    openUrl: (url) => invoke('open_url', { url }),
    pickFolder: (title) => invoke('pick_folder', { title }),
    revealInstance: (id, subPath) => invoke('instances_open_path', { id, subPath: subPath ?? '' }),

    accounts: {
      list: () => invoke('accounts_list'),
      addOffline: (name) => invoke('accounts_offline', { name }),
      loginLittleSkin: (apiRoot, username, password) =>
        invoke('accounts_login_littleskin', { apiRoot, username, password }),
      refresh: (id) => invoke('accounts_refresh', { id }),
      remove: (id) => invoke('accounts_remove', { id }),
    selectProfile: (id, profileId) => invoke('accounts_select_profile', { id, profileId }),
    uploadSkin: (id, data, model) => invoke('accounts_upload_skin', { id, data, model }),
      startMicrosoft: (clientId) => invoke('accounts_ms_start', { clientId: clientId ?? null }),
      pollMicrosoft: (deviceCode, clientId) =>
        invoke('accounts_ms_poll', { deviceCode, clientId: clientId ?? null })
    },

    versions: {
      manifest: (source) => invoke('versions_manifest', { source }),
      loaders: (mcVersion, loader) => invoke('versions_loaders', { mcVersion, loader }),
      install: (request) => invoke('install_start', { request }),
      cancel: () => invoke('install_cancel'),
      onProgress: (listener: (progress: InstallProgress) => void) => {
        let dispose: (() => void) | null = null
        void listen<InstallProgress>('install:progress', (event) => listener(event.payload)).then(
          (unlisten) => {
            dispose = unlisten
          }
        )
        return () => dispose?.()
      }
    },

    launch: (instanceId, accountId) => invoke('launch_start', { id: instanceId, accountId: accountId ?? null }),
    stopLaunch: () => invoke('launch_stop'),
    isLaunching: () => invoke('launch_status'),
    onLaunchState: (listener: (event: LaunchEvent) => void) => {
      let dispose: (() => void) | null = null
      void listen<LaunchEvent>('launch:state', (event) => listener(event.payload)).then((unlisten) => {
        dispose = unlisten
      })
      return () => dispose?.()
    },
    onLaunchLog: (listener: (log: LaunchLog) => void) => {
      let dispose: (() => void) | null = null
      void listen<LaunchLog>('launch:log', (event) => listener(event.payload)).then((unlisten) => {
        dispose = unlisten
      })
      return () => dispose?.()
    },

    netplay: {
      runtime: (provider) => invoke('netplay_runtime', { provider }),
      install: (provider) => invoke('netplay_install', { provider }),
      status: () => invoke('netplay_status'),
      host: (room, playerName) => invoke('netplay_host', { room, playerName }),
      join: (room, playerName) => invoke('netplay_join', { room, playerName }),
      stop: () => invoke('netplay_stop'),
      generateCode: () => invoke<RoomCodeInfo>('netplay_code_generate'),
      parseCode: (code) => invoke('netplay_code_parse', { code }),
      getEasyTierConfig: () => invoke('netplay_easytier_config'),
      saveEasyTierConfig: (config) => invoke('netplay_easytier_save', { config }),
      onStatus: (listener: (status: NetplayStatus) => void) => {
        let dispose: (() => void) | null = null
        void listen<NetplayStatus>('netplay:status-event', (event) => listener(event.payload)).then(
          (unlisten) => {
            dispose = unlisten
          }
        )
        return () => dispose?.()
      },
      onInstallProgress: (listener: (progress: NetplayInstallProgress) => void) => {
        let dispose: (() => void) | null = null
        void listen<NetplayInstallProgress>('netplay:install-progress', (event) =>
          listener(event.payload)
        ).then((unlisten) => {
          dispose = unlisten
        })
        return () => dispose?.()
      }
    },

    window: {
      minimize: () => invoke('window_minimize'),
      toggleMaximize: () => invoke('window_toggle_maximize'),
      close: () => invoke('window_close'),
      onStateChange: () => () => undefined
    }
  }
}

/** 判断当前是否跑在 Tauri 里 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}
