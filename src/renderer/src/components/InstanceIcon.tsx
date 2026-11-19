import { useEffect, useState } from 'react'
import type { Instance, LoaderKind } from '@shared/types'
import { coverSolid } from '@renderer/lib/cover'
import grassArt from '@renderer/assets/icons/vanilla.png'
import anvilArt from '@renderer/assets/icons/forge.png'
import woolArt from '@renderer/assets/icons/fabric.png'
import foxArt from '@renderer/assets/icons/neoforge.png'

/**
 * 实例图标。
 *
 * 内置图标沿用 PCL2 的那套：草方块（原版）、铁砧（Forge）、
 * 羊毛（Fabric / Quilt）、狐狸脸（NeoForge）。都是 16×16 上下的像素图，
 * 用 `image-rendering: pixelated` 放大，边缘是硬的，不会糊。
 * 用户在版本设置里换了自定义图片时优先用图片。
 */

interface ArtProps {
  src: string
  /** 压在深色块上时提亮一点，保住轮廓 */
  lift?: number
}

function Art({ src, lift = 1 }: ArtProps): JSX.Element {
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      draggable={false}
      className="h-full w-full select-none object-contain"
      style={{
        imageRendering: 'pixelated',
        filter: lift === 1 ? undefined : `brightness(${lift}) drop-shadow(0 1px 1px rgba(0,0,0,0.4))`
      }}
    />
  )
}

/** 没有对应素材时的兜底：一个灰色方块 */
function Cube(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="100%" height="100%" shapeRendering="crispEdges" aria-hidden="true">
      <polygon points="8,2 14,5.2 8,8.4 2,5.2" fill="#9aa0aa" />
      <polygon points="2,5.2 8,8.4 8,14.6 2,11.4" fill="#7c828c" />
      <polygon points="14,5.2 8,8.4 8,14.6 14,11.4" fill="#666c76" />
    </svg>
  )
}

export function LoaderSprite({ loader }: { loader: LoaderKind }): JSX.Element {
  switch (loader) {
    case 'vanilla':
      return <Art src={grassArt} />
    case 'fabric':
    case 'quilt':
      return <Art src={woolArt} />
    case 'forge':
      return <Art src={anvilArt} lift={1.55} />
    case 'neoforge':
      return <Art src={foxArt} />
    default:
      return <Cube />
  }
}

/* --------------------------- 自定义图片 --------------------------- */

const iconCache = new Map<string, string | null>()

/** 自定义图标读一次就缓存，列表滚动时不会反复走 IPC */
export function useCustomIcon(path?: string | null): string | null {
  const [src, setSrc] = useState<string | null>(() =>
    path ? (iconCache.get(path) ?? null) : null
  )

  useEffect(() => {
    if (!path) {
      setSrc(null)
      return
    }
    const cached = iconCache.get(path)
    if (cached !== undefined) {
      setSrc(cached)
      return
    }
    let alive = true
    void window.ferry.loadBackground(path).then((data) => {
      iconCache.set(path, data)
      if (alive) setSrc(data)
    })
    return () => {
      alive = false
    }
  }, [path])

  return src
}

/** 换图标后让缓存失效 */
export function invalidateIcon(path: string): void {
  iconCache.delete(path)
}

interface TileProps {
  instance: Instance
  /** 方块边长（px） */
  size: number
  /** 需要横跨整行时传 "100%" */
  width?: number | string
  radius?: number
  className?: string
}

/**
 * 列表 / 卡片 / hero 里统一用的图标块：
 * 有自定义图片就铺满，没有就画加载器对应的像素图标。
 */
export function InstanceTile({
  instance,
  size,
  width,
  radius = 8,
  className = ''
}: TileProps): JSX.Element {
  const custom = useCustomIcon(instance.icon)
  const solid = coverSolid(instance.coverSeed)
  const box = { width: width ?? size, height: size, borderRadius: radius }
  // 羊毛那张素材四周留白多，放大一档才能跟草方块、铁砧的视觉重量对齐
  const scale = instance.loader === 'fabric' || instance.loader === 'quilt' ? 0.86 : 0.68

  if (custom) {
    return (
      <span
        className={`relative flex shrink-0 items-center justify-center overflow-hidden ${className}`}
        style={box}
      >
        <img
          src={custom}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="h-full w-full select-none object-cover"
        />
      </span>
    )
  }

  return (
    <span
      className={`relative flex shrink-0 items-center justify-center ${className}`}
      style={{ ...box, backgroundColor: solid }}
    >
      <span style={{ width: Math.round(size * scale), height: Math.round(size * scale) }}>
        <LoaderSprite loader={instance.loader} />
      </span>
    </span>
  )
}
