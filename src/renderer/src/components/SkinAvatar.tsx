import { useEffect, useRef, useState } from 'react'
import type { AccountSummary } from '@shared/types'
import { Icon } from './Icon'

/**
 * 从皮肤贴图裁出玩家头部（1/8 网格里的 (8,8) 格）。
 * LittleSkin 在纹理失效时会返回紫黑棋盘占位图，
 * 采样判断后退回通用图标，免得标题栏/侧边栏出现一块棋盘。
 */
function isPlaceholder(ctx: CanvasRenderingContext2D, size: number): boolean {
  const { data } = ctx.getImageData(0, 0, size, size)
  let meaningful = 0
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const a = data[i + 3]
    if (a === 0) continue
    const magenta = r > 200 && g < 60 && b > 200
    const black = r < 40 && g < 40 && b < 40
    if (!magenta && !black) meaningful += 1
  }
  return meaningful === 0
}

/** PCL 风格的方形像素头像；没有皮肤时退回通用图标 */
export function SkinAvatar({
  account,
  size,
  rounded = 'md'
}: {
  account: AccountSummary | null
  size: number
  rounded?: 'md' | 'full'
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [ready, setReady] = useState(false)
  const skinUrl = account?.skinUrl ?? null

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !skinUrl) return () => undefined
    const ctx = canvas.getContext('2d')
    if (!ctx) return () => undefined

    let alive = true
    setReady(false)
    void window.ferry
      .fetchImage(skinUrl)
      .then((data) => {
        if (!alive || !data) return
        const image = new Image()
        image.onload = () => {
          if (!alive) return
          const unit = image.naturalWidth / 8
          if (unit <= 0) return
          ctx.clearRect(0, 0, canvas.width, canvas.height)
          ctx.imageSmoothingEnabled = false
          ctx.drawImage(image, unit, unit, unit, unit, 0, 0, canvas.width, canvas.height)
          if (isPlaceholder(ctx, canvas.width)) {
            ctx.clearRect(0, 0, canvas.width, canvas.height)
            return
          }
          setReady(true)
        }
        image.src = data
      })
      .catch(() => undefined)

    return () => {
      alive = false
    }
  }, [skinUrl])

  const shape = rounded === 'full' ? 'rounded-full' : 'rounded-md'

  return (
    <span
      className={`relative flex shrink-0 items-center justify-center overflow-hidden bg-[var(--active-bg)] text-2 ${shape}`}
      style={{ width: size, height: size }}
    >
      {!ready && <Icon name="user" size={Math.round(size * 0.5)} />}
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        className={`absolute inset-0 ${ready ? '' : 'opacity-0'} ${shape}`}
        style={{ imageRendering: 'pixelated' }}
      />
    </span>
  )
}
