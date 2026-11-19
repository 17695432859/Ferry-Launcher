import { app, type BrowserWindow } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * 开发用截图工具：设置 FERRY_CAPTURE=home|settings|accounts|downloads
 * 支持带后缀点击子标签：home-mods / home-settings
 * 启动后按 1440×900 截一张图写到 shots/ 然后退出。
 * 生产构建里没有这个环境变量，逻辑不会执行。
 */
export const CAPTURE_TARGET = process.env['FERRY_CAPTURE'] ?? null

export function captureRoute(target: string): string {
  const [route] = target.split('-')
  return route || 'home'
}

export async function captureAndExit(win: BrowserWindow, target: string): Promise<void> {
  const dir = process.env['FERRY_CAPTURE_DIR'] ?? path.join(process.cwd(), 'shots')
  await mkdir(dir, { recursive: true })
  const log: string[] = []

  win.webContents.on('console-message', (_event, level, message) => {
    log.push(`[renderer:${level}] ${message}`)
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    log.push(`[gone] ${details.reason} exit=${details.exitCode}`)
  })

  // 等字体、动画首帧和 IPC 初始化都稳定下来
  await new Promise((resolve) => setTimeout(resolve, 1600))

  const tab = target.includes('-') ? target.slice(target.indexOf('-') + 1) : null
  if (tab) {
    try {
      const result = await win.webContents.executeJavaScript(
        `(() => {
           const el =
             document.querySelector('[data-tab="${tab}"]') ??
             document.querySelector('[data-action="${tab}"]') ??
             document.querySelector('[data-provider="${tab}"]');
           if (!el) return 'NOT_FOUND';
           el.click();
           return 'CLICKED';
         })()`
      )
      log.push(`[tab] ${tab} -> ${String(result)}`)
    } catch (error) {
      log.push(`[tab-error] ${(error as Error).message}`)
    }
    const extra = Number(process.env['FERRY_CAPTURE_WAIT'] ?? 900)
    await new Promise((resolve) => setTimeout(resolve, Number.isFinite(extra) ? extra : 900))
  }

  try {
    const text = await win.webContents.executeJavaScript(
      `document.body.innerText.replace(/\\s+/g, ' ').slice(0, 600)`
    )
    log.push(`[text] ${String(text)}`)
  } catch {
    log.push('[text] unavailable')
  }

  try {
    const image = await win.webContents.capturePage()
    await writeFile(path.join(dir, `${target}.png`), image.toPNG())
  } catch (error) {
    log.push(`[capture-error] ${(error as Error).message}`)
  }

  await writeFile(path.join(dir, '_capture.log'), `${log.join('\n')}\n`, 'utf8')
  app.quit()
}
