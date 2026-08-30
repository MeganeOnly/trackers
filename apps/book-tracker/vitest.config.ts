import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// 单独的 vitest 配置:vite.config.ts 的 root 指向 src/renderer(renderer 构建专用),
// vitest 默认会读 vite.config.ts 的 root → 把测试扫描根也限制到 src/renderer/。
// book-tracker 的纯函数已全部抽到 monorepo 共享内核 packages/tracker-core,
// 这里显式指向 core 的测试目录,让 `npm test` 仍然验证共享逻辑。
//
// 别名用数组形式(Vite 5 推荐):对象形式对 `@` 开头的 find 在 vitest 4 下解析
// 不稳,会报 "Cannot find package '@core'" —— 用数组 find/replacement 走同一个
// resolver,不绕 npm scope 判定。alias 与 vite.config.ts 保持一致。
export default defineConfig({
  test: {
    include: ['../../packages/tracker-core/src/__tests__/**/*.test.ts']
  },
  resolve: {
    alias: [
      { find: '@', replacement: resolve(__dirname, 'src/renderer') },
      { find: '@shared', replacement: resolve(__dirname, 'src/shared') },
      // @core 指向 index.ts 文件 —— 测试里只 import '@core'
      { find: '@core', replacement: resolve(__dirname, '../../packages/tracker-core/src/index.ts') },
      // @ui 指向 src 目录 —— 测试里 import '@ui/Modal' / '@ui/useTheme'
      // (vitest 跑测试时 import 的都是 .ts/.tsx,没有 .css;但保持与 vite 一致)
      { find: '@ui', replacement: resolve(__dirname, '../../packages/tracker-ui/src') }
    ]
  }
})
