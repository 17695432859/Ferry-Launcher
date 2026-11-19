import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { Instance, ModEntry } from '@shared/types'
import { LOADER_LABEL_KEYS } from '@renderer/lib/labels'
import { useAppStore } from '@renderer/store/app-store'
import { Icon } from '../Icon'

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function ModPanel({ instance }: { instance: Instance }): JSX.Element {
  const t = useAppStore((state) => state.t)
  const notify = useAppStore((state) => state.notify)
  const [mods, setMods] = useState<ModEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setMods(await window.ferry.listMods(instance.id))
    } finally {
      setLoading(false)
    }
  }, [instance.id])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleToggle = async (mod: ModEntry): Promise<void> => {
    setBusy(mod.fileName)
    try {
      setMods(await window.ferry.toggleMod(instance.id, mod.fileName, !mod.enabled))
    } finally {
      setBusy(null)
    }
  }

  const handleDelete = async (mod: ModEntry): Promise<void> => {
    setBusy(mod.fileName)
    try {
      setMods(await window.ferry.deleteMod(instance.id, mod.fileName))
      notify('info', t('mods.deleted'))
    } catch {
      notify('error', t('mods.deleteFailed'))
    } finally {
      setBusy(null)
    }
  }

  const handleImport = async (): Promise<void> => {
    const result = await window.ferry.importMods(instance.id)
    if (result.cancelled) return
    await refresh()
    if (result.added > 0) {
      notify('success', t('mods.imported', { added: result.added, skipped: result.skipped }))
    } else {
      notify('info', t('mods.imported', { added: 0, skipped: result.skipped }))
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-5 py-3">
        <span className="text-[12.5px] tnum text-3">{t('mods.count', { count: mods.length })}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void refresh()}
            title={t('mods.refresh')}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--hairline)] bg-[var(--hover-bg)] text-3 transition-colors hover:text-1"
          >
            <Icon name="restore" size={13} />
          </button>
          <button
            type="button"
            onClick={() => void window.ferry.revealInstance(instance.id, 'mods')}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--hairline)] bg-[var(--hover-bg)] px-2.5 text-[12.5px] text-2 transition-colors hover:text-1"
          >
            <Icon name="folder" size={13} />
            {t('mods.openFolder')}
          </button>
          <button
            type="button"
            onClick={() => void handleImport()}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-2.5 text-[12.5px] font-medium accent-text transition-colors hover:bg-accent/15"
          >
            <Icon name="import" size={13} />
            {t('mods.import')}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {loading ? (
          <div className="flex h-24 items-center justify-center text-[12.5px] text-3">···</div>
        ) : mods.length === 0 ? (
          <div className="mt-6 flex flex-col items-center gap-2 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--hairline)] bg-[var(--hover-bg)]">
              <Icon name="cube" size={18} className="text-3" />
            </div>
            <p className="text-[13.5px] text-1">{t('mods.empty')}</p>
            <p className="max-w-[280px] text-[12.5px] leading-relaxed text-3">{t('mods.emptyHint')}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <AnimatePresence initial={false}>
              {mods.map((mod) => (
                <motion.div
                  key={mod.fileName}
                  layout
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: mod.enabled ? 1 : 0.55, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ type: 'spring', stiffness: 180, damping: 20 }}
                  className="flex items-center gap-2.5 rounded-lg border border-[var(--hairline)] bg-[var(--hover-bg)] px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium text-1">{mod.displayName}</span>
                      {!mod.enabled && (
                        <span className="shrink-0 rounded bg-[var(--active-bg)] px-1 py-px text-[10.5px] text-3">
                          {t('mods.disabled')}
                        </span>
                      )}
                    </div>
                    <div
                      className="mt-0.5 flex items-center gap-2 text-[11.5px] text-3"
                      title={mod.description ?? undefined}
                    >
                      <span className="truncate">
                        {mod.version ?? t('mods.unknownVersion')}
                        {mod.loader ? ` · ${t(LOADER_LABEL_KEYS[mod.loader])}` : ''}
                      </span>
                      <span className="tnum">{formatSize(mod.sizeBytes)}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={mod.enabled}
                    disabled={busy === mod.fileName}
                    onClick={() => void handleToggle(mod)}
                    className={`relative h-[22px] w-[38px] shrink-0 rounded-full border transition-colors duration-200 ${
                      mod.enabled ? 'border-accent/50 bg-accent/85' : 'border-[var(--hairline)] bg-[var(--active-bg)]'
                    }`}
                  >
                    <motion.span
                      layout
                      transition={{ type: 'spring', stiffness: 520, damping: 34 }}
                      className="absolute top-[3px] h-[14px] w-[14px] rounded-full bg-white shadow-sm"
                      style={{ left: mod.enabled ? 20 : 3 }}
                    />
                  </button>

                  <button
                    type="button"
                    title={t('home.remove')}
                    disabled={busy === mod.fileName}
                    onClick={() => void handleDelete(mod)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-3 transition-colors hover:bg-[var(--active-bg)] hover:text-1 disabled:opacity-40"
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  )
}
