import { AnimatePresence, motion } from 'framer-motion'
import type { CrashReport } from '@shared/types'
import type { TranslationKey } from '@shared/i18n'
import { useAppStore } from '@renderer/store/app-store'
import { Icon } from './Icon'

const SEVERITY_KEY: Record<string, TranslationKey> = {
  high: 'crash.high',
  medium: 'crash.medium',
  low: 'crash.low'
}

interface Props {
  report: CrashReport | null
  analyzing: boolean
  open: boolean
  onClose: () => void
  /** 侧栏底部的大启动按钮上，下面没有空间，面板改为向上展开 */
  block?: boolean
}

export function CrashPanel({ report, analyzing, open, onClose, block = false }: Props): JSX.Element {
  const t = useAppStore((state) => state.t)

  return (
    <AnimatePresence>
      {open && (report || analyzing) && (
        <motion.div
          initial={{ opacity: 0, y: -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.98 }}
          transition={{ duration: 0.15 }}
          className={`glass-strong absolute z-40 flex flex-col overflow-hidden rounded-xl border border-[var(--hairline)] shadow-xl ${
            block
              ? 'bottom-full left-0 mb-2 max-h-[min(440px,calc(100vh-220px))] w-[440px] max-w-[calc(100vw-28px)]'
              : 'right-0 top-11 max-h-[440px] w-[500px]'
          }`}
        >
          <div className="flex items-center gap-2 border-b border-[var(--hairline)] px-3 py-2">
            <Icon name="alert" size={13} className={report?.crashed ? 'text-[#c2455e]' : 'text-3'} />
            <span className="text-[12px] font-medium text-1">{t('crash.title')}</span>
            <button
              type="button"
              onClick={onClose}
              className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-3 hover:bg-[var(--active-bg)] hover:text-1"
            >
              <Icon name="close" size={12} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
            {analyzing ? (
              <p className="py-6 text-center text-[12px] text-3">{t('crash.analyzing')}</p>
            ) : !report ? (
              <p className="py-6 text-center text-[12px] text-3">{t('crash.noReports')}</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                <p className="text-[12px] leading-relaxed text-1">{report.summary}</p>
                {report.sources.length > 0 && (
                  <p className="text-[10.5px] text-3">
                    {t('crash.sources', { files: report.sources.join('、') })}
                  </p>
                )}

                {report.causes.map((cause) => (
                  <div
                    key={cause.id}
                    className="rounded-lg border border-[var(--hairline)] bg-[var(--hover-bg)] px-2.5 py-2"
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`rounded px-1 py-px text-[9.5px] ${
                          cause.severity === 'high'
                            ? 'bg-[#c2455e]/15 text-[#c2455e]'
                            : cause.severity === 'medium'
                              ? 'bg-[#e8873c]/15 text-[#e8873c]'
                              : 'bg-[var(--active-bg)] text-3'
                        }`}
                      >
                        {t(SEVERITY_KEY[cause.severity] ?? 'crash.low')}
                      </span>
                      <span className="text-[12px] font-medium text-1">{cause.title}</span>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-2">{cause.detail}</p>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-1">
                      <span className="text-3">{t('crash.fix')}：</span>
                      {cause.fix}
                    </p>
                    {cause.evidence && (
                      <pre className="mt-1.5 overflow-x-auto rounded bg-[var(--active-bg)] px-2 py-1.5 font-mono text-[10px] leading-relaxed text-3">
                        {cause.evidence}
                      </pre>
                    )}
                  </div>
                ))}

                {report.tail.length > 0 && (
                  <details className="rounded-lg border border-[var(--hairline)] px-2.5 py-2">
                    <summary className="cursor-pointer text-[11px] text-2">{t('crash.raw')}</summary>
                    <pre className="mt-2 max-h-[140px] overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed text-3">
                      {report.tail.join('\n')}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
