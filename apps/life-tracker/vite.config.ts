import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Tauri 2 renderer 构建配置
// - root 指向 src/renderer(Vite 在那里找 index.html 入口)
// - dev 端口固定 1421(tauri.conf.json devUrl 对应;book-tracker 用 1420)
// - build 输出到 <project>/dist/(frontendDist ../dist 对应)
// - 不监听 src-tauri/(Rust 改动由 cargo 自己处理)
// - @core 指向 monorepo 共享内核 packages/tracker-core(fs.allow 放开到 repo 根)

export default defineConfig({
  root: 'src/renderer',
  publicDir: false,
  clearScreen: false,
  server: {
    port: 1421,
    strictPort: true,
    host: '127.0.0.1',
    // root 在 src/renderer,但 @core 引用 repo 根的 packages/ → 必须放开 fs.allow
    fs: {
      allow: [resolve(__dirname, '../..')]
    },
    watch: {
      ignored: ['**/src-tauri/**']
    }
  },
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    target: 'es2022',
    minify: 'esbuild',
    sourcemap: false
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer'),
      '@shared': resolve(__dirname, 'src/shared'),
      // @core 指向 index.ts 文件 —— 代码里只 import '@core'(不带子路径)
      '@core': resolve(__dirname, '../../packages/tracker-core/src/index.ts'),
      // @ui 指向 src 目录 —— 组件 import '@ui/Modal' 等,main.tsx 还 import
      // '@ui/base.css' / '@ui/themes/*.css',目录形式让两者都能解析
      '@ui': resolve(__dirname, '../../packages/tracker-ui/src'),
    }
  },
  plugins: [react()],
  envPrefix: ['VITE_', 'TAURI_']
})
