import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  ACCENT_PRESETS,
  BLUR_RANGE,
  DEFAULT_SETTINGS,
  MEMORY_RANGE,
  UI_SCALE_RANGE,
  type AppSettings,
  type DownloadSource,
  type Locale,
  type ThemeMode
} from '@shared/types'

const THEMES: ThemeMode[] = ['dark', 'light', 'system']
const SOURCES: DownloadSource[] = ['official', 'bmclapi']
const LOCALES: Locale[] = ['zh-CN', 'en']
const HEX = /^#[0-9a-fA-F]{6}$/

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

/**
 * 设置持久化：单文件 JSON，写在 userData 下。
 * 所有来自渲染层的字段都必须过一遍这里，非法值直接回落到默认值。
 */
class SettingsStore {
  private cache: AppSettings | null = null

  private get filePath(): string {
    return path.join(app.getPath('userData'), 'settings.json')
  }

  async load(): Promise<AppSettings> {
    if (this.cache) return { ...this.cache }
    let raw: string
    try {
      raw = await readFile(this.filePath, 'utf8')
    } catch {
      this.cache = { ...DEFAULT_SETTINGS }
      await this.persist()
      return { ...this.cache }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = null
    }
    this.cache = this.sanitize(parsed)
    return { ...this.cache }
  }

  async save(patch: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.load()
    this.cache = this.sanitize({ ...current, ...patch })
    await this.persist()
    return { ...this.cache }
  }

  private sanitize(input: unknown): AppSettings {
    const raw = (input ?? {}) as Record<string, unknown>
    const accent = typeof raw.accent === 'string' && HEX.test(raw.accent) ? raw.accent : DEFAULT_SETTINGS.accent
    return {
      theme: THEMES.includes(raw.theme as ThemeMode) ? (raw.theme as ThemeMode) : DEFAULT_SETTINGS.theme,
      accent,
      blur: clamp(Number(raw.blur ?? DEFAULT_SETTINGS.blur), BLUR_RANGE.min, BLUR_RANGE.max),
      backgroundAnimation:
        typeof raw.backgroundAnimation === 'boolean'
          ? raw.backgroundAnimation
          : DEFAULT_SETTINGS.backgroundAnimation,
      backgroundMode: raw.backgroundMode === 'custom' ? 'custom' : 'builtin',
      backgroundPath: typeof raw.backgroundPath === 'string' ? raw.backgroundPath : null,
      backgroundDim: clamp(Number(raw.backgroundDim ?? DEFAULT_SETTINGS.backgroundDim), 0, 80),
      uiScale: clamp(Number(raw.uiScale ?? DEFAULT_SETTINGS.uiScale), UI_SCALE_RANGE.min, UI_SCALE_RANGE.max),
      downloadSource: SOURCES.includes(raw.downloadSource as DownloadSource)
        ? (raw.downloadSource as DownloadSource)
        : DEFAULT_SETTINGS.downloadSource,
      defaultMemoryMb: clamp(
        Number(raw.defaultMemoryMb ?? DEFAULT_SETTINGS.defaultMemoryMb),
        MEMORY_RANGE.min,
        MEMORY_RANGE.max
      ),
      locale: LOCALES.includes(raw.locale as Locale) ? (raw.locale as Locale) : DEFAULT_SETTINGS.locale,
      lastAccountId: typeof raw.lastAccountId === 'string' ? raw.lastAccountId : null,
      onboardingDone: raw.onboardingDone === true,
      defaultJavaPath: typeof raw.defaultJavaPath === 'string' && raw.defaultJavaPath ? raw.defaultJavaPath : null,
      curseforgeApiKey: typeof raw.curseforgeApiKey === 'string' && raw.curseforgeApiKey ? raw.curseforgeApiKey : null
    }
  }

  private async persist(): Promise<void> {
    if (!this.cache) return
    await mkdir(path.dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(this.cache, null, 2), 'utf8')
  }

  /** 供设置页「恢复默认」使用 */
  static defaultAccent(): string {
    return ACCENT_PRESETS[0].value
  }
}

export const settingsStore = new SettingsStore()
