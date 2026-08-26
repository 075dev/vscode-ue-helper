import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    exclude: ['test/integration/**', 'node_modules/**'],
    globals: false,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/extension.ts', 'src/**/*.d.ts'],
      thresholds: {
        // 覆盖率阈值按 FIX-PLAN 阶梯校准(Phase 4 测试补强后逐阶段上调至 80)
        lines: 75,
        functions: 70,
        branches: 70,
        statements: 75,
      },
    },
    setupFiles: ['test/unit/setup.ts'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@core': resolve(__dirname, 'src/core'),
      '@detection': resolve(__dirname, 'src/detection'),
      '@build': resolve(__dirname, 'src/build'),
      '@clangd': resolve(__dirname, 'src/clangd'),
      '@i18n': resolve(__dirname, 'src/i18n'),
      '@commands': resolve(__dirname, 'src/commands'),
      '@ui': resolve(__dirname, 'src/ui'),
      '@mcp': resolve(__dirname, 'src/mcp'),
    },
  },
});
