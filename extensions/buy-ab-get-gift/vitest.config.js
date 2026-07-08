import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    forceRerunTriggers: ["**/tests/fixtures/**", "**/src/**"],
  },
});
