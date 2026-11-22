import { useAppStore } from '@renderer/store/app-store'

/**
 * 白底启动页：主区域整块留白，实例信息以浅色卡片呈现，账户与启动控制在左侧面板。
 * 用户在设置里选了自定义背景时，由 App 层统一铺在窗口底层。
 */
export function HomePage(): JSX.Element {
  const instances = useAppStore((state) => state.instances)
  const selectedId = useAppStore((state) => state.selectedId)

  const selected = instances.find((item) => item.id === selectedId) ?? instances[0] ?? null

  return (
    <main className="relative min-h-0 flex-1">
      {selected && (
        <div className="absolute bottom-6 right-7 rounded-xl border border-[var(--hairline)] bg-[var(--bg-1)] px-4 py-2 text-[12px] text-[var(--text-2)] shadow-sm">
          Minecraft {selected.mcVersion} ·{' '}
          <span className="font-medium text-[var(--text-1)]">{selected.name}</span>
        </div>
      )}
    </main>
  )
}
