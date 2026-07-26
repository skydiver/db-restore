import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    // Several tests drive the real command layer, whose logger and spinners
    // write to the terminal. Their output is kept for failing tests, where
    // it is diagnostic, and dropped for passing ones, where it is noise.
    silent: 'passed-only',
  },
});
