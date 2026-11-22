import { useAppStore } from '@renderer/store/app-store'
import forestBg from '@renderer/assets/forest-bg.jpg'

/**
 * PCL 风格的启动页：主区域整块是 Minecraft 风景图，账户与启动控制在左侧面板。
 * 背景铺满可用区域，用户自定义背景优先级更高。
 */
export function HomePage(): JSX.Element {
  const instances = useAppStore((state) => state.instances)
  const selectedId = useAppStore((state) => state.selectedId)
  const backgroundImage = useAppStore((state) => state.backgroundImage)
  const backgroundMode = useAppStore((state) => state.settings.backgroundMode)

  const selected = instances.find((item) => item.id === selectedId) ?? instances[0] ?? null
  const bgUrl = backgroundMode === 'custom' && backgroundImage ? backgroundImage : forestBg

  return (
    <main className="relative min-h-0 flex-1 overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url("${bgUrl}")` }}
        aria-hidden="true"
      />
      {selected && (
        <div className="pointer-events-none absolute bottom-5 right-6 rounded-lg bg-black/35 px-3 py-1.5 text-[11.5px] text-white/90 backdrop-blur-sm">
          Minecraft {selected.mcVersion} · {selected.name}
        </div>
      )}
    </main>
  )
}
