import type { SVGProps } from 'react'
import oakBoat from '@renderer/assets/oak-boat.png'

export type IconName =
  | 'play'
  | 'user'
  | 'download'
  | 'settings'
  | 'grid'
  | 'list'
  | 'folder'
  | 'import'
  | 'minimize'
  | 'maximize'
  | 'restore'
  | 'close'
  | 'check'
  | 'alert'
  | 'chevron'
  | 'trash'
  | 'search'
  | 'cube'
  | 'plus'
  | 'spark'
  | 'edit'
  | 'save'

const PATHS: Record<IconName, string> = {
  play: 'M8 5.5v13l11-6.5-11-6.5Z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
  download: 'M12 4v11m0 0 4-4m-4 4-4-4M5 19h14',
  settings:
    'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Zm8-3.2c0 .5-.05 1-.14 1.46l2.02 1.5-1.94 3.36-2.35-.94c-.75.62-1.6 1.1-2.53 1.4L14.7 22h-5.4l-.36-2.42a8 8 0 0 1-2.53-1.4l-2.35.94L2.12 15.6l2.02-1.5a8.2 8.2 0 0 1 0-2.92l-2.02-1.5L4.06 6.3l2.35.94a8 8 0 0 1 2.53-1.4L9.3 2h5.4l.36 2.42c.93.3 1.78.78 2.53 1.4l2.35-.94 1.94 3.36-2.02 1.5c.09.47.14.96.14 1.46Z',
  grid: 'M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z',
  list: 'M4 6h16M4 12h16M4 18h16',
  folder: 'M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7.5A1.5 1.5 0 0 1 17.5 19h-13A1.5 1.5 0 0 1 3 17.5v-10Z',
  import: 'M12 15V4m0 0L8 8m4-4 4 4M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3',
  minimize: 'M5 12h14',
  maximize: 'M5.5 5.5h13v13h-13v-13Z',
  restore: 'M8 8h11v11H8V8Zm-3 8V5h11',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  alert: 'M12 8v5m0 3.5h.01M10.3 4.3 2.9 17.2A1.6 1.6 0 0 0 4.3 19.6h15.4a1.6 1.6 0 0 0 1.4-2.4L13.7 4.3a1.6 1.6 0 0 0-2.8 0Z',
  chevron: 'M9 6l6 6-6 6',
  trash: 'M4 7h16M9 7V5h6v2m-8 0 1 13h8l1-13',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5.2-1.8L21 21',
  plus: 'M12 5v14M5 12h14',
  cube: 'M12 3.2 20 7.8v8.4L12 20.8 4 16.2V7.8l8-4.6Zm0 0v8.6m8-4-8 4.6m-8-4 8 4.6',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z',
  edit: 'M4 20h4L19 9l-4-4L4 16v4Zm10-14 4 4',
  save: 'M5 4h11l3 3v13H5V4Zm3 0v5h7V4M8 14h8'
}

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
  size?: number
  filled?: boolean
}

export function Icon({ name, size = 18, filled = false, ...rest }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

/** 应用标识：渐变船体 + 波纹，纯矢量，任意尺寸清晰 */
export function FerryLogo({ size = 26 }: { size?: number }): JSX.Element {
  // 像素画按最近邻放大，避免糊成一团
  return (
    <img
      src={oakBoat}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
      style={{ imageRendering: 'pixelated' }}
      className="select-none rounded-[26%]"
    />
  )
}
