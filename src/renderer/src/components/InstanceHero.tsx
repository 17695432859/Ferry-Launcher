import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { Instance } from '@shared/types'
import { formatRelativeTime } from '@renderer/lib/format'
import { LOADER_LABEL_KEYS } from '@renderer/lib/labels'
import { useAppStore } from '@renderer/store/app-store'
import { Icon } from './Icon'
import { InstanceTile } from './InstanceIcon'
import { LaunchRing } from './LaunchRing'
import { ContentPanel } from './instance/ContentPanel'
import { OverviewPanel } from './instance/OverviewPanel'
import { SettingsPanel } from './instance/SettingsPanel'

type Tab = 'overview' | 'content' | 'settings'

const TABS: Array<{ id: Tab; key: 'tab.overview' | 'tab.content' | 'tab.settings' }> = [
  { id: 'overview', key: 'tab.overview' },
  { id: 'content', key: 'tab.content' },
  { id: 'settings', key: 'tab.settings' }
]

export function InstanceHero({ instance }: { instance: Instance }): JSX.Element {
  const t = useAppStore((state) => state.t)
  const locale = useAppStore((state) => state.settings.locale)
  const removeInstance = useAppStore((state) => state.removeInstance)
  const notify = useAppStore((state) => state.notify)
  const [tab, setTab] = useState<Tab>('overview')
  const [confirming, setConfirming] = useState(false)

  const lastPlayed = formatRelativeTime(instance.lastPlayedAt, locale)
  const loaderLabel = t(LOADER_LABEL_KEYS[instance.loader])

  return (
    <motion.section
      key={instance.id}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="glass flex min-h-0 flex-1 flex-col overflow-hidden rounded-panel"
    >
      <div className="flex items-start gap-4 px-5 pb-3 pt-5">
        <InstanceTile instance={instance} size={44} radius={12} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-[18px] font-semibold leading-tight tracking-tight text-1">
              {instance.name}
            </h1>
            <span className="shrink-0 rounded-md bg-accent/12 px-1.5 py-0.5 text-[11.5px] font-medium accent-text">
              {loaderLabel}
            </span>
          </div>
          <p className="mt-1 truncate text-[12.5px] text-2">
            Minecraft {instance.mcVersion}
            {instance.loaderVersion ? ` · ${loaderLabel} ${instance.loaderVersion}` : ''}
            {lastPlayed ? ` · ${t('home.lastPlayed')} ${lastPlayed}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              if (!confirming) {
                setConfirming(true)
                setTimeout(() => setConfirming(false), 3000)
                return
              }
              void removeInstance(instance.id)
              notify('info', t('home.removedToast', { name: instance.name }))
            }}
            title={t('home.remove')}
            className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
              confirming ? 'bg-[#c2455e] text-white' : 'text-3 hover:bg-[var(--hover-bg)] hover:text-1'
            }`}
          >
            <Icon name={confirming ? 'alert' : 'trash'} size={15} />
          </button>
          <LaunchRing instanceId={instance.id} />
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-[var(--hairline)] px-4">
        {TABS.map((item) => {
          const active = item.id === tab
          return (
            <button
              key={item.id}
              type="button"
              data-tab={item.id}
              onClick={() => setTab(item.id)}
              className={`relative px-3 py-2 text-[13px] font-medium transition-colors ${
                active ? 'text-1' : 'text-3 hover:text-2'
              }`}
            >
              {t(item.key)}
              {active && (
                <motion.span
                  layoutId="instance-tab"
                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                  className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-accent"
                />
              )}
            </button>
          )
        })}
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0 overflow-y-auto"
          >
            {tab === 'overview' && <OverviewPanel instance={instance} />}
            {tab === 'content' && <ContentPanel instance={instance} />}
            {tab === 'settings' && <SettingsPanel instance={instance} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.section>
  )
}
