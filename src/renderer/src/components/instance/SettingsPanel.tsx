import { useState } from 'react'
import type { CSSProperties } from 'react'
import { MEMORY_RANGE, type Instance } from '@shared/types'
import { useAppStore } from '@renderer/store/app-store'
import { Icon } from '../Icon'
import { InstanceTile, invalidateIcon } from '../InstanceIcon'

function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[12.5px] text-3">{label}</span>
        {hint && <span className="text-[11.5px] text-3 opacity-80">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

export function SettingsPanel({ instance }: { instance: Instance }): JSX.Element {
  const t = useAppStore((state) => state.t)
  const updateInstance = useAppStore((state) => state.updateInstance)
  const reloadInstances = useAppStore((state) => state.reloadInstances)
  const notify = useAppStore((state) => state.notify)

  const [name, setName] = useState(instance.name)
  const [jvmArgs, setJvmArgs] = useState(instance.jvmArgs ?? '')
  const [includeSaves, setIncludeSaves] = useState(false)
  const [exporting, setExporting] = useState(false)

  const isolated = instance.isolated ?? true
  const percent = ((instance.memoryMb - MEMORY_RANGE.min) / (16384 - MEMORY_RANGE.min)) * 100
  const trackStyle = {
    '--track-fill': `linear-gradient(90deg, var(--accent) ${percent}%, color-mix(in srgb, var(--text-3) 30%, transparent) ${percent}%)`
  } as CSSProperties

  const commitName = (): void => {
    const next = name.trim()
    if (!next || next === instance.name) {
      setName(instance.name)
      return
    }
    void updateInstance(instance.id, { name: next })
  }

  const handlePickIcon = async (): Promise<void> => {
    const result = await window.ferry.pickInstanceIcon(instance.id)
    if (result.ok) {
      invalidateIcon(result.path)
      await reloadInstances()
    } else if (result.reason === 'too-large') {
      notify('error', t('instance.iconTooLarge'))
    } else if (result.reason === 'unsupported') {
      notify('error', t('instance.iconUnsupported'))
    }
  }

  const handleClearIcon = async (): Promise<void> => {
    if (instance.icon) invalidateIcon(instance.icon)
    await window.ferry.clearInstanceIcon(instance.id)
    await reloadInstances()
  }

  const handleExport = async (): Promise<void> => {
    setExporting(true)
    try {
      const result = await window.ferry.exportInstance(instance.id, includeSaves)
      if (result.ok) {
        notify('success', t('instance.exported', { path: result.path }))
      } else if (result.reason === 'empty') {
        notify('error', t('instance.exportEmpty'))
      } else if (result.reason === 'error') {
        notify('error', result.message ?? t('home.importReadError', { message: '' }))
      }
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <Field label={t('instance.name')}>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
          maxLength={48}
          className="h-9 w-full max-w-[320px] rounded-lg border border-[var(--hairline)] bg-[var(--hover-bg)] px-3 text-[13px] text-1 outline-none transition-colors focus:border-accent/60"
        />
      </Field>

      <Field label={t('settings.memory')} hint={`${instance.memoryMb} ${t('common.mb')}`}>
        <div className="w-[320px] max-w-full">
          <input
            type="range"
            className="slider"
            min={MEMORY_RANGE.min}
            max={16384}
            step={MEMORY_RANGE.step}
            value={instance.memoryMb}
            style={trackStyle}
            onChange={(event) =>
              void updateInstance(instance.id, { memoryMb: Number(event.target.value) })
            }
            aria-label={t('settings.memory')}
          />
        </div>
      </Field>

      <Field label={t('instance.icon')} hint={t('instance.iconHint')}>
        <div className="flex items-center gap-2.5">
          <InstanceTile instance={instance} size={40} radius={8} />
          <button
            type="button"
            onClick={() => void handlePickIcon()}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--hairline)] bg-[var(--hover-bg)] px-2.5 text-[12.5px] text-2 transition-colors hover:text-1"
          >
            <Icon name="import" size={13} />
            {t('instance.iconPick')}
          </button>
          <button
            type="button"
            disabled={!instance.icon}
            onClick={() => void handleClearIcon()}
            className="flex h-8 items-center rounded-lg border border-[var(--hairline)] bg-[var(--hover-bg)] px-2.5 text-[12.5px] text-2 transition-colors hover:text-1 disabled:opacity-40"
          >
            {t('instance.iconReset')}
          </button>
        </div>
      </Field>

      <Field label={t('instance.java')}>
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 max-w-[320px] flex-1 truncate rounded-lg border border-[var(--hairline)] bg-[var(--hover-bg)] px-3 py-2 text-[12.5px] text-2">
            {instance.javaPath ?? t('home.javaAuto')}
          </span>
          <button
            type="button"
            onClick={async () => {
              const picked = await window.ferry.pickJava()
              if (picked) void updateInstance(instance.id, { javaPath: picked })
            }}
            className="flex h-8 items-center rounded-lg border border-[var(--hairline)] bg-[var(--hover-bg)] px-2.5 text-[12.5px] text-2 transition-colors hover:text-1"
          >
            {t('instance.javaPick')}
          </button>
          <button
            type="button"
            disabled={!instance.javaPath}
            onClick={() => void updateInstance(instance.id, { javaPath: null })}
            className="flex h-8 items-center rounded-lg border border-[var(--hairline)] bg-[var(--hover-bg)] px-2.5 text-[12.5px] text-2 transition-colors hover:text-1 disabled:opacity-40"
          >
            {t('instance.javaReset')}
          </button>
        </div>
      </Field>

      <Field label={t('instance.jvmArgs')} hint={t('instance.jvmArgsHint')}>
        <textarea
          value={jvmArgs}
          onChange={(event) => setJvmArgs(event.target.value)}
          onBlur={() => void updateInstance(instance.id, { jvmArgs })}
          rows={3}
          spellCheck={false}
          className="w-full max-w-[520px] resize-none rounded-lg border border-[var(--hairline)] bg-[var(--hover-bg)] px-3 py-2 text-[12.5px] leading-relaxed text-1 outline-none transition-colors focus:border-accent/60"
          style={{ fontFamily: "'Inter Variable', ui-monospace, monospace" }}
        />
      </Field>

      <Field label={t('instance.isolation')}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={isolated}
            onClick={() => void updateInstance(instance.id, { isolated: !isolated })}
            className={`relative h-[24px] w-[42px] rounded-full border transition-colors duration-200 ${
              isolated ? 'border-accent/50 bg-accent/85' : 'border-[var(--hairline)] bg-[var(--active-bg)]'
            }`}
          >
            <span
              className="absolute top-[3px] h-[16px] w-[16px] rounded-full bg-white shadow-sm transition-[left] duration-200"
              style={{ left: isolated ? 22 : 3 }}
            />
          </button>
          <span className="text-[12.5px] text-2">
            {isolated ? t('common.on') : t('common.off')}
          </span>
        </div>
      </Field>

      <div className="mt-2 border-t border-[var(--hairline)] pt-4">
        <div className="flex items-baseline gap-2">
          <span className="text-[12.5px] text-3">{t('instance.export')}</span>
          <span className="text-[11.5px] text-3 opacity-80">{t('instance.exportHint')}</span>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px] text-2">
            <input
              type="checkbox"
              checked={includeSaves}
              onChange={(event) => setIncludeSaves(event.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            {t('instance.exportSaves')}
          </label>
          <button
            type="button"
            disabled={exporting}
            onClick={() => void handleExport()}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-3 text-[12.5px] font-medium accent-text transition-colors hover:bg-accent/15 disabled:opacity-50"
          >
            <Icon name="download" size={13} />
            {t('instance.export')}
          </button>
        </div>
      </div>
    </div>
  )
}
