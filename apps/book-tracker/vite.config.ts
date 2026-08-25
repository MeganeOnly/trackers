import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Tauri 2 renderer 构建配置
// - root 指向 src/renderer(Vite 在那里找 index.html 入口)
// - dev 端口固定 1420(tauri.conf.json devUrl 对应)
// - build 输出到 <project>/dist/(frontendDist ../dist 对应)
// - 不监听 src-tauri/(Rust 改动由 cargo 自己处理)

export default defineConfig({
  root: 'src/renderer',
  publicDir: false,
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: '127.0.0.1',
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
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  plugins: [react()],
  envPrefix: ['VITE_', 'TAURI_']
})
