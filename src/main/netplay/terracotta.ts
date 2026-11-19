import { spawn, type ChildProcess } from 'node:child_process'
import { chmod, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { NetplayInstallOutcome, NetplayOutcome } from '@shared/ipc'
import type { NetplayRuntime, NetplayStatus } from '@shared/types'
import { IDLE_NETPLAY_STATUS } from '@shared/types'
import {
  archKey,
  downloadFromMirrors,
  ensureDir,
  extractTarGz,
  fetchLatestRelease,
  netplayDir,
  osKey,
  removeQuietly
} from './common'

/**
 * Terracotta | 陶瓦联机（AGPL-3.0，作者 burningtnt）
 * 上游：https://github.com/burningtnt/Terracotta
 *
 * 这里只做两件事：调用官方发行包里的可执行文件、走它自带的本地 HTTP 接口。
 * 二进制不做任何修改，界面里保留版权标识。
 *
 * 启动约定（读自上游 src/main.rs）：
 *   terracotta --hmcl <portFile>
 *   → 进程把 {"port": N} 原子写入 <portFile>，HTTP 服务监听 127.0.0.1:N
 */

const REPO = 'burningtnt/Terracotta'
/** 取不到 GitHub API 时的兜底版本，来自官方 releases */
const FALLBACK_VERSION = '0.4.2'

const dir = (): string => netplayDir('terracotta')
const binaryPath = (): string =>
  path.join(dir(), process.platform === 'win32' ? 'terracotta.exe' : 'terracotta')

interface Session {
  child: ChildProcess
  port: number
  timer: NodeJS.Timeout | null
  status: NetplayStatus
}

let session: Session | null = null
let pushStatus: (status: NetplayStatus) => void = () => undefined

export function onStatus(listener: (status: NetplayStatus) => void): void {
  pushStatus = listener
}

async function readInstalledVersion(): Promise<string | null> {
  try {
    const raw = await readFile(path.join(dir(), 'version.json'), 'utf8')
    const parsed = JSON.parse(raw) as { version?: string }
    return parsed.version ?? null
  } catch {
    return null
  }
}

export async function runtime(): Promise<NetplayRuntime> {
  const version = await readInstalledVersion()
  let installed = false
  if (version) {
    try {
      const info = await stat(binaryPath())
      installed = info.isFile() && info.size > 0
    } catch {
      installed = false
    }
  }
  return {
    provider: 'terracotta',
    installed,
    version,
    path: installed ? binaryPath() : null
  }
}

function assetName(version: string): string {
  // 上游命名：terracotta-<version>-<os>-<arch>-pkg.tar.gz
  const os = osKey()
  const arch = process.platform === 'darwin' && process.arch === 'arm64' ? 'arm64' : archKey()
  return `terracotta-${version}-${os}-${arch}-pkg.tar.gz`
}

export async function install(
  onProgress?: (received: number, total: number) => void
): Promise<NetplayInstallOutcome> {
  const os = osKey()
  if (os === 'windows' && process.arch === 'ia32') {
    return { ok: false, reason: 'unsupported', message: 'Windows 32 位暂无 Terracotta 发行包' }
  }

  const latest = await fetchLatestRelease(REPO)
  const version = latest?.version ?? FALLBACK_VERSION
  const asset = assetName(version)
  if (latest && !latest.assets.includes(asset)) {
    return { ok: false, reason: 'unsupported', message: `当前平台没有发行包：${asset}` }
  }

  // Gitee 是上游自己挂的国内镜像，先试它，卡住再回 GitHub
  const urls = [
    `https://gitee.com/burningtnt/Terracotta/releases/download/v${version}/${asset}`,
    `https://github.com/${REPO}/releases/download/v${version}/${asset}`
  ]
  const tmp = netplayDir('terracotta-download.tar.gz')
  try {
    await ensureDir(dir())
    await downloadFromMirrors(urls, tmp, (progress) =>
      onProgress?.(progress.received, progress.total)
    )
    await removeQuietly(dir())
    await ensureDir(dir())
    const written = await extractTarGz(tmp, dir())
    const exe = written.find((name) => name.startsWith(`terracotta-${version}`))
    if (!exe) {
      return { ok: false, reason: 'extract', message: '发行包里没有找到主程序' }
    }
    const target = binaryPath()
    const source = path.join(dir(), exe)
    if (source !== target) {
      const { rename } = await import('node:fs/promises')
      await rename(source, target)
    }
    if (process.platform !== 'win32') await chmod(target, 0o755)
    await writeFile(path.join(dir(), 'version.json'), JSON.stringify({ version }), 'utf8')
    return { ok: true, runtime: await runtime() }
  } catch (error) {
    return {
      ok: false,
      reason: 'network',
      message: error instanceof Error ? error.message : String(error)
    }
  } finally {
    await removeQuietly(tmp)
  }
}

/** 等 --hmcl 模式把端口写进文件；上游最多 8 秒 */
async function waitForPort(file: string, timeoutMs = 12000): Promise<number> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const raw = await readFile(file, 'utf8')
      const parsed = JSON.parse(raw) as { port?: number }
      if (typeof parsed.port === 'number' && parsed.port > 0) return parsed.port
    } catch {
      // 文件还没生成，继续等
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('TIMEOUT')
}

async function api(port: number, route: string): Promise<unknown> {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    signal: AbortSignal.timeout(5000)
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const text = await response.text()
  return text ? JSON.parse(text) : null
}

interface TerracottaState {
  state?: string
  room?: string
  url?: string
  type?: number
}

const EXCEPTION_TEXT: Record<number, string> = {
  0: '房主网络不可达',
  1: '房主连接被重置',
  2: '客人侧虚拟网络异常退出',
  3: '房主侧虚拟网络异常退出',
  4: '联机端口被重置',
  5: '房间握手失败'
}

function mapState(raw: TerracottaState, current: NetplayStatus): NetplayStatus {
  const base: NetplayStatus = { ...current, message: null, errorCode: null }
  switch (raw.state) {
    case 'waiting':
      return { ...base, phase: 'waiting', joinAddress: null }
    case 'host-scanning':
      return { ...base, phase: 'scanning', message: null }
    case 'host-starting':
      return { ...base, phase: 'starting', roomCode: raw.room ?? current.roomCode }
    case 'host-ok':
      return { ...base, phase: 'hosting', roomCode: raw.room ?? current.roomCode }
    case 'guest-connecting':
      return { ...base, phase: 'connecting', roomCode: raw.room ?? current.roomCode }
    case 'guest-starting':
      return { ...base, phase: 'connecting', roomCode: raw.room ?? current.roomCode }
    case 'guest-ok':
      return { ...base, phase: 'connected', joinAddress: raw.url ?? null }
    case 'exception':
      return {
        ...base,
        phase: 'error',
        errorCode: `TC${raw.type ?? 0}`,
        message: EXCEPTION_TEXT[raw.type ?? 0] ?? '联机异常'
      }
    default:
      return base
  }
}

function stopPolling(): void {
  if (session?.timer) {
    clearInterval(session.timer)
    session.timer = null
  }
}

async function refresh(): Promise<NetplayStatus> {
  if (!session) return IDLE_NETPLAY_STATUS
  try {
    const raw = (await api(session.port, '/state')) as TerracottaState
    session.status = mapState(raw, session.status)
  } catch {
    // 进程刚起来时接口可能还没就绪，保持上一状态
  }
  pushStatus(session.status)
  return session.status
}

/** 启动进程并等待端口文件，成功后开始 1 秒轮询状态 */
async function ensureRunning(): Promise<NetplayStatus> {
  if (session) return session.status
  const info = await runtime()
  if (!info.installed) throw new Error('NOT_INSTALLED')

  const portFile = netplayDir('terracotta-port.json')
  await removeQuietly(portFile)
  const child = spawn(binaryPath(), ['--hmcl', portFile], {
    cwd: dir(),
    windowsHide: true,
    stdio: 'ignore'
  })
  child.on('exit', () => {
    stopPolling()
    session = null
    pushStatus({ ...IDLE_NETPLAY_STATUS, message: null })
  })

  const port = await waitForPort(portFile)
  const status: NetplayStatus = {
    ...IDLE_NETPLAY_STATUS,
    provider: 'terracotta',
    phase: 'waiting',
    virtualIp: null
  }
  session = { child, port, timer: null, status }
  session.timer = setInterval(() => void refresh(), 1000)
  await refresh()
  return session.status
}

export async function host(room: string, playerName: string): Promise<NetplayOutcome> {
  try {
    await ensureRunning()
    if (!session) throw new Error('NOT_RUNNING')
    const query = new URLSearchParams()
    if (room) query.set('room', room)
    if (playerName) query.set('player', playerName)
    await api(session.port, `/state/scanning?${query.toString()}`)
    session.status = { ...session.status, phase: 'scanning', roomCode: room || null }
    return { ok: true, status: await refresh() }
  } catch (error) {
    return fail(error)
  }
}

export async function join(room: string, playerName: string): Promise<NetplayOutcome> {
  try {
    await ensureRunning()
    if (!session) throw new Error('NOT_RUNNING')
    const query = new URLSearchParams({ room })
    if (playerName) query.set('player', playerName)
    await api(session.port, `/state/guesting?${query.toString()}`)
    session.status = { ...session.status, phase: 'connecting', roomCode: room }
    return { ok: true, status: await refresh() }
  } catch (error) {
    return fail(error)
  }
}

function fail(error: unknown): NetplayOutcome {
  const message = error instanceof Error ? error.message : String(error)
  const reason =
    message === 'NOT_INSTALLED'
      ? 'not-installed'
      : message === 'TIMEOUT'
        ? 'timeout'
        : message.startsWith('HTTP')
          ? 'rejected'
          : 'error'
  return { ok: false, reason, message }
}

export async function stop(): Promise<NetplayStatus> {
  if (!session) return IDLE_NETPLAY_STATUS
  try {
    await api(session.port, '/state/ide')
  } catch {
    // 接口不通就直接杀进程
  }
  stopPolling()
  const child = session.child
  session = null
  try {
    child.kill()
  } catch {
    // 已经退出
  }
  pushStatus(IDLE_NETPLAY_STATUS)
  return IDLE_NETPLAY_STATUS
}

export async function status(): Promise<NetplayStatus> {
  return session ? session.status : IDLE_NETPLAY_STATUS
}

/** 应用退出时兜底清理，避免留下孤儿进程 */
export function dispose(): void {
  stopPolling()
  session?.child.kill()
  session = null
}

/** 调试用：确认解压后的目录内容 */
export async function listInstalledFiles(): Promise<string[]> {
  try {
    return await readdir(dir())
  } catch {
    return []
  }
}
