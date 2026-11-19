import { BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { IPC } from '@shared/ipc'
import type { WindowState } from '@shared/types'
import { CAPTURE_TARGET, captureAndExit, captureRoute } from './capture'

const isDev = !!process.env['ELECTRON_RENDERER_URL']

function readState(win: BrowserWindow): WindowState {
  return { maximized: win.isMaximized(), focused: win.isFocused() }
}

/**
 * 无边框主窗口。
 * 刻意不使用 transparent: true —— 毛玻璃模糊的是应用自绘的极光背景，
 * 而不是桌面，这样在 Win7 到 Win11、macOS、Linux 上表现一致。
 */
export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: CAPTURE_TARGET ? 1440 : 1280,
    height: CAPTURE_TARGET ? 900 : 820,
    useContentSize: !!CAPTURE_TARGET,
    minWidth: 1040,
    minHeight: 660,
    show: false,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    trafficLightPosition: process.platform === 'darwin' ? { x: 16, y: 18 } : undefined,
    backgroundColor: '#0a0e18',
    title: 'Ferry Launcher',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: isDev
    }
  })

  win.once('ready-to-show', () => {
    win.show()
  })

  const pushState = (): void => {
    if (win.isDestroyed()) return
    win.webContents.send(IPC.windowState, readState(win))
  }
  win.on('maximize', pushState)
  win.on('unmaximize', pushState)
  win.on('focus', pushState)
  win.on('blur', pushState)

  // 渲染层不允许自己开窗或跳转，外链一律交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && url.startsWith(devUrl)) return
    event.preventDefault()
  })

  const captureRoutePath = CAPTURE_TARGET ? captureRoute(CAPTURE_TARGET) : null
  const route = captureRoutePath && captureRoutePath !== 'home' ? `/${captureRoutePath}` : '/'

  if (isDev) {
    const base = process.env['ELECTRON_RENDERER_URL'] as string
    void win.loadURL(`${base}#${route}`)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'), { hash: route })
  }

  const captureTarget = CAPTURE_TARGET
  if (captureTarget) {
    win.webContents.once('did-finish-load', () => {
      void captureAndExit(win, captureTarget)
    })
  }

  return win
}
