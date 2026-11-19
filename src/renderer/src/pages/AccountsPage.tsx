import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { AccountSummary, DeviceCode } from '@shared/types'
import { useAppStore } from '@renderer/store/app-store'
import { Icon } from '../components/Icon'

type AddKind = 'littleskin' | 'microsoft' | 'offline'

const KIND_LABEL: Record<string, 'accounts.kind.littleskin' | 'accounts.kind.microsoft' | 'accounts.kind.offline'> = {
  littleskin: 'accounts.kind.littleskin',
  microsoft: 'accounts.kind.microsoft',
  offline: 'accounts.kind.offline'
}

/* ==========================================================================
   3D 皮肤预览
   ========================================================================== */

function SkinPreview({ account }: { account: AccountSummary | null }): JSX.Element {
  const t = useAppStore((state) => state.t)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const viewerRef = useRef<{ dispose: () => void } | null>(null)
  const [skin, setSkin] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setSkin(null)
    if (!account?.skinUrl) return () => undefined
    void window.ferry.fetchImage(account.skinUrl).then((data) => {
      if (alive) setSkin(data)
    })
    return () => {
      alive = false
    }
  }, [account?.skinUrl])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !skin) return () => undefined
    let disposed = false
    void (async () => {
      const { SkinViewer, IdleAnimation } = await import('skinview3d')
      if (disposed || !canvasRef.current) return
      const viewer = new SkinViewer({
        canvas: canvasRef.current,
        width: 220,
        height: 300,
        skin,
        model: account?.skinModel === 'slim' ? 'slim' : 'default'
      })
      viewer.animation = new IdleAnimation()
      viewer.autoRotate = true
      viewer.autoRotateSpeed = 0.6
      viewer.zoom = 0.85
      viewerRef.current = viewer
      if (account?.capeUrl) {
        const cape = await window.ferry.fetchImage(account.capeUrl)
        if (cape && !disposed) viewer.loadCape(cape)
      }
    })()
    return () => {
      disposed = true
      viewerRef.current?.dispose()
      viewerRef.current = null
    }
  }, [skin, account?.skinModel, account?.capeUrl])

  return (
    <div className="glass flex min-h-0 flex-col items-center gap-2 rounded-panel p-4">
      <div className="flex w-full items-center justify-between">
        <span className="text-[12.5px] font-medium text-2">{t('accounts.preview')}</span>
        {account && (
          <span className="rounded-md bg-[var(--hover-bg)] px-1.5 py-0.5 text-[11px] text-3">
            {t(`accounts.model.${account.skinModel === 'slim' ? 'slim' : 'classic'}`)}
          </span>
        )}
      </div>
      <div className="relative flex h-[300px] w-full items-center justify-center">
        <canvas ref={canvasRef} className={skin ? 'block' : 'hidden'} />
        {!skin && (
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--hairline)] bg-[var(--hover-bg)]">
              <Icon name="user" size={26} className="text-3" />
            </div>
            <p className="max-w-[180px] text-[12px] leading-relaxed text-3">
              {account ? t('accounts.noSkin') : t('accounts.emptyList')}
            </p>
          </div>
        )}
      </div>
      {account && (
        <div className="w-full truncate text-center text-[12px] text-2">{account.profileName}</div>
      )}
    </div>
  )
}

/* ==========================================================================
   页面
   ========================================================================== */

export function AccountsPage(): JSX.Element {
  const t = useAppStore((state) => state.t)
  const settings = useAppStore((state) => state.settings)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const notify = useAppStore((state) => state.notify)

  const [accounts, setAccounts] = useState<AccountSummary[]>([])
  const [kind, setKind] = useState<AddKind>('littleskin')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [apiRoot, setApiRoot] = useState('https://littleskin.cn/api/yggdrasil')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [offlineName, setOfflineName] = useState('')
  const [device, setDevice] = useState<DeviceCode | null>(null)
  const [switching, setSwitching] = useState<string | null>(null)

  const activeId = settings.lastAccountId
  const active = accounts.find((item) => item.id === activeId) ?? accounts[0] ?? null

  const refresh = useCallback(async (): Promise<void> => {
    setAccounts(await window.ferry.accounts.list())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // 微软设备码轮询
  useEffect(() => {
    if (!device) return () => undefined
    let stopped = false
    const timer = setInterval(async () => {
      const result = await window.ferry.accounts.pollMicrosoft(device.deviceCode)
      if (stopped) return
      if (result.status === 'ok') {
        clearInterval(timer)
        setDevice(null)
        setBusy(false)
        await refresh()
        await updateSettings({ lastAccountId: result.account.id })
        notify('success', result.account.profileName)
      } else if (result.status === 'error') {
        clearInterval(timer)
        setDevice(null)
        setBusy(false)
        setError(result.message)
      }
    }, Math.max(5, device.interval) * 1000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [device, notify, refresh, updateSettings])

  const handleLogin = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const account = await window.ferry.accounts.loginLittleSkin(apiRoot, username, password)
      await refresh()
      await updateSettings({ lastAccountId: account.id })
      setPassword('')
      notify('success', account.profileName)
    } catch (caught) {
      setError(String(caught))
    } finally {
      setBusy(false)
    }
  }

  const handleOffline = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const account = await window.ferry.accounts.addOffline(offlineName)
      await refresh()
      await updateSettings({ lastAccountId: account.id })
      setOfflineName('')
    } catch (caught) {
      setError(String(caught))
    } finally {
      setBusy(false)
    }
  }

  const handleMicrosoft = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setDevice(await window.ferry.accounts.startMicrosoft())
    } catch (caught) {
      setError(String(caught))
      setBusy(false)
    }
  }

  const handleSwitchProfile = async (account: AccountSummary, profileId: string): Promise<void> => {
    if (profileId === account.uuid) return
    setSwitching(profileId)
    try {
      const updated = await window.ferry.accounts.selectProfile(account.id, profileId)
      setAccounts((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
      notify('success', t('accounts.profileSwitched', { name: updated.profileName }))
    } catch (caught) {
      const message = String(caught)
      // 令牌绑死角色时后端会返回 PROFILE_LOCKED（没有存密码没法自动重登）
      if (message.includes('PROFILE_LOCKED') || message.includes('already has a profile')) {
        notify('error', t('accounts.profileLocked'))
      } else {
        notify('error', message)
      }
    } finally {
      setSwitching(null)
    }
  }

  const handleRemove = async (account: AccountSummary): Promise<void> => {
    const next = await window.ferry.accounts.remove(account.id)
    setAccounts(next)
    if (activeId === account.id) {
      await updateSettings({ lastAccountId: next[0]?.id ?? null })
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
      <header className="mx-auto max-w-[980px] px-1 pb-3">
        <h1 className="text-[19px] font-semibold tracking-tight text-1">{t('accounts.title')}</h1>
        <p className="mt-0.5 text-[12.5px] text-2">{t('accounts.subtitle')}</p>
      </header>

      <div className="mx-auto grid max-w-[980px] grid-cols-[minmax(0,1fr)_260px] items-start gap-3">
        <div className="flex min-w-0 flex-col gap-3">
          {/* 账户列表 */}
          <div className="glass shrink-0 rounded-panel p-2">
            {accounts.length === 0 ? (
              <p className="px-2 py-6 text-center text-[12.5px] text-3">{t('accounts.emptyList')}</p>
            ) : (
              <div className="flex flex-col gap-1">
                {accounts.map((account) => {
                  const isActive = account.id === active?.id
                  return (
                    <div
                      key={account.id}
                      className={`flex shrink-0 flex-col gap-2 rounded-lg border px-2.5 py-2 transition-colors ${
                        isActive
                          ? 'border-accent/40 bg-accent/8'
                          : 'border-transparent hover:bg-[var(--hover-bg)]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--active-bg)] text-[12px] font-semibold text-2">
                        {account.profileName.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[13px] font-medium text-1">
                            {account.profileName}
                          </span>
                          {isActive && (
                            <span className="shrink-0 rounded bg-accent/15 px-1 py-px text-[10.5px] accent-text">
                              {t('accounts.active')}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 truncate text-[11.5px] text-3">
                          {t(KIND_LABEL[account.kind])}
                          {account.apiRoot ? ` · ${new URL(account.apiRoot).host}` : ''}
                          {account.profiles.length > 1 ? ` · ${account.profiles.length} ${t('accounts.profile')}` : ''}
                        </div>
                      </div>
                      {!isActive && (
                        <button
                          type="button"
                          onClick={() => void updateSettings({ lastAccountId: account.id })}
                          className="shrink-0 rounded-md px-2 py-1 text-[11.5px] text-3 transition-colors hover:bg-[var(--active-bg)] hover:text-1"
                        >
                          {t('accounts.setActive')}
                        </button>
                      )}
                      <button
                        type="button"
                        title={t('accounts.remove')}
                        onClick={() => void handleRemove(account)}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-3 transition-colors hover:bg-[var(--active-bg)] hover:text-1"
                      >
                        <Icon name="trash" size={13} />
                      </button>
                      </div>
                      {account.profiles.length > 1 && (
                        <div className="flex shrink-0 flex-wrap items-center gap-1 border-t border-[var(--hairline)] pt-2">
                          <span className="mr-1 text-[11px] text-3">{t('accounts.profile')}</span>
                          {account.profiles.map((profile) => {
                            const current = profile.id === account.uuid
                            return (
                              <button
                                key={profile.id}
                                type="button"
                                disabled={switching !== null}
                                onClick={() => void handleSwitchProfile(account, profile.id)}
                                className={`rounded-md border px-2 py-0.5 text-[11.5px] transition-colors disabled:opacity-50 ${
                                  current
                                    ? 'border-accent/45 bg-accent/12 accent-text'
                                    : 'border-[var(--hairline)] text-3 hover:text-1'
                                }`}
                              >
                                {profile.name}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* 添加账户 */}
          <div className="glass shrink-0 rounded-panel p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[13px] font-medium text-1">{t('accounts.add')}</span>
              <div className="ml-auto flex items-center gap-1 rounded-lg bg-[var(--active-bg)] p-0.5">
                {(['littleskin', 'microsoft', 'offline'] as AddKind[]).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      setKind(item)
                      setError(null)
                      setDevice(null)
                    }}
                    className={`relative rounded-[6px] px-2.5 py-1 text-[12px] transition-colors ${
                      kind === item ? 'text-1' : 'text-3 hover:text-2'
                    }`}
                  >
                    {kind === item && (
                      <motion.span
                        layoutId="account-kind"
                        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                        className="absolute inset-0 rounded-[6px] bg-[var(--panel)] shadow-sm"
                      />
                    )}
                    <span className="relative">{t(KIND_LABEL[item])}</span>
                  </button>
                ))}
              </div>
            </div>

            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={kind}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className="flex flex-col gap-2"
              >
                {kind === 'littleskin' && (
                  <>
                    <Field label={t('accounts.apiRoot')}>
                      <input
                        value={apiRoot}
                        onChange={(event) => setApiRoot(event.target.value)}
                        spellCheck={false}
                        className="input"
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label={t('accounts.username')}>
                        <input
                          value={username}
                          onChange={(event) => setUsername(event.target.value)}
                          spellCheck={false}
                          className="input"
                        />
                      </Field>
                      <Field label={t('accounts.password')}>
                        <input
                          type="password"
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && username && password) void handleLogin()
                          }}
                          className="input"
                        />
                      </Field>
                    </div>
                    <button
                      type="button"
                      disabled={busy || !username || !password}
                      onClick={() => void handleLogin()}
                      className="mt-1 h-9 self-start rounded-lg bg-accent px-5 text-[13px] font-medium text-[var(--accent-ink)] disabled:opacity-45"
                    >
                      {busy ? `${t('accounts.loggingIn')}…` : t('accounts.login')}
                    </button>
                  </>
                )}

                {kind === 'microsoft' && (
                  <>
                    <p className="text-[12px] leading-relaxed text-3">{t('accounts.msHint')}</p>
                    {device ? (
                      <div className="flex items-center gap-3 rounded-lg border border-[var(--hairline)] bg-[var(--hover-bg)] p-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-[11.5px] text-3">{t('accounts.msCode')}</div>
                          <div className="mt-1 font-mono text-[22px] font-semibold tracking-[0.18em] text-1">
                            {device.userCode}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col gap-1.5">
                          <button
                            type="button"
                            onClick={() => void window.ferry.openUrl(device.verificationUri)}
                            className="h-8 rounded-lg bg-accent px-3 text-[12px] font-medium text-[var(--accent-ink)]"
                          >
                            {t('accounts.msOpen')}
                          </button>
                          <span className="text-center text-[11px] text-3">
                            {t('accounts.msWaiting')}…
                          </span>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleMicrosoft()}
                        className="h-9 rounded-lg bg-accent text-[13px] font-medium text-[var(--accent-ink)] disabled:opacity-45"
                      >
                        {busy ? `${t('accounts.loggingIn')}…` : t('accounts.msStart')}
                      </button>
                    )}
                  </>
                )}

                {kind === 'offline' && (
                  <>
                    <Field label={t('accounts.offlineName')}>
                      <input
                        value={offlineName}
                        maxLength={16}
                        onChange={(event) => setOfflineName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && offlineName) void handleOffline()
                        }}
                        spellCheck={false}
                        className="input"
                      />
                    </Field>
                    <p className="text-[11.5px] leading-relaxed text-3">{t('accounts.offlineHint')}</p>
                    <button
                      type="button"
                      disabled={busy || !offlineName.trim()}
                      onClick={() => void handleOffline()}
                      className="mt-1 h-9 self-start rounded-lg bg-accent px-5 text-[13px] font-medium text-[var(--accent-ink)] disabled:opacity-45"
                    >
                      {t('accounts.add')}
                    </button>
                  </>
                )}
              </motion.div>
            </AnimatePresence>

            {error && (
              <p className="mt-2 break-all rounded-lg bg-[#c2455e]/12 px-2.5 py-2 text-[11.5px] leading-relaxed text-[#c2455e]">
                {t('accounts.loginFailed', { message: error })}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <SkinPreview account={active} />
        </div>
      </div>

    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11.5px] text-3">{label}</span>
      {children}
    </label>
  )
}
