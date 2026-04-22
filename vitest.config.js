import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["tests/js/setup.js"],
    include: ["tests/js/**/*.test.js"],
    coverage: {
      provider: "v8",
      include: ["js/**/*.js"],
      reporter: ["text", "lcov"],
    },
  },
});
