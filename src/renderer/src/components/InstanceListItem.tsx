import { useRef } from 'react'
import { motion, useMotionTemplate, useMotionValue, useSpring } from 'framer-motion'
import type { Instance } from '@shared/types'
import { LOADER_LABEL_KEYS, instanceSubtitle } from '@renderer/lib/labels'
import { usePrefersReducedMotion } from '@renderer/hooks/usePrefersReducedMotion'
import { useAppStore } from '@renderer/store/app-store'
import type { InstanceView } from '@renderer/store/app-store'
import { InstanceTile } from './InstanceIcon'

interface Props {
  instance: Instance
  active: boolean
  view: InstanceView
  index: number
  onSelect: () => void
}

const ENTRANCE = { type: 'spring', stiffness: 180, damping: 20 } as const

export function InstanceListItem({ instance, active, view, index, onSelect }: Props): JSX.Element {
  const t = useAppStore((state) => state.t)
  const reduced = usePrefersReducedMotion()
  const loaderLabel = t(LOADER_LABEL_KEYS[instance.loader])

  const cardRef = useRef<HTMLButtonElement>(null)
  const rotateX = useSpring(0, { stiffness: 180, damping: 20 })
  const rotateY = useSpring(0, { stiffness: 180, damping: 20 })
  const glowX = useMotionValue(50)
  const glowY = useMotionValue(50)
  const highlight = useMotionTemplate`radial-gradient(140px circle at ${glowX}% ${glowY}%, rgba(255,255,255,0.16), transparent 70%)`

  const handleMove = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (reduced) return
    const rect = cardRef.current?.getBoundingClientRect()
    if (!rect) return
    const px = (event.clientX - rect.left) / rect.width
    const py = (event.clientY - rect.top) / rect.height
    // 最大倾斜 6°
    rotateY.set((px - 0.5) * 12)
    rotateX.set((0.5 - py) * 12)
    glowX.set(px * 100)
    glowY.set(py * 100)
  }

  const handleLeave = (): void => {
    rotateX.set(0)
    rotateY.set(0)
  }

  const base =
    // shrink-0 很关键：列表是 flex 纵向容器，不加的话行会被压扁，图标就顶出格子了
    'group relative w-full shrink-0 overflow-hidden rounded-lg border text-left transition-colors duration-150'
  const tone = active
    ? 'border-accent/45 bg-accent/10'
    : 'border-transparent hover:border-[var(--hairline)] hover:bg-[var(--hover-bg)]'

  if (view === 'list') {
    return (
      <motion.button
        type="button"
        onClick={onSelect}
        title={instance.name}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...ENTRANCE, delay: index * 0.035 }}
        className={`${base} ${tone} flex items-center gap-3.5 px-3 py-2.5`}
      >
        {active && (
          <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-accent" aria-hidden="true" />
        )}
        <InstanceTile instance={instance} size={40} radius={8} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium leading-snug text-1">{instance.name}</span>
          <span className="mt-1 block truncate text-[12.5px] text-3">
            {loaderLabel} · {instance.mcVersion}
          </span>
        </span>
      </motion.button>
    )
  }

  return (
    <motion.button
      ref={cardRef}
      type="button"
      onClick={onSelect}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      title={instance.name}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...ENTRANCE, delay: index * 0.045 }}
      style={{ rotateX, rotateY, transformPerspective: 800 }}
      className={`${base} ${tone} flex flex-col items-start gap-1.5 p-2`}
    >
      <motion.span
        aria-hidden="true"
        style={{ backgroundImage: highlight }}
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
      />
      <span className="relative flex w-full items-center justify-center">
        <InstanceTile instance={instance} size={52} width="100%" radius={6} />
      </span>
      <span className="relative min-w-0 w-full">
        <span className="block truncate text-[12.5px] font-medium text-1">{instance.name}</span>
        <span className="block truncate text-[11px] text-3">
          {instanceSubtitle(instance.loader, instance.loaderVersion, instance.mcVersion)}
        </span>
      </span>
    </motion.button>
  )
}
