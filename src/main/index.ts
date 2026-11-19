import { app, BrowserWindow, session } from 'electron'
import { createMainWindow } from './window'
import { registerIpcHandlers } from './ipc'
import { setStatusSink } from './netplay'
import * as netplay from './netplay'
import { IPC } from '@shared/ipc'

const isDev = !!process.env['ELECTRON_RENDERER_URL']

/**
 * 生产环境 CSP：渲染层只允许加载打包内的资源。
 * 所有网络请求都必须走主进程，所以 connect-src 收紧到 'self'。
 * 皮肤贴图由 https 直接加载（img-src），不放开 script/style 的远程来源。
 */
const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ')

/** 开发环境需要放行 Vite 的 HMR websocket 与内联样式 */
const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' ws://localhost:* http://localhost:*",
  "object-src 'none'",
  "base-uri 'none'"
].join('; ')

function applySecurityPolicy(): void {
  const csp = isDev ? DEV_CSP : PROD_CSP
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    })
  })
  // 启动器不需要摄像头/麦克风/定位等权限，一律拒绝
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false)
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('cn.ferry.launcher')
    applySecurityPolicy()
    registerIpcHandlers()
    const win = createMainWindow()

    // 联机状态由主进程推送，渲染层只负责渲染
    setStatusSink((status) => {
      if (!win.isDestroyed()) win.webContents.send(IPC.netplayStatusEvent, status)
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('before-quit', () => {
    netplay.dispose()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
