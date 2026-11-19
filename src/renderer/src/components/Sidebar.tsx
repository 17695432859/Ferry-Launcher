import { NavLink } from 'react-router-dom'
import { useAppStore } from '@renderer/store/app-store'
import { Icon, type IconName } from './Icon'
import type { TranslationKey } from '@shared/i18n'

interface NavItem {
  to: string
  icon: IconName
  labelKey: TranslationKey
  end?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', icon: 'play', labelKey: 'nav.home', end: true },
  { to: '/accounts', icon: 'user', labelKey: 'nav.accounts' },
  { to: '/downloads', icon: 'download', labelKey: 'nav.downloads' },
  { to: '/multiplayer', icon: 'cube', labelKey: 'nav.multiplayer' },
  { to: '/settings', icon: 'settings', labelKey: 'nav.settings' }
]

export function Sidebar(): JSX.Element {
  const t = useAppStore((state) => state.t)

  return (
    <nav className="flex w-[168px] shrink-0 flex-col gap-0.5 px-2.5 pb-3 pt-1">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            [
              'group relative flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition-colors duration-200',
              isActive ? 'text-1' : 'text-2 hover:bg-[var(--hover-bg)] hover:text-1'
            ].join(' ')
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute inset-0 -z-10 rounded-xl border border-[var(--panel-border)] bg-[var(--active-bg)]"
                />
              )}
              <Icon name={item.icon} size={17} className={isActive ? 'accent-text' : ''} />
              <span>{t(item.labelKey)}</span>
            </>
          )}
        </NavLink>
      ))}

      <div className="mt-auto px-1">
        <p className="text-[11px] text-3">M1 · v0.1.3</p>
      </div>
    </nav>
  )
}
