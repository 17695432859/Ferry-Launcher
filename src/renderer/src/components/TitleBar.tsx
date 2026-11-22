import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAppStore } from '@renderer/store/app-store'
import { Icon, type IconName } from './Icon'
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

/** PCL 蓝色顶栏：左侧标识、居中导航、右侧窗口按钮 */
export function TitleBar(): JSX.Element {
  const t = useAppStore((state) => state.t)
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

  const moreActive = location.pathname === '/multiplayer' || location.pathname === '/accounts'
  const closeMore = (): void => setMoreOpen(false)

  return (
    <header
      data-tauri-drag-region="deep"
      className="drag relative z-20 grid h-11 shrink-0 grid-cols-[1fr_auto_1fr] items-center bg-[#2d7dd2] px-3 text-white"
    >
      <div className="flex items-center gap-2">
        <span className="select-none text-[15px] font-bold tracking-tight">Ferry</span>
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
                  ? 'bg-white text-[#2d7dd2] shadow-sm'
                  : 'text-white/90 hover:bg-white/15 hover:text-white'
              ].join(' ')
            }
          >
            <Icon name={tab.icon} size={13} filled={tab.to === '/'} strokeWidth={tab.to === '/' ? 0 : 1.7} />
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
                ? 'bg-white text-[#2d7dd2] shadow-sm'
                : 'text-white/90 hover:bg-white/15 hover:text-white'
            ].join(' ')}
          >
            <Icon name="grid" size={13} />
            <span>{t('nav.more')}</span>
          </button>

          {moreOpen && (
            <div className="glass-strong absolute left-1/2 top-9 z-30 w-[132px] -translate-x-1/2 overflow-hidden rounded-xl border border-[var(--hairline)] py-1 shadow-xl">
              {(
                [
                  { to: '/multiplayer', icon: 'cube', labelKey: 'nav.multiplayer' },
                  { to: '/accounts', icon: 'user', labelKey: 'nav.accounts' }
                ] as Array<{ to: string; icon: IconName; labelKey: TranslationKey }>
              ).map((item) => (
                <button
                  key={item.to}
                  type="button"
                  onClick={() => {
                    navigate(item.to)
                    closeMore()
                  }}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12.5px] transition-colors hover:bg-[var(--hover-bg)] ${
                    location.pathname === item.to ? 'accent-text' : 'text-1'
                  }`}
                >
                  <Icon name={item.icon} size={14} />
                  <span>{t(item.labelKey)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </nav>

      <div className="flex items-center justify-end gap-0.5">
        <button
          type="button"
          aria-label={t('titlebar.minimize')}
          title={t('titlebar.minimize')}
          onClick={() => void window.ferry.window.minimize()}
          className="no-drag flex h-8 w-11 items-center justify-center rounded-lg text-white/90 transition-colors hover:bg-white/15 hover:text-white"
        >
          <Icon name="minimize" size={16} />
        </button>
        <button
          type="button"
          aria-label={t('titlebar.close')}
          title={t('titlebar.close')}
          onClick={() => void window.ferry.window.close()}
          className="no-drag flex h-8 w-11 items-center justify-center rounded-lg text-white/90 transition-colors hover:bg-[#e81123] hover:text-white"
        >
          <Icon name="close" size={16} />
        </button>
      </div>
    </header>
  )
}
