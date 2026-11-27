import { defineConfig } from 'vitest/config';

// 固定运行时区，让用 `new Date(y, m, d, h)` 构造的本地时间与测试设置里的 Asia/Shanghai 一致，
// 本机和 CI 结果相同；跨时区行为由用例显式传入其他时区覆盖。
process.env.TZ = 'Asia/Shanghai';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx,mjs}'],
    coverage: {
      reporter: ['text', 'json-summary'],
    },
  },
});
