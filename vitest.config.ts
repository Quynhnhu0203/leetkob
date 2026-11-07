import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Unit and contract tests must never reach the network (no real model call).
    env: { GEMINI_API_KEY: "" },
  },
});
