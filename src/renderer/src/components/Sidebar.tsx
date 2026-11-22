import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '@renderer/store/app-store'
import { Icon } from './Icon'
import { SkinAvatar } from './SkinAvatar'

/** PCL 风格的左侧账号面板：登录入口、皮肤头像、启动游戏、版本选择/设置 */
export function Sidebar(): JSX.Element {
  const t = useAppStore((state) => state.t)
  const accounts = useAppStore((state) => state.accounts)
  const activeId = useAppStore((state) => state.settings.lastAccountId)
  const instances = useAppStore((state) => state.instances)
  const selectedId = useAppStore((state) => state.selectedId)
  const selectInstance = useAppStore((state) => state.selectInstance)
  const notify = useAppStore((state) => state.notify)
  const navigate = useNavigate()

  const [versionsOpen, setVersionsOpen] = useState(false)
  const [launching, setLaunching] = useState(false)

  useEffect(() => {
    const onDown = (event: MouseEvent): void => {
      const target = event.target as HTMLElement
      if (!target.closest('[data-version-picker]')) setVersionsOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const active = accounts.find((item) => item.id === activeId) ?? accounts[0] ?? null
  const selected = instances.find((item) => item.id === selectedId) ?? instances[0] ?? null

  const handleLaunch = async (): Promise<void> => {
    if (launching) return
    if (!selected) {
      notify('error', t('home.noInstancesHint'))
      return
    }
    setLaunching(true)
    try {
      const steps = await window.ferry.preflightInstance(selected.id)
      if (steps.length === 0) {
        notify('error', t('launch.failed', { message: 'preflight' }))
        return
      }
      const failed = steps.find((step) => !step.ok)
      if (failed) {
        notify('error', failed.id === 'java' ? t('launch.noJava') : t('launch.failed', { message: failed.id }))
        return
      }
      const outcome = await window.ferry.launch(selected.id, active?.id ?? null)
      if (!outcome.ok) {
        const [need, found] = outcome.message.split('|')
        notify(
          'error',
          outcome.reason === 'no-account'
            ? t('launch.noAccount')
            : outcome.reason === 'auth-expired'
              ? t('launch.authExpired')
              : outcome.reason === 'java-too-old'
                ? t('launch.javaTooOld', { need, found })
                : t('launch.failed', { message: outcome.message })
        )
        return
      }
      notify('success', t('launch.running'))
    } finally {
      setLaunching(false)
    }
  }

  return (
    <nav className="relative z-10 flex w-[272px] shrink-0 flex-col border-r border-[var(--hairline)] bg-[var(--sidebar-bg)] px-4 pb-4 pt-5">
      <button
        type="button"
        onClick={() => navigate('/accounts')}
        className="flex items-center gap-1.5 self-start text-[12.5px] font-medium text-[#2d7dd2] transition-opacity hover:opacity-75"
      >
        <Icon name="user" size={14} />
        <span>{active?.sourceName ?? 'LittleSkin'} {t('accounts.loginShort')}</span>
      </button>

      <div className="flex flex-1 flex-col items-center justify-center gap-2 pb-6">
        <SkinAvatar account={active} size={80} />
        <div className="mt-1 text-center">
          <p className="text-[15px] font-semibold text-[var(--sidebar-text)]">{active?.profileName ?? t('accounts.notSignedIn')}</p>
          <p className="mt-0.5 text-[11.5px] text-[var(--sidebar-text-2)]">{active?.userName ?? ''}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => void handleLaunch()}
          disabled={launching}
          className="flex h-[52px] flex-col items-center justify-center rounded-lg border border-[#2d7dd2] bg-white/70 text-[#2d7dd2] transition-colors hover:bg-[#2d7dd2] hover:text-white disabled:opacity-60"
        >
          <span className="text-[13px] font-semibold">{launching ? t('home.launching') : t('home.launch')}</span>
          <span className="mt-0.5 max-w-[220px] truncate text-[11px] opacity-75">
            {selected?.name ?? t('home.noInstances')}
          </span>
        </button>

        <div className="grid grid-cols-2 gap-2" data-version-picker>
          <div className="relative">
            <button
              type="button"
              onClick={() => setVersionsOpen((open) => !open)}
              className="h-9 w-full rounded-lg border border-[var(--hairline)] bg-white/70 text-[12px] font-medium text-[var(--sidebar-text)] transition-colors hover:bg-[var(--hover-bg)]"
            >
              {t('home.versionSelect')}
            </button>
            <AnimatePresence>
              {versionsOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  transition={{ duration: 0.15 }}
                  className="glass-strong absolute bottom-11 left-0 z-40 max-h-[280px] w-[248px] overflow-y-auto rounded-xl border border-[var(--hairline)] p-1 shadow-xl"
                >
                  {instances.map((instance) => (
                    <button
                      key={instance.id}
                      type="button"
                      onClick={() => {
                        selectInstance(instance.id)
                        setVersionsOpen(false)
                      }}
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[12px] transition-colors hover:bg-[var(--hover-bg)] ${
                        instance.id === selectedId ? 'accent-text' : 'text-[var(--sidebar-text)]'
                      }`}
                    >
                      <Icon name={instance.id === selectedId ? 'check' : 'play'} size={13} />
                      <span className="min-w-0 flex-1 truncate">{instance.name}</span>
                      <span className="shrink-0 text-[11px] text-[var(--sidebar-text-2)]">{instance.mcVersion}</span>
                    </button>
                  ))}
                  {instances.length === 0 && (
                    <p className="px-2 py-4 text-center text-[12px] text-[var(--sidebar-text-2)]">{t('home.noInstancesHint')}</p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <button
            type="button"
            onClick={() => navigate('/versions')}
            className="h-9 rounded-lg border border-[var(--hairline)] bg-white/70 text-[12px] font-medium text-[var(--sidebar-text)] transition-colors hover:bg-[var(--hover-bg)]"
          >
            {t('home.versionSettings')}
          </button>
        </div>
      </div>
    </nav>
  )
}
