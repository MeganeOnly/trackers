import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// 单独的 vitest 配置:vite.config.ts 的 root 指向 src/renderer(renderer 构建专用),
// vitest 默认会读 vite.config.ts 的 root → 把测试扫描根也限制到 src/renderer/,
// 找不到 src/shared/__tests__/ 下的测试。这里显式指定 test.include。
// 别名与 vite.config.ts 一致,保证 import 路径在两套构建下都解析正确。
export default defineConfig({
  test: {
    include: ['src/shared/__tests__/**/*.test.ts']
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  }
})
