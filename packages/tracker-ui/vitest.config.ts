import { defineConfig } from 'vitest/config'

// tracker-ui 的测试目前只覆盖纯函数(motionInit 等),不需要 DOM。
// 共享 GraphView 的渲染/交互测试留在各 app 的 __tests__/ 下,
// 用各自的 vite.config.ts + rtl + jsdom。

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts']
  }
})