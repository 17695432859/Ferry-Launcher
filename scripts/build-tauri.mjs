/**
 * Tauri 壳的构建入口。
 *
 *   node scripts/build-tauri.mjs        生产构建 -> dist/FerryLauncher-0.1.4.exe
 *   node scripts/build-tauri.mjs --dev  开发模式（vite dev server + tauri dev）
 *
 * 工具链固定在 rust-toolchain.toml（MSVC）。这里不需要手动准备 vcvars：
 * rustc 自己会通过 vswhere 找到 MSVC 的 link.exe。之前试过注入 vcvars64 导出的
 * 环境变量，反而让构建脚本去调 reg.exe（被沙箱黑名单拦掉），所以别那么干。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, copyFileSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dev = process.argv.includes('--dev')

const env = {
  ...process.env,
  PATH: `${join(homedir(), '.cargo', 'bin')};${process.env.PATH}`
}

const run = (args) =>
  new Promise((ok, fail) => {
    const child = spawn('npx', args, { cwd: root, env, stdio: 'inherit', shell: true })
    child.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`退出码 ${code}`))))
  })

try {
  if (dev) {
    await run(['tauri', 'dev'])
  } else {
    console.log('\n> 构建前端')
    await run(['vite', 'build', '-c', 'vite.tauri.config.ts'])
    console.log('\n> 编译 Rust')
    await run(['tauri', 'build', '--no-bundle'])

    const exe = join(root, 'src-tauri', 'target', 'release', 'ferry-launcher.exe')
    if (!existsSync(exe)) throw new Error('没有产出 exe')
    mkdirSync(join(root, 'dist'), { recursive: true })
    const out = join(root, 'dist', 'FerryLauncher-0.1.4.exe')
    // 先删旧文件，避免 Explorer 复用同一路径的图标缓存。
    rmSync(out, { force: true })
    copyFileSync(exe, out)

    // 通知 Shell 资源已变更；不重启 explorer.exe，不打扰正在开的窗口。
    if (process.platform === 'win32') {
      const refreshed = spawnSync(
        'python',
        ['-c', 'import ctypes; ctypes.windll.shell32.SHChangeNotify(0x08000000, 0, None, None)'],
        { cwd: root, stdio: 'ignore' }
      )
      if (refreshed.status !== 0) console.log('（图标缓存刷新跳过：没有可用的 Python）')
    }

    console.log(`\n完成: ${out}  ${(statSync(out).size / 1048576).toFixed(2)} MB`)
  }
} catch (error) {
  console.error(`\n失败: ${error.message}`)
  process.exit(1)
}
