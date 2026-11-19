import type { Locale } from '@shared/types'

export function formatRelativeTime(iso: string | null, locale: Locale): string | null {
  if (!iso) return null
  const target = new Date(iso).getTime()
  if (Number.isNaN(target)) return null
  const diffSeconds = Math.round((target - Date.now()) / 1000)
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31536000],
    ['month', 2592000],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60]
  ]
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  for (const [unit, seconds] of units) {
    if (Math.abs(diffSeconds) >= seconds) {
      return formatter.format(Math.round(diffSeconds / seconds), unit)
    }
  }
  return formatter.format(diffSeconds, 'second')
}

export function formatPlaytime(ms: number, locale: Locale): string {
  const hours = ms / 3600000
  if (hours >= 1) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(hours)} ${
      locale === 'en' ? 'h' : '小时'
    }`
  }
  const minutes = Math.max(0, Math.round(ms / 60000))
  return `${minutes} ${locale === 'en' ? 'min' : '分钟'}`
}

export function formatMemory(mb: number): string {
  return `${mb} MB`
}
