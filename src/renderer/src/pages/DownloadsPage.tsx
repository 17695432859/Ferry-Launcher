import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { InstallProgress, LoaderVersion, VersionSummary } from '@shared/types'
import type { TranslationKey } from '@shared/i18n'
import { useAppStore } from '@renderer/store/app-store'
import { ModDownloadPanel } from './ModDownloadsPage'
import { Icon } from '../components/Icon'
import { Select } from '../components/Select'

const LOADERS = [
  { id: 'vanilla', label: '原版' },
  { id: 'fabric', label: 'Fabric' },
  { id: 'forge', label: 'Forge' },
  { id: 'neoforge', label: 'NeoForge' },
  { id: 'quilt', label: 'Quilt' }
] as const

const STAGE_KEYS: Record<string, string> = {
  manifest: 'downloads.stage.manifest',
  client: 'downloads.stage.client',
  libraries: 'downloads.stage.libraries',
  assets: 'downloads.stage.assets',
  loader: 'downloads.stage.loader',
  done: 'downloads.stage.done'
}

export function DownloadsPage(): JSX.Element {
  const t = useAppStore((state) => state.t)
  const notify = useAppStore((state) => state.notify)
  const settings = useAppStore((state) => state.settings)
  const info = useAppStore((state) => state.info)
  const importInstanceList = useAppStore((state) => state.reloadInstances)

  const [versions, setVersions] = useState<VersionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'release' | 'snapshot' | 'all'>('release')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<VersionSummary | null>(null)
  const [tab, setTab] = useState<'versions' | 'mods'>('versions')

  const [loader, setLoader] = useState<string>('vanilla')
  const [loaderVersion, setLoaderVersion] = useState('')
  const [loaderVersions, setLoaderVersions] = useState<LoaderVersion[]>([])
  const [name, setName] = useState('')
  const [dir, setDir] = useState('')

  const [installing, setInstalling] = useState(false)
  const [progress, setProgress] = useState<InstallProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const disposeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    void window.ferry.versions
      .manifest(settings.downloadSource)
      .then((list) => {
        if (alive) setVersions(list)
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [settings.downloadSource])

  useEffect(() => {
    if (!selected) return
    setDir(`${info?.dataDir ?? ''}\\game\\${selected.id}`)
    setName(`${selected.id} · ${loader}`)
  }, [selected, info?.dataDir, loader])

  useEffect(() => {
    if (!selected || (loader !== 'fabric' && loader !== 'quilt')) {
      setLoaderVersions([])
      setLoaderVersion('')
      return
    }
    let alive = true
    void window.ferry.versions
      .loaders(selected.id, loader)
      .then((list) => {
        if (!alive) return
        setLoaderVersions(list)
        setLoaderVersion(list.find((item) => item.stable)?.version ?? list[0]?.version ?? '')
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [selected, loader])

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return versions
      .filter((item) => (filter === 'all' ? true : item.kind === filter))
      .filter((item) => (keyword ? item.id.toLowerCase().includes(keyword) : true))
      .slice(0, 200)
  }, [versions, filter, search])

  const startInstall = async (): Promise<void> => {
    if (!selected) return
    setInstalling(true)
    setError(null)
    setProgress({ stage: 'manifest', detail: '', current: 0, total: 1 })
    disposeRef.current = window.ferry.versions.onProgress((next) => setProgress(next))
    try {
      const outcome = await window.ferry.versions.install({
        mcVersion: selected.id,
        loader,
        loaderVersion: loader === 'vanilla' ? null : loaderVersion,
        gameDir: dir,
        source: settings.downloadSource,
        javaPath: null
      })
      if (!outcome.ok) {
        setError(
          outcome.reason === 'no-java' ? t('downloads.noJava') : t('downloads.failed', { message: outcome.message })
        )
        return
      }
      const created = await window.ferry.createInstance({
        name: name.trim() || selected.id,
        mcVersion: selected.id,
        loader,
        loaderVersion: loader === 'vanilla' ? null : loaderVersion,
        gameDir: dir,
        versionId: outcome.versionId
      })
      if (created.ok) {
        await importInstanceList()
        notify('success', t('downloads.done'))
      }
    } finally {
      disposeRef.current?.()
      disposeRef.current = null
      setInstalling(false)
    }
  }

  const percent =
    progress && progress.total > 0 ? Math.min(100, (progress.current / progress.total) * 100) : 0

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
      <header className="mx-auto max-w-[1120px] px-1 pb-3">
        <h1 className="text-[19px] font-semibold tracking-tight text-1">{t('downloads.title')}</h1>
        <p className="mt-0.5 text-[12.5px] text-2">{t('downloads.subtitle')}</p>
        <div className="mt-3 inline-flex items-center gap-0.5 rounded-lg bg-[var(--active-bg)] p-0.5">
          {(['versions', 'mods'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className={`relative rounded-[6px] px-3 py-1.5 text-[12px] transition-colors ${
                tab === item ? 'text-1' : 'text-3 hover:text-2'
              }`}
            >
              {tab === item && (
                <motion.span
                  layoutId="downloads-tab"
                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                  className="absolute inset-0 rounded-[6px] bg-[var(--panel)] shadow-sm"
                />
              )}
              <span className="relative">{t(item === 'versions' ? 'downloads.tab.versions' : 'downloads.tab.mods')}</span>
            </button>
          ))}
        </div>
      </header>

      {tab === 'mods' ? (
        <ModDownloadPanel />
      ) : (
      <div className="mx-auto grid max-w-[1040px] grid-cols-[minmax(0,1fr)_300px] gap-3">
        {/* 版本列表 */}
        <div className="glass flex min-h-[420px] flex-col overflow-hidden rounded-panel">
          <div className="flex items-center gap-2 border-b border-[var(--hairline)] px-3 py-2.5">
            <div className="relative flex-1">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('downloads.search')}
                className="input pl-8"
              />
              <Icon
                name="search"
                size={13}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-3"
              />
            </div>
            <div className="flex items-center gap-1 rounded-lg bg-[var(--active-bg)] p-0.5">
              {(['release', 'snapshot', 'all'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setFilter(item)}
                  className={`relative rounded-[6px] px-2 py-1 text-[12px] transition-colors ${
                    filter === item ? 'text-1' : 'text-3 hover:text-2'
                  }`}
                >
                  {filter === item && (
                    <motion.span
                      layoutId="version-filter"
                      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                      className="absolute inset-0 rounded-[6px] bg-[var(--panel)] shadow-sm"
                    />
                  )}
                  <span className="relative">{t(`downloads.filter.${item}` as TranslationKey)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {loading ? (
              <p className="py-10 text-center text-[12.5px] text-3">···</p>
            ) : filtered.length === 0 ? (
              <p className="py-10 text-center text-[12.5px] text-3">{t('downloads.emptyList')}</p>
            ) : (
              <div className="grid grid-cols-2 gap-1">
                {filtered.map((item) => {
                  const active = item.id === selected?.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelected(item)}
                      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                        active
                          ? 'border-accent/45 bg-accent/8'
                          : 'border-transparent hover:bg-[var(--hover-bg)]'
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-1">{item.id}</span>
                      {item.kind !== 'release' && (
                        <span className="shrink-0 rounded bg-[var(--active-bg)] px-1 py-px text-[10px] text-3">
                          {item.kind}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* 安装配置：不跟着左边列表拉满高度，按钮就紧跟在目录后面 */}
        <div className="glass flex flex-col gap-2.5 self-start rounded-panel p-4">
          <div className="text-[13px] font-medium text-1">
            {selected ? selected.id : t('downloads.version')}
          </div>

          <div className="flex flex-wrap gap-1">
            {LOADERS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setLoader(item.id)}
                className={`rounded-md border px-2 py-1 text-[11.5px] transition-colors ${
                  loader === item.id
                    ? 'border-accent/45 bg-accent/12 accent-text'
                    : 'border-[var(--hairline)] text-3 hover:text-1'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {loader !== 'vanilla' && (
            <label className="flex flex-col gap-1">
              <span className="text-[11.5px] text-3">{t('downloads.loaderVersion')}</span>
              {loaderVersions.length > 0 ? (
                <Select
                  value={loaderVersion}
                  onChange={setLoaderVersion}
                  placeholder={t('downloads.loaderVersion')}
                  options={loaderVersions.map((item) => ({
                    value: item.version,
                    label: item.version,
                    hint: item.stable ? undefined : 'beta'
                  }))}
                />
              ) : (
                <input
                  value={loaderVersion}
                  onChange={(event) => setLoaderVersion(event.target.value)}
                  placeholder={t('downloads.loaderHint', {
                    example: loader === 'neoforge' ? '21.1.72' : '47.2.0'
                  })}
                  className="input"
                />
              )}
            </label>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-[11.5px] text-3">{t('downloads.name')}</span>
            <input value={name} onChange={(event) => setName(event.target.value)} className="input" />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11.5px] text-3">{t('downloads.target')}</span>
            <div className="flex gap-1.5">
              <input value={dir} onChange={(event) => setDir(event.target.value)} className="input" />
              <button
                type="button"
                onClick={async () => {
                  const picked = await window.ferry.pickFolder(t('downloads.target'))
                  if (picked) setDir(picked)
                }}
                className="h-[34px] shrink-0 rounded-lg border border-[var(--hairline)] px-2 text-[12px] text-2 hover:text-1"
              >
                {t('downloads.pickDir')}
              </button>
            </div>
          </label>

          <AnimatePresence>
            {installing && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-1 flex items-center justify-between text-[11.5px] text-2">
                  <span>{t((STAGE_KEYS[progress?.stage ?? 'manifest'] ?? 'downloads.installing') as TranslationKey)}</span>
                  <span className="tnum text-3">{percent.toFixed(0)}%</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--active-bg)]">
                  <motion.div
                    className="h-full rounded-full bg-accent"
                    animate={{ width: `${percent}%` }}
                    transition={{ duration: 0.2 }}
                  />
                </div>
                {progress?.detail && (
                  <p className="mt-1 truncate text-[11px] text-3">{progress.detail}</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {error && (
            <p className="break-all rounded-lg bg-[#c2455e]/12 px-2.5 py-2 text-[11.5px] leading-relaxed text-[#c2455e]">
              {error}
            </p>
          )}

          <div className="mt-1 flex gap-1.5">
            {installing ? (
              <button
                type="button"
                onClick={() => void window.ferry.versions.cancel()}
                className="h-9 flex-1 rounded-lg border border-[var(--hairline)] text-[13px] text-2 hover:text-1"
              >
                {t('downloads.cancel')}
              </button>
            ) : (
              <button
                type="button"
                disabled={!selected || !dir}
                onClick={() => void startInstall()}
                className="h-9 flex-1 rounded-lg bg-accent text-[13px] font-medium text-[var(--accent-ink)] disabled:opacity-45"
              >
                {t('downloads.install')}
              </button>
            )}
          </div>
        </div>
      </div>
      )}
    </div>
  )
}
