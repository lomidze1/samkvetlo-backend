import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

// Plain unit tests (pure functions, no DB, no jsdom) — kept separate from
// vitest.config.mts's tests/int/**, which needs a Postgres test DB and
// pushes schema on every getPayload() call (see that file's comment).
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
})
