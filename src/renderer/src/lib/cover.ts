/**
 * 程序化封面：纯色块，同一个 seed 永远落到同一格调色板。
 * 8 个深色底都能配白字，不靠渐变也能有层次。
 */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return Math.abs(hash)
}

export const COVER_SOLIDS = [
  '#2F5C8A',
  '#24705C',
  '#63509A',
  '#9E5538',
  '#8F3F50',
  '#26677A',
  '#58632F',
  '#3E4E8C'
] as const

export function coverSolid(seed: string): string {
  return COVER_SOLIDS[hashSeed(seed) % COVER_SOLIDS.length]
}

/** 同色系更深一档，用于封面上的角标底 */
export function shade(hex: string, amount = 0.18): string {
  const value = hex.replace('#', '')
  const int = Number.parseInt(value, 16)
  const channel = (shift: number): number => Math.round(((int >> shift) & 255) * (1 - amount))
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`
}
