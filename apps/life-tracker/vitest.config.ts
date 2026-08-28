import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// 单独的 vitest 配置:vite.config.ts 的 root 指向 src/renderer(renderer 构建专用),
// vitest 默认会读 vite.config.ts 的 root → 把测试扫描根也限制到 src/renderer/。
// book-tracker 的纯函数已全部抽到 monorepo 共享内核 packages/tracker-core,
// 这里显式指向 core 的测试目录,让 `npm test` 仍然验证共享逻辑。
// 别名与 vite.config.ts 一致,保证 import 路径在两套构建下都解析正确。
export default defineConfig({
  test: {
    // React 组件集成测试需要 DOM；纯逻辑/共享测试保持默认 node 环境
    environment: 'jsdom',
    include: [
      '../../packages/tracker-core/src/__tests__/**/*.test.ts',
      'src/shared/**/*.test.ts',
      'src/shared/**/*.test.tsx'
    ]
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@core': resolve(__dirname, '../../packages/tracker-core/src/index.ts')
    }
  }
})
