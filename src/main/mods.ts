import { app, dialog, shell, type BrowserWindow } from 'electron'
import AdmZip from 'adm-zip'
import { copyFile, mkdir, readdir, rename, stat } from 'node:fs/promises'
import path from 'node:path'
import type { ModEntry } from '@shared/types'

const DISABLED_SUFFIX = '.disabled'

interface FabricMeta {
  id?: string
  name?: string
  version?: string
  description?: string
}

function parseTomlField(text: string, field: string): string | null {
  const match = text.match(new RegExp(`^\\s*${field}\\s*=\\s*"([^"]*)"`, 'm'))
  return match ? match[1] : null
}

/** 从 jar 里读 mod 元数据；读不到就退回文件名，不抛错 */
function readModMeta(filePath: string, fileName: string): Omit<ModEntry, 'fileName' | 'enabled' | 'sizeBytes'> {
  const fallbackName = fileName.replace(/\.jar(\.disabled)?$/i, '')
  let zip: AdmZip
  try {
    zip = new AdmZip(filePath)
  } catch {
    return { displayName: fallbackName, version: null, loader: null, description: null }
  }

  try {
    const fabricEntry = zip.getEntry('fabric.mod.json')
    if (fabricEntry) {
      const meta = JSON.parse(zip.readAsText(fabricEntry)) as FabricMeta
      return {
        displayName: meta.name?.trim() || meta.id || fallbackName,
        version: meta.version ?? null,
        loader: 'fabric',
        description: meta.description ?? null
      }
    }

    const neoEntry = zip.getEntry('META-INF/neoforge.mods.toml')
    const forgeEntry = zip.getEntry('META-INF/mods.toml')
    const tomlEntry = neoEntry ?? forgeEntry
    if (tomlEntry) {
      const text = zip.readAsText(tomlEntry)
      return {
        displayName: parseTomlField(text, 'displayName') ?? parseTomlField(text, 'modId') ?? fallbackName,
        version: parseTomlField(text, 'version'),
        loader: neoEntry ? 'neoforge' : 'forge',
        description: parseTomlField(text, 'description')
      }
    }

    const quiltEntry = zip.getEntry('quilt.mod.json')
    if (quiltEntry) {
      const meta = JSON.parse(zip.readAsText(quiltEntry)) as {
        quilt_loader?: { id?: string; version?: string; metadata?: { name?: string; description?: string } }
      }
      return {
        displayName: meta.quilt_loader?.metadata?.name ?? meta.quilt_loader?.id ?? fallbackName,
        version: meta.quilt_loader?.version ?? null,
        loader: 'quilt',
        description: meta.quilt_loader?.metadata?.description ?? null
      }
    }
  } catch {
    // jar 损坏或元数据格式异常，走文件名兜底
  }

  return { displayName: fallbackName, version: null, loader: null, description: null }
}

export function modsDir(gameDir: string): string {
  return path.join(gameDir, 'mods')
}

export async function listMods(gameDir: string): Promise<ModEntry[]> {
  const dir = modsDir(gameDir)
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    return []
  }

  const entries: ModEntry[] = []
  for (const fileName of files) {
    const lower = fileName.toLowerCase()
    const enabled = lower.endsWith('.jar')
    const disabled = lower.endsWith(`.jar${DISABLED_SUFFIX}`)
    if (!enabled && !disabled) continue
    const fullPath = path.join(dir, fileName)
    let sizeBytes = 0
    try {
      sizeBytes = (await stat(fullPath)).size
    } catch {
      continue
    }
    const meta = readModMeta(fullPath, fileName)
    entries.push({ fileName, enabled, sizeBytes, ...meta })
  }

  return entries.sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-CN'))
}

function resolveModFile(gameDir: string, fileName: string): string | null {
  const base = path.basename(fileName)
  if (base !== fileName) return null
  if (!/\.jar(\.disabled)?$/i.test(base)) return null
  return path.join(modsDir(gameDir), base)
}

export async function toggleMod(gameDir: string, fileName: string, enabled: boolean): Promise<ModEntry[]> {
  const target = resolveModFile(gameDir, fileName)
  if (!target) return listMods(gameDir)
  const isDisabled = target.toLowerCase().endsWith(DISABLED_SUFFIX)
  if (enabled && isDisabled) {
    await rename(target, target.slice(0, -DISABLED_SUFFIX.length))
  } else if (!enabled && !isDisabled) {
    await rename(target, `${target}${DISABLED_SUFFIX}`)
  }
  return listMods(gameDir)
}

/** 删除走系统回收站，不做硬删除 */
export async function deleteMod(gameDir: string, fileName: string): Promise<ModEntry[]> {
  const target = resolveModFile(gameDir, fileName)
  if (target) {
    try {
      await shell.trashItem(target)
    } catch {
      // 回收站不可用时保持文件不动，交给上层提示
      throw new Error('TRASH_FAILED')
    }
  }
  return listMods(gameDir)
}

export async function importMods(
  gameDir: string,
  parent: BrowserWindow | null,
  locale: string
): Promise<{ added: number; skipped: number; cancelled: boolean }> {
  const options: Electron.OpenDialogOptions = {
    title: locale === 'en' ? 'Import mods' : '导入 Mod',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Minecraft mods', extensions: ['jar'] }]
  }
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) {
    return { added: 0, skipped: 0, cancelled: true }
  }

  const dir = modsDir(gameDir)
  await mkdir(dir, { recursive: true })
  const existing = new Set((await readdir(dir)).map((name) => name.toLowerCase()))

  let added = 0
  let skipped = 0
  for (const source of result.filePaths) {
    const name = path.basename(source)
    if (existing.has(name.toLowerCase())) {
      skipped += 1
      continue
    }
    try {
      await copyFile(source, path.join(dir, name))
      existing.add(name.toLowerCase())
      added += 1
    } catch {
      skipped += 1
    }
  }
  return { added, skipped, cancelled: false }
}

/** 实例导出的默认文件名 */
export function defaultExportName(name: string, mcVersion: string): string {
  const safe = name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'instance'
  return `${safe}-${mcVersion}.zip`
}

export function appDataRoot(): string {
  return app.getPath('userData')
}
