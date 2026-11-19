import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { MOCK_INSTANCES } from '@shared/mock/instances'
import type { Instance } from '@shared/types'

function isInstance(value: unknown): value is Instance {
  if (!value || typeof value !== 'object') return false
  const raw = value as Record<string, unknown>
  return (
    typeof raw.id === 'string' &&
    typeof raw.name === 'string' &&
    typeof raw.mcVersion === 'string' &&
    typeof raw.gameDir === 'string'
  )
}

/**
 * 实例仓库。M0 用 mock 种子写入 instances.json，之后所有增删都走真实文件。
 * M3 接入版本安装后，只需在这里补 create()，UI 与 IPC 不用改。
 */
class InstanceRepository {
  private cache: Instance[] | null = null

  private get filePath(): string {
    return path.join(app.getPath('userData'), 'instances.json')
  }

  async list(): Promise<Instance[]> {
    await this.ensureLoaded()
    return this.cache ? [...this.cache] : []
  }

  /** 同一个目录 + 同一个版本才算重复；一个 .minecraft 下可以有多个版本实例 */
  private isSameSlot(a: Instance, b: Instance): boolean {
    if (a.gameDir.toLowerCase() !== b.gameDir.toLowerCase()) return false
    return (a.versionId ?? '') === (b.versionId ?? '')
  }

  async add(instance: Instance): Promise<Instance[]> {
    await this.ensureLoaded()
    if (this.cache?.some((item) => this.isSameSlot(item, instance))) {
      throw new Error('DUPLICATE_GAME_DIR')
    }
    this.cache = [...(this.cache ?? []), instance]
    await this.persist()
    return [...this.cache]
  }

  /** 批量添加，返回真正加进去的那些，重复的直接跳过 */
  async addMany(instances: Instance[]): Promise<Instance[]> {
    await this.ensureLoaded()
    const accepted: Instance[] = []
    for (const instance of instances) {
      if (this.cache?.some((item) => this.isSameSlot(item, instance))) continue
      this.cache = [...(this.cache ?? []), instance]
      accepted.push(instance)
    }
    if (accepted.length > 0) await this.persist()
    return accepted
  }

  /** 只接受白名单字段，数值一律夹在合理区间 */
  async update(id: string, patch: Record<string, unknown>): Promise<Instance[]> {
    await this.ensureLoaded()
    this.cache = (this.cache ?? []).map((item) => {
      if (item.id !== id) return item
      const next = { ...item }
      if (typeof patch.name === 'string' && patch.name.trim().length > 0) {
        next.name = patch.name.trim().slice(0, 48)
      }
      if (typeof patch.memoryMb === 'number' && Number.isFinite(patch.memoryMb)) {
        next.memoryMb = Math.min(32768, Math.max(1024, Math.round(patch.memoryMb / 512) * 512))
      }
      if (patch.javaPath === null) {
        next.javaPath = null
      } else if (typeof patch.javaPath === 'string' && patch.javaPath.trim().length > 0) {
        next.javaPath = patch.javaPath.trim().slice(0, 512)
      }
      if (typeof patch.jvmArgs === 'string') {
        next.jvmArgs = patch.jvmArgs.slice(0, 2000)
      }
      if (typeof patch.isolated === 'boolean') {
        next.isolated = patch.isolated
      }
      return next
    })
    await this.persist()
    return [...(this.cache ?? [])]
  }

  async remove(id: string): Promise<Instance[]> {
    await this.ensureLoaded()
    this.cache = (this.cache ?? []).filter((item) => item.id !== id)
    await this.persist()
    return [...this.cache]
  }

  async get(id: string): Promise<Instance | null> {
    await this.ensureLoaded()
    return this.cache?.find((item) => item.id === id) ?? null
  }

  private async ensureLoaded(): Promise<void> {
    if (this.cache) return
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'))
      if (Array.isArray(parsed)) {
        const valid = parsed.filter(isInstance)
        if (valid.length > 0 || parsed.length === 0) {
          this.cache = valid
          return
        }
      }
    } catch {
      // 文件不存在或损坏：落到种子数据
    }
    this.cache = await this.seed()
    await this.persist()
  }

  /** 首次启动写入示例实例，gameDir 指向 userData 下的真实目录，便于「打开文件夹」验证 */
  private async seed(): Promise<Instance[]> {
    const baseDir = path.join(app.getPath('userData'), 'instances')
    const seeded: Instance[] = []
    for (const seed of MOCK_INSTANCES) {
      const gameDir = path.join(baseDir, seed.id)
      try {
        await mkdir(gameDir, { recursive: true })
      } catch {
        // 目录创建失败不影响实例列表展示
      }
      seeded.push({ ...seed, gameDir })
    }
    return seeded
  }

  private async persist(): Promise<void> {
    if (!this.cache) return
    await mkdir(path.dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(this.cache, null, 2), 'utf8')
  }
}

export const instanceRepository = new InstanceRepository()
