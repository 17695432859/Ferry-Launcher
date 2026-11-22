import { useEffect, useState } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { MotionConfig } from 'framer-motion'
import { Sidebar } from '@renderer/components/Sidebar'
import { TitleBar } from '@renderer/components/TitleBar'
import { Toast } from '@renderer/components/Toast'
import { FerryLogo } from '@renderer/components/Icon'
import { AccountsPage } from '@renderer/pages/AccountsPage'
import { DownloadsPage } from '@renderer/pages/DownloadsPage'
import { HomePage } from '@renderer/pages/HomePage'
import { MultiplayerPage } from '@renderer/pages/MultiplayerPage'
import { SettingsPage } from '@renderer/pages/SettingsPage'
import { VersionSettingsPage } from '@renderer/pages/VersionSettingsPage'
import { applyTheme } from '@renderer/lib/theme'
import { useAppStore } from '@renderer/store/app-store'

function usePrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (event: MediaQueryListEvent): void => setPrefersDark(event.matches)
    query.addEventListener('change', handler)
    return () => query.removeEventListener('change', handler)
  }, [])
  return prefersDark
}

function Splash(): JSX.Element {
  return (
    <div className="app-frame relative flex h-full items-center justify-center">
      <div className="relative z-10 flex flex-col items-center gap-3">
        <div className="animate-pulse">
          <FerryLogo size={44} />
        </div>
        <p className="text-[12.5px] tracking-[0.16em] text-3">FERRY LAUNCHER</p>
      </div>
    </div>
  )
}

export function App(): JSX.Element {
  const ready = useAppStore((state) => state.ready)
  const settings = useAppStore((state) => state.settings)
  const init = useAppStore((state) => state.init)
  const prefersDark = usePrefersDark()

  useEffect(() => {
    void init()
  }, [init])

  // 主题/强调色/模糊/缩放全部落到 CSS 变量，切换不需要重建组件树
  useEffect(() => {
    applyTheme(settings, prefersDark)
  }, [settings, prefersDark])

  if (!ready) return <Splash />

  return (
    <MotionConfig reducedMotion="user">
      <div className="app-frame relative flex h-full flex-col">
        <TitleBar />
        <div className="relative z-10 flex min-h-0 flex-1 bg-[var(--bg-0)]">
          <Sidebar />
          {/* 内容区：白底由这层铺，页面自身不再各自处理背景 */}
          <div className="relative flex min-h-0 flex-1 flex-col bg-[var(--bg-0)]">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/versions" element={<VersionSettingsPage />} />
              <Route path="/accounts" element={<AccountsPage />} />
              <Route path="/downloads" element={<DownloadsPage />} />
              <Route path="/multiplayer" element={<MultiplayerPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </div>
        </div>
        <Toast />
      </div>
    </MotionConfig>
  )
}

// WebView2 会带着上次的 URL 回来，冷启动必须落回启动页，不能接着上次的页面
if (window.location.hash && window.location.hash !== '#/' && window.location.hash !== '') {
  window.location.hash = '#/'
}

export function Root(): JSX.Element {
  return (
    <HashRouter>
      <App />
    </HashRouter>
  )
}
