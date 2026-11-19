import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  IPC,
  type BackgroundPickResult,
  type ExportOutcome,
  type ImportOutcome,
  type ModImportOutcome,
  type NetplayInstallOutcome,
  type NetplayOutcome,
  type PreflightStep
} from '@shared/ipc'
import type {
  AppInfo,
  AppSettings,
  EasyTierConfig,
  Instance,
  ModEntry,
  NetplayProviderId,
  NetplayRuntime,
  NetplayStatus,
  RoomCodeInfo
} from '@shared/types'
import { loadBackgroundDataUrl, pickBackground } from './background'
import { exportInstance } from './export'
import { deleteMod, importMods, listMods, toggleMod } from './mods'
import * as netplay from './netplay'
import { scanGameDirAll } from './importer'
import { preflightInstance } from './preflight'
import { instanceRepository } from './instance-repo'
import { settingsStore } from './settings-store'

function buildAppInfo(): AppInfo {
  const build = Number(os.release().split('.')[2] ?? 0)
  return {
    name: 'Ferry Launcher',
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    systemLocale: app.getLocale(),
    dataDir: app.getPath('userData'),
    // Windows 11 (build >= 22000) 才有 mica/acrylic；其余平台走 CSS 毛玻璃
    nativeBackdrop: process.platform === 'win32' && build >= 22000
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

async function importInstanceFromDialog(parent: BrowserWindow | null): Promise<ImportOutcome> {
  const settings = await settingsStore.load()
  const options: Electron.OpenDialogOptions = {
    title: settings.locale === 'en' ? 'Select an existing game folder' : '选择已有的游戏目录',
    buttonLabel: settings.locale === 'en' ? 'Import' : '导入',
    properties: ['openDirectory']
  }
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
  const target = result.filePaths[0]
  if (result.canceled || !target) return { ok: false, reason: 'cancelled' }

  let candidates: Awaited<ReturnType<typeof scanGameDirAll>>
  try {
    candidates = await scanGameDirAll(target)
  } catch (error) {
    return {
      ok: false,
      reason: 'read-error',
      message: error instanceof Error ? error.message : String(error)
    }
  }
  if (candidates.length === 0) {
    return { ok: false, reason: 'not-a-game-dir', message: target }
  }

  const stamp = Date.now().toString(36)
  const drafts: Instance[] = candidates.map((candidate, index) => ({
    id: `imported-${stamp}-${index}`,
    name: candidate.suggestedName,
    mcVersion: candidate.mcVersion,
    loader: candidate.loader,
    loaderVersion: candidate.loaderVersion,
    coverSeed: `${candidate.gameDir}#${candidate.versionId ?? ''}`,
    lastPlayedAt: null,
    totalPlaytimeMs: 0,
    memoryMb: settings.defaultMemoryMb,
    javaPath: null,
    gameDir: candidate.gameDir,
    versionId: candidate.versionId ?? undefined
  }))

  let accepted: Instance[]
  try {
    accepted = await instanceRepository.addMany(drafts)
  } catch (error) {
    return {
      ok: false,
      reason: 'read-error',
      message: error instanceof Error ? error.message : String(error)
    }
  }

  if (accepted.length === 0) {
    return { ok: false, reason: 'duplicate', message: target }
  }

  const warnings = candidates.flatMap((candidate) => candidate.warnings)
  return {
    ok: true,
    instances: accepted,
    warnings,
    skipped: drafts.length - accepted.length
  }
}

/** 所有 IPC 处理集中在主进程，入参一律先校验类型 */
export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.appInfo, (): AppInfo => buildAppInfo())

  ipcMain.handle(IPC.settingsGet, (): Promise<AppSettings> => settingsStore.load())

  ipcMain.handle(IPC.settingsSet, (_event, patch: unknown): Promise<AppSettings> => {
    return settingsStore.save(asRecord(patch) as Partial<AppSettings>)
  })

  ipcMain.handle(IPC.instancesList, (): Promise<Instance[]> => instanceRepository.list())

  ipcMain.handle(IPC.instancesImport, (event): Promise<ImportOutcome> => {
    return importInstanceFromDialog(BrowserWindow.fromWebContents(event.sender))
  })

  ipcMain.handle(
    IPC.instancesUpdate,
    (_event, id: unknown, patch: unknown): Promise<Instance[]> => {
      if (typeof id !== 'string') return instanceRepository.list()
      return instanceRepository.update(id, asRecord(patch))
    }
  )

  ipcMain.handle(IPC.instancesPreflight, async (_event, id: unknown): Promise<PreflightStep[]> => {
    if (typeof id !== 'string') return []
    const instance = await instanceRepository.get(id)
    if (!instance) return []
    return preflightInstance(instance)
  })

  ipcMain.handle(IPC.instancesRemove, (_event, id: unknown): Promise<Instance[]> => {
    if (typeof id !== 'string' || id.length === 0) return instanceRepository.list()
    return instanceRepository.remove(id)
  })

  const openInstancePath = async (id: unknown, subPath: unknown): Promise<void> => {
    if (typeof id !== 'string') return
    const instance = await instanceRepository.get(id)
    if (!instance) return
    const allowed = ['', 'mods', 'saves', 'logs', 'resourcepacks']
    const sub = typeof subPath === 'string' && allowed.includes(subPath) ? subPath : ''
    const target = sub ? path.join(instance.gameDir, sub) : instance.gameDir
    await mkdir(target, { recursive: true })
    const error = await shell.openPath(target)
    if (error) throw new Error(error)
  }

  ipcMain.handle(IPC.instancesReveal, (_event, id: unknown): Promise<void> => openInstancePath(id, ''))
  ipcMain.handle(IPC.instancesOpenPath, (_event, id: unknown, subPath: unknown): Promise<void> =>
    openInstancePath(id, subPath)
  )

  ipcMain.handle(IPC.modsList, async (_event, id: unknown): Promise<ModEntry[]> => {
    if (typeof id !== 'string') return []
    const instance = await instanceRepository.get(id)
    return instance ? listMods(instance.gameDir) : []
  })

  ipcMain.handle(
    IPC.modsToggle,
    async (_event, id: unknown, fileName: unknown, enabled: unknown): Promise<ModEntry[]> => {
      if (typeof id !== 'string' || typeof fileName !== 'string') return []
      const instance = await instanceRepository.get(id)
      if (!instance) return []
      return toggleMod(instance.gameDir, fileName, enabled === true)
    }
  )

  ipcMain.handle(
    IPC.modsDelete,
    async (_event, id: unknown, fileName: unknown): Promise<ModEntry[]> => {
      if (typeof id !== 'string' || typeof fileName !== 'string') return []
      const instance = await instanceRepository.get(id)
      if (!instance) return []
      return deleteMod(instance.gameDir, fileName)
    }
  )

  ipcMain.handle(IPC.modsImport, async (event, id: unknown): Promise<ModImportOutcome> => {
    if (typeof id !== 'string') return { added: 0, skipped: 0, cancelled: true }
    const instance = await instanceRepository.get(id)
    if (!instance) return { added: 0, skipped: 0, cancelled: true }
    const settings = await settingsStore.load()
    return importMods(instance.gameDir, BrowserWindow.fromWebContents(event.sender), settings.locale)
  })

  ipcMain.handle(
    IPC.instanceExport,
    async (event, id: unknown, includeSaves: unknown): Promise<ExportOutcome> => {
      if (typeof id !== 'string') return { ok: false, reason: 'error', message: 'BAD_ID' }
      const instance = await instanceRepository.get(id)
      if (!instance) return { ok: false, reason: 'error', message: 'NOT_FOUND' }
      const settings = await settingsStore.load()
      return exportInstance(
        instance,
        includeSaves === true,
        BrowserWindow.fromWebContents(event.sender),
        settings.locale
      )
    }
  )

  ipcMain.handle(IPC.instancePickJava, async (event): Promise<string | null> => {
    const settings = await settingsStore.load()
    const parent = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: settings.locale === 'en' ? 'Select a Java executable' : '选择 Java 可执行文件',
      properties: ['openFile'],
      filters:
        process.platform === 'win32'
          ? [{ name: 'Java', extensions: ['exe'] }]
          : [{ name: 'Java', extensions: ['*'] }]
    }
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle(IPC.backgroundPick, (event): Promise<BackgroundPickResult> => {
    return settingsStore.load().then((settings) =>
      pickBackground(BrowserWindow.fromWebContents(event.sender), settings.locale)
    )
  })

  ipcMain.handle(IPC.backgroundLoad, (_event, filePath: unknown): Promise<string | null> => {
    return loadBackgroundDataUrl(typeof filePath === 'string' ? filePath : null)
  })

  /* ---------------------------------------------------------------- 联机 */

  const readProvider = (value: unknown): NetplayProviderId | null =>
    value === 'terracotta' || value === 'easytier' ? value : null

  ipcMain.handle(IPC.netplayRuntime, (_event, provider: unknown): Promise<NetplayRuntime> => {
    const id = readProvider(provider)
    if (!id) throw new Error('BAD_PROVIDER')
    return netplay.runtime(id)
  })

  ipcMain.handle(IPC.netplayInstall, async (event, provider: unknown): Promise<NetplayInstallOutcome> => {
    const id = readProvider(provider)
    if (!id) return { ok: false, reason: 'unsupported', message: 'BAD_PROVIDER' }
    return netplay.install(id, (received, total) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send(IPC.netplayInstallProgress, { provider: id, received, total })
      }
    })
  })

  ipcMain.handle(IPC.netplayStatus, (): Promise<NetplayStatus> => netplay.status())

  ipcMain.handle(
    IPC.netplayHost,
    (_event, room: unknown, playerName: unknown): Promise<NetplayOutcome> =>
      netplay.host('terracotta', typeof room === 'string' ? room : '', typeof playerName === 'string' ? playerName : '')
  )

  ipcMain.handle(
    IPC.netplayJoin,
    (_event, room: unknown, playerName: unknown): Promise<NetplayOutcome> => {
      const code = typeof room === 'string' ? room.trim() : ''
      if (!code) return Promise.resolve({ ok: false, reason: 'invalid', message: 'EMPTY_ROOM' })
      return netplay.join('terracotta', code, typeof playerName === 'string' ? playerName : '')
    }
  )

  ipcMain.handle(IPC.netplayStop, (): Promise<NetplayStatus> => netplay.stop())

  ipcMain.handle(IPC.netplayEasyTierConfig, (): Promise<EasyTierConfig> => netplay.easyTierConfig())

  ipcMain.handle(IPC.netplayEasyTierSave, (_event, config: unknown): Promise<NetplayOutcome> => {
    const record = asRecord(config)
    const next: EasyTierConfig = {
      code: typeof record.code === 'string' ? record.code : '',
      networkName: typeof record.networkName === 'string' ? record.networkName : '',
      networkSecret: typeof record.networkSecret === 'string' ? record.networkSecret : '',
      peers: typeof record.peers === 'string' ? record.peers : '',
      role: record.role === 'host' ? 'host' : 'guest',
      port: typeof record.port === 'number' ? record.port : undefined
    }
    return netplay.startEasyTier(next)
  })

  ipcMain.handle(IPC.netplayCodeGenerate, (): RoomCodeInfo => netplay.generateCode())

  ipcMain.handle(
    IPC.netplayCodeParse,
    (_event, code: unknown): (RoomCodeInfo & { ok: true }) | { ok: false; reason: string } => {
      const info = typeof code === 'string' ? netplay.parseCode(code) : null
      return info ? { ok: true, ...info } : { ok: false, reason: 'bad-room-code' }
    }
  )

  ipcMain.handle(IPC.windowMinimize, (event): void => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.handle(IPC.windowToggleMaximize, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { maximized: false, focused: false }
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return { maximized: win.isMaximized(), focused: win.isFocused() }
  })

  ipcMain.handle(IPC.windowClose, (event): void => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
}
