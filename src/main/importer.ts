import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { LoaderKind, ScanWarning } from '@shared/types'

export interface ScanResult {
  mcVersion: string
  loader: LoaderKind
  loaderVersion: string | null
  suggestedName: string
  warnings: ScanWarning[]
}

interface VersionJson {
  id?: string
  clientVersion?: string
  inheritsFrom?: string
  mainClass?: string
  libraries?: Array<{ name?: string }>
}

interface MmcPackJson {
  components?: Array<{ uid?: string; version?: string }>
}

interface CurseForgeInstanceJson {
  name?: string
  gameVersion?: string
  baseModLoader?: { name?: string; forgeVersion?: string; mavenVersionString?: string }
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory()
  } catch {
    return false
  }
}

async function readJsonSafe<T>(target: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(target, 'utf8')) as T
  } catch {
    return null
  }
}

function splitLoaderVersion(raw: string | undefined): string | null {
  if (!raw) return null
  const match = raw.match(/(\d+(?:\.\d+){1,3}(?:[-+][\w.]+)?)/)
  return match ? match[1] : null
}

/** 从加载器标识字符串（如 "forge-43.2.0"）解析出加载器类型与版本 */
function parseLoaderTag(raw: string | undefined): { loader: LoaderKind; version: string | null } {
  if (!raw) return { loader: 'vanilla', version: null }
  const lower = raw.toLowerCase()
  if (lower.includes('neoforge')) return { loader: 'neoforge', version: splitLoaderVersion(raw) }
  if (lower.includes('quilt')) return { loader: 'quilt', version: splitLoaderVersion(raw) }
  if (lower.includes('fabric')) return { loader: 'fabric', version: splitLoaderVersion(raw) }
  if (lower.includes('forge')) return { loader: 'forge', version: splitLoaderVersion(raw) }
  return { loader: 'vanilla', version: null }
}

/** 从版本 JSON 的 libraries / mainClass 推断加载器 */
function detectLoaderFromVersionJson(json: VersionJson): { loader: LoaderKind; version: string | null } {
  const names = (json.libraries ?? []).map((lib) => (lib.name ?? '').toLowerCase())
  const mainClass = (json.mainClass ?? '').toLowerCase()
  const findVersion = (needle: string): string | null => {
    const hit = names.find((name) => name.includes(needle))
    if (!hit) return null
    // net.fabricmc:loader:0.15.11 → 0.15.11
    // net.minecraftforge:forge:1.20.1-47.2.0 → 47.2.0（去掉前面的 MC 版本）
    const parts = hit.split(':')
    if (parts.length < 3) return null
    const raw = parts[2]
    const stripped = raw.match(/^\d+\.\d+(?:\.\d+)?-(.+)$/)
    return stripped ? stripped[1] : raw
  }
  if (names.some((n) => n.includes('net.neoforged')) || mainClass.includes('neoforge')) {
    return { loader: 'neoforge', version: findVersion('net.neoforged') }
  }
  if (names.some((n) => n.includes('org.quiltmc')) || mainClass.includes('quilt')) {
    return { loader: 'quilt', version: findVersion('org.quiltmc') }
  }
  if (names.some((n) => n.includes('net.fabricmc')) || mainClass.includes('fabricmc')) {
    return { loader: 'fabric', version: findVersion('net.fabricmc') }
  }
  if (names.some((n) => n.includes('net.minecraftforge')) || mainClass.includes('forge')) {
    return { loader: 'forge', version: findVersion('net.minecraftforge') }
  }
  return { loader: 'vanilla', version: null }
}

async function scanVersionsDir(dir: string, warnings: ScanWarning[]): Promise<ScanResult | null> {
  const versionsDir = path.join(dir, 'versions')
  if (!(await isDirectory(versionsDir))) return null
  let entries: string[]
  try {
    entries = (await readdir(versionsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return null
  }
  if (entries.length === 0) return null

  const candidates: Array<{ json: VersionJson; mtime: number; folder: string }> = []
  for (const folder of entries) {
    const jsonPath = path.join(versionsDir, folder, `${folder}.json`)
    const json = await readJsonSafe<VersionJson>(jsonPath)
    if (!json) continue
    let mtime = 0
    try {
      mtime = (await stat(jsonPath)).mtimeMs
    } catch {
      mtime = 0
    }
    candidates.push({ json, mtime, folder })
  }
  if (candidates.length === 0) {
    warnings.push({ code: 'no-version-json' })
    return null
  }
  // 优先带 clientVersion 的完整版本 JSON，其次取最新修改的
  candidates.sort((a, b) => {
    const aFull = a.json.clientVersion ? 1 : 0
    const bFull = b.json.clientVersion ? 1 : 0
    if (aFull !== bFull) return bFull - aFull
    return b.mtime - a.mtime
  })
  const best = candidates[0]
  if (candidates.length > 1) {
    warnings.push({ code: 'multiple-versions', count: candidates.length, chosen: best.folder })
  }
  const detected = detectLoaderFromVersionJson(best.json)
  return {
    mcVersion: best.json.clientVersion ?? best.json.id ?? best.folder,
    loader: detected.loader,
    loaderVersion: detected.version,
    suggestedName: best.folder,
    warnings
  }
}

/**
 * 扫描一个已有游戏目录，识别 Minecraft 版本与模组加载器。
 * 依次兼容：Prism/MultiMC (mmc-pack.json)、CurseForge (minecraftinstance.json)、
 * 标准 .minecraft (versions/*)、以及目录本身就是单个版本档案的情况。
 */
export async function scanGameDir(dir: string): Promise<ScanResult | null> {
  if (!(await isDirectory(dir))) return null
  const warnings: ScanWarning[] = []
  const fallbackName = path.basename(dir).replace(/^\.+/, '') || 'Minecraft'

  // 1) Prism Launcher / MultiMC
  const mmc = await readJsonSafe<MmcPackJson>(path.join(dir, 'mmc-pack.json'))
  if (mmc?.components?.length) {
    const pick = (uid: string): string | undefined =>
      mmc.components?.find((component) => component.uid === uid)?.version
    const mcVersion = pick('net.minecraft')
    if (mcVersion) {
      const loaders: Array<[string, LoaderKind]> = [
        ['net.neoforged', 'neoforge'],
        ['org.quiltmc.quilt-loader', 'quilt'],
        ['net.fabricmc.fabric-loader', 'fabric'],
        ['net.minecraftforge', 'forge']
      ]
      for (const [uid, loader] of loaders) {
        const version = pick(uid)
        if (version) {
          return {
            mcVersion,
            loader,
            loaderVersion: version,
            suggestedName: fallbackName,
            warnings
          }
        }
      }
      return { mcVersion, loader: 'vanilla', loaderVersion: null, suggestedName: fallbackName, warnings }
    }
    warnings.push({ code: 'no-version-json' })
  }

  // 2) CurseForge
  const curse = await readJsonSafe<CurseForgeInstanceJson>(path.join(dir, 'minecraftinstance.json'))
  if (curse?.gameVersion) {
    const parsed = parseLoaderTag(curse.baseModLoader?.name ?? curse.baseModLoader?.mavenVersionString)
    return {
      mcVersion: curse.gameVersion,
      loader: parsed.loader,
      loaderVersion: parsed.version ?? curse.baseModLoader?.forgeVersion ?? null,
      suggestedName: curse.name?.trim() || fallbackName,
      warnings
    }
  }

  // 3) 标准 .minecraft 布局
  const fromVersions = await scanVersionsDir(dir, warnings)
  if (fromVersions) {
    return { ...fromVersions, suggestedName: fromVersions.suggestedName || fallbackName }
  }

  // 4) 目录本身就是一个版本档案（只含 <name>.json + <name>.jar）
  const profileJson = await readJsonSafe<VersionJson>(path.join(dir, `${path.basename(dir)}.json`))
  if (profileJson?.id) {
    const detected = detectLoaderFromVersionJson(profileJson)
    return {
      mcVersion: profileJson.clientVersion ?? profileJson.inheritsFrom ?? profileJson.id,
      loader: detected.loader,
      loaderVersion: detected.version,
      suggestedName: fallbackName,
      warnings
    }
  }

  // 5) 只有 mods/saves 的裸目录：无法判定版本，交给调用方报错
  if ((await isDirectory(path.join(dir, 'mods'))) || (await isDirectory(path.join(dir, 'saves')))) {
    warnings.push({ code: 'mods-without-version' })
  }
  return null
}

/** 批量导入时的一个候选实例 */
export interface ScanCandidate extends ScanResult {
  /** 实例要指向的游戏目录（多版本共享同一个 .minecraft） */
  gameDir: string
  /** versions/ 下的版本文件夹名，裸目录或整合包为 null */
  versionId: string | null
}

/** 单个版本文件夹 → 候选 */
async function candidateFromVersion(
  root: string,
  folder: string
): Promise<ScanCandidate | null> {
  const jsonPath = path.join(root, 'versions', folder, `${folder}.json`)
  const json = await readJsonSafe<VersionJson>(jsonPath)
  if (!json) return null
  const detected = detectLoaderFromVersionJson(json)
  return {
    gameDir: root,
    versionId: folder,
    mcVersion: json.clientVersion ?? json.inheritsFrom ?? json.id ?? folder,
    loader: detected.loader,
    loaderVersion: detected.version,
    suggestedName: folder,
    warnings: []
  }
}

/**
 * 扫一个目录里"所有的"游戏。
 * 优先级：
 *   1) 标准 .minecraft → versions/ 下每个版本各算一个实例
 *   2) 整合包目录（Prism / CurseForge / 单版本档案）→ 一个实例
 *   3) 目录本身是容器（里面若干子目录各自是游戏）→ 递归一层
 */
const SKIP_DIRS = new Set([
  'assets',
  'libraries',
  'logs',
  'crash-reports',
  'cache',
  'runtime',
  'jre',
  'java',
  'node_modules',
  'screenshots',
  'shaderpacks',
  'resourcepacks',
  'mods',
  'saves',
  'config',
  'backups',
  'downloads'
])

export async function scanGameDirAll(dir: string, depth = 0): Promise<ScanCandidate[]> {
  if (depth > 2) return []
  if (!(await isDirectory(dir))) return []

  // 1) 标准 .minecraft 布局：把每个版本都收进来
  const versionsDir = path.join(dir, 'versions')
  if (await isDirectory(versionsDir)) {
    let folders: string[] = []
    try {
      folders = (await readdir(versionsDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    } catch {
      folders = []
    }
    const found: ScanCandidate[] = []
    for (const folder of folders) {
      const candidate = await candidateFromVersion(dir, folder)
      if (candidate) found.push(candidate)
    }
    if (found.length > 0) return found
  }

  // 2) 整合包 / 单个版本档案
  const single = await scanGameDir(dir)
  if (single) {
    const isVersionFolder = await isDirectory(path.join(dir, '..', '..', 'versions'))
    return [
      {
        ...single,
        gameDir: dir,
        versionId: isVersionFolder ? path.basename(dir) : null
      }
    ]
  }

  // 3) 容器目录：逐个看下一层
  let entries: string[] = []
  try {
    entries = (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
  const nested: ScanCandidate[] = []
  for (const name of entries) {
    if (SKIP_DIRS.has(name.toLowerCase())) continue
    const child = path.join(dir, name)
    const childCandidates = await scanGameDirAll(child, depth + 1)
    nested.push(...childCandidates)
  }
  return nested
}
