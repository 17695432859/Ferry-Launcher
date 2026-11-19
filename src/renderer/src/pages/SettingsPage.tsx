import { useState } from 'react'
import { motion } from 'framer-motion'
import type { CSSProperties, ReactNode } from 'react'
import {
  ACCENT_PRESETS,
  BLUR_RANGE,
  DEFAULT_SETTINGS,
  MEMORY_RANGE,
  UI_SCALE_RANGE,
  type AppSettings,
  type JavaInfo
} from '@shared/types'
import { useAppStore } from '@renderer/store/app-store'
import { Icon } from '@renderer/components/Icon'

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="glass rounded-panel p-4">
      <h3 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-2">{title}</h3>
      <div className="mt-1 divide-y divide-[var(--hairline)]">{children}</div>
    </section>
  )
}

function Row({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className="flex items-center gap-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] text-1">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] leading-snug text-3">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Segmented<T extends string>({
  id,
  value,
  options,
  onChange
}: {
  id: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}): JSX.Element {
  return (
    <div className="flex rounded-lg border border-[var(--hairline)] bg-[var(--hover-bg)] p-0.5">
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className="relative px-2.5 py-1 text-[12.5px] font-medium transition-colors"
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                className="absolute inset-0 rounded-md border border-[var(--panel-border)] bg-[var(--panel-bg-strong)]"
              />
            )}
            <span className={`relative ${active ? 'text-1' : 'text-2'}`}>{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function Slider({
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange
}: {
  value: number
  min: number
  max: number
  step?: number
  suffix: string
  onChange: (value: number) => void
}): JSX.Element {
  const percent = ((value - min) / (max - min)) * 100
  const style = {
    '--track-fill': `linear-gradient(90deg, var(--accent) ${percent}%, color-mix(in srgb, var(--text-3) 30%, transparent) ${percent}%)`
  } as CSSProperties
  return (
    <div className="flex w-[232px] items-center gap-3">
      <input
        type="range"
        className="slider"
        style={style}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="w-14 shrink-0 text-right text-[12.5px] tnum text-2">
        {value}
        {suffix}
      </span>
    </div>
  )
}

function Switch({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-[24px] w-[42px] rounded-full border transition-colors duration-200 ${
        checked
          ? 'border-accent/50 bg-accent/85'
          : 'border-[var(--hairline)] bg-[var(--active-bg)]'
      }`}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 520, damping: 34 }}
        className="absolute top-[3px] h-[16px] w-[16px] rounded-full bg-white shadow-sm"
        style={{ left: checked ? 22 : 3 }}
      />
    </button>
  )
}

export function SettingsPage(): JSX.Element {
  const t = useAppStore((state) => state.t)
  const settings = useAppStore((state) => state.settings)
  const info = useAppStore((state) => state.info)
  const updateSettings = useAppStore((state) => state.updateSettings)

  const patch = (value: Partial<AppSettings>): void => void updateSettings(value)
  const [found, setFound] = useState<JavaInfo[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState(false)
  const [downloading, setDownloading] = useState<number | null>(null)

  const detectJava = async (): Promise<void> => {
    setScanning(true)
    try {
      const list = await window.ferry.detectJava()
      setFound(list)
      setScanned(true)
      // 还没设过默认值就顺手选一个最合适的
      if (!settings.defaultJavaPath && list.length > 0) {
        await patch({ defaultJavaPath: list[0].path })
      }
    } finally {
      setScanning(false)
    }
  }

  const downloadJava = async (major: number): Promise<void> => {
    setDownloading(major)
    try {
      const result = await window.ferry.downloadJava(major)
      if (!result.ok || !result.path) {
        notify('error', result.message ?? 'JAVA_UNPACK_FAILED')
        return
      }
      const list = await window.ferry.detectJava()
      setFound(list)
      setScanned(true)
      await patch({ defaultJavaPath: result.path })
      notify('success', t('settings.javaDownloaded', { major: String(major) }))
    } finally {
      setDownloading(null)
    }
  }

  const pickBackground = useAppStore((state) => state.pickBackground)
  const clearBackground = useAppStore((state) => state.clearBackground)
  const notify = useAppStore((state) => state.notify)

  const handlePickBackground = async (): Promise<void> => {
    const result = await pickBackground()
    if (result.ok || result.reason === 'cancelled') return
    if (result.reason === 'too-large') {
      notify('error', t('settings.backgroundTooLarge'))
    } else if (result.reason === 'unsupported') {
      notify('error', t('settings.backgroundUnsupported'))
    } else {
      notify('error', t('home.importReadError', { message: result.message ?? '' }))
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
      <div className="mx-auto flex max-w-[720px] flex-col gap-3">
        <header className="px-1 pb-1">
          <h1 className="text-[19px] font-semibold tracking-tight text-1">{t('settings.title')}</h1>
          <p className="mt-0.5 text-[12.5px] text-2">{t('settings.subtitle')}</p>
        </header>

        <Section title={t('settings.appearance')}>
          <Row label={t('settings.theme')}>
            <Segmented
              id="theme"
              value={settings.theme}
              onChange={(theme) => patch({ theme })}
              options={[
                { value: 'dark', label: t('settings.theme.dark') },
                { value: 'light', label: t('settings.theme.light') },
                { value: 'system', label: t('settings.theme.system') }
              ]}
            />
          </Row>

          <Row label={t('settings.accent')}>
            <div className="flex items-center gap-1.5">
              {ACCENT_PRESETS.map((preset) => {
                const active = preset.value.toLowerCase() === settings.accent.toLowerCase()
                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-label={preset.label}
                    title={preset.label}
                    onClick={() => patch({ accent: preset.value })}
                    className="swatch flex items-center justify-center"
                    style={{
                      background: preset.value,
                      borderColor: active ? 'var(--text-1)' : 'transparent'
                    }}
                  >
                    {active && <Icon name="check" size={12} className="text-white drop-shadow" />}
                  </button>
                )
              })}
              <label
                className="swatch ml-1 flex cursor-pointer items-center justify-center border-dashed border-[var(--text-3)] bg-transparent"
                title={t('settings.accentCustom')}
              >
                <Icon name="plus" size={12} className="text-3" />
                <Icon name="plus" size={12} className="text-3" />
                <input
                  type="color"
                  value={settings.accent}
                  onChange={(event) => patch({ accent: event.target.value })}
                  className="h-0 w-0 opacity-0"
                  aria-label={t('settings.accentCustom')}
                />
              </label>
            </div>
          </Row>

          <Row label={t('settings.blur')}>
            <Slider
              value={settings.blur}
              min={BLUR_RANGE.min}
              max={BLUR_RANGE.max}
              suffix={t('common.px')}
              onChange={(blur) => patch({ blur })}
            />
          </Row>

          <Row label={t('settings.scale')}>
            <Slider
              value={settings.uiScale}
              min={UI_SCALE_RANGE.min}
              max={UI_SCALE_RANGE.max}
              step={5}
              suffix={t('common.percent')}
              onChange={(uiScale) => patch({ uiScale })}
            />
          </Row>

          <Row label={t('settings.bgSource')}>
            <Segmented
              id="bg-source"
              value={settings.backgroundMode}
              onChange={(backgroundMode) => patch({ backgroundMode })}
              options={[
                { value: 'builtin', label: t('settings.bgSourceBuiltin') },
                { value: 'custom', label: t('settings.bgSourceCustom') }
              ]}
            />
          </Row>

          {settings.backgroundMode === 'custom' && (
          <Row
            label={t('settings.background')}
            hint={settings.backgroundPath ? settings.backgroundPath.split(/[\\/]/).pop() : t('settings.backgroundNone')}
          >
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void handlePickBackground()}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--hairline)] bg-[var(--hover-bg)] px-2.5 text-[12.5px] text-2 transition-colors hover:text-1"
              >
                <Icon name="folder" size={13} />
                {t('settings.backgroundPick')}
              </button>
              <button
                type="button"
                disabled={!settings.backgroundPath}
                onClick={() => void clearBackground()}
                className="flex h-8 items-center rounded-lg border border-[var(--hairline)] bg-[var(--hover-bg)] px-2.5 text-[12.5px] text-2 transition-colors hover:text-1 disabled:opacity-40"
              >
                {t('settings.backgroundClear')}
              </button>
            </div>
          </Row>

          )}

          {settings.backgroundMode === 'custom' && (
            <Row label={t('settings.backgroundDim')}>
              <Slider
                value={settings.backgroundDim}
                min={0}
                max={80}
                suffix={t('common.percent')}
                onChange={(backgroundDim) => patch({ backgroundDim })}
              />
            </Row>
          )}

          {settings.backgroundMode === 'builtin' && (
            <Row label={t('settings.bgAnim')} hint={t('settings.bgAnimHint')}>
              <Switch
                checked={settings.backgroundAnimation}
                label={t('settings.bgAnim')}
                onChange={(backgroundAnimation) => patch({ backgroundAnimation })}
              />
            </Row>
          )}
        </Section>

        <Section title={t('settings.launch')}>
          <Row label={t('settings.source')}>
            <Segmented
              id="source"
              value={settings.downloadSource}
              onChange={(downloadSource) => patch({ downloadSource })}
              options={[
                { value: 'official', label: t('settings.source.official') },
                { value: 'bmclapi', label: t('settings.source.bmclapi') }
              ]}
            />
          </Row>
          <Row label={t('settings.curseforgeKey')} hint={t('settings.curseforgeKeyHint')}>
            <input
              type="password"
              key={settings.curseforgeApiKey ?? ''}
              defaultValue={settings.curseforgeApiKey ?? ''}
              onBlur={(event) => patch({ curseforgeApiKey: event.target.value.trim() || null })}
              placeholder="x-api-key"
              className="h-9 w-[260px] rounded-lg border border-[var(--hairline)] bg-[var(--hover-bg)] px-2.5 text-[12px] text-1 outline-none placeholder:text-3 focus:border-accent/50"
            />
          </Row>
          <Row label={t('settings.memory')}>
            <Slider
              value={settings.defaultMemoryMb}
              min={MEMORY_RANGE.min}
              max={MEMORY_RANGE.max}
              step={MEMORY_RANGE.step}
              suffix={t('common.mb')}
              onChange={(defaultMemoryMb) => patch({ defaultMemoryMb })}
            />
          </Row>
        </Section>

        <Section title={t('settings.java')}>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={scanning}
              onClick={() => void detectJava()}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-3 text-[12.5px] font-medium accent-text transition-colors hover:bg-accent/15 disabled:opacity-50"
            >
              <Icon name="search" size={13} />
              {scanning ? t('settings.javaScanning') : t('settings.javaScan')}
            </button>
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-3">
              {settings.defaultJavaPath ?? t('settings.javaAuto')}
            </span>
            {settings.defaultJavaPath && (
              <button
                type="button"
                onClick={() => void patch({ defaultJavaPath: null })}
                className="h-8 shrink-0 rounded-lg border border-[var(--hairline)] px-2.5 text-[12px] text-2 transition-colors hover:text-1"
              >
                {t('settings.javaReset')}
              </button>
            )}
          </div>

          {/* 1.21 需要 Java 21，机器上没有就一键拉一个 */}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={downloading !== null}
              onClick={() => void downloadJava(21)}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-[var(--hairline)] bg-[var(--hover-bg)] px-3 text-[12.5px] text-2 transition-colors hover:text-1 disabled:opacity-50"
            >
              <Icon name="download" size={13} />
              {downloading === 21 ? t('settings.javaDownloading') : t('settings.javaDownload')}
            </button>
            <span className="text-[11.5px] text-3">{t('settings.javaDownloadHint')}</span>
          </div>

          {scanned && (
            <div className="mt-2 flex flex-col gap-1">
              {found.length === 0 ? (
                <p className="px-1 py-2 text-[12px] text-3">{t('settings.javaNone')}</p>
              ) : (
                found.map((item) => {
                  const active = item.path === settings.defaultJavaPath
                  return (
                    <button
                      key={item.path}
                      type="button"
                      onClick={() => void patch({ defaultJavaPath: item.path })}
                      className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                        active
                          ? 'border-accent/45 bg-accent/10'
                          : 'border-[var(--hairline)] hover:bg-[var(--hover-bg)]'
                      }`}
                    >
                      <span className="w-[52px] shrink-0 text-[12px] font-medium text-1">
                        {item.major > 0 ? `Java ${item.major}` : t('settings.javaUnknown')}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[11.5px] text-3">{item.path}</span>
                      {item.arch && <span className="shrink-0 text-[11px] text-3">{item.arch}</span>}
                      {active && <Icon name="check" size={12} className="shrink-0 accent-text" />}
                    </button>
                  )
                })
              )}
            </div>
          )}
        </Section>

        <Section title={t('settings.language')}>
          <Row label={t('settings.uiLanguage')}>
            <Segmented
              id="locale"
              value={settings.locale}
              onChange={(locale) => patch({ locale })}
              options={[
                { value: 'zh-CN', label: '简体中文' },
                { value: 'en', label: 'English' }
              ]}
            />
          </Row>
        </Section>

        <Section title={t('settings.about')}>
          <Row
            label={t('app.name')}
            hint={t('settings.aboutBody', {
              version: info?.version ?? '0.1.0',
              electron: info?.electron ?? '-',
              chrome: info?.chrome ?? '-'
            })}
          >
            <button
              type="button"
              onClick={() => patch(DEFAULT_SETTINGS)}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--hairline)] bg-[var(--hover-bg)] px-2.5 text-[12.5px] text-2 transition-colors hover:text-1"
            >
              <Icon name="restore" size={13} />
              {t('settings.reset')}
            </button>
          </Row>
        </Section>
      </div>
    </div>
  )
}
