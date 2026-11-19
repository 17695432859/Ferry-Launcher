import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 用 requestAnimationFrame 做补间，替代任何 setInterval 计时。
 * 进度条、环形进度都走这里，掉帧时按真实时间推进，不会抖动。
 */
export function useRafTween(duration = 420): {
  value: number
  animateTo: (from: number, to: number) => Promise<void>
  reset: () => void
} {
  const [value, setValue] = useState(0)
  const frame = useRef(0)

  const animateTo = useCallback(
    (from: number, to: number) =>
      new Promise<void>((resolve) => {
        cancelAnimationFrame(frame.current)
        const started = performance.now()
        const tick = (now: number): void => {
          const progress = Math.min(1, (now - started) / duration)
          const eased = 1 - (1 - progress) ** 3
          setValue(from + (to - from) * eased)
          if (progress < 1) {
            frame.current = requestAnimationFrame(tick)
          } else {
            resolve()
          }
        }
        frame.current = requestAnimationFrame(tick)
      }),
    [duration]
  )

  const reset = useCallback(() => {
    cancelAnimationFrame(frame.current)
    setValue(0)
  }, [])

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  return { value, animateTo, reset }
}
