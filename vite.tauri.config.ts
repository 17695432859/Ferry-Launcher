import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

/**
 * Tauri 壳的前端构建：和 electron-vite 的 renderer 部分保持同一份源码与别名，
 * 产物落到 out/tauri（tauri.conf.json 的 frontendDist 指向这里）。
 * 单独目录是为了能每次清空重建——产物会被整个打进 exe，残留文件会白白占体积。
 */
export default defineConfig({
  root: 'src/renderer',
  base: './',
  resolve: {
    // 渲染层必须只有一份 React，否则 Zustand 读到的 dispatcher 为空，页面直接白/黑屏
    dedupe: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      'react-router',
      'react-router-dom',
      '@remix-run/router'
    ],
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  plugins: [react()],
  build: {
    outDir: resolve('out/tauri'),
    emptyOutDir: true,
    target: 'chrome105',
    rollupOptions: { input: { index: resolve('src/renderer/index.html') } }
  }
})
