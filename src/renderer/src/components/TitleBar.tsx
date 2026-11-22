import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAppStore } from '@renderer/store/app-store'
import { Icon, type IconName } from './Icon'
import { SkinAvatar } from './SkinAvatar'
import type { TranslationKey } from '@shared/i18n'

interface Tab {
  to: string
  icon: IconName
  labelKey: TranslationKey
}

const TABS: Tab[] = [
  { to: '/', icon: 'play', labelKey: 'nav.home' },
  { to: '/downloads', icon: 'download', labelKey: 'nav.downloads' },
  { to: '/settings', icon: 'settings', labelKey: 'nav.settings' }
]

/**
 * 顶栏：左侧标识、居中功能入口（启动/下载/设置/更多）、
 * 右上角账号头像（PCL 的账号切换入口）+ 窗口按钮。
 */
export function TitleBar(): JSX.Element {
  const t = useAppStore((state) => state.t)
  const accounts = useAppStore((state) => state.accounts)
  const activeId = useAppStore((state) => state.settings.lastAccountId)
  const location = useLocation()
  const navigate = useNavigate()
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onDown = (event: MouseEvent): void => {
      if (moreRef.current && !moreRef.current.contains(event.target as Node)) setMoreOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const active = accounts.find((item) => item.id === activeId) ?? accounts[0] ?? null
  const moreActive = location.pathname === '/multiplayer' || location.pathname === '/accounts'
  const closeMore = (): void => setMoreOpen(false)

  return (
    <header
      data-tauri-drag-region="deep"
      className="drag relative z-20 grid h-11 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-[var(--hairline)] bg-white px-3 text-[var(--sidebar-text)]"
    >
      <div className="flex items-center gap-2">
        <span className="select-none text-[15px] font-bold tracking-tight accent-text">Ferry</span>
      </div>

      <nav className="flex items-center gap-1">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === '/'}
            className={({ isActive }) =>
              [
                'no-drag flex h-[26px] items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors duration-150',
                isActive
                  ? 'bg-accent/12 accent-text'
                  : 'text-[var(--sidebar-text-2)] hover:bg-[var(--hover-bg)] hover:text-[var(--sidebar-text)]'
              ].join(' ')
            }
          >
            <Icon name={tab.icon} size={13} />
            <span>{t(tab.labelKey)}</span>
          </NavLink>
        ))}

        <div className="relative" ref={moreRef}>
          <button
            type="button"
            onClick={() => setMoreOpen((open) => !open)}
            className={[
              'no-drag flex h-[26px] items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors duration-150',
              moreActive || moreOpen
                ? 'bg-accent/12 accent-text'
                : 'text-[var(--sidebar-text-2)] hover:bg-[var(--hover-bg)] hover:text-[var(--sidebar-text)]'
            ].join(' ')}
          >
            <Icon name="grid" size={13} />
            <span>{t('nav.more')}</span>
          </button>

          {moreOpen && (
            <div className="glass-strong absolute left-1/2 top-9 z-30 w-[132px] -translate-x-1/2 overflow-hidden rounded-xl border border-[var(--hairline)] py-1 shadow-xl">
              <button
                type="button"
                onClick={() => {
                  navigate('/multiplayer')
                  closeMore()
                }}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12.5px] transition-colors hover:bg-[var(--hover-bg)] ${
                  location.pathname === '/multiplayer' ? 'accent-text' : 'text-1'
                }`}
              >
                <Icon name="cube" size={14} />
                <span>{t('nav.multiplayer')}</span>
              </button>
            </div>
          )}
        </div>
      </nav>

      <div className="flex items-center justify-end gap-1">
        {/* PCL 的账号入口：右上角头像，点击进账户管理 / 切换账号 */}
        <button
          type="button"
          onClick={() => navigate('/accounts')}
          title={t('nav.accounts')}
          className="no-drag mr-1 flex h-7 items-center gap-2 rounded-full border border-[var(--hairline)] py-0 pl-0.5 pr-2.5 transition-colors hover:bg-[var(--hover-bg)]"
        >
          <SkinAvatar account={active} size={22} rounded="full" />
          <span className="max-w-[96px] truncate text-[12px] font-medium">
            {active?.profileName ?? t('accounts.notSignedIn')}
          </span>
          <Icon name="chevron" size={11} />
        </button>
        <button
          type="button"
          aria-label={t('titlebar.minimize')}
          title={t('titlebar.minimize')}
          onClick={() => void window.ferry.window.minimize()}
          className="no-drag flex h-8 w-10 items-center justify-center rounded-lg text-[var(--sidebar-text-2)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--sidebar-text)]"
        >
          <Icon name="minimize" size={16} />
        </button>
        <button
          type="button"
          aria-label={t('titlebar.close')}
          title={t('titlebar.close')}
          onClick={() => void window.ferry.window.close()}
          className="no-drag flex h-8 w-10 items-center justify-center rounded-lg text-[var(--sidebar-text-2)] transition-colors hover:bg-[#e81123] hover:text-white"
        >
          <Icon name="close" size={16} />
        </button>
      </div>
    </header>
  )
}
