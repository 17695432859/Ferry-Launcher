import { useNavigate } from 'react-router-dom'
import { useAppStore } from '@renderer/store/app-store'
import { formatRelativeTime } from '@renderer/lib/format'
import { LOADER_LABEL_KEYS } from '@renderer/lib/labels'
import { Icon } from '@renderer/components/Icon'
import { InstanceTile } from '@renderer/components/InstanceIcon'
import { SkinAvatar } from '@renderer/components/SkinAvatar'

/**
 * PCL 右侧内容显示区：当前版本概览 + 当前账号卡片。
 * 版本列表与启动按钮在左侧 Sidebar；账号切换入口在顶栏右上角与这里。
 */
export function HomePage(): JSX.Element {
  const t = useAppStore((state) => state.t)
  const locale = useAppStore((state) => state.settings.locale)
  const instances = useAppStore((state) => state.instances)
  const selectedId = useAppStore((state) => state.selectedId)
  const accounts = useAppStore((state) => state.accounts)
  const activeId = useAppStore((state) => state.settings.lastAccountId)
  const navigate = useNavigate()

  const selected = instances.find((item) => item.id === selectedId) ?? instances[0] ?? null
  const active = accounts.find((item) => item.id === activeId) ?? accounts[0] ?? null
  const loaderLabel = selected ? t(LOADER_LABEL_KEYS[selected.loader]) : ''
  const lastPlayed = selected ? formatRelativeTime(selected.lastPlayedAt, locale) : ''

  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
      <div className="mx-auto flex max-w-[1120px] flex-col gap-4">
        <header className="px-1 pb-1">
          <h1 className="text-[19px] font-semibold tracking-tight text-[var(--text-1)]">
            {t('nav.home')}
          </h1>
          <p className="mt-0.5 text-[12.5px] text-[var(--text-3)]">
            {t('home.instanceCount', { count: instances.length })}
          </p>
        </header>

        {selected ? (
          <section className="rounded-panel border border-[var(--hairline)] bg-white p-5 shadow-sm">
            <div className="flex items-center gap-4">
              <InstanceTile instance={selected} size={64} radius={14} />
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[17px] font-semibold text-[var(--text-1)]">
                  {selected.name}
                </h2>
                <p className="mt-1 truncate text-[12.5px] text-[var(--text-2)]">
                  Minecraft {selected.mcVersion}
                  {selected.loader !== 'vanilla' && selected.loaderVersion
                    ? ` · ${loaderLabel} ${selected.loaderVersion}`
                    : ''}
                </p>
                <p className="mt-0.5 text-[11.5px] text-[var(--text-3)]">
                  {lastPlayed ? `${t('home.lastPlayed')} ${lastPlayed}` : t('home.never')}
                </p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--hairline)] pt-4">
              <div className="rounded-lg bg-[var(--bg-1)] px-3 py-2.5">
                <p className="text-[11px] text-[var(--text-3)]">{t('home.version')}</p>
                <p className="mt-0.5 truncate text-[13px] font-medium text-[var(--text-1)]">
                  {selected.mcVersion}
                </p>
              </div>
              <div className="rounded-lg bg-[var(--bg-1)] px-3 py-2.5">
                <p className="text-[11px] text-[var(--text-3)]">{t('home.loader')}</p>
                <p className="mt-0.5 truncate text-[13px] font-medium text-[var(--text-1)]">
                  {loaderLabel}
                </p>
              </div>
            </div>
          </section>
        ) : (
          <section className="rounded-panel border border-dashed border-[var(--hairline)] bg-[var(--bg-1)] px-5 py-10 text-center">
            <p className="text-[13px] font-medium text-[var(--text-1)]">{t('home.noInstances')}</p>
            <p className="mx-auto mt-1 max-w-[320px] text-[12px] leading-relaxed text-[var(--text-3)]">
              {t('home.noInstancesHint')}
            </p>
          </section>
        )}

        <section className="rounded-panel border border-[var(--hairline)] bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.1em] text-[var(--text-3)]">
              {t('accounts.title')}
            </h2>
            <button
              type="button"
              onClick={() => navigate('/accounts')}
              className="flex items-center gap-1 text-[12px] font-medium accent-text hover:opacity-75"
            >
              <Icon name="edit" size={12} />
              {active ? t('accounts.profileSwitch') : t('accounts.add')}
            </button>
          </div>
          <button
            type="button"
            onClick={() => navigate('/accounts')}
            className="mt-4 flex w-full items-center gap-3.5 rounded-xl border border-[var(--hairline)] bg-[var(--bg-1)] px-3.5 py-3 text-left transition-colors hover:border-accent/40"
          >
            <SkinAvatar account={active} size={48} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-semibold text-[var(--text-1)]">
                {active?.profileName ?? t('accounts.notSignedIn')}
              </span>
              <span className="mt-0.5 block truncate text-[12px] text-[var(--text-2)]">
                {active?.userName ?? t('accounts.addHint')}
              </span>
            </span>
            <Icon name="chevron" size={14} />
          </button>
        </section>
      </div>
    </main>
  )
}
