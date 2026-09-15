import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/int/**/*.int.spec.ts'],
    // Each int test file that calls getPayload() runs its own dev schema
    // push against samkvetlo_test; running files concurrently races those
    // pushes (duplicate CREATE TABLE). Files still run in one process.
    fileParallelism: false,
  },
})
