import type { TranslationKey } from '@shared/i18n'
import type { LoaderKind } from '@shared/types'

export const LOADER_LABEL_KEYS: Record<LoaderKind, TranslationKey> = {
  vanilla: 'loader.vanilla',
  fabric: 'loader.fabric',
  forge: 'loader.forge',
  neoforge: 'loader.neoforge',
  quilt: 'loader.quilt'
}

/** 实例副标题：Fabric 0.15.11 · 1.20.1 */
export function instanceSubtitle(loader: LoaderKind, loaderVersion: string | null, mcVersion: string): string {
  if (loader === 'vanilla' || !loaderVersion) return mcVersion
  return `${loaderVersion} · ${mcVersion}`
}
