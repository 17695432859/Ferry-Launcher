import { dialog, type BrowserWindow } from 'electron'
import { createWriteStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { ZipFile } from 'yazl'
import type { ExportOutcome } from '@shared/ipc'
import type { Instance } from '@shared/types'
import { defaultExportName, listMods } from './mods'

/** 导出时打包的目录，日志和崩溃报告一律排除 */
const CONFIG_DIRS = ['mods', 'config', 'defaultconfigs', 'resourcepacks', 'shaderpacks']
const CONFIG_FILES = ['options.txt', 'optionsof.txt', 'servers.dat']

async function addDirectory(
  zip: ZipFile,
  root: string,
  relative: string,
  onFile: () => void
): Promise<void> {
  const absolute = path.join(root, relative)
  let entries: string[]
  try {
    entries = await readdir(absolute)
  } catch {
    return
  }
  for (const name of entries) {
    const childRel = path.posix.join(relative, name)
    const childAbs = path.join(absolute, name)
    let info
    try {
      info = await stat(childAbs)
    } catch {
      continue
    }
    if (info.isDirectory()) {
      await addDirectory(zip, root, childRel, onFile)
    } else {
      zip.addFile(childAbs, childRel)
      onFile()
    }
  }
}

async function addFileIfExists(zip: ZipFile, root: string, relative: string): Promise<boolean> {
  const absolute = path.join(root, relative)
  try {
    const info = await stat(absolute)
    if (!info.isFile()) return false
    zip.addFile(absolute, relative)
    return true
  } catch {
    return false
  }
}

/**
 * 导出实例为整合包 zip。
 * 只读取实例目录，不会改动或删除任何原文件。
 */
export async function exportInstance(
  instance: Instance,
  includeSaves: boolean,
  parent: BrowserWindow | null,
  locale: string,
  forcedPath: string | null = null
): Promise<ExportOutcome> {
  let target = forcedPath
  if (!target) {
    const options: Electron.SaveDialogOptions = {
      title: locale === 'en' ? 'Export instance' : '导出实例',
      defaultPath: defaultExportName(instance.name, instance.mcVersion),
      filters: [{ name: 'Zip archive', extensions: ['zip'] }]
    }
    const result = parent
      ? await dialog.showSaveDialog(parent, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { ok: false, reason: 'cancelled' }
    target = result.filePath
  }

  const zip = new ZipFile()
  let entries = 0
  const bump = (): void => {
    entries += 1
  }

  for (const dir of CONFIG_DIRS) {
    await addDirectory(zip, instance.gameDir, dir, bump)
  }
  if (includeSaves) {
    await addDirectory(zip, instance.gameDir, 'saves', bump)
  }
  for (const file of CONFIG_FILES) {
    if (await addFileIfExists(zip, instance.gameDir, file)) bump()
  }

  if (entries === 0) {
    return { ok: false, reason: 'empty' }
  }

  const mods = await listMods(instance.gameDir)
  const manifest = {
    format: 'ferry-instance/1',
    exportedAt: new Date().toISOString(),
    name: instance.name,
    mcVersion: instance.mcVersion,
    loader: instance.loader,
    loaderVersion: instance.loaderVersion,
    memoryMb: instance.memoryMb,
    isolated: instance.isolated ?? true,
    mods: mods.map((mod) => ({ fileName: mod.fileName, enabled: mod.enabled }))
  }
  zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'), 'ferry-instance.json')

  zip.end()
  try {
    await pipeline(zip.outputStream, createWriteStream(target))
  } catch (error) {
    return {
      ok: false,
      reason: 'error',
      message: error instanceof Error ? error.message : String(error)
    }
  }

  return { ok: true, path: target, entries }
}
