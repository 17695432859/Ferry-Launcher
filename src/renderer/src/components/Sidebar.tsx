import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ImportOutcome } from '@shared/ipc'
import type { ScanWarning } from '@shared/types'
import { useAppStore } from '@renderer/store/app-store'
import { Icon } from './Icon'
import { InstanceTile } from './InstanceIcon'
import { LaunchRing } from './LaunchRing'

/**
 * PCL 风格的左侧版本面板：顶部版本列表 + 新建/导入，
 * 中间可点选的实例列表，底部启动游戏 + 版本设置（PCL 的「主界面左下角版本设置」）。
 */
export function Sidebar(): JSX.Element {
  const t = useAppStore((state) => state.t)
  const instances = useAppStore((state) => state.instances)
  const selectedId = useAppStore((state) => state.selectedId)
  const selectInstance = useAppStore((state) => state.selectInstance)
  const importInstance = useAppStore((state) => state.importInstance)
  const importing = useAppStore((state) => state.importing)
  const notify = useAppStore((state) => state.notify)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')

  const selected = instances.find((item) => item.id === selectedId) ?? instances[0] ?? null
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
    <nav className="relative z-20 flex w-[264px] shrink-0 flex-col border-r border-[var(--hairline)] bg-[var(--sidebar-bg)] px-3 pb-3 pt-4">
      <div className="flex items-center gap-2 px-1">
        <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.1em] text-[var(--sidebar-text-2)]">
          {t('home.instances')}
        </h2>
        <span className="rounded-md bg-[var(--hover-bg)] px-1.5 py-px text-[11px] tnum text-[var(--sidebar-text-2)]">
          {instances.length}
        </span>
        <button
          type="button"
          onClick={() => void handleImport()}
          disabled={importing}
          title={t('home.import')}
          aria-label={t('home.import')}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-[var(--sidebar-text-2)] transition-colors hover:bg-[var(--hover-bg)] hover:text-accent disabled:opacity-60"
        >
          <Icon name={importing ? 'spark' : 'plus'} size={15} />
        </button>
      </div>

      <div className="relative mt-3">
        <Icon
          name="search"
          size={13}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--sidebar-text-2)]"
        />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('home.search')}
          className="h-9 w-full rounded-lg border border-[var(--hairline)] bg-white pl-7 pr-2.5 text-[13px] text-[var(--sidebar-text)] outline-none transition-colors placeholder:text-[var(--sidebar-text-2)] focus:border-accent/60"
        />
      </div>

      <div className="mt-2.5 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-0.5">
        {filtered.map((instance) => {
          const active = instance.id === selected?.id
          return (
            <button
              key={instance.id}
              type="button"
              onClick={() => selectInstance(instance.id)}
              className={`relative flex w-full shrink-0 items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors ${
                active
                  ? 'border-accent/45 bg-accent/10'
                  : 'border-transparent hover:border-[var(--hairline)] hover:bg-[var(--hover-bg)]'
              }`}
            >
              {active && (
                <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-accent" aria-hidden="true" />
              )}
              <InstanceTile instance={instance} size={38} radius={8} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-[var(--sidebar-text)]">
                  {instance.name}
                </span>
                <span className="mt-0.5 block truncate text-[11.5px] text-[var(--sidebar-text-2)]">
                  Minecraft {instance.mcVersion}
                </span>
              </span>
            </button>
          )
        })}
        {filtered.length === 0 && (
          <p className="px-1 py-6 text-center text-[12.5px] text-[var(--sidebar-text-2)]">
            {instances.length === 0 ? t('home.noInstancesHint') : t('home.searchEmpty')}
          </p>
        )}
      </div>

      <div className="mt-2 flex flex-col gap-2 border-t border-[var(--hairline)] pt-3">
        {selected && <LaunchRing instanceId={selected.id} variant="block" />}
        <button
          type="button"
          onClick={() => navigate('/versions')}
          className="h-8 rounded-lg border border-[var(--hairline)] bg-white text-[11.5px] font-medium text-[var(--sidebar-text)] transition-colors hover:bg-[var(--hover-bg)]"
        >
          {t('home.versionSettings')}
        </button>
      </div>
    </nav>
  )
}
