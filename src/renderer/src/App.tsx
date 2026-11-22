import { useEffect, useState } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { MotionConfig } from 'framer-motion'
import { Backdrop } from '@renderer/components/Backdrop'
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
    <div className="relative flex h-full items-center justify-center">
      <div className="app-backdrop" />
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
  const backgroundImage = useAppStore((state) => state.backgroundImage)
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
      <div className="relative flex h-full flex-col">
        {settings.backgroundMode === 'custom' && backgroundImage ? (
          <>
            <div
              className="fixed inset-0 z-0 bg-cover bg-center"
              style={{ backgroundImage: `url("${backgroundImage}")` }}
              aria-hidden="true"
            />
            {/*
              自定义背景是照片，亮度不可控。这里压一层固定底噪（纯色，不是渐变），
              再叠加用户自己调的压暗比例——否则 8% 白的玻璃面板压在亮天空上，正文对比度会掉到 3:1 以下。
            */}
            <div
              className="fixed inset-0 z-0"
              style={{
                backgroundColor: 'var(--bg-0)',
                opacity: Math.min(0.9, 0.15 + (settings.backgroundDim / 100) * 0.75)
              }}
              aria-hidden="true"
            />
          </>
        ) : (
          <>
            <div className="app-backdrop" />
            <Backdrop animated={settings.backgroundAnimation} />
          </>
        )}
        <TitleBar />
        <div className="relative z-10 flex min-h-0 flex-1">
          <Sidebar />
          <main className="relative flex min-h-0 flex-1 flex-col">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/versions" element={<VersionSettingsPage />} />
              <Route path="/accounts" element={<AccountsPage />} />
              <Route path="/downloads" element={<DownloadsPage />} />
              <Route path="/multiplayer" element={<MultiplayerPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </main>
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
