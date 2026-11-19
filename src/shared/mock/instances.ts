import type { Instance } from '../types'

/**
 * M0 阶段的示例实例。
 * 只描述与磁盘无关的字段，gameDir 由主进程按 userData 目录推导，
 * M3 接入真实实例存储后删除本文件的引用即可（InstanceRepository 是唯一替换点）。
 */
export type MockInstanceSeed = Omit<Instance, 'gameDir'>

export const MOCK_INSTANCES: MockInstanceSeed[] = [
  {
    id: 'vanilla-1.20.4',
    name: '原版 1.20.4',
    mcVersion: '1.20.4',
    loader: 'vanilla',
    loaderVersion: null,
    coverSeed: 'vanilla-1.20.4',
    lastPlayedAt: '2026-11-17T21:08:00.000Z',
    totalPlaytimeMs: 43 * 3600 * 1000,
    memoryMb: 4096,
    javaPath: null
  },
  {
    id: 'fabric-1.20.1',
    name: 'Fabric 生存服',
    mcVersion: '1.20.1',
    loader: 'fabric',
    loaderVersion: '0.15.11',
    coverSeed: 'fabric-1.20.1',
    lastPlayedAt: '2026-11-16T12:41:00.000Z',
    totalPlaytimeMs: 128 * 3600 * 1000,
    memoryMb: 6144,
    javaPath: null
  },
  {
    id: 'forge-1.19.2',
    name: 'Forge 机械整合',
    mcVersion: '1.19.2',
    loader: 'forge',
    loaderVersion: '43.3.5',
    coverSeed: 'forge-1.19.2',
    lastPlayedAt: '2026-10-28T09:15:00.000Z',
    totalPlaytimeMs: 76 * 3600 * 1000,
    memoryMb: 8192,
    javaPath: null
  }
]
