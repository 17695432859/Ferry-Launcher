import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { ContentItem, ContentKind, ContentPreview, Instance, ModUpdate } from '@shared/types'
import { useAppStore } from '@renderer/store/app-store'
import { Icon } from '../Icon'
import { ModBrowser } from './ModBrowser'

const KINDS: Array<{ id: ContentKind; key: 'content.tab.mods' | 'content.tab.resourcepacks' | 'content.tab.saves' | 'content.tab.logs' }> = [
  { id: 'mods', key: 'content.tab.mods' },
  { id: 'resourcepacks', key: 'content.tab.resourcepacks' },
  { id: 'saves', key: 'content.tab.saves' },
  { id: 'logs', key: 'content.tab.logs' }
]

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function formatDate(seconds: number): string {
  if (!seconds) return '-'
  const date = new Date(seconds * 1000)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function ContentPanel({ instance }: { instance: Instance }): JSX.Element {
  const t = useAppStore((state) => state.t)
  const notify = useAppStore((state) => state.notify)

  const [kind, setKind] = useState<ContentKind>('mods')
  const [items, setItems] = useState<ContentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ item: ContentItem; data: ContentPreview } | null>(null)
  const [updates, setUpdates] = useState<ModUpdate[]>([])
  const [checking, setChecking] = useState(false)
  const [browserOpen, setBrowserOpen] = useState(false)

  const refresh = useCallback(
    async (target: ContentKind = kind): Promise<void> => {
      setLoading(true)
      try {
        setItems(await window.ferry.listContent(instance.id, target))
      } finally {
        setLoading(false)
      }
    },
    [instance.id, kind]
  )

  useEffect(() => {
    setPreview(null)
    setUpdates([])
    setBrowserOpen(false)
    void refresh(kind)
  }, [refresh, kind])

  const updateMap = useMemo(() => {
    const map = new Map<string, ModUpdate>()
    for (const item of updates) map.set(item.key, item)
    return map
  }, [updates])

  const handleToggle = async (item: ContentItem): Promise<void> => {
    setBusy(item.key)
    try {
      setItems(await window.ferry.toggleContent(instance.id, kind, item.key, !item.enabled))
    } catch {
      notify('error', t('content.deleteFailed'))
    } finally {
      setBusy(null)
    }
  }

  const handleDelete = async (item: ContentItem): Promise<void> => {
    if (confirming !== item.key) {
      setConfirming(item.key)
      setTimeout(() => setConfirming((current) => (current === item.key ? null : current)), 3000)
      return
    }
    setBusy(item.key)
    setConfirming(null)
    try {
      setItems(await window.ferry.deleteContent(instance.id, kind, item.key))
      if (preview?.item.key === item.key) setPreview(null)
      notify('info', t('content.deleted'))
    } catch {
      notify('error', t('content.deleteFailed'))
    } finally {
      setBusy(null)
    }
  }

  const handlePreview = async (item: ContentItem): Promise<void> => {
    setBrowserOpen(false)
    setBusy(item.key)
    try {
      const data = await window.ferry.previewContent(instance.id, kind, item.key)
      setPreview({ item, data })
    } catch {
      notify('error', t('content.previewFailed'))
    } finally {
      setBusy(null)
    }
  }

  const handleImport = async (): Promise<void> => {
    const result = await window.ferry.importContent(instance.id, kind)
    if (result.cancelled) return
    await refresh(kind)
    notify(result.added > 0 ? 'success' : 'info', t('content.imported', { added: result.added, skipped: result.skipped }))
  }

  const handleCheckUpdates = async (): Promise<void> => {
    setChecking(true)
    try {
      const found = await window.ferry.checkModUpdates(instance.id)
      setUpdates(found)
      notify('info', found.length > 0 ? t('content.updatesFound', { count: found.length }) : t('content.noUpdates'))
    } catch {
      notify('error', t('content.previewFailed'))
    } finally {
      setChecking(false)
    }
  }

  const handleUpgrade = async (update: ModUpdate): Promise<void> => {
    setBusy(update.key)
    try {
      setItems(await window.ferry.upgradeMod(instance.id, update.key, update.downloadUrl, update.fileName))
      setUpdates((list) => list.filter((item) => item.key !== update.key))
      notify('success', t('content.updated', { name: update.projectTitle }))
    } catch {
      notify('error', t('content.updateFailed'))
    } finally {
      setBusy(null)
    }
  }

  const canImport = kind === 'mods' || kind === 'resourcepacks'

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 子标签 */}
        <div className="flex items-center gap-1 border-b border-[var(--hairline)] px-4">
          {KINDS.map((entry) => {
            const active = entry.id === kind
            return (
              <button
                key={entry.id}
                type="button"
                data-kind={entry.id}
                onClick={() => setKind(entry.id)}
                className={`relative px-2.5 py-2 text-[12.5px] font-medium transition-colors ${
                  active ? 'text-1' : 'text-3 hover:text-2'
                }`}
              >
                {t(entry.key)}
                {active && (
                  <motion.span
                    layoutId="content-kind"
                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                    className="absolute inset-x-1.5 -bottom-px h-[2px] rounded-full bg-accent"
                  />
                )}
              </button>
            )
          })}

          <div className="ml-auto flex items-center gap-1.5 py-1.5">
            <span className="mr-1 text-[11.5px] tnum text-3">{t('content.count', { count: items.length })}</span>
            {kind === 'mods' && (
              <button
                type="button"
                onClick={() => {
                  setPreview(null)
                  setBrowserOpen(true)
                }}
                className="flex h-7 items-center gap-1 rounded-md border border-accent/40 bg-accent/10 px-2 text-[11.5px] font-medium accent-text"
              >
                <Icon name="download" size={12} />
                {t('mods.download')}
              </button>
            )}
            {kind === 'mods' && (
              <button
                type="button"
                disabled={checking || items.length === 0}
                onClick={() => void handleCheckUpdates()}
                className="flex h-7 items-center gap-1 rounded-md border border-[var(--hairline)] bg-[var(--hover-bg)] px-2 text-[11.5px] text-2 transition-colors hover:text-1 disabled:opacity-45"
              >
                <Icon name="download" size={12} />
                {t('content.checkUpdates')}
              </button>
            )}
            <button
              type="button"
              onClick={() => void refresh(kind)}
              title={t('content.refresh')}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--hairline)] bg-[var(--hover-bg)] text-3 transition-colors hover:text-1"
            >
              <Icon name="restore" size={12} />
            </button>
            <button
              type="button"
              onClick={() => void window.ferry.revealInstance(instance.id, kind)}
              title={t('content.openFolder')}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--hairline)] bg-[var(--hover-bg)] text-3 transition-colors hover:text-1"
            >
              <Icon name="folder" size={12} />
            </button>
            {canImport && (
              <button
                type="button"
                onClick={() => void handleImport()}
                className="flex h-7 items-center gap-1 rounded-md border border-accent/40 bg-accent/10 px-2 text-[11.5px] font-medium accent-text"
              >
                <Icon name="import" size={12} />
                {t('content.import')}
              </button>
            )}
          </div>
        </div>

        {/* 列表 */}
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex h-24 items-center justify-center text-[12.5px] text-3">···</div>
          ) : items.length === 0 ? (
            <div className="mt-6 flex flex-col items-center gap-2 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--hairline)] bg-[var(--hover-bg)]">
                <Icon name={kind === 'logs' ? 'list' : 'cube'} size={18} className="text-3" />
              </div>
              <p className="text-[13px] text-1">{t(`content.empty.${kind}`)}</p>
              <p className="max-w-[300px] text-[12px] leading-relaxed text-3">{t(`content.hint.${kind}`)}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {items.map((item) => {
                const update = updateMap.get(item.key)
                return (
                  <motion.div
                    key={item.key}
                    layout
                    className="flex items-center gap-2.5 rounded-lg border border-[var(--hairline)] bg-[var(--hover-bg)] px-2.5 py-1.5"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[var(--active-bg)]">
                      {item.hasIcon ? (
                        <ItemIcon instanceId={instance.id} kind={kind} itemKey={item.key} />
                      ) : (
                        <Icon name={kind === 'logs' ? 'list' : 'cube'} size={14} className="text-3" />
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => void handlePreview(item)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[12.5px] font-medium text-1">{item.name}</span>
                        {!item.enabled && (
                          <span className="shrink-0 rounded bg-[var(--active-bg)] px-1 py-px text-[10px] text-3">
                            {t('content.disabledTag')}
                          </span>
                        )}
                        {update && (
                          <span className="shrink-0 rounded bg-accent/15 px-1 py-px text-[10px] accent-text">
                            {update.latestVersion}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-3">
                        <span className="truncate">
                          {item.version ?? item.note ?? item.key}
                        </span>
                        <span className="tnum shrink-0">{formatSize(item.sizeBytes)}</span>
                      </div>
                    </button>

                    {update && (
                      <button
                        type="button"
                        disabled={busy === item.key}
                        onClick={() => void handleUpgrade(update)}
                        className="shrink-0 rounded-md bg-accent/12 px-2 py-1 text-[11.5px] font-medium accent-text disabled:opacity-45"
                      >
                        {busy === item.key ? t('content.updating') : t('content.update')}
                      </button>
                    )}

                    {item.canToggle && (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={item.enabled}
                        disabled={busy === item.key}
                        onClick={() => void handleToggle(item)}
                        className={`relative h-[20px] w-[34px] shrink-0 rounded-full border transition-colors ${
                          item.enabled
                            ? 'border-accent/50 bg-accent/85'
                            : 'border-[var(--hairline)] bg-[var(--active-bg)]'
                        }`}
                      >
                        <motion.span
                          layout
                          transition={{ type: 'spring', stiffness: 520, damping: 34 }}
                          className="absolute top-[3px] h-[12px] w-[12px] rounded-full bg-white shadow-sm"
                          style={{ left: item.enabled ? 18 : 3 }}
                        />
                      </button>
                    )}

                    <button
                      type="button"
                      title={confirming === item.key ? t('content.confirmDelete') : t('content.delete')}
                      disabled={busy === item.key}
                      onClick={() => void handleDelete(item)}
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-40 ${
                        confirming === item.key
                          ? 'bg-[#c2455e] text-white'
                          : 'text-3 hover:bg-[var(--active-bg)] hover:text-1'
                      }`}
                    >
                      <Icon name={confirming === item.key ? 'alert' : 'trash'} size={12} />
                    </button>
                  </motion.div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Mod 下载抽屉 */}
      <AnimatePresence>
        {browserOpen && kind === 'mods' && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 380, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="shrink-0 overflow-hidden"
          >
            <ModBrowser
              instance={instance}
              onClose={() => setBrowserOpen(false)}
              onInstalled={(nextItems) => {
                setItems(nextItems)
                setBrowserOpen(false)
              }}
            />
          </motion.aside>
        )}
      </AnimatePresence>

      {/* 预览抽屉 */}
      <AnimatePresence>
        {preview && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 268, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="shrink-0 overflow-hidden border-l border-[var(--hairline)]"
          >
            <div className="flex h-full w-[268px] flex-col">
              <div className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-1">
                  {preview.item.name}
                </span>
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-3 hover:bg-[var(--active-bg)] hover:text-1"
                >
                  <Icon name="close" size={12} />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
                {preview.data.kind === 'image' && preview.data.image && (
                  <div className="mb-2 flex justify-center rounded-lg bg-[var(--active-bg)] p-2">
                    <img
                      src={preview.data.image}
                      alt=""
                      className="max-h-[180px] max-w-full object-contain"
                      style={{ imageRendering: 'pixelated' }}
                    />
                  </div>
                )}
                {preview.data.kind === 'text' && (
                  <pre className="mb-2 max-h-[320px] overflow-auto whitespace-pre-wrap break-all rounded-lg bg-[var(--active-bg)] p-2 font-mono text-[10.5px] leading-relaxed text-2">
                    {preview.data.text || t('content.noPreview')}
                  </pre>
                )}
                {preview.data.kind === 'none' && (
                  <p className="mb-2 text-[11.5px] text-3">{t('content.noPreview')}</p>
                )}

                <div className="flex flex-col gap-1">
                  {preview.data.fields.map((field) => (
                    <div key={field.label} className="flex gap-2 text-[11.5px]">
                      <span className="w-[68px] shrink-0 text-3">{field.label}</span>
                      <span className="min-w-0 flex-1 break-all text-2">{field.value}</span>
                    </div>
                  ))}
                  <div className="flex gap-2 text-[11.5px]">
                    <span className="w-[68px] shrink-0 text-3">{t('content.size')}</span>
                    <span className="tnum text-2">{formatSize(preview.item.sizeBytes)}</span>
                  </div>
                  <div className="flex gap-2 text-[11.5px]">
                    <span className="w-[68px] shrink-0 text-3">{t('content.modified')}</span>
                    <span className="tnum text-2">{formatDate(preview.item.modified)}</span>
                  </div>
                  <div className="mt-0.5 break-all text-[10.5px] text-3">{preview.item.key}</div>
                </div>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  )
}

/** 列表里的小图标按需拉取，避免一次请求几百张图 */
function ItemIcon({
  instanceId,
  kind,
  itemKey
}: {
  instanceId: string
  kind: ContentKind
  itemKey: string
}): JSX.Element {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void window.ferry
      .previewContent(instanceId, kind, itemKey)
      .then((data) => {
        if (alive) setSrc(data.image)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [instanceId, kind, itemKey])

  if (!src) return <Icon name="cube" size={14} className="text-3" />
  return (
    <img
      src={src}
      alt=""
      className="h-8 w-8 object-cover"
      style={{ imageRendering: 'pixelated' }}
    />
  )
}
