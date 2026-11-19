import { useEffect, useState } from 'react'
import type { WindowState } from '@shared/types'
import { useAppStore } from '@renderer/store/app-store'
import { FerryLogo, Icon } from './Icon'

function ControlButton({
  label,
  onClick,
  danger = false,
  children
}: {
  label: string
  onClick: () => void
  danger?: boolean
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`no-drag flex h-8 w-11 items-center justify-center rounded-lg text-2 transition-colors duration-150 hover:text-1 ${
        danger ? 'hover:bg-[#e81123] hover:text-white' : 'hover:bg-[var(--hover-bg)]'
      }`}
    >
      {children}
    </button>
  )
}

export function TitleBar(): JSX.Element {
  const info = useAppStore((state) => state.info)
  const t = useAppStore((state) => state.t)
  const [windowState, setWindowState] = useState<WindowState>({ maximized: false, focused: true })

  useEffect(() => window.ferry.window.onStateChange(setWindowState), [])

  return (
    <header
      data-tauri-drag-region
      className="drag relative z-20 flex h-11 shrink-0 items-center gap-2.5 px-3"
    >
      <div className="flex items-center gap-2.5">
        <FerryLogo size={22} />
        <span className="text-[13.5px] font-semibold tracking-tight text-1">Ferry Launcher</span>
        <span className="rounded-md border border-[var(--hairline)] bg-[var(--hover-bg)] px-1.5 py-px text-[11.5px] font-medium tnum text-3">
          v{info?.version ?? '0.1.2'}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <ControlButton label={t('titlebar.minimize')} onClick={() => void window.ferry.window.minimize()}>
          <Icon name="minimize" size={16} />
        </ControlButton>
        <ControlButton
          label={windowState.maximized ? t('titlebar.restore') : t('titlebar.maximize')}
          onClick={() => void window.ferry.window.toggleMaximize()}
        >
          <Icon name={windowState.maximized ? 'restore' : 'maximize'} size={14} />
        </ControlButton>
        <ControlButton label={t('titlebar.close')} danger onClick={() => void window.ferry.window.close()}>
          <Icon name="close" size={16} />
        </ControlButton>
      </div>
    </header>
  )
}
