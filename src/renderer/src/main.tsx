import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
// 中文用系统字体（微软雅黑 / 苹方），自带的思源黑体有 588 个子集文件、17MB，
// 打进 exe 太重，收益也远不如拉丁字母明显。
import './styles/index.css'
import { Root } from './App'
import { createTauriFerry, isTauri } from './lib/ferry-tauri'

// Electron 壳由 preload 注入 window.ferry；Tauri 壳在这里补上同名接口，
// 渲染层不需要知道底下是哪个运行时。
if (isTauri() && typeof window.ferry === 'undefined') {
  window.ferry = createTauriFerry()
}

const container = document.getElementById('root')
if (!container) throw new Error('root container missing')

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>
)
