import type { Instance } from '@shared/types'
import type { InstanceSubPath } from '@shared/ipc'
import { formatMemory, formatPlaytime, formatRelativeTime } from '@renderer/lib/format'
import { LOADER_LABEL_KEYS } from '@renderer/lib/labels'
import { useAppStore } from '@renderer/store/app-store'
import { Icon, type IconName } from '../Icon'

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[12px] text-3">{label}</span>
      <span className="truncate text-[13px] text-1" title={value}>
        {value}
      </span>
    </div>
  )
}

function Tile({
  icon,
  label,
  onClick
}: {
  icon: IconName
  label: string
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-full flex-1 flex-col items-center justify-center gap-1.5 rounded-xl border border-[var(--hairline)] bg-[var(--hover-bg)] text-2 transition-colors duration-150 hover:border-[var(--panel-border)] hover:text-1"
    >
      <Icon name={icon} size={20} />
      <span className="text-[12.5px]">{label}</span>
    </button>
  )
}

export function OverviewPanel({ instance }: { instance: Instance }): JSX.Element {
  const t = useAppStore((state) => state.t)
  const locale = useAppStore((state) => state.settings.locale)
  const notify = useAppStore((state) => state.notify)

  const lastPlayed = formatRelativeTime(instance.lastPlayedAt, locale)
  const open = (subPath: InstanceSubPath): void => {
    void window.ferry
      .revealInstance(instance.id, subPath)
      .catch(() => notify('error', t('home.dirError')))
  }

  return (
    <div className="flex h-full flex-col px-5 py-4">
      <div className="grid grid-cols-3 gap-x-6 gap-y-4">
        <Field label={t('home.version')} value={instance.mcVersion} />
        <Field label={t('home.loader')} value={t(LOADER_LABEL_KEYS[instance.loader])} />
        <Field label={t('home.memory')} value={formatMemory(instance.memoryMb)} />
        <Field label={t('home.playtime')} value={formatPlaytime(instance.totalPlaytimeMs, locale)} />
        <Field label={t('home.lastPlayed')} value={lastPlayed ?? t('home.never')} />
        <Field label={t('instance.java')} value={instance.javaPath ?? t('home.javaAuto')} />
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-xl border border-[var(--hairline)] bg-[var(--hover-bg)] px-3.5 py-2.5">
        <span className="shrink-0 text-[11.5px] uppercase tracking-[0.08em] text-3">
          {t('home.gameDir')}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-2" title={instance.gameDir}>
          {instance.gameDir}
        </span>
        <button
          type="button"
          onClick={() => open('')}
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-[var(--hairline)] bg-[var(--hover-bg)] px-2 text-[12px] text-2 transition-colors hover:text-1"
        >
          <Icon name="folder" size={12} />
          {t('home.openDir')}
        </button>
      </div>

      <div className="mt-5">
        <div className="flex items-baseline justify-between">
          <span className="text-[12px] text-3">{t('instance.memoryAlloc')}</span>
          <span className="text-[12.5px] text-2 tnum">{formatMemory(instance.memoryMb)}</span>
        </div>
        <div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--active-bg)]">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500"
            style={{ width: `${Math.min(100, (instance.memoryMb / 16384) * 100)}%` }}
          />
        </div>
        <div className="mt-1.5 flex justify-between text-[11px] text-3 tnum">
          <span>1 GB</span>
          <span>8 GB</span>
          <span>16 GB</span>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-[var(--hairline)] bg-[var(--hover-bg)] px-3.5 py-2.5">
          <div className="text-[12px] text-3">{t('instance.isolation')}</div>
          <div className="mt-1 flex items-center gap-1.5 text-[13px] text-1">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: instance.isolated ? 'var(--accent)' : 'var(--text-3)' }}
            />
            {instance.isolated ? t('instance.on') : t('instance.off')}
          </div>
        </div>
        <div className="rounded-xl border border-[var(--hairline)] bg-[var(--hover-bg)] px-3.5 py-2.5">
          <div className="text-[12px] text-3">{t('instance.jvmArgs')}</div>
          <div
            className="mt-1 truncate text-[13px] text-1"
            title={instance.jvmArgs || undefined}
          >
            {instance.jvmArgs?.trim() || t('instance.jvmArgsEmpty')}
          </div>
        </div>
      </div>

      <div className="mt-auto flex max-h-[112px] flex-1 gap-2 pt-4">
        <Tile icon="cube" label={t('home.openMods')} onClick={() => open('mods')} />
        <Tile icon="folder" label={t('home.openSaves')} onClick={() => open('saves')} />
        <Tile icon="list" label={t('home.openLogs')} onClick={() => open('logs')} />
        <Tile icon="grid" label={t('home.openPacks')} onClick={() => open('resourcepacks')} />
      </div>
    </div>
  )
}
