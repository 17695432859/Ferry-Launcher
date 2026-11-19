import type { ReactNode } from 'react'
import { Icon, type IconName } from '@renderer/components/Icon'

/** 里程碑占位页：明确标注能力将在哪个版本接入，不放假的可用按钮 */
export function MilestoneState({
  icon,
  title,
  hint,
  milestone,
  children
}: {
  icon: IconName
  title: string
  hint: string
  milestone: string
  children?: ReactNode
}): JSX.Element {
  return (
    <div className="glass glass-card mx-auto mt-10 flex w-full max-w-[520px] flex-col items-center gap-3 rounded-card p-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--hairline)] bg-[var(--hover-bg)]">
        <Icon name={icon} size={22} className="text-2" />
      </div>
      <h2 className="text-[16px] font-semibold text-1">{title}</h2>
      <p className="max-w-[360px] text-[12.5px] leading-relaxed text-2">{hint}</p>
      <span className="mt-1 rounded-full border border-accent/35 bg-accent/10 px-2.5 py-1 text-[11.5px] font-medium tracking-wide accent-text">
        {milestone}
      </span>
      {children}
    </div>
  )
}
