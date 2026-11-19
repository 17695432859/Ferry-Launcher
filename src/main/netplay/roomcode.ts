import { randomBytes } from 'node:crypto'
import type { RoomCodeInfo } from '@shared/types'

/**
 * 联机码，完全按 Scaffolding 协议（陶瓦 / EasyTier 官方格式）实现。
 *
 * 形如 `U/NNNN-NNNN-SSSS-SSSS`：
 * - 字符表 0-9 与 A-H、J-N、P-Z（去掉容易看错的 I 和 O），共 34 个；
 * - 把这 16 位当作小端序整数，必须能被 7 整除；
 * - 前 8 位是 EasyTier 网络名后缀，后 8 位是网络密钥。
 *
 * 官方例子：`U/YNZE-U61D-2206-HXRG`
 *   → 网络名 `scaffolding-mc-YNZE-U61D`、密钥 `2206-HXRG`。
 */

const ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const PREFIX = 'U/'
const NETWORK_PREFIX = 'scaffolding-mc-'

function digitOf(char: string): number {
  return ALPHABET.indexOf(char)
}

/** 把 16 位数字当作小端序整数取模（34 ≡ 6 mod 7，边加边取模即可） */
function modulus(digits: number[]): number {
  let value = 0
  let power = 1
  for (const digit of digits) {
    value = (value + digit * power) % 7
    power = (power * 34) % 7
  }
  return value
}

function format(digits: number[]): string {
  const text = digits.map((digit) => ALPHABET[digit] ?? '0').join('')
  return `${PREFIX}${text.slice(0, 4)}-${text.slice(4, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}`
}

/** 随机填 15 位，最后一位穷举出能让整体被 7 整除的候选，保证分布均匀且必定合法 */
export function generate(): string {
  const bytes = randomBytes(16)
  const digits: number[] = new Array<number>(16).fill(0)
  for (let index = 1; index < 16; index += 1) {
    digits[index] = bytes[index] % 34
  }

  const candidates: number[] = []
  for (let candidate = 0; candidate < 34; candidate += 1) {
    digits[0] = candidate
    if (modulus(digits) === 0) candidates.push(candidate)
  }
  digits[0] = candidates.length > 0 ? candidates[bytes[0] % candidates.length] : 0
  return format(digits)
}

/** 去空格、转大写、补 `U/` 前缀 */
export function normalize(raw: string): string {
  const cleaned = raw.replace(/\s+/g, '').toUpperCase()
  const body = cleaned.startsWith(PREFIX) ? cleaned.slice(PREFIX.length) : cleaned
  return `${PREFIX}${body}`
}

/** 校验并返回网络名 + 密钥；不合法返回 null */
export function parse(raw: string): RoomCodeInfo | null {
  const body = normalize(raw).slice(PREFIX.length)
  const parts = body.split('-')
  if (parts.length !== 4) return null
  const joined = parts.join('')
  if (joined.length !== 16) return null

  const digits: number[] = []
  for (const char of joined) {
    const digit = digitOf(char)
    if (digit < 0) return null
    digits.push(digit)
  }
  if (modulus(digits) !== 0) return null

  return {
    code: normalize(raw),
    networkName: `${NETWORK_PREFIX}${parts[0]}-${parts[1]}`,
    networkSecret: `${parts[2]}-${parts[3]}`
  }
}

export function isValid(raw: string): boolean {
  return parse(raw) !== null
}

/** 从网络名 + 密钥反推联机码 */
export function fromNetwork(networkName: string, networkSecret: string): string | null {
  if (!networkName.startsWith(NETWORK_PREFIX)) return null
  const name = networkName.slice(NETWORK_PREFIX.length)
  return parse(`${name}-${networkSecret}`)?.code ?? null
}

/** 联机中心发现用的 hostname：`scaffolding-mc-server-{port}` */
export function centerHostname(port: number): string {
  return `scaffolding-mc-server-${port}`
}
