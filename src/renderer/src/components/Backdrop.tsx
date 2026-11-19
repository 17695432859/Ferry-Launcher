import { useEffect, useRef } from 'react'
import { usePrefersReducedMotion } from '@renderer/hooks/usePrefersReducedMotion'

/**
 * 背景光晕：一层铺满视口的强调色，亮度极缓地呼吸，并随鼠标做几像素的视差。
 * 刻意不用渐变、不用圆形色块——纯色平铺，边缘靠 transform 溢出视口来藏。
 */
export function Backdrop({ animated }: { animated: boolean }): JSX.Element {
  const layerRef = useRef<HTMLDivElement>(null)
  const pointer = useRef({ x: 0.5, y: 0.5 })
  const reduced = usePrefersReducedMotion()

  useEffect(() => {
    const layer = layerRef.current
    if (!layer) return

    const apply = (opacity: number, offsetX: number, offsetY: number): void => {
      layer.style.opacity = opacity.toFixed(4)
      layer.style.transform = `translate3d(${offsetX.toFixed(2)}px, ${offsetY.toFixed(2)}px, 0)`
    }

    if (!animated || reduced) {
      apply(0.028, 0, 0)
      return
    }

    let frame = 0
    let currentX = 0
    let currentY = 0
    const started = performance.now()

    const tick = (now: number): void => {
      const elapsed = (now - started) / 1000
      // 12 秒一个呼吸周期，幅度很小，避免变成视觉噪音
      const opacity = 0.03 + Math.sin(elapsed * 0.52) * 0.012
      const targetX = (pointer.current.x - 0.5) * -14
      const targetY = (pointer.current.y - 0.5) * -10
      currentX += (targetX - currentX) * 0.05
      currentY += (targetY - currentY) * 0.05
      apply(opacity, currentX, currentY)
      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)

    const handlePointer = (event: PointerEvent): void => {
      pointer.current.x = event.clientX / window.innerWidth
      pointer.current.y = event.clientY / window.innerHeight
    }
    window.addEventListener('pointermove', handlePointer, { passive: true })

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', handlePointer)
    }
  }, [animated, reduced])

  return (
    <div
      ref={layerRef}
      aria-hidden="true"
      className="pointer-events-none fixed -inset-[6%] z-0"
      style={{ backgroundColor: 'var(--accent)', opacity: 0.028 }}
    />
  )
}
