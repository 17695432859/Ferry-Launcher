import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useAppStore } from '@renderer/store/app-store'
import { Icon } from './Icon'

const TONE = {
  info: { icon: 'spark', color: 'text-2' },
  success: { icon: 'check', color: 'accent-text' },
  error: { icon: 'alert', color: 'text-[#ff8f9b]' }
} as const

export function Toast(): JSX.Element {
  const toast = useAppStore((state) => state.toast)
  const dismiss = useAppStore((state) => state.dismissToast)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(dismiss, 4200)
    return () => clearTimeout(timer)
  }, [toast, dismiss])

  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 -translate-x-1/2">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="glass pointer-events-auto flex max-w-[520px] items-start gap-2 rounded-xl px-3.5 py-2.5 shadow-panel"
          >
            <Icon name={TONE[toast.kind].icon} size={15} className={`mt-0.5 shrink-0 ${TONE[toast.kind].color}`} />
            <p className="text-[12.5px] leading-relaxed text-1">{toast.text}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
