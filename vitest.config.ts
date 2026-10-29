import { defineConfig } from "vitest/config";
// Default suite = mocked/unit only. Live Qloo tests run with `npm run test:live` (needs QLOO_API_KEY).
export default defineConfig({ test: { include: ["tests/**/*.test.ts"], exclude: ["tests/live/**", "node_modules/**", "dist/**"] } });
