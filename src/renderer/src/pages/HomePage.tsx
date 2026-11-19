import { useMemo, useState } from 'react'
import type { ImportOutcome } from '@shared/ipc'
import type { ScanWarning } from '@shared/types'
import { InstanceHero } from '@renderer/components/InstanceHero'
import { InstanceListItem } from '@renderer/components/InstanceListItem'
import { Icon } from '@renderer/components/Icon'
import { useAppStore } from '@renderer/store/app-store'

export function HomePage(): JSX.Element {
  const t = useAppStore((state) => state.t)
  const instances = useAppStore((state) => state.instances)
  const selectedId = useAppStore((state) => state.selectedId)
  const view = useAppStore((state) => state.view)
  const setView = useAppStore((state) => state.setView)
  const selectInstance = useAppStore((state) => state.selectInstance)
  const importInstance = useAppStore((state) => state.importInstance)
  const importing = useAppStore((state) => state.importing)
  const notify = useAppStore((state) => state.notify)
  const [query, setQuery] = useState('')

  const selected = instances.find((item) => item.id === selectedId) ?? null
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return instances
    return instances.filter(
      (item) =>
        item.name.toLowerCase().includes(keyword) || item.mcVersion.toLowerCase().includes(keyword)
    )
  }, [instances, query])

  const describeWarning = (warning: ScanWarning): string => {
    switch (warning.code) {
      case 'multiple-versions':
        return t('home.importWarnMultiple', { count: warning.count, chosen: warning.chosen })
      case 'no-version-json':
        return t('home.importWarnNoJson')
      case 'mods-without-version':
        return t('home.importWarnMods')
    }
  }

  const handleImport = async (): Promise<void> => {
    const outcome: ImportOutcome = await importInstance()
    if (!outcome.ok) {
      if (outcome.reason === 'cancelled') return
      if (outcome.reason === 'not-a-game-dir') {
        notify('error', t('home.importNoGameDir'))
        return
      }
      if (outcome.reason === 'duplicate') {
        notify('error', t('home.importDuplicate'))
        return
      }
      notify('error', t('home.importReadError', { message: outcome.message }))
      return
    }
    const suffix = outcome.warnings.length > 0 ? ` · ${describeWarning(outcome.warnings[0])}` : ''
    if (outcome.instances.length === 1) {
      notify('success', `${t('home.importOk', { name: outcome.instances[0].name })}${suffix}`)
    } else {
      const skipped = outcome.skipped > 0 ? t('home.importSkipped', { count: outcome.skipped }) : ''
      notify(
        'success',
        `${t('home.importOkMany', { count: outcome.instances.length })}${skipped}${suffix}`
      )
    }
  }

  return (
    <div className="flex min-h-0 flex-1 gap-3 px-3 pb-3">
      <aside className="glass flex w-[292px] shrink-0 flex-col rounded-panel p-3">
        <div className="flex items-center gap-2 px-1">
          <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.1em] text-2">
            {t('home.instances')}
          </h2>
          <span className="rounded-md bg-[var(--hover-bg)] px-1.5 py-px text-[11px] tnum text-3">
            {instances.length}
          </span>
          <div className="ml-auto flex items-center gap-0.5">
            <button
              type="button"
              aria-label={t('home.view.grid')}
              title={t('home.view.grid')}
              onClick={() => setView('grid')}
              className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                view === 'grid' ? 'bg-[var(--active-bg)] text-1' : 'text-3 hover:text-1'
              }`}
            >
              <Icon name="grid" size={14} />
            </button>
            <button
              type="button"
              aria-label={t('home.view.list')}
              title={t('home.view.list')}
              onClick={() => setView('list')}
              className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                view === 'list' ? 'bg-[var(--active-bg)] text-1' : 'text-3 hover:text-1'
              }`}
            >
              <Icon name="list" size={14} />
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <div className="relative flex-1">
            <Icon
              name="search"
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-3"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('home.search')}
              className="h-9 w-full rounded-lg border border-[var(--hairline)] bg-[var(--hover-bg)] pl-7 pr-2.5 text-[13px] text-1 outline-none transition-colors placeholder:text-3 focus:border-accent/60"
            />
          </div>
        </div>

        <div
          className={`mt-3 min-h-0 flex-1 overflow-y-auto pr-0.5 ${
            view === 'grid' ? 'grid grid-cols-2 content-start gap-2' : 'flex flex-col gap-2'
          }`}
        >
          {filtered.map((instance, index) => (
            <InstanceListItem
              key={instance.id}
              instance={instance}
              active={instance.id === selectedId}
              view={view}
              index={index}
              onSelect={() => selectInstance(instance.id)}
            />
          ))}
          {filtered.length === 0 && (
            <p className="col-span-2 px-1 py-6 text-center text-[12.5px] text-3">
              {instances.length === 0 ? t('home.noInstancesHint') : t('home.searchEmpty')}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => void handleImport()}
          disabled={importing}
          className="mt-2.5 flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-accent/40 bg-accent/10 text-[12.5px] font-medium accent-text transition-colors hover:bg-accent/15 disabled:opacity-60"
        >
          <Icon name="import" size={14} />
          {importing ? t('home.importing') : t('home.import')}
        </button>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          <InstanceHero instance={selected} />
        ) : (
          <div className="glass glass-card flex flex-1 flex-col items-center justify-center gap-3 rounded-card p-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--hairline)] bg-[var(--hover-bg)]">
              <Icon name="folder" size={22} className="text-2" />
            </div>
            <h2 className="text-[16px] font-semibold text-1">{t('home.noInstances')}</h2>
            <p className="max-w-[320px] text-[12.5px] leading-relaxed text-2">{t('home.noInstancesHint')}</p>
            <button
              type="button"
              onClick={() => void handleImport()}
              className="mt-1 flex h-9 items-center gap-1.5 rounded-xl border border-accent/40 bg-accent/10 px-3.5 text-[12.5px] font-medium accent-text transition-colors hover:bg-accent/15"
            >
              <Icon name="import" size={14} />
              {t('home.import')}
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
