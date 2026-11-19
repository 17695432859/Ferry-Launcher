import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type FerryApi, type NetplayInstallProgress } from '@shared/ipc'
import type { NetplayStatus, WindowState } from '@shared/types'

/**
 * Electron 壳是切到 Tauri 之前的旧版预览壳，只保留实例扫描、联机、主题这些老能力。
 * 安装、启动、账户、内容管理都在 Tauri 侧的 Rust 后端里，
 * 这里明确拒绝，而不是返回假数据让界面看起来"成功"。
 */
const TAURI_ONLY = '该功能只在 Tauri 版中提供（Electron 壳为旧版预览）'
const notInElectron = (): Promise<never> => Promise.reject(new Error(TAURI_ONLY))
const noopUnsubscribe = (): void => undefined

/**
 * 渲染层与主进程之间的唯一通道。
 * 这里只暴露具名方法，不透传 ipcRenderer 本身，渲染层无法自造通道。
 */
const api: FerryApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC.appInfo),
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  saveSettings: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch),
  listInstances: () => ipcRenderer.invoke(IPC.instancesList),
  importInstance: () => ipcRenderer.invoke(IPC.instancesImport),
  updateInstance: (id, patch) => ipcRenderer.invoke(IPC.instancesUpdate, id, patch),
  removeInstance: (id) => ipcRenderer.invoke(IPC.instancesRemove, id),
  preflightInstance: (id) => ipcRenderer.invoke(IPC.instancesPreflight, id),
  pickBackground: () => ipcRenderer.invoke(IPC.backgroundPick),
  listMods: (id) => ipcRenderer.invoke(IPC.modsList, id),
  toggleMod: (id, fileName, enabled) => ipcRenderer.invoke(IPC.modsToggle, id, fileName, enabled),
  deleteMod: (id, fileName) => ipcRenderer.invoke(IPC.modsDelete, id, fileName),
  importMods: (id) => ipcRenderer.invoke(IPC.modsImport, id),
  exportInstance: (id, includeSaves) => ipcRenderer.invoke(IPC.instanceExport, id, includeSaves),
  pickJava: () => ipcRenderer.invoke(IPC.instancePickJava),
  pickInstanceIcon: notInElectron,
  clearInstanceIcon: notInElectron,
  loadBackground: (filePath) => ipcRenderer.invoke(IPC.backgroundLoad, filePath),
  revealInstance: (id, subPath) => ipcRenderer.invoke(IPC.instancesOpenPath, id, subPath ?? ''),
  netplay: {
    runtime: (provider) => ipcRenderer.invoke(IPC.netplayRuntime, provider),
    install: (provider) => ipcRenderer.invoke(IPC.netplayInstall, provider),
    status: () => ipcRenderer.invoke(IPC.netplayStatus),
    host: (room, playerName) => ipcRenderer.invoke(IPC.netplayHost, room, playerName),
    join: (room, playerName) => ipcRenderer.invoke(IPC.netplayJoin, room, playerName),
    stop: () => ipcRenderer.invoke(IPC.netplayStop),
    generateCode: () => ipcRenderer.invoke(IPC.netplayCodeGenerate),
    parseCode: (code) => ipcRenderer.invoke(IPC.netplayCodeParse, code),
    getEasyTierConfig: () => ipcRenderer.invoke(IPC.netplayEasyTierConfig),
    saveEasyTierConfig: (config) => ipcRenderer.invoke(IPC.netplayEasyTierSave, config),
    onStatus: (listener) => {
      const handler = (_event: unknown, status: NetplayStatus): void => listener(status)
      ipcRenderer.on(IPC.netplayStatusEvent, handler)
      return () => {
        ipcRenderer.removeListener(IPC.netplayStatusEvent, handler)
      }
    },
    onInstallProgress: (listener) => {
      const handler = (_event: unknown, progress: NetplayInstallProgress): void => listener(progress)
      ipcRenderer.on(IPC.netplayInstallProgress, handler)
      return () => {
        ipcRenderer.removeListener(IPC.netplayInstallProgress, handler)
      }
    }
  },
  /* ---- 以下为 Tauri 版才有的能力 ---- */
  listContent: notInElectron,
  previewContent: notInElectron,
  toggleContent: notInElectron,
  deleteContent: notInElectron,
  importContent: notInElectron,
  checkModUpdates: notInElectron,
  upgradeMod: notInElectron,
  accounts: {
    list: notInElectron,
    addOffline: notInElectron,
    loginLittleSkin: notInElectron,
    refresh: notInElectron,
    remove: notInElectron,
    selectProfile: notInElectron,
    uploadSkin: notInElectron,
    startMicrosoft: notInElectron,
    pollMicrosoft: notInElectron
  },
  versions: {
    manifest: notInElectron,
    loaders: notInElectron,
    install: notInElectron,
    cancel: notInElectron,
    onProgress: () => noopUnsubscribe
  },
  detectJava: notInElectron,
  downloadJava: notInElectron,
  fetchImage: notInElectron,
  openUrl: notInElectron,
  pickFolder: notInElectron,
  createInstance: notInElectron,
  launch: notInElectron,
  stopLaunch: notInElectron,
  isLaunching: notInElectron,
  onLaunchState: () => noopUnsubscribe,
  onLaunchLog: () => noopUnsubscribe,

  window: {
    minimize: () => ipcRenderer.invoke(IPC.windowMinimize),
    toggleMaximize: () => ipcRenderer.invoke(IPC.windowToggleMaximize),
    close: () => ipcRenderer.invoke(IPC.windowClose),
    onStateChange: (listener: (state: WindowState) => void) => {
      const handler = (_event: unknown, state: WindowState): void => listener(state)
      ipcRenderer.on(IPC.windowState, handler)
      return () => {
        ipcRenderer.removeListener(IPC.windowState, handler)
      }
    }
  }
}

contextBridge.exposeInMainWorld('ferry', api)
