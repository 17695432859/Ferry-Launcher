import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { ContentItem, Instance, ModInstallProgress, ModSearchHit } from '@shared/types'
import { LOADER_LABEL_KEYS } from '@renderer/lib/labels'
import { useAppStore } from '@renderer/store/app-store'
import { Icon } from '../Icon'

function formatCount(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  return String(value)
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(value / 1024))} KB`
}

interface Props {
  instance: Instance
  onClose: () => void
  onInstalled: (items: ContentItem[], title: string) => void
}

export function ModBrowser({ instance, onClose, onInstalled }: Props): JSX.Element {
  const t = useAppStore((state) => state.t)
  const notify = useAppStore((state) => state.notify)
  const curseforgeKey = useAppStore((state) => state.settings.curseforgeApiKey)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ModSearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [progress, setProgress] = useState<ModInstallProgress | null>(null)

  useEffect(
    () =>
      window.ferry.onModInstallProgress((event) => {
        if (event.instanceId === instance.id) setProgress(event)
      }),
    [instance.id]
  )

  const runSearch = useCallback(
    async (text: string): Promise<void> => {
      setSearching(true)
      try {
        setHits(await window.ferry.searchMods(instance.id, text, 24))
      } catch {
        setHits([])
      } finally {
        setSearching(false)
      }
    },
    [instance.id]
  )

  useEffect(() => {
    void runSearch('')
  }, [runSearch])

  const handleInstall = async (hit: ModSearchHit): Promise<void> => {
    if (installing) return
    setInstalling(hit.projectId)
    setProgress({ instanceId: instance.id, projectId: hit.projectId, phase: 'resolve', received: 0, total: 0 })
    try {
      const items = await window.ferry.downloadMod(instance.id, hit.projectId)
      notify('success', t('mods.center.installed', { name: hit.title }))
      onInstalled(items, hit.title)
    } catch (error) {
      const message = String(error)
      notify(
        'error',
        message.includes('NO_COMPATIBLE_VERSION')
          ? t('mods.center.noCompatible')
          : t('mods.center.failed')
      )
    } finally {
      setInstalling(null)
      setProgress(null)
    }
  }

  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.received / progress.total) * 100))
      : 0
  const loaderLabel = t(LOADER_LABEL_KEYS[instance.loader])

  return (
    <div className="flex h-full w-[380px] flex-col border-l border-[var(--hairline)] bg-[var(--panel-solid)]">
      <div className="flex items-center gap-2 border-b border-[var(--hairline)] px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-1">{t('mods.center.title')}</div>
          <div className="mt-0.5 truncate text-[11px] text-3">
            {t('mods.center.context', { version: instance.mcVersion, loader: loaderLabel })}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          title={t('mods.center.close')}
          className="flex h-7 w-7 items-center justify-center rounded-md text-3 transition-colors hover:bg-[var(--active-bg)] hover:text-1"
        >
          <Icon name="close" size={13} />
        </button>
      </div>

      <div className="flex items-center gap-1.5 px-3 py-2.5">
        <div className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-3">
            <Icon name="search" size={13} />
          </span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void runSearch(query)
            }}
            placeholder={t('mods.center.search')}
            className="h-8 w-full rounded-lg border border-[var(--hairline)] bg-[var(--hover-bg)] pl-8 pr-2 text-[12px] text-1 outline-none placeholder:text-3 focus:border-accent/50"
          />
        </div>
        <button
          type="button"
          onClick={() => void runSearch(query)}
          disabled={searching}
          className="h-8 shrink-0 rounded-lg border border-accent/40 bg-accent/10 px-2.5 text-[12px] font-medium accent-text disabled:opacity-50"
        >
          {searching ? t('mods.center.searching') : t('mods.download')}
        </button>
      </div>

      <AnimatePresence>
        {installing && progress && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-[var(--hairline)] px-3"
          >
            <div className="py-2 text-[11.5px] text-2">
              {progress.phase === 'resolve'
                ? t('mods.center.resolving')
                : t('mods.center.progress', {
                    received: formatBytes(progress.received),
                    total: progress.total > 0 ? formatBytes(progress.total) : '?'
                  })}
            </div>
            <div className="mb-2 h-1 overflow-hidden rounded-full bg-[var(--active-bg)]">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-150"
                style={{ width: progress.phase === 'resolve' ? '8%' : `${percent}%` }}
              />
            </div>
            <button
              type="button"
              onClick={() => void window.ferry.cancelModDownload()}
              className="mb-2 text-[11px] text-3 underline-offset-2 hover:text-1 hover:underline"
            >
              {t('mods.center.cancel')}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {searching && hits.length === 0 ? (
          <div className="flex h-24 items-center justify-center text-[12px] text-3">
            {t('mods.center.searching')}
          </div>
        ) : hits.length === 0 ? (
          <div className="flex h-24 items-center justify-center text-center text-[12px] text-3">
            {t('mods.center.empty')}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {hits.map((hit) => (
              <div
                key={hit.projectId}
                className="flex items-center gap-2 rounded-lg border border-[var(--hairline)] bg-[var(--hover-bg)] px-2 py-2"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[var(--active-bg)]">
                  {hit.iconUrl ? (
                    <img src={hit.iconUrl} alt="" className="h-9 w-9 object-cover" />
                  ) : (
                    <Icon name="cube" size={15} className="text-3" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => void window.ferry.openUrl(`https://modrinth.com/mod/${hit.slug}`)}
                    className="block max-w-full truncate text-left text-[12.5px] font-medium text-1 hover:accent-text"
                    title={hit.title}
                  >
                    {hit.title}
                  </button>
                  <div className="mt-0.5 truncate text-[10.5px] text-3">
                    {hit.author} · {formatCount(hit.downloads)} {t('mods.center.downloads')}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-2" title={hit.description}>
                    {hit.description}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={installing !== null}
                  onClick={() => void handleInstall(hit)}
                  className="shrink-0 rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-[11.5px] font-medium accent-text disabled:opacity-45"
                >
                  {installing === hit.projectId ? t('mods.center.installing') : t('mods.center.install')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-[var(--hairline)] px-3 py-2 text-center text-[10.5px] text-3">
        {!curseforgeKey && (
          <div className="mb-1 text-[10.5px] text-2">{t('mods.center.curseforgeHint')}</div>
        )}
        {t('mods.center.powered', {
          source: hits[0]?.source === 'curseforge' ? 'CurseForge' : 'Modrinth'
        })}
      </div>
    </div>
  )
}
