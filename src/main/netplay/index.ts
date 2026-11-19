import type { NetplayOutcome } from '@shared/ipc'
import type { EasyTierConfig, NetplayProviderId, NetplayRuntime, NetplayStatus, RoomCodeInfo } from '@shared/types'
import { IDLE_NETPLAY_STATUS } from '@shared/types'
import * as easyTier from './easytier'
import * as terracotta from './terracotta'

/**
 * 联机门面：把两个 provider 收敛成一组接口，
 * 主进程只维护"当前是谁在跑"，UI 只认 NetplayStatus。
 */

let sink: (status: NetplayStatus) => void = () => undefined
let active: NetplayProviderId | null = null

export function setStatusSink(listener: (status: NetplayStatus) => void): void {
  sink = listener
  terracotta.onStatus((status) => {
    if (status.phase === 'idle') active = null
    sink(status)
  })
  easyTier.onStatus((status) => {
    if (status.phase === 'idle') active = null
    sink(status)
  })
}

export function runtime(provider: NetplayProviderId): Promise<NetplayRuntime> {
  return provider === 'terracotta' ? terracotta.runtime() : easyTier.runtime()
}

export function install(
  provider: NetplayProviderId,
  onProgress: (received: number, total: number) => void
): Promise<Awaited<ReturnType<typeof terracotta.install>>> {
  return provider === 'terracotta' ? terracotta.install(onProgress) : easyTier.install(onProgress)
}

export async function host(
  provider: NetplayProviderId,
  room: string,
  playerName: string
): Promise<NetplayOutcome> {
  if (provider === 'easytier') {
    return { ok: false, reason: 'wrong-mode', message: 'EasyTier 直连请使用"开始组网"' }
  }
  const outcome = await terracotta.host(room, playerName)
  if (outcome.ok) active = provider
  return outcome
}

export async function join(
  provider: NetplayProviderId,
  room: string,
  playerName: string
): Promise<NetplayOutcome> {
  if (provider === 'easytier') {
    return { ok: false, reason: 'wrong-mode', message: 'EasyTier 直连请使用"开始组网"' }
  }
  const outcome = await terracotta.join(room, playerName)
  if (outcome.ok) active = provider
  return outcome
}

export async function startEasyTier(config: EasyTierConfig): Promise<NetplayOutcome> {
  const saved = await easyTier.saveConfig(config)
  const outcome = await easyTier.start(saved)
  if (outcome.ok) active = 'easytier'
  return outcome
}

export function easyTierConfig(): Promise<EasyTierConfig> {
  return easyTier.getConfig()
}

/** 生成一个官方格式的联机码，陶瓦和 EasyTier 共用 */
export function generateCode(): RoomCodeInfo {
  return easyTier.generateCode()
}

/** 校验并解析联机码，不合法返回 null */
export function parseCode(code: string): RoomCodeInfo | null {
  return easyTier.parseCode(code)
}

export async function stop(): Promise<NetplayStatus> {
  const status = active === 'easytier' ? await easyTier.stop() : await terracotta.stop()
  active = null
  return status
}

export async function status(): Promise<NetplayStatus> {
  if (active === 'easytier') return easyTier.status()
  if (active === 'terracotta') return terracotta.status()
  return IDLE_NETPLAY_STATUS
}

export function dispose(): void {
  terracotta.dispose()
  easyTier.dispose()
}
