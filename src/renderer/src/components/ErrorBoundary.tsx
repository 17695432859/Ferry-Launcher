import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * 渲染层最后一道防线。
 *
 * React 组件树里任何一次 render 抛错，默认会把整棵树卸载掉、留下白屏，
 * 用户看到的就是「应用崩溃了」。这里接住错误，给出可操作的重载按钮，
 * 并把堆栈留在 console 里方便排查。
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[Ferry] UI crashed', error, info.componentStack)
  }

  private reload = (): void => {
    this.setState({ error: null })
    window.location.hash = '#/'
    window.location.reload()
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="text-[15px] font-semibold text-1">界面出了点问题</div>
        <p className="max-w-[420px] break-all text-[12px] leading-relaxed text-3">
          {this.state.error.message || '未知错误'}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="h-8 rounded-lg border border-[var(--hairline)] px-3 text-[12.5px] text-2 hover:text-1"
          >
            返回
          </button>
          <button
            type="button"
            onClick={this.reload}
            className="h-8 rounded-lg bg-accent px-3 text-[12.5px] font-medium text-[var(--accent-ink)]"
          >
            重新加载
          </button>
        </div>
      </div>
    )
  }
}
