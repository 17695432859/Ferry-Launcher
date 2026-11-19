import type { AppSettings } from '@shared/types'

/** #rrggbb → "r g b"，供 Tailwind 的 rgb(var(--accent-rgb) / <alpha>) 使用 */
export function hexToRgbChannels(hex: string): string {
  const value = hex.replace('#', '')
  const int = Number.parseInt(value.length === 3 ? value.replace(/(.)/g, '$1$1') : value, 16)
  if (Number.isNaN(int)) return '91 140 255'
  return `${(int >> 16) & 255} ${(int >> 8) & 255} ${int & 255}`
}

/** 相对亮度，用于决定强调色上的文字用黑还是白 */
function relativeLuminance(hex: string): number {
  const channels = hexToRgbChannels(hex)
    .split(' ')
    .map((part) => Number(part) / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

export function resolveTheme(mode: AppSettings['theme'], prefersDark: boolean): 'dark' | 'light' {
  if (mode === 'system') return prefersDark ? 'dark' : 'light'
  return mode
}

/**
 * 把设置写进 CSS 变量，主题切换不需要重建 React 树。
 * 所有视觉参数都走变量，组件里不出现魔法数字。
 */
export function applyTheme(settings: AppSettings, prefersDark: boolean): void {
  const root = document.documentElement
  root.dataset.theme = resolveTheme(settings.theme, prefersDark)
  // 自定义背景是照片，亮度不可控；面板要换一档更实的底，否则正文对比度守不住
  root.dataset.photo = settings.backgroundMode === 'custom' ? '1' : '0'
  root.style.setProperty('--accent', settings.accent)
  root.style.setProperty('--accent-rgb', hexToRgbChannels(settings.accent))
  root.style.setProperty('--accent-ink', relativeLuminance(settings.accent) > 0.6 ? '#0b1120' : '#ffffff')
  root.style.setProperty('--glass-blur', `${settings.blur}px`)
  root.style.setProperty('--ui-scale', String(settings.uiScale / 100))
  root.lang = settings.locale
}
