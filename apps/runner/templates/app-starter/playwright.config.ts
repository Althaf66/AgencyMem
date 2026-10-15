import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PORT ?? 5180);

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1, // one server and one database per run
  retries: 0,
  timeout: 15_000,
  expect: { timeout: 3_000 },
  reporter: [["list"], ["json", { outputFile: "test-results/report.json" }]],
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: String(port),
      NODE_ENV: "test",
      TZ: "Asia/Kolkata",
      DB_FILE: `data/test-${port}.db`,
    },
  },
});
