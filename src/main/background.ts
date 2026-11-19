import { app, dialog, type BrowserWindow } from 'electron'
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const MAX_BYTES = 16 * 1024 * 1024
const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif'
}

export type BackgroundPickResult =
  | { ok: true; path: string }
  | { ok: false; reason: 'cancelled' | 'too-large' | 'unsupported' | 'read-error'; message?: string }

function backgroundsDir(): string {
  return path.join(app.getPath('userData'), 'backgrounds')
}

/** 选择一张图片并复制到 userData，返回落盘后的路径 */
export async function pickBackground(
  parent: BrowserWindow | null,
  locale: string
): Promise<BackgroundPickResult> {
  const options: Electron.OpenDialogOptions = {
    title: locale === 'en' ? 'Choose a background image' : '选择背景图片',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }]
  }
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
  const source = result.filePaths[0]
  if (result.canceled || !source) return { ok: false, reason: 'cancelled' }

  const extension = path.extname(source).toLowerCase()
  if (!MIME[extension]) return { ok: false, reason: 'unsupported', message: extension }

  try {
    const info = await stat(source)
    if (info.size > MAX_BYTES) return { ok: false, reason: 'too-large', message: String(info.size) }
    await mkdir(backgroundsDir(), { recursive: true })
    const target = path.join(backgroundsDir(), `bg-${Date.now()}${extension}`)
    await copyFile(source, target)
    return { ok: true, path: target }
  } catch (error) {
    return {
      ok: false,
      reason: 'read-error',
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * 渲染层不允许读文件系统，所以图片以 data URL 形式经 IPC 传过去。
 * 上限 16MB，超出直接返回 null，避免把内存撑爆。
 */
export async function loadBackgroundDataUrl(filePath: string | null): Promise<string | null> {
  if (!filePath) return null
  const extension = path.extname(filePath).toLowerCase()
  const mime = MIME[extension]
  if (!mime) return null
  try {
    const info = await stat(filePath)
    if (!info.isFile() || info.size > MAX_BYTES) return null
    const buffer = await readFile(filePath)
    return `data:${mime};base64,${buffer.toString('base64')}`
  } catch {
    return null
  }
}
