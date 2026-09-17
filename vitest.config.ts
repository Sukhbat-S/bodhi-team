import { defineConfig } from "vitest/config";
export default defineConfig({test:{include:["packages/**/src/**/*.test.ts","apps/**/src/**/*.test.ts","scripts/distribution.test.ts","scripts/harness-session-lifecycle.test.ts"]}});
