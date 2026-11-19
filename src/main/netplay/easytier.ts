import { spawn, type ChildProcess } from 'node:child_process'
import { chmod, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import AdmZip from 'adm-zip'
import type { NetplayInstallOutcome, NetplayOutcome } from '@shared/ipc'
import type { EasyTierConfig, NetplayRuntime, NetplayStatus, RoomCodeInfo } from '@shared/types'
import { IDLE_NETPLAY_STATUS } from '@shared/types'
import * as roomcode from './roomcode'
import {
  archKey,
  downloadFromMirrors,
  ensureDir,
  fetchLatestRelease,
  netplayDir,
  osKey,
  removeQuietly
} from './common'

/**
 * EasyTier 直连（Apache-2.0）
 * 上游：https://github.com/EasyTier/EasyTier
 *
 * 这里只调用官方发行包里的 easytier-core / easytier-cli：
 *   easytier-core --network-name X --network-secret Y -p <peer> ...
 *   easytier-cli node
 */

const REPO = 'EasyTier/EasyTier'
const FALLBACK_VERSION = '2.6.4'

const dir = (): string => netplayDir('easytier')
const exe = (name: string): string => path.join(dir(), process.platform === 'win32' ? `${name}.exe` : name)
const configPath = (): string => netplayDir('easytier.json')

interface Session {
  child: ChildProcess
  timer: NodeJS.Timeout | null
  status: NetplayStatus
}

let session: Session | null = null
let pushStatus: (status: NetplayStatus) => void = () => undefined

export function onStatus(listener: (status: NetplayStatus) => void): void {
  pushStatus = listener
}

const DEFAULT_CONFIG: EasyTierConfig = {
  code: '',
  networkName: '',
  networkSecret: '',
  peers: '',
  role: 'guest'
}

/** 房主用联机中心的发现名，加入方随便取一个不冲突的名字 */
function hostnameOf(config: EasyTierConfig): string {
  if (config.role === 'host') return roomcode.centerHostname(config.port ?? 25565)
  return `ferry-${Math.random().toString(36).slice(2, 8)}`
}

export async function getConfig(): Promise<EasyTierConfig> {
  try {
    const raw = await readFile(configPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<EasyTierConfig>
    return {
      code: typeof parsed.code === 'string' ? parsed.code : '',
      networkName: typeof parsed.networkName === 'string' ? parsed.networkName : '',
      networkSecret: typeof parsed.networkSecret === 'string' ? parsed.networkSecret : '',
      peers: typeof parsed.peers === 'string' ? parsed.peers : '',
      role: parsed.role === 'host' ? 'host' : 'guest',
      port: typeof parsed.port === 'number' ? parsed.port : undefined
    }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export async function saveConfig(next: EasyTierConfig): Promise<EasyTierConfig> {
  // 有联机码就以码为准，网络名和密钥由协议推出来，避免两边不一致
  const parsed = next.code ? roomcode.parse(next.code) : null
  const clean: EasyTierConfig = {
    code: parsed?.code ?? '',
    networkName: (parsed?.networkName ?? next.networkName).trim().slice(0, 64),
    networkSecret: (parsed?.networkSecret ?? next.networkSecret).trim().slice(0, 128),
    peers: next.peers.trim().slice(0, 2000),
    role: next.role === 'host' ? 'host' : 'guest',
    port: next.port && next.port > 0 && next.port < 65536 ? Math.trunc(next.port) : undefined
  }
  await ensureDir(netplayDir())
  await writeFile(configPath(), JSON.stringify(clean, null, 2), 'utf8')
  return clean
}

export function generateCode(): RoomCodeInfo {
  return roomcode.parse(roomcode.generate()) as RoomCodeInfo
}

export function parseCode(code: string): RoomCodeInfo | null {
  return roomcode.parse(code)
}

export async function runtime(): Promise<NetplayRuntime> {
  let version: string | null = null
  try {
    const raw = await readFile(path.join(dir(), 'version.json'), 'utf8')
    version = (JSON.parse(raw) as { version?: string }).version ?? null
  } catch {
    version = null
  }
  let installed = false
  try {
    const core = await stat(exe('easytier-core'))
    const cli = await stat(exe('easytier-cli'))
    installed = core.isFile() && core.size > 0 && cli.isFile() && cli.size > 0
  } catch {
    installed = false
  }
  return {
    provider: 'easytier',
    installed,
    version,
    path: installed ? exe('easytier-core') : null
  }
}

function assetName(version: string): string {
  // 上游命名：easytier-<os>-<arch>-v<version>.zip
  const os = osKey()
  const arch = process.arch === 'arm64' && os !== 'macos' ? 'aarch64' : archKey()
  return `easytier-${os}-${arch}-v${version}.zip`
}

export async function install(
  onProgress?: (received: number, total: number) => void
): Promise<NetplayInstallOutcome> {
  const latest = await fetchLatestRelease(REPO)
  const version = latest?.version ?? FALLBACK_VERSION
  const asset = assetName(version)
  if (latest && !latest.assets.includes(asset)) {
    return { ok: false, reason: 'unsupported', message: `当前平台没有发行包：${asset}` }
  }

  const url = `https://github.com/${REPO}/releases/download/v${version}/${asset}`
  const tmp = netplayDir('easytier-download.zip')
  try {
    await ensureDir(dir())
    await downloadFromMirrors([url], tmp, (progress) =>
      onProgress?.(progress.received, progress.total)
    )
    await removeQuietly(dir())
    await ensureDir(dir())
    new AdmZip(tmp).extractAllTo(dir(), true)
    if (process.platform !== 'win32') {
      await chmod(exe('easytier-core'), 0o755).catch(() => undefined)
      await chmod(exe('easytier-cli'), 0o755).catch(() => undefined)
    }
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

function splitPeers(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((peer) => peer.trim())
    .filter(Boolean)
}

/** 从 easytier-cli node 的表格里挑出本机虚拟 IP，取不到就返回 null */
async function queryVirtualIp(): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(exe('easytier-cli'), ['node'], { windowsHide: true })
    let output = ''
    const done = (value: string | null): void => resolve(value)
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8')
    })
    child.on('error', () => done(null))
    child.on('exit', () => {
      const matches = output.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? []
      const ip = matches.find((candidate) => !candidate.startsWith('127.') && candidate !== '0.0.0.0')
      done(ip ?? null)
    })
    setTimeout(() => {
      child.kill()
      done(null)
    }, 3000)
  })
}

function stopPolling(): void {
  if (session?.timer) {
    clearInterval(session.timer)
    session.timer = null
  }
}

export async function start(config: EasyTierConfig): Promise<NetplayOutcome> {
  if (session) return { ok: true, status: session.status }
  const info = await runtime()
  if (!info.installed) return { ok: false, reason: 'not-installed', message: '运行时未安装' }
  if (!config.networkName || !config.networkSecret) {
    return { ok: false, reason: 'invalid', message: '网络名和密码不能为空' }
  }

  const args = [
    '--network-name',
    config.networkName,
    '--network-secret',
    config.networkSecret,
    '--hostname',
    hostnameOf(config)
  ]
  for (const peer of splitPeers(config.peers)) {
    args.push('-p', peer)
  }

  const child = spawn(exe('easytier-core'), args, {
    cwd: dir(),
    windowsHide: true,
    stdio: 'ignore'
  })
  child.on('exit', () => {
    stopPolling()
    session = null
    pushStatus(IDLE_NETPLAY_STATUS)
  })

  const status: NetplayStatus = {
    ...IDLE_NETPLAY_STATUS,
    provider: 'easytier',
    phase: 'connecting',
    message: config.networkName
  }
  session = { child, timer: null, status }
  session.timer = setInterval(() => {
    void (async () => {
      if (!session) return
      const ip = await queryVirtualIp()
      session.status = { ...session.status, phase: ip ? 'connected' : 'connecting', virtualIp: ip }
      pushStatus(session.status)
    })()
  }, 2000)
  return { ok: true, status }
}

export async function stop(): Promise<NetplayStatus> {
  if (!session) return IDLE_NETPLAY_STATUS
  stopPolling()
  const child = session.child
  session = null
  try {
    child.kill()
  } catch {
    // 已退出
  }
  pushStatus(IDLE_NETPLAY_STATUS)
  return IDLE_NETPLAY_STATUS
}

export async function status(): Promise<NetplayStatus> {
  return session ? session.status : IDLE_NETPLAY_STATUS
}

export function dispose(): void {
  stopPolling()
  session?.child.kill()
  session = null
}
