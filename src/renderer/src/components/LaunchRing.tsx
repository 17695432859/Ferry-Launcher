import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { CrashReport, LaunchLog } from '@shared/types'
import type { TranslationKey } from '@shared/i18n'
import { useRafTween } from '@renderer/hooks/useRafTween'
import { useAppStore } from '@renderer/store/app-store'
import { CrashPanel } from './CrashPanel'
import { Icon } from './Icon'

type Phase = 'idle' | 'preflight' | 'launching' | 'running' | 'failed'

const STAGE_LABEL: Record<string, string> = {
  resolving: 'launch.preflight',
  natives: 'launch.preflight',
  spawning: 'launch.preflight',
  running: 'launch.running',
  exited: 'launch.exited'
}

const RING_RADIUS = 9
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

/**
 * 主启动按钮。点击后先跑预检（目录 / 版本文件 / 写权限 / Java），
 * 然后真的拉起游戏进程；运行中再点一次是结束进程。
 *
 * variant:
 *   inline —— 小号胶囊按钮（版本设置页顶栏用）
 *   block  —— PCL 主界面那种整条大按钮，主标题下面带实例名
 */
export function LaunchRing({
  instanceId,
  variant = 'inline'
}: {
  instanceId: string
  variant?: 'inline' | 'block'
}): JSX.Element {
  const t = useAppStore((state) => state.t)
  const notify = useAppStore((state) => state.notify)
  const accountId = useAppStore((state) => state.settings.lastAccountId)
  const instance = useAppStore((state) => state.instances.find((item) => item.id === instanceId) ?? null)
  const block = variant === 'block'

  const [phase, setPhase] = useState<Phase>('idle')
  const [label, setLabel] = useState('')
  const [logs, setLogs] = useState<LaunchLog[]>([])
  const [showLog, setShowLog] = useState(false)
  const [crashReport, setCrashReport] = useState<CrashReport | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [showCrash, setShowCrash] = useState(false)
  const { value, animateTo, reset } = useRafTween(420)
  const logRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const disposeState = window.ferry.onLaunchState((event) => {
      if (event.phase === 'running') {
        setPhase('running')
        setLabel(t('launch.running'))
      } else if (event.phase === 'exited') {
        setPhase('idle')
        setLabel('')
        notify('info', t('launch.exited', { code: event.message || '0' }))
      } else {
        setLabel(t((STAGE_LABEL[event.phase] ?? 'launch.preflight') as TranslationKey))
      }
    })
    const disposeLog = window.ferry.onLaunchLog((entry) => {
      setLogs((list) => (list.length > 400 ? [...list.slice(-400), entry] : [...list, entry]))
    })
    // 后端在游戏异常退出时已经跑完分析，这里直接接结论并弹出来
    const disposeCrash = window.ferry.onCrashAnalysis((report) => {
      setCrashReport(report)
      setAnalyzing(false)
      setShowCrash(true)
      if (report.crashed) notify('error', t('crash.auto'))
    })
    void window.ferry.isLaunching().then((running) => {
      if (running) {
        setPhase('running')
        setLabel(t('launch.running'))
      }
    })
    return () => {
      disposeState()
      disposeLog()
      disposeCrash()
    }
  }, [notify, t])

  useEffect(() => {
    if (!showLog || !logRef.current) return
    logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs, showLog])

  const run = async (): Promise<void> => {
    if (phase === 'running') {
      await window.ferry.stopLaunch()
      setPhase('idle')
      return
    }
    if (phase === 'preflight' || phase === 'launching') return

    reset()
    setPhase('preflight')
    setLogs([])
    setCrashReport(null)
    setShowCrash(false)

    const steps = await window.ferry.preflightInstance(instanceId)
    if (steps.length === 0) {
      setPhase('failed')
      return
    }
    let index = 0
    for (const step of steps) {
      const from = (index / steps.length) * 60
      const to = ((index + 1) / steps.length) * 60
      await animateTo(from, to)
      index += 1
      if (!step.ok) {
        setPhase('failed')
        setLabel(step.id === 'java' ? t('launch.noJava') : t('launch.failed', { message: step.id }))
        setTimeout(() => setPhase('idle'), 3200)
        return
      }
    }

    setPhase('launching')
    await animateTo(60, 92)
    const outcome = await window.ferry.launch(instanceId, accountId)
    if (!outcome.ok) {
      setPhase('failed')
      const [need, found] = outcome.message.split('|')
      setLabel(
        outcome.reason === 'no-account'
          ? t('launch.noAccount')
          : outcome.reason === 'auth-expired'
            ? t('launch.authExpired')
            : outcome.reason === 'java-too-old'
              ? t('launch.javaTooOld', { need, found })
              : t('launch.failed', { message: outcome.message })
      )
      setTimeout(() => setPhase('idle'), 4200)
      return
    }
    await animateTo(92, 100)
    setPhase('running')
    setLabel(t('launch.running'))
  }

  const busy = phase === 'preflight' || phase === 'launching'
  const text =
    phase === 'running'
      ? t('launch.stop')
      : busy
        ? label || t('launch.preflight')
        : phase === 'failed'
          ? label
          : t('home.launch')

  const analyze = async (): Promise<void> => {
    setShowLog(false)
    setShowCrash(true)
    setAnalyzing(true)
    setCrashReport(null)
    try {
      const report = await window.ferry.analyzeCrash(instanceId)
      setCrashReport(report)
    } catch {
      notify('error', t('crash.noReports'))
    } finally {
      setAnalyzing(false)
    }
  }

  // block 模式两个按钮等宽，内容左对齐（图标落在同一条竖线上，不随文字长短左右飘）
  const toolClass = block
    ? 'flex h-7 flex-1 items-center justify-start gap-1.5 rounded-lg border border-[var(--hairline)] px-2.5 text-[11.5px] font-medium text-2 transition-colors hover:bg-[var(--hover-bg)] hover:text-1'
    : 'flex h-9 w-9 items-center justify-center rounded-lg text-3 transition-colors hover:bg-[var(--hover-bg)] hover:text-1'

  return (
    <div className={block ? 'relative flex w-full flex-col gap-1.5' : 'relative flex items-center gap-1.5'}>
      {/* 日志 / 崩溃分析：inline 模式在主按钮左侧，block 模式挪到主按钮下面一行 */}
      <div className={block ? 'order-2 flex items-center gap-1.5' : 'contents'}>
        <button
          type="button"
          onClick={() => setShowLog((open) => !open)}
          title={t('launch.log')}
          className={toolClass}
        >
          <Icon name="list" size={14} />
          {block && <span>{t('launch.log')}</span>}
        </button>
        <button
          type="button"
          onClick={() => void analyze()}
          title={t('crash.analyze')}
          className={toolClass}
        >
          <Icon name="alert" size={14} />
          {block && <span>{t('crash.analyze')}</span>}
        </button>
      </div>

      <motion.button
        type="button"
        onClick={() => void run()}
        whileTap={{ scale: 0.97 }}
        whileHover={phase === 'idle' ? { scale: 1.015 } : undefined}
        transition={{ type: 'spring', stiffness: 380, damping: 26 }}
        className={
          block
            ? 'group relative order-1 flex h-[52px] w-full items-center gap-2.5 overflow-hidden rounded-xl px-3 text-left text-[var(--accent-ink)] shadow-[0_10px_24px_-12px_rgb(var(--accent-rgb)/0.9)]'
            : 'group relative flex h-9 items-center gap-2 overflow-hidden rounded-lg px-3.5 text-[13px] font-medium text-[var(--accent-ink)] shadow-[0_6px_18px_-8px_rgb(var(--accent-rgb)/0.8)]'
        }
        style={{
          backgroundColor: phase === 'failed' ? '#c2455e' : phase === 'running' ? '#3f8f6a' : 'var(--accent)'
        }}
        aria-live="polite"
      >
        {phase === 'idle' && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-white/20 transition-transform duration-700 ease-out group-hover:translate-x-[420%]"
          />
        )}

        <span
          className={
            block
              ? 'relative flex h-7 w-7 shrink-0 items-center justify-center'
              : 'relative flex h-[22px] w-[22px] shrink-0 items-center justify-center'
          }
        >
          <AnimatePresence mode="wait" initial={false}>
            {busy ? (
              <motion.svg
                key="ring"
                width="22"
                height="22"
                viewBox="0 0 22 22"
                initial={{ opacity: 0, rotate: -90 }}
                animate={{ opacity: 1, rotate: -90 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
              >
                <circle cx="11" cy="11" r={RING_RADIUS} fill="none" stroke="currentColor" strokeOpacity="0.28" strokeWidth="2.2" />
                <circle
                  cx="11"
                  cy="11"
                  r={RING_RADIUS}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeDasharray={RING_CIRCUMFERENCE}
                  strokeDashoffset={RING_CIRCUMFERENCE * (1 - value / 100)}
                />
              </motion.svg>
            ) : (
              <motion.span
                key={phase}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.16 }}
                className="flex items-center justify-center"
              >
                <Icon
                  name={phase === 'failed' ? 'alert' : phase === 'running' ? 'close' : 'play'}
                  size={phase === 'idle' ? 14 : 15}
                  filled={phase === 'idle'}
                  strokeWidth={phase === 'idle' ? 0 : 2}
                />
              </motion.span>
            )}
          </AnimatePresence>
        </span>

        {block ? (
          <span className="relative flex min-w-0 flex-1 flex-col justify-center leading-tight">
            <span className="truncate text-[13.5px] font-semibold">{text}</span>
            <span className="mt-0.5 truncate text-[11px] font-normal opacity-85">
              {instance ? `${instance.name} · ${instance.mcVersion}` : ''}
            </span>
          </span>
        ) : (
          <span className="relative whitespace-nowrap">{text}</span>
        )}
      </motion.button>

      <CrashPanel report={crashReport} analyzing={analyzing} open={showCrash} onClose={() => setShowCrash(false)} />
      <AnimatePresence>
        {showLog && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className={`glass-strong absolute z-40 flex h-[260px] flex-col overflow-hidden rounded-xl border border-[var(--hairline)] shadow-xl ${
              block ? 'left-0 top-[86px] w-[420px]' : 'right-0 top-11 w-[460px]'
            }`}
          >
            <div className="flex items-center gap-2 border-b border-[var(--hairline)] px-3 py-1.5">
              <span className="text-[11.5px] text-2">{t('launch.log')}</span>
              <button
                type="button"
                onClick={() => setShowLog(false)}
                className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-3 hover:bg-[var(--active-bg)] hover:text-1"
              >
                <Icon name="close" size={12} />
              </button>
            </div>
            <div ref={logRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
              {logs.length === 0 ? (
                <p className="text-[11.5px] text-3">{t('launch.logEmpty')}</p>
              ) : (
                logs.map((entry, index) => (
                  <div
                    key={index}
                    className={`whitespace-pre-wrap break-all font-mono text-[10.5px] leading-[1.5] ${
                      entry.stream === 'stderr' ? 'text-[#c2455e]' : 'text-2'
                    }`}
                  >
                    {entry.line}
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
