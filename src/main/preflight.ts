import { access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import type { PreflightStep } from '@shared/ipc'
import type { Instance } from '@shared/types'

async function exists(target: string): Promise<boolean> {
  try {
    await access(target, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/**
 * 启动前预检：只做文件系统层面的真实检查，不猜、不伪造。
 * M4 接入真正的启动链路后，这里会作为第一阶段沿用。
 */
export async function preflightInstance(instance: Instance): Promise<PreflightStep[]> {
  const steps: PreflightStep[] = []

  let dirOk = false
  try {
    dirOk = (await stat(instance.gameDir)).isDirectory()
  } catch {
    dirOk = false
  }
  steps.push({ id: 'dir', ok: dirOk, detail: instance.gameDir })

  const versionCandidates = [
    path.join(instance.gameDir, 'versions', instance.mcVersion, `${instance.mcVersion}.json`),
    path.join(instance.gameDir, 'mmc-pack.json'),
    path.join(instance.gameDir, 'minecraftinstance.json'),
    path.join(instance.gameDir, `${instance.mcVersion}.json`)
  ]
  let versionFile: string | null = null
  for (const candidate of versionCandidates) {
    if (await exists(candidate)) {
      versionFile = candidate
      break
    }
  }
  steps.push({
    id: 'version',
    ok: versionFile !== null,
    detail: versionFile ?? instance.mcVersion
  })

  let writable = false
  try {
    await access(instance.gameDir, constants.W_OK)
    writable = true
  } catch {
    writable = false
  }
  steps.push({ id: 'writable', ok: writable, detail: instance.gameDir })

  return steps
}
