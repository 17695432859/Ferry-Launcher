import { create } from 'zustand'
import type { AccountSummary, AppInfo, AppSettings, Instance } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { translate, type TranslationKey } from '@shared/i18n'
import type { BackgroundPickResult, ImportOutcome, InstancePatch } from '@shared/ipc'

export type InstanceView = 'grid' | 'list'

export interface ToastMessage {
  id: number
  kind: 'info' | 'success' | 'error'
  text: string
}

interface AppState {
  ready: boolean
  info: AppInfo | null
  settings: AppSettings
  instances: Instance[]
  selectedId: string | null
  view: InstanceView
  toast: ToastMessage | null
  importing: boolean
  /** 自定义背景图的 data URL，null 表示用程序化背景 */
  backgroundImage: string | null
  /** 账户列表，标题栏与账户页共用同一份 */
  accounts: AccountSummary[]

  init: () => Promise<void>
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
  selectInstance: (id: string) => void
  setView: (view: InstanceView) => void
  pickBackground: () => Promise<BackgroundPickResult>
  clearBackground: () => Promise<void>
  importInstance: () => Promise<ImportOutcome>
  /** 重新拉一次实例列表（新建 / 安装完成后用） */
  reloadInstances: () => Promise<void>
  /** 重新拉一次账户列表（登录 / 移除 / 切角色后用） */
  reloadAccounts: () => Promise<void>
  updateInstance: (id: string, patch: InstancePatch) => Promise<void>
  removeInstance: (id: string) => Promise<void>
  notify: (kind: ToastMessage['kind'], text: string) => void
  dismissToast: () => void
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string
}

let toastSeq = 0
let saveTimer: ReturnType<typeof setTimeout> | null = null
let pendingPatch: Partial<AppSettings> = {}

/** 设置写盘做 250ms 防抖，滑杆拖动时不会把 IPC 打满 */
function schedulePersist(patch: Partial<AppSettings>, onSaved: (settings: AppSettings) => void): void {
  pendingPatch = { ...pendingPatch, ...patch }
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const toSave = pendingPatch
    pendingPatch = {}
    saveTimer = null
    void window.ferry.saveSettings(toSave).then(onSaved)
  }, 250)
}

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  info: null,
  settings: { ...DEFAULT_SETTINGS },
  instances: [],
  selectedId: null,
  view: 'list',
  toast: null,
  importing: false,
  backgroundImage: null,
  accounts: [],

  init: async () => {
    const [info, settings, instances] = await Promise.all([
      window.ferry.getAppInfo(),
      window.ferry.getSettings(),
      window.ferry.listInstances()
    ])
    const locale = settings.locale ?? (info.systemLocale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en')
    const backgroundImage = settings.backgroundPath
      ? await window.ferry.loadBackground(settings.backgroundPath)
      : null
    set({
      info,
      settings: { ...settings, locale },
      instances,
      selectedId: instances[0]?.id ?? null,
      backgroundImage,
      ready: true
    })
    // 账户单独拉：旧 Electron 预览壳没有账户接口，失败也不能挡住首屏
    await get().reloadAccounts()
  },

  updateSettings: async (patch) => {
    set((state) => ({ settings: { ...state.settings, ...patch } }))
    if (patch.backgroundPath !== undefined) {
      const backgroundImage = await window.ferry.loadBackground(patch.backgroundPath)
      set({ backgroundImage })
    }
    schedulePersist(patch, (saved) => {
      // 服务端做了范围校验，以返回值为准，避免 UI 与磁盘不一致
      set((state) => ({ settings: { ...state.settings, ...saved } }))
    })
  },

  selectInstance: (id) => set({ selectedId: id }),

  setView: (view) => set({ view }),

  pickBackground: async () => {
    const result = await window.ferry.pickBackground()
    if (result.ok) {
      await get().updateSettings({ backgroundPath: result.path, backgroundMode: 'custom' })
    }
    return result
  },

  clearBackground: async () => {
    await get().updateSettings({ backgroundPath: null, backgroundMode: 'builtin' })
  },

  importInstance: async () => {
    set({ importing: true })
    try {
      const outcome = await window.ferry.importInstance()
      if (outcome.ok) {
        const instances = await window.ferry.listInstances()
        set({ instances, selectedId: outcome.instances[0]?.id ?? null })
      }
      return outcome
    } finally {
      set({ importing: false })
    }
  },

  reloadInstances: async () => {
    const instances = await window.ferry.listInstances()
    set((state) => ({
      instances,
      selectedId:
        state.selectedId && instances.some((item) => item.id === state.selectedId)
          ? state.selectedId
          : (instances[0]?.id ?? null)
    }))
  },

  reloadAccounts: async () => {
    try {
      set({ accounts: await window.ferry.accounts.list() })
    } catch {
      // 旧 Electron 预览壳没有账户接口，这里静默降级成空列表
      set({ accounts: [] })
    }
  },

  updateInstance: async (id, patch) => {
    // 先本地乐观更新，滑杆拖动才跟手；落盘由主进程校验
    set((state) => ({
      instances: state.instances.map((item) => (item.id === id ? { ...item, ...patch } : item))
    }))
    const instances = await window.ferry.updateInstance(id, patch)
    set({ instances })
  },

  removeInstance: async (id) => {
    const instances = await window.ferry.removeInstance(id)
    set((state) => ({
      instances,
      selectedId: state.selectedId === id ? (instances[0]?.id ?? null) : state.selectedId
    }))
  },

  notify: (kind, text) => {
    toastSeq += 1
    set({ toast: { id: toastSeq, kind, text } })
  },

  dismissToast: () => set({ toast: null }),

  t: (key, vars) => translate(get().settings.locale, key, vars)
}))
