import { defineConfig } from "vitest/config";

export default defineConfig({
  define: { __SINGLE_FILE__: "false" },
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    environment: "node",
  },
});
