import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { DownloadContentType } from '@shared/ipc'
import type { ModInstallProgress, ModSearchHit, VersionSummary } from '@shared/types'
import type { TranslationKey } from '@shared/i18n'
import { useAppStore } from '@renderer/store/app-store'
import { Icon } from '../components/Icon'
import { Select } from '../components/Select'

type Source = 'all' | 'curseforge' | 'modrinth'

const CONTENT_TYPES: { id: DownloadContentType; key: TranslationKey }[] = [
  { id: 'mod', key: 'mods.page.type.mod' },
  { id: 'modpack', key: 'mods.page.type.modpack' },
  { id: 'datapack', key: 'mods.page.type.datapack' },
  { id: 'resourcepack', key: 'mods.page.type.resourcepack' },
  { id: 'shader', key: 'mods.page.type.shader' }
]

const SOURCES: { id: Source; key: TranslationKey }[] = [
  { id: 'all', key: 'mods.page.source.all' },
  { id: 'curseforge', key: 'mods.page.source.curseforge' },
  { id: 'modrinth', key: 'mods.page.source.modrinth' }
]

const LOADERS: { value: string; key: TranslationKey }[] = [
  { value: '', key: 'mods.page.anyLoader' },
  { value: 'fabric', key: 'loader.fabric' },
  { value: 'forge', key: 'loader.forge' },
  { value: 'neoforge', key: 'loader.neoforge' },
  { value: 'quilt', key: 'loader.quilt' }
]

const CATEGORIES: { value: string; key: TranslationKey }[] = [
  { value: '', key: 'mods.page.anyCategory' },
  { value: 'optimization', key: 'mods.page.cat.optimization' },
  { value: 'utility', key: 'mods.page.cat.utility' },
  { value: 'decoration', key: 'mods.page.cat.decoration' },
  { value: 'adventure', key: 'mods.page.cat.adventure' },
  { value: 'library', key: 'mods.page.cat.library' },
  { value: 'worldgen', key: 'mods.page.cat.worldgen' },
  { value: 'world-gen', key: 'mods.page.cat.worldgen' },
  { value: 'technology', key: 'mods.page.cat.technology' },
  { value: 'magic', key: 'mods.page.cat.magic' },
  { value: 'food', key: 'mods.page.cat.food' },
  { value: 'combat', key: 'mods.page.cat.combat' },
  { value: 'storage', key: 'mods.page.cat.storage' },
  { value: 'transportation', key: 'mods.page.cat.transportation' },
  { value: 'misc', key: 'mods.page.cat.misc' }
]

function formatCount(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  return String(value)
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(value / 1024))} KB`
}

function categoryLabel(value: string, t: (key: TranslationKey) => string): string {
  const option = CATEGORIES.find((item) => item.value === value.toLowerCase())
  if (option) return t(option.key)
  return value.replace(/-/g, ' ').replace(/^./, (char) => char.toUpperCase())
}

export function ModDownloadPanel(): JSX.Element {
  const t = useAppStore((state) => state.t)
  const notify = useAppStore((state) => state.notify)
  const settings = useAppStore((state) => state.settings)
  const instances = useAppStore((state) => state.instances)
  const selectedId = useAppStore((state) => state.selectedId)

  const [versions, setVersions] = useState<VersionSummary[]>([])
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<Source>('all')
  const [contentType, setContentType] = useState<DownloadContentType>('mod')
  const [gameVersion, setGameVersion] = useState('')
  const [loader, setLoader] = useState('')
  const [category, setCategory] = useState('')

  const [hits, setHits] = useState<ModSearchHit[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const [selected, setSelected] = useState<ModSearchHit | null>(null)
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [instanceId, setInstanceId] = useState('')
  const [installing, setInstalling] = useState<string | null>(null)
  const [progress, setProgress] = useState<ModInstallProgress | null>(null)

  const queryRef = useRef('')
  const seqRef = useRef(0)
  const listRef = useRef<HTMLDivElement | null>(null)

  // 默认装到当前选中的实例
  useEffect(() => {
    if (!instanceId && selectedId) setInstanceId(selectedId)
  }, [selectedId, instanceId])

  useEffect(() => {
    let alive = true
    void window.ferry.versions
      .manifest(settings.downloadSource)
      .then((list) => {
        if (alive) setVersions(list.filter((item) => item.kind === 'release').slice(0, 80))
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [settings.downloadSource])

  useEffect(
    () =>
      window.ferry.onModInstallProgress((event) => {
        if (installing && event.projectId === installing) setProgress(event)
      }),
    [installing]
  )

  const runSearch = useCallback(
    async (text: string): Promise<void> => {
      const seq = ++seqRef.current
      setSearching(true)
      setError(null)
      try {
        const result = await window.ferry.searchModsGlobal(text, {
          gameVersion,
          loader,
          source,
          category,
          contentType,
          page,
          limit: 24
        })
        if (seq !== seqRef.current) return
        setHits(result.hits)
        setTotal(result.total)
        setSelected((prev) =>
          prev
            ? (result.hits.find((item) => item.projectId === prev.projectId && item.source === prev.source) ?? result.hits[0] ?? null)
            : (result.hits[0] ?? null)
        )
        setSearched(true)
      } catch (cause) {
        if (seq !== seqRef.current) return
        setHits([])
        setTotal(0)
        setSelected(null)
        setSearched(true)
        const message = String(cause)
        setError(message.includes('NO_CURSEFORGE_KEY') ? t('mods.page.noKey') : message)
      } finally {
        if (seq === seqRef.current) setSearching(false)
      }
    },
    [gameVersion, loader, source, category, contentType, page, t]
  )

  // 筛选条件一变就回到第一页重新搜索；关键词按回车或点按钮才生效
  useEffect(() => {
    void runSearch(queryRef.current)
  }, [runSearch])

  // 翻页后回到列表顶部，否则用户还停在上一页的滚动位置
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0
    setPageInput(String(page))
  }, [page])

  // 页码输入框：越界就夹到有效范围
  const commitPageInput = (): void => {
    const parsed = Number.parseInt(pageInput, 10)
    if (!Number.isFinite(parsed)) {
      setPageInput(String(page))
      return
    }
    const next = Math.min(pageCount, Math.max(1, parsed))
    if (next === page) setPageInput(String(page))
    else setPage(next)
  }

  const submitSearch = (text: string): void => {
    queryRef.current = text
    if (page === 1) {
      void runSearch(text)
    } else {
      setPage(1)
    }
  }

  // 任何筛选条件变化都回到第一页，避免出现「翻到第 5 页再改版本」这种空结果
  const changeFilter = <T,>(setter: (value: T) => void) => (value: T): void => {
    setPage(1)
    setter(value)
  }

  const target = useMemo(() => instances.find((item) => item.id === instanceId) ?? null, [instances, instanceId])

  const startInstall = async (): Promise<void> => {
    if (!selected || !target || installing) return
    setInstalling(selected.projectId)
    setProgress({
      instanceId: target.id,
      projectId: selected.projectId,
      phase: 'resolve',
      received: 0,
      total: 0
    })
    try {
      await window.ferry.downloadMod(target.id, selected.projectId, {
        source: selected.source,
        gameVersion: gameVersion || target.mcVersion,
        loader: loader || (target.loader === 'vanilla' ? '' : target.loader),
        contentType
      })
      notify('success', t('mods.center.installed', { name: selected.title }))
    } catch (cause) {
      const message = String(cause)
      notify(
        'error',
        message.includes('NO_COMPATIBLE_VERSION')
          ? t('mods.center.noCompatible')
          : message.includes('NO_CURSEFORGE_KEY')
            ? t('mods.page.noKey')
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

  const noKeyBlocked = selected?.source === 'curseforge' && !settings.curseforgeApiKey
  const pageCount = Math.max(1, Math.ceil(total / 24))
  const canPrev = page > 1 && !searching
  const canNext = page < pageCount && !searching
  const stableVersions = (selected?.versions ?? []).filter((item) => /^\d+\.\d+(\.\d+)?$/.test(item))
  const displayVersions = (stableVersions.length > 0 ? stableVersions : (selected?.versions ?? []))
    .slice(-3)
    .reverse()

  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-3">
      {/* 筛选栏 */}
      <div className="glass mb-3 flex flex-col gap-2 rounded-panel px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-[11px] text-3">{t('mods.page.category')}</span>
          {CONTENT_TYPES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => changeFilter(setContentType)(item.id)}
              className={`rounded-md px-2 py-1 text-[11.5px] transition-colors ${
                contentType === item.id
                  ? 'bg-accent/15 accent-text'
                  : 'text-3 hover:bg-[var(--hover-bg)] hover:text-1'
              }`}
            >
              {t(item.key)}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="relative min-w-[220px] flex-[2]">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-3">
              <Icon name="search" size={13} />
            </span>
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                queryRef.current = event.target.value
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitSearch(queryRef.current)
              }}
              placeholder={t('mods.page.search')}
              className="h-9 w-full rounded-lg border border-[var(--hairline)] bg-[var(--hover-bg)] pl-8 pr-2 text-[12.5px] text-1 outline-none placeholder:text-3 focus:border-accent/50"
            />
          </div>
          <button
            type="button"
            disabled={searching}
            onClick={() => submitSearch(queryRef.current)}
            className="h-9 shrink-0 rounded-lg bg-accent px-3 text-[12.5px] font-medium text-[var(--accent-ink)] disabled:opacity-50"
          >
            {searching ? t('mods.page.searching') : t('mods.page.searchButton')}
          </button>

          <div className="flex h-9 shrink-0 items-center gap-0.5 rounded-lg bg-[var(--active-bg)] p-0.5">
            {SOURCES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => changeFilter(setSource)(item.id)}
                className={`relative h-8 rounded-[6px] px-2.5 text-[12px] transition-colors ${
                  source === item.id ? 'text-1' : 'text-3 hover:text-2'
                }`}
              >
                {source === item.id && (
                  <motion.span
                    layoutId="mod-source-filter"
                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                    className="absolute inset-0 rounded-[6px] bg-[var(--panel)] shadow-sm"
                  />
                )}
                <span className="relative">{t(item.key)}</span>
              </button>
            ))}
          </div>

          <div className="w-[130px] shrink-0">
            <Select
              value={gameVersion}
              onChange={changeFilter(setGameVersion)}
              placeholder={t('mods.page.anyVersion')}
              options={[
                { value: '', label: t('mods.page.anyVersion') },
                ...versions.map((item) => ({ value: item.id, label: item.id }))
              ]}
              maxHeight={300}
            />
          </div>
          {(contentType === 'mod' || contentType === 'modpack') && (
            <div className="w-[116px] shrink-0">
              <Select
                value={loader}
                onChange={changeFilter(setLoader)}
                placeholder={t('mods.page.anyLoader')}
                options={LOADERS.map((item) => ({ value: item.value, label: t(item.key) }))}
              />
            </div>
          )}
          <div className="w-[126px] shrink-0">
            <Select
              value={category}
              onChange={changeFilter(setCategory)}
              placeholder={t('mods.page.anyCategory')}
              options={CATEGORIES.map((item) => ({ value: item.value, label: t(item.key) }))}
            />
          </div>
        </div>
      </div>

        {!settings.curseforgeApiKey && source !== 'modrinth' && (
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-[#e8873c]/10 px-3 py-2 text-[11.5px] text-[#e8873c]">
            <Icon name="alert" size={13} className="shrink-0" />
            <span className="min-w-0 flex-1">{t('mods.page.noKeyHint')}</span>
            <button
              type="button"
              onClick={() => {
                window.location.hash = '#/settings'
              }}
              className="shrink-0 underline underline-offset-2"
            >
              {t('mods.page.settings')}
            </button>
          </div>
        )}

        {error && error !== t('mods.page.noKey') && (
          <div className="mb-3 rounded-lg bg-[#c2455e]/12 px-3 py-2 text-[12px] text-[#c2455e]">
            {error}
          </div>
        )}

        <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-3">
          {/* 搜索结果 */}
          <div className="glass flex max-h-[calc(100vh-320px)] min-h-[340px] flex-col overflow-hidden rounded-panel">
            <div className="flex items-center justify-between border-b border-[var(--hairline)] px-3 py-2">
              <span className="text-[12px] text-2">
                {searched && total > 0 ? t('mods.page.found', { count: total }) : t('mods.page.title')}
              </span>
              {source === 'all' && !settings.curseforgeApiKey && (
                <span className="text-[10.5px] text-3">{t('mods.page.powered', { source: 'Modrinth' })}</span>
              )}
            </div>

            <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {searching && hits.length === 0 ? (
                <p className="py-12 text-center text-[12.5px] text-3">{t('mods.page.searching')}</p>
              ) : !searched ? (
                <p className="py-12 text-center text-[12.5px] text-3">{t('mods.page.idle')}</p>
              ) : hits.length === 0 ? (
                <p className="py-12 text-center text-[12.5px] text-3">{t('mods.page.empty')}</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {hits.map((hit) => {
                    const active = selected?.projectId === hit.projectId && selected?.source === hit.source
                    return (
                      <button
                        key={`${hit.source}:${hit.projectId}`}
                        type="button"
                        onClick={() => setSelected(hit)}
                        className={`flex w-full items-center gap-2.5 rounded-lg border px-2 py-2 text-left transition-colors ${
                          active
                            ? 'border-accent/45 bg-accent/8'
                            : 'border-transparent hover:bg-[var(--hover-bg)]'
                        }`}
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--active-bg)]">
                          {hit.iconUrl ? (
                            <img src={hit.iconUrl} alt="" className="h-10 w-10 object-cover" />
                          ) : (
                            <Icon name="cube" size={16} className="text-3" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-[12.5px] font-medium text-1" title={hit.title}>
                              {hit.title}
                            </span>
                            <span
                              className={`shrink-0 rounded px-1 py-px text-[9.5px] ${
                                hit.source === 'curseforge'
                                  ? 'bg-[#e8873c]/15 text-[#e8873c]'
                                  : 'bg-[#ce6aed]/15 text-[#ce6aed]'
                              }`}
                            >
                              {hit.source === 'curseforge' ? 'CF' : 'MR'}
                            </span>
                          </div>
                          <div className="mt-0.5 truncate text-[10.5px] text-3">
                            {hit.author} · {formatCount(hit.downloads)} {t('mods.page.downloads')}
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-2" title={hit.description}>
                            {hit.description}
                          </div>
                        </div>
                        <Icon name="chevron" size={12} className="shrink-0 rotate-90 text-3" />
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* 分页：24 条一页，支持逐页翻和直接跳页 */}
            {searched && total > 24 && (
              <div className="flex items-center justify-center gap-1.5 border-t border-[var(--hairline)] px-3 py-2">
                <button
                  type="button"
                  disabled={!canPrev}
                  onClick={() => setPage(1)}
                  title={t('mods.page.first')}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--hairline)] text-2 transition-colors hover:text-1 disabled:opacity-35"
                >
                  <Icon name="chevron" size={11} className="rotate-180" />
                  <Icon name="chevron" size={11} className="-ml-1.5 rotate-180" />
                </button>
                <button
                  type="button"
                  disabled={!canPrev}
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  className="flex h-7 items-center gap-0.5 rounded-md border border-[var(--hairline)] px-1.5 text-[11.5px] text-2 transition-colors hover:text-1 disabled:opacity-35"
                >
                  <Icon name="chevron" size={11} className="rotate-180" />
                  {t('mods.page.prev')}
                </button>

                <span className="flex items-center gap-1 text-[11.5px] text-3">
                  {t('mods.page.pageLabel')}
                  <input
                    value={pageInput}
                    onChange={(event) => setPageInput(event.target.value.replace(/[^\d]/g, ''))}
                    onBlur={() => commitPageInput()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitPageInput()
                    }}
                    className="tnum h-7 w-12 rounded-md border border-[var(--hairline)] bg-[var(--hover-bg)] text-center text-[11.5px] text-1 outline-none focus:border-accent/50"
                  />
                  <span className="tnum">/ {pageCount}</span>
                </span>

                <button
                  type="button"
                  disabled={!canNext}
                  onClick={() => setPage((prev) => Math.min(pageCount, prev + 1))}
                  className="flex h-7 items-center gap-0.5 rounded-md border border-[var(--hairline)] px-1.5 text-[11.5px] text-2 transition-colors hover:text-1 disabled:opacity-35"
                >
                  {t('mods.page.next')}
                  <Icon name="chevron" size={11} />
                </button>
                <button
                  type="button"
                  disabled={!canNext}
                  onClick={() => setPage(pageCount)}
                  title={t('mods.page.last')}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--hairline)] text-2 transition-colors hover:text-1 disabled:opacity-35"
                >
                  <Icon name="chevron" size={11} />
                  <Icon name="chevron" size={11} className="-ml-1.5" />
                </button>
              </div>
            )}
          </div>

          {/* 详情与安装 */}
          <div className="glass flex flex-col gap-2.5 self-start rounded-panel p-4">
            {selected ? (
              <>
                <div className="flex items-start gap-2.5">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[var(--active-bg)]">
                    {selected.iconUrl ? (
                      <img src={selected.iconUrl} alt="" className="h-12 w-12 object-cover" />
                    ) : (
                      <Icon name="cube" size={20} className="text-3" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold leading-tight text-1" title={selected.title}>
                      {selected.title}
                    </div>
                    <div className="mt-1 truncate text-[11px] text-3">
                      {selected.author} · {formatCount(selected.downloads)} {t('mods.page.downloads')}
                    </div>
                  </div>
                  <button
                    type="button"
                    title={t('mods.page.openHome')}
                    onClick={() =>
                      void window.ferry.openUrl(
                        selected.source === 'curseforge'
                          ? `https://www.curseforge.com/minecraft/${
                              contentType === 'mod' ? 'mc-mods' : contentType === 'resourcepack' ? 'texture-packs' : `${contentType}s`
                            }/${selected.slug}`
                          : `https://modrinth.com/${contentType}/${selected.slug}`
                      )
                    }
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-3 transition-colors hover:bg-[var(--active-bg)] hover:text-1"
                  >
                    <Icon name="import" size={13} />
                  </button>
                </div>

                <p className="max-h-[96px] overflow-y-auto text-[11.5px] leading-relaxed text-2">
                  {selected.description || '—'}
                </p>

                <div className="flex flex-wrap gap-1">
                  {selected.categories.slice(0, 6).map((item) => (
                    <span
                      key={item}
                      className="rounded-md bg-[var(--active-bg)] px-1.5 py-0.5 text-[10.5px] text-2"
                    >
                      {categoryLabel(item, t)}
                    </span>
                  ))}
                </div>

                <div className="flex flex-col gap-1 border-t border-[var(--hairline)] pt-2 text-[11.5px]">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="shrink-0 text-3">{t('mods.page.latest')}</span>
                    <span className="truncate text-right text-2" title={selected.latestVersion ?? ''}>
                      {selected.latestVersion ?? t('mods.page.any')}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="shrink-0 text-3">{t('mods.page.versions')}</span>
                    <span className="truncate text-right text-2" title={selected.versions.join(', ')}>
                      {displayVersions.join(', ') || t('mods.page.any')}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="shrink-0 text-3">{t('mods.page.source')}</span>
                    <span className="text-2">
                      {selected.source === 'curseforge' ? 'CurseForge' : 'Modrinth'}
                    </span>
                  </div>
                </div>

                <label className="flex flex-col gap-1">
                  <span className="text-[11.5px] text-3">{t('mods.page.installTo')}</span>
                  {instances.length > 0 ? (
                    <Select
                      value={instanceId}
                      onChange={setInstanceId}
                      placeholder={t('mods.page.installTo')}
                      options={instances.map((item) => ({
                        value: item.id,
                        label: item.name,
                        hint: `${item.mcVersion} ${item.loader === 'vanilla' ? '' : item.loader}`.trim()
                      }))}
                    />
                  ) : (
                    <span className="text-[11.5px] text-3">{t('mods.page.noInstances')}</span>
                  )}
                </label>

                <AnimatePresence>
                  {installing && progress && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="flex items-center justify-between text-[11px] text-2">
                        <span>
                          {progress.phase === 'resolve'
                            ? t('mods.page.resolving')
                            : t('mods.page.progress', {
                                received: formatBytes(progress.received),
                                total: progress.total > 0 ? formatBytes(progress.total) : '?'
                              })}
                        </span>
                        <span className="tnum text-3">{progress.phase === 'resolve' ? '' : `${percent}%`}</span>
                      </div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--active-bg)]">
                        <div
                          className="h-full rounded-full bg-accent transition-[width] duration-150"
                          style={{ width: progress.phase === 'resolve' ? '8%' : `${percent}%` }}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => void window.ferry.cancelModDownload()}
                        className="mt-1.5 text-[11px] text-3 underline-offset-2 hover:text-1 hover:underline"
                      >
                        {t('mods.center.cancel')}
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>

                {noKeyBlocked && (
                  <div className="rounded-lg bg-[#e8873c]/10 px-2.5 py-2 text-[11px] leading-relaxed text-[#e8873c]">
                    {t('mods.page.noKeyHint')}
                    <button
                      type="button"
                      onClick={() => {
                        window.location.hash = '#/settings'
                      }}
                      className="ml-1 underline underline-offset-2"
                    >
                      {t('mods.page.settings')}
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  disabled={!target || installing !== null || noKeyBlocked}
                  onClick={() => void startInstall()}
                  className="mt-1 flex h-9 items-center justify-center gap-1.5 rounded-lg bg-accent text-[12.5px] font-medium text-[var(--accent-ink)] disabled:opacity-45"
                >
                  <Icon name="download" size={14} />
                  {installing ? t('mods.page.installing') : t('mods.page.install')}
                </button>
              </>
            ) : (
              <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 text-center text-3">
                <Icon name="cube" size={28} />
                <span className="text-[12px]">{t('mods.page.selectHint')}</span>
              </div>
            )}
          </div>
        </div>
    </div>
  )
}

/** 独立入口（保留给直接链接）；主界面里通过「下载」页内嵌同一个面板 */
export function ModDownloadsPage(): JSX.Element {
  const t = useAppStore((state) => state.t)
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
      <header className="mx-auto max-w-[1120px] px-1 pb-3">
        <h1 className="text-[19px] font-semibold tracking-tight text-1">{t('mods.page.title')}</h1>
        <p className="mt-0.5 text-[12.5px] text-2">{t('mods.page.subtitle')}</p>
      </header>
      <ModDownloadPanel />
    </div>
  )
}
