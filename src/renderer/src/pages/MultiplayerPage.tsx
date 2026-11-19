import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { EasyTierConfig, NetplayProviderId, NetplayRuntime, NetplayStatus } from '@shared/types'
import { IDLE_NETPLAY_STATUS } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { useAppStore } from '@renderer/store/app-store'

type ProviderId = NetplayProviderId

const PROVIDERS: Array<{
  id: ProviderId
  nameKey: 'net.terracotta' | 'net.easytier'
  attributionKey: 'net.attribution' | 'net.easytierAttribution'
}> = [
  { id: 'terracotta', nameKey: 'net.terracotta', attributionKey: 'net.attribution' },
  { id: 'easytier', nameKey: 'net.easytier', attributionKey: 'net.easytierAttribution' }
]

const PHASE_KEY = {
  idle: 'net.phase.idle',
  installing: 'net.phase.installing',
  starting: 'net.phase.starting',
  scanning: 'net.phase.scanning',
  waiting: 'net.phase.waiting',
  connecting: 'net.phase.connecting',
  connected: 'net.phase.connected',
  hosting: 'net.phase.hosting',
  error: 'net.phase.error'
} as const

const EMPTY_CONFIG: EasyTierConfig = {
  code: '',
  networkName: '',
  networkSecret: '',
  peers: '',
  role: 'host',
  port: 25565
}


function Step({ index, title, desc }: { index: number; title: string; desc: string }): JSX.Element {
  return (
    <div className="rounded-xl border border-[var(--hairline)] bg-[var(--hover-bg)] px-3.5 py-3">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/15 text-[11px] font-semibold tnum accent-text">
          {index}
        </span>
        <span className="text-[12.5px] font-medium text-1">{title}</span>
      </div>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-3">{desc}</p>
    </div>
  )
}

export function MultiplayerPage(): JSX.Element {
  const t = useAppStore((state) => state.t)
  const notify = useAppStore((state) => state.notify)

  const [provider, setProvider] = useState<ProviderId>('terracotta')
  const [runtimes, setRuntimes] = useState<Partial<Record<ProviderId, NetplayRuntime>>>({})
  const [status, setStatus] = useState<NetplayStatus>(IDLE_NETPLAY_STATUS)
  const [installing, setInstalling] = useState<ProviderId | null>(null)
  const [progress, setProgress] = useState<{ received: number; total: number; phase: string }>({
    received: 0,
    total: 0,
    phase: 'connect'
  })
  const [installError, setInstallError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [room, setRoom] = useState('')
  const [player, setPlayer] = useState('')
  const [config, setConfig] = useState<EasyTierConfig>(EMPTY_CONFIG)
  const copiedTimer = useRef<number | null>(null)
  const [copied, setCopied] = useState(false)

  const loadRuntime = useCallback(async (id: ProviderId): Promise<void> => {
    const runtime = await window.ferry.netplay.runtime(id)
    setRuntimes((prev) => ({ ...prev, [id]: runtime }))
  }, [])

  useEffect(() => {
    void loadRuntime('terracotta')
    void loadRuntime('easytier')
    void window.ferry.netplay.status().then(setStatus)
    void window.ferry.netplay.getEasyTierConfig().then(setConfig)
  }, [loadRuntime])

  useEffect(() => {
    const offStatus = window.ferry.netplay.onStatus(setStatus)
    const offProgress = window.ferry.netplay.onInstallProgress((next) => {
      setProgress({ received: next.received, total: next.total, phase: next.phase ?? 'download' })
    })
    return () => {
      offStatus()
      offProgress()
    }
  }, [])

  useEffect(() => {
    return () => {
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current)
    }
  }, [])

  const runtime = runtimes[provider]
  const installed = runtime?.installed === true
  const active = status.phase !== 'idle' && status.phase !== 'error'

  // 下载源连上之前 total 一直是 0，不能拿它算百分比，否则进度条会假装满格
  const installPercent =
    progress.total > 0 ? Math.min(100, Math.round((progress.received / progress.total) * 100)) : 0
  const installPending = progress.phase === 'connect' || progress.phase === 'extract'
  const installLabel =
    progress.phase === 'connect'
      ? t('net.connecting')
      : progress.phase === 'extract'
        ? t('net.extracting')
        : progress.total > 0
          ? t('net.installing', { percent: installPercent })
          : t('net.downloadingMb', { size: (progress.received / 1024 / 1024).toFixed(1) })

  const handleInstall = async (): Promise<void> => {
    setInstalling(provider)
    setInstallError(null)
    setProgress({ received: 0, total: 0, phase: 'connect' })
    const outcome = await window.ferry.netplay.install(provider)
    setInstalling(null)
    if (outcome.ok) {
      setRuntimes((prev) => ({ ...prev, [provider]: outcome.runtime }))
      notify('success', t('net.installed', { version: outcome.runtime.version ?? '' }))
    } else {
      setInstallError(outcome.message)
    }
  }

  const describeError = (reason: string, message: string): string => {
    if (reason === 'not-installed') return t('net.error.not-installed')
    if (reason === 'timeout') return t('net.error.timeout')
    if (reason === 'rejected') return t('net.error.rejected')
    if (reason === 'invalid') return t('net.error.invalid')
    if (message === 'EMPTY_ROOM') return t('net.error.EMPTY_ROOM')
    return t('net.error.generic', { message })
  }

  const run = async (action: () => Promise<{ ok: boolean; reason?: string; message?: string }>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const outcome = await action()
      if (!outcome.ok) {
        setError(describeError(outcome.reason ?? 'error', outcome.message ?? ''))
      }
    } finally {
      setBusy(false)
    }
  }

  // 官方行为：房主不指定房间码，陶瓦用密码学随机数生成 U/NNNN-NNNN-SSSS-SSSS
  const handleHost = (): Promise<void> => run(() => window.ferry.netplay.host('', player.trim()))

  const handleJoin = (): Promise<void> =>
    run(() => window.ferry.netplay.join(room.trim(), player.trim()))

  const handleMesh = (): Promise<void> =>
    run(() => window.ferry.netplay.saveEasyTierConfig(config))

  const handleGenerateCode = async (): Promise<void> => {
    const info = await window.ferry.netplay.generateCode()
    setConfig((prev) => ({
      ...prev,
      code: info.code,
      networkName: info.networkName,
      networkSecret: info.networkSecret
    }))
  }

  // 粘贴别人的码时，顺便把对应的网络名和密钥解出来
  const handleCodeChange = async (raw: string): Promise<void> => {
    setConfig((prev) => ({ ...prev, code: raw }))
    if (!raw.trim()) return
    const parsed = await window.ferry.netplay.parseCode(raw)
    if (parsed.ok) {
      setConfig((prev) => ({
        ...prev,
        code: parsed.code,
        networkName: parsed.networkName,
        networkSecret: parsed.networkSecret
      }))
    }
  }

  const handleStop = async (): Promise<void> => {
    setStatus(await window.ferry.netplay.stop())
    setError(null)
  }

  const copyAddress = (): void => {
    if (!status.joinAddress) return
    void navigator.clipboard.writeText(status.joinAddress)
    setCopied(true)
    if (copiedTimer.current) window.clearTimeout(copiedTimer.current)
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1600)
  }

  const logRef = useRef<Array<{ time: string; text: string }>>([])
  const [events, setEvents] = useState<Array<{ time: string; text: string }>>([])
  useEffect(() => {
    const text = status.message ?? t(PHASE_KEY[status.phase])
    const last = logRef.current[0]
    if (last && last.text === text) return
    const entry = { time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), text }
    logRef.current = [entry, ...logRef.current].slice(0, 6)
    setEvents(logRef.current)
  }, [status.phase, status.message, t])

  const meta = PROVIDERS.find((item) => item.id === provider) as (typeof PROVIDERS)[number]
  const phaseText = t(PHASE_KEY[status.phase])

  return (
    <div className="flex min-h-0 flex-1 flex-col px-5 pb-5 pt-3">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight text-1">{t('net.title')}</h1>
          <p className="mt-1 text-[12.5px] text-2">{t('net.subtitle')}</p>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-[var(--hairline)] bg-[var(--hover-bg)] p-1">
          {PROVIDERS.map((item) => {
            const selected = item.id === provider
            return (
              <button
                key={item.id}
                type="button"
                data-provider={item.id}
                onClick={() => setProvider(item.id)}
                className={`relative rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium transition-colors ${
                  selected ? 'text-1' : 'text-3 hover:text-2'
                }`}
              >
                {selected && (
                  <motion.span
                    layoutId="netplay-provider"
                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                    className="absolute inset-0 -z-10 rounded-lg border border-[var(--panel-border)] bg-[var(--active-bg)]"
                  />
                )}
                {t(item.nameKey)}
              </button>
            )
          })}
        </div>
      </div>

      <section className="glass flex min-h-0 flex-1 flex-col overflow-hidden rounded-panel">
        <header className="flex items-center gap-3 border-b border-[var(--hairline)] px-5 py-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/12">
            <Icon name="cube" size={15} className="accent-text" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-medium text-1">{t(meta.nameKey)}</p>
          </div>
          <span className="shrink-0 text-[11px] text-3">{t(meta.attributionKey)}</span>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {!installed ? (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--hairline)] bg-[var(--hover-bg)]">
                <Icon name="download" size={19} className="text-3" />
              </div>
              <p className="text-[13px] font-medium text-1">{t('net.notInstalled')}</p>
              <p className="text-[12.5px] text-3">{t('net.needInstall')}</p>
              {installing ? (
                <div className="mt-1 w-[260px]">
                  <div className="h-1 overflow-hidden rounded-full bg-[var(--active-bg)]">
                    <div
                      className={
                        installPending
                          ? 'h-full w-1/3 animate-pulse rounded-full bg-accent'
                          : 'h-full rounded-full bg-accent transition-[width] duration-300'
                      }
                      style={installPending ? undefined : { width: `${installPercent}%` }}
                    />
                  </div>
                  <p className="mt-2 text-center text-[12px] tnum text-3">{installLabel}</p>
                </div>
              ) : (
                <button
                  type="button"
                  data-action="install"
                  onClick={() => void handleInstall()}
                  className="mt-1 flex h-9 items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-3.5 text-[12.5px] font-medium accent-text transition-colors hover:bg-accent/15"
                >
                  <Icon name="download" size={14} />
                  {installError ? t('net.retry') : t('net.install')}
                </button>
              )}
              {installError && (
                <p className="max-w-[320px] text-center text-[12px] leading-relaxed text-[#c2455e]">
                  {t('net.installFailed', { message: installError })}
                </p>
              )}
            </div>
          ) : provider === 'terracotta' ? (
            <div className="flex h-full flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12px] text-3">{t('net.joinCode')}</span>
                  <input
                    value={room}
                    onChange={(event) => setRoom(event.target.value.toUpperCase().slice(0, 21))}
                    placeholder="U/XXXX-XXXX-XXXX-XXXX"
                    spellCheck={false}
                    className="h-8 rounded-lg border border-[var(--hairline)] bg-[var(--hover-bg)] px-2.5 font-mono text-[12px] text-1 outline-none transition-colors placeholder:text-3 focus:border-accent/60"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12px] text-3">{t('net.playerName')}</span>
                  <input
                    value={player}
                    onChange={(event) => setPlayer(event.target.value.slice(0, 16))}
                    placeholder="Steve"
                    className="h-8 rounded-lg border border-[var(--hairline)] bg-[var(--hover-bg)] px-2.5 text-[12.5px] text-1 outline-none transition-colors placeholder:text-3 focus:border-accent/60"
                  />
                </label>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-action="host"
                  disabled={busy || active}
                  onClick={() => void handleHost()}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-3 text-[12.5px] font-medium accent-text transition-colors hover:bg-accent/15 disabled:opacity-40"
                >
                  <Icon name="play" size={13} />
                  {t('net.create')}
                </button>
                <button
                  type="button"
                  data-action="join"
                  disabled={busy || active || !room.trim()}
                  onClick={() => void handleJoin()}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--hairline)] bg-[var(--hover-bg)] px-3 text-[12.5px] text-1 transition-colors hover:border-[var(--panel-border)] disabled:opacity-40"
                >
                  <Icon name="import" size={13} />
                  {t('net.join')}
                </button>
                <button
                  type="button"
                  data-action="stop"
                  disabled={!active}
                  onClick={() => void handleStop()}
                  className="ml-auto flex h-8 items-center rounded-lg border border-[var(--hairline)] bg-[var(--hover-bg)] px-3 text-[12.5px] text-2 transition-colors hover:text-1 disabled:opacity-40"
                >
                  {t('net.stop')}
                </button>
              </div>

              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={status.phase}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.16 }}
                  className="rounded-xl border border-[var(--hairline)] bg-[var(--hover-bg)] px-4 py-3"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{
                        backgroundColor:
                          status.phase === 'error'
                            ? '#c2455e'
                            : status.phase === 'idle'
                              ? 'var(--text-3)'
                              : 'var(--accent)'
                      }}
                    />
                    <span className="text-[12.5px] text-1">{phaseText}</span>
                    {status.roomCode && (
                      <span className="ml-auto text-[12px] tnum text-2">
                        {t('net.roomCode')} {status.roomCode}
                      </span>
                    )}
                  </div>

                  {status.message && (
                    <p className="mt-1.5 text-[12.5px] text-[#c2455e]">{status.message}</p>
                  )}

                  {status.joinAddress && (
                    <div className="mt-2.5 flex items-center gap-2">
                      <span className="text-[11.5px] uppercase tracking-[0.08em] text-3">
                        {t('net.address')}
                      </span>
                      <code className="min-w-0 flex-1 truncate rounded-md bg-[var(--active-bg)] px-2 py-1 text-[12.5px] text-1">
                        {status.joinAddress}
                      </code>
                      <button
                        type="button"
                        onClick={copyAddress}
                        className="shrink-0 rounded-md border border-[var(--hairline)] px-2 py-1 text-[12px] text-2 transition-colors hover:text-1"
                      >
                        {copied ? t('net.copied') : t('net.copyAddress')}
                      </button>
                    </div>
                  )}

                  <p className="mt-2 text-[12px] leading-relaxed text-3">
                    {status.phase === 'connected' || status.phase === 'connecting'
                      ? t('net.guestTip')
                      : t('net.hostTip')}
                  </p>
                </motion.div>
              </AnimatePresence>

              {error && <p className="text-[12.5px] text-[#c2455e]">{error}</p>}

              <div className="grid grid-cols-3 gap-3 pt-5">
                <Step index={1} title={t('net.step1')} desc={t('net.step1Desc')} />
                <Step index={2} title={t('net.step2')} desc={t('net.step2Desc')} />
                <Step index={3} title={t('net.step3')} desc={t('net.step3Desc')} />
              </div>
              <div className="mt-auto pt-5">
                <div className="mb-2 flex items-baseline gap-2">
                  <span className="text-[10.5px] uppercase tracking-[0.1em] text-3">{t('net.sessionLog')}</span>
                  <span className="text-[10.5px] text-3 opacity-70">{t('net.sessionLogHint')}</span>
                </div>
                <div className="flex flex-col gap-1">
                  {events.length === 0 ? (
                    <span className="text-[11px] text-3">{t('net.sessionLogEmpty')}</span>
                  ) : (
                    events.map((event, index) => (
                      <div
                        key={`${event.time}-${index}`}
                        className="flex items-center gap-2 rounded-md bg-[var(--hover-bg)] px-2.5 py-1.5"
                      >
                        <span className="text-[10.5px] tnum text-3">{event.time}</span>
                        <span className="truncate text-[11.5px] text-2">{event.text}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>
          ) : (
            <div className="flex h-full flex-col gap-3.5">
              <div className="grid grid-cols-2 gap-3">
                <label className="col-span-2 flex flex-col gap-1.5">
                  <span className="flex items-baseline gap-2">
                    <span className="text-[12px] text-3">{t('net.joinCode')}</span>
                    <span className="text-[11.5px] text-3 opacity-80">{t('net.codeHint')}</span>
                  </span>
                  <div className="flex gap-1.5">
                    <input
                      value={config.code}
                      onChange={(event) => void handleCodeChange(event.target.value.toUpperCase().slice(0, 21))}
                      placeholder="U/XXXX-XXXX-XXXX-XXXX"
                      spellCheck={false}
                      className="h-8 min-w-0 flex-1 rounded-lg border border-[var(--hairline)] bg-[var(--hover-bg)] px-2.5 font-mono text-[12px] text-1 outline-none transition-colors placeholder:text-3 focus:border-accent/60"
                    />
                    <button
                      type="button"
                      onClick={() => void handleGenerateCode()}
                      className="h-8 shrink-0 rounded-lg border border-accent/40 bg-accent/10 px-2.5 text-[12px] font-medium accent-text"
                    >
                      {t('net.generateCode')}
                    </button>
                  </div>
                  {config.networkName && (
                    <span className="break-all font-mono text-[10.5px] leading-relaxed text-3">
                      {config.networkName} · {config.networkSecret}
                    </span>
                  )}
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12px] text-3">{t('net.role')}</span>
                  <div className="flex h-8 items-center gap-1 rounded-lg bg-[var(--active-bg)] p-0.5">
                    {(['host', 'guest'] as const).map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setConfig((prev) => ({ ...prev, role: item }))}
                        className={`flex-1 rounded-[6px] py-1 text-[11.5px] transition-colors ${
                          config.role === item ? 'bg-[var(--panel)] text-1 shadow-sm' : 'text-3'
                        }`}
                      >
                        {t(item === 'host' ? 'net.roleHost' : 'net.roleGuest')}
                      </button>
                    ))}
                  </div>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12px] text-3">{t('net.mcPort')}</span>
                  <input
                    value={config.port ?? 25565}
                    onChange={(event) =>
                      setConfig((prev) => ({
                        ...prev,
                        port: Number(event.target.value.replace(/[^\d]/g, '').slice(0, 5)) || 25565
                      }))
                    }
                    inputMode="numeric"
                    className="h-8 rounded-lg border border-[var(--hairline)] bg-[var(--hover-bg)] px-2.5 text-[12.5px] text-1 outline-none transition-colors focus:border-accent/60"
                  />
                </label>
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="flex items-baseline gap-2">
                  <span className="text-[12px] text-3">{t('net.peers')}</span>
                  <span className="text-[11.5px] text-3 opacity-80">{t('net.peersHint')}</span>
                </span>
                <textarea
                  value={config.peers}
                  onChange={(event) =>
                    setConfig((prev) => ({ ...prev, peers: event.target.value.slice(0, 2000) }))
                  }
                  rows={3}
                  spellCheck={false}
                  className="resize-none rounded-lg border border-[var(--hairline)] bg-[var(--hover-bg)] px-3 py-2 text-[12.5px] leading-relaxed text-1 outline-none transition-colors focus:border-accent/60"
                />
              </label>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-action="mesh"
                  disabled={busy || active || !config.code.trim()}
                  onClick={() => void handleMesh()}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-3 text-[12.5px] font-medium accent-text transition-colors hover:bg-accent/15 disabled:opacity-40"
                >
                  <Icon name="play" size={13} />
                  {t('net.startMesh')}
                </button>
                <button
                  type="button"
                  data-action="stop"
                  disabled={!active}
                  onClick={() => void handleStop()}
                  className="flex h-8 items-center rounded-lg border border-[var(--hairline)] bg-[var(--hover-bg)] px-3 text-[12.5px] text-2 transition-colors hover:text-1 disabled:opacity-40"
                >
                  {t('net.stop')}
                </button>
                <span className="ml-auto text-[12px] text-3">
                  {t('net.virtualIp')}{' '}
                  <span className="tnum text-2">{status.virtualIp ?? t('net.virtualIpPending')}</span>
                </span>
              </div>

              <div className="rounded-xl border border-[var(--hairline)] bg-[var(--hover-bg)] px-4 py-3">
                <div className="flex items-center gap-2">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{
                      backgroundColor:
                        status.phase === 'error'
                          ? '#c2455e'
                          : status.phase === 'connected'
                            ? 'var(--accent)'
                            : 'var(--text-3)'
                    }}
                  />
                  <span className="text-[12.5px] text-1">{phaseText}</span>
                </div>
                <p className="mt-2 text-[12px] leading-relaxed text-3">{t('net.hostTip')}</p>
              </div>

              {error && <p className="text-[12.5px] text-[#c2455e]">{error}</p>}

              <div className="grid grid-cols-3 gap-3 pt-5">
                <Step index={1} title={t('net.mesh1')} desc={t('net.mesh1Desc')} />
                <Step index={2} title={t('net.mesh2')} desc={t('net.mesh2Desc')} />
                <Step index={3} title={t('net.mesh3')} desc={t('net.mesh3Desc')} />
              </div>
              <div className="mt-auto pt-5">
                <div className="mb-2 flex items-baseline gap-2">
                  <span className="text-[10.5px] uppercase tracking-[0.1em] text-3">{t('net.sessionLog')}</span>
                  <span className="text-[10.5px] text-3 opacity-70">{t('net.sessionLogHint')}</span>
                </div>
                <div className="flex flex-col gap-1">
                  {events.length === 0 ? (
                    <span className="text-[11px] text-3">{t('net.sessionLogEmpty')}</span>
                  ) : (
                    events.map((event, index) => (
                      <div
                        key={`${event.time}-${index}`}
                        className="flex items-center gap-2 rounded-md bg-[var(--hover-bg)] px-2.5 py-1.5"
                      >
                        <span className="text-[10.5px] tnum text-3">{event.time}</span>
                        <span className="truncate text-[11.5px] text-2">{event.text}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>
          )}
        </div>
      </section>
    </div>
  )
}
