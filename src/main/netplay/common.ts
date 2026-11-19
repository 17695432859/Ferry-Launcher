import { app, net } from 'electron'
import { createWriteStream } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { gunzipSync } from 'node:zlib'

/** 联机运行时的存放目录，和游戏实例完全隔离 */
export function netplayDir(...segments: string[]): string {
  return path.join(app.getPath('userData'), 'netplay', ...segments)
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}

export interface DownloadProgress {
  received: number
  total: number
}

/**
 * 下载到文件。GitHub 会 302 到 objects.githubusercontent.com，
 * net.fetch 默认跟随重定向，这里只需要按块计数上报进度。
 * 15 秒没有任何数据就判定卡死并中断，交给上层换镜像重试。
 */
export async function downloadFile(
  url: string,
  dest: string,
  onProgress?: (progress: DownloadProgress) => void,
  stallMs = 15000
): Promise<void> {
  const controller = new AbortController()
  let stallTimer: NodeJS.Timeout | null = null
  const armStall = (): void => {
    if (stallTimer) clearTimeout(stallTimer)
    stallTimer = setTimeout(() => controller.abort(), stallMs)
  }
  armStall()

  try {
    const response = await net.fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': `FerryLauncher/${app.getVersion()}`,
        Accept: 'application/octet-stream'
      }
    })
    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`)
    }
    const total = Number(response.headers.get('content-length') ?? 0)
    let received = 0
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length
        armStall()
        onProgress?.({ received, total })
        callback(null, chunk)
      }
    })
    await ensureDir(path.dirname(dest))
    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      counter,
      createWriteStream(dest)
    )
  } finally {
    if (stallTimer) clearTimeout(stallTimer)
  }
}

/** 依次尝试多个镜像，前一个失败/卡死就换下一个 */
export async function downloadFromMirrors(
  urls: string[],
  dest: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<void> {
  let lastError: unknown = null
  for (const url of urls) {
    try {
      await removeQuietly(dest)
      await downloadFile(url, dest, onProgress)
      return
    } catch (error) {
      lastError = error
    }
  }
  throw lastError ?? new Error('ALL_MIRRORS_FAILED')
}

/** 读取 GitHub 最新 release，取不到就返回 null，由调用方回退到内置版本号 */
export async function fetchLatestRelease(
  repo: string
): Promise<{ tag: string; version: string; assets: string[] } | null> {
  try {
    const response = await net.fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: {
        'User-Agent': `FerryLauncher/${app.getVersion()}`,
        Accept: 'application/vnd.github+json'
      }
    })
    if (!response.ok) return null
    const data = (await response.json()) as {
      tag_name?: string
      assets?: Array<{ name?: string }>
    }
    const tag = data.tag_name ?? ''
    if (!tag) return null
    return {
      tag,
      version: tag.replace(/^v/, ''),
      assets: (data.assets ?? []).map((asset) => asset.name ?? '').filter(Boolean)
    }
  } catch {
    return null
  }
}

interface TarEntry {
  name: string
  data: Buffer
}

/** 极简 tar 解析：只处理普通文件，够解压官方发行包用 */
function parseTar(buffer: Buffer): TarEntry[] {
  const entries: TarEntry[] = []
  let offset = 0
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512)
    // 连续两个全零块代表归档结束
    if (header.every((byte) => byte === 0)) break
    const rawName = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '')
    const name = prefix ? `${prefix}/${rawName}` : rawName
    const size = parseInt(header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim(), 8) || 0
    const typeFlag = String.fromCharCode(header[156] ?? 0)
    const dataStart = offset + 512
    if (typeFlag === '0' || typeFlag === '\0') {
      entries.push({ name, data: buffer.subarray(dataStart, dataStart + size) })
    }
    offset = dataStart + Math.ceil(size / 512) * 512
  }
  return entries
}

/**
 * 解压 .tar.gz，把其中所有普通文件写到 destDir。
 * 返回写出的相对路径列表。
 */
export async function extractTarGz(archive: string, destDir: string): Promise<string[]> {
  const { readFile } = await import('node:fs/promises')
  const compressed = await readFile(archive)
  const entries = parseTar(gunzipSync(compressed))
  const written: string[] = []
  await ensureDir(destDir)
  for (const entry of entries) {
    const safeName = path.basename(entry.name)
    if (!safeName || entry.name.endsWith('/')) continue
    await writeFile(path.join(destDir, safeName), entry.data)
    written.push(safeName)
  }
  return written
}

export async function removeQuietly(target: string): Promise<void> {
  await rm(target, { recursive: true, force: true }).catch(() => undefined)
}

/** 平台标识；两个上游项目的架构命名不一样，由各自的 provider 再拼 */
export function osKey(): 'windows' | 'macos' | 'linux' {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'macos'
  return 'linux'
}

export function archKey(): string {
  if (process.arch === 'x64') return 'x86_64'
  if (process.arch === 'ia32') return 'i686'
  if (process.arch === 'arm64') return 'arm64'
  return process.arch
}
