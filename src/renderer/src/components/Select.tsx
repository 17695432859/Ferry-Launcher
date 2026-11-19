import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Icon } from './Icon'

export interface SelectOption {
  value: string
  label: string
  /** 次要说明，比如 (beta) */
  hint?: string
}

interface Props {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  /** 弹层最大高度，默认 264 */
  maxHeight?: number
}

/**
 * 自绘下拉。
 *
 * 系统原生 select 的弹层在 WebView2 里是纯白方框，跟毛玻璃面板完全不搭，
 * 所以这里自己画：触发器 + 玻璃弹层，键盘 Esc 关闭，点外面也关。
 */
export function Select({
  value,
  options,
  onChange,
  placeholder,
  disabled = false,
  className = '',
  maxHeight = 264
}: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const current = options.find((option) => option.value === value)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex h-9 w-full items-center gap-2 rounded-lg border px-2.5 text-left text-[12.5px] transition-colors ${
          open
            ? 'border-accent/60 bg-[var(--hover-bg)] text-1'
            : 'border-[var(--hairline)] bg-[var(--hover-bg)] text-2 hover:text-1'
        } disabled:opacity-45`}
      >
        <span className={`min-w-0 flex-1 truncate ${current ? 'text-1' : 'text-3'}`}>
          {current?.label ?? placeholder ?? ''}
        </span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.18 }}>
          <Icon name="chevron" size={13} className="rotate-90 text-3" />
        </motion.span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.11, ease: [0.22, 1, 0.36, 1] }}
            role="listbox"
            /*
             * 这里刻意不用 .glass：弹层面积大，backdrop-filter 每帧都要重算背景模糊，
             * 展开/滚动会明显掉帧。改成实心底色 + 描边，观感一样干净，成本几乎为零。
             */
            className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-y-auto overscroll-contain rounded-xl border border-[var(--panel-border)] bg-[var(--panel-solid)] p-1 shadow-panel"
            style={{ maxHeight, contain: 'content', willChange: 'transform, opacity' }}
          >
            {options.map((option) => {
              const active = option.value === value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(option.value)
                    setOpen(false)
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-[7px] text-left text-[12.5px] transition-colors ${
                    active ? 'bg-accent/15 text-1' : 'text-2 hover:bg-[var(--hover-bg)] hover:text-1'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.hint && <span className="shrink-0 text-[11px] text-3">{option.hint}</span>}
                  {active && <Icon name="check" size={12} className="shrink-0 accent-text" />}
                </button>
              )
            })}
            {options.length === 0 && (
              <div className="px-2 py-3 text-center text-[12px] text-3">—</div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
