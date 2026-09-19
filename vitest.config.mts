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
    // Vitest's defaults (5s test / 10s hook) are sized for pure unit tests.
    // These files run a full runSeed() against a real Postgres, which fits
    // in the default budget locally but not on a CI runner: the same suite
    // takes 84s here and 282s on ubuntu-latest (~3.4x), and that pushed
    // secrecy's beforeAll past 10s. When that hook aborts mid-way its
    // afterAll cleanup is incomplete, so the rows it seeded leak into the
    // shared database and the next file to create a page then fails on a
    // duplicate slug — one timeout took four files down with it.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
})
