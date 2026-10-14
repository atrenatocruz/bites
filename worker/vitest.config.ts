import { defineConfig } from "vitest/config";

// An unrelated CJS postcss.config.js in the home directory crashes vite; an empty inline config skips discovery.
export default defineConfig({ css: { postcss: {} } });
