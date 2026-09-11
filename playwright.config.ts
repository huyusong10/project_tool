import { defineConfig } from "@playwright/test";
import os from "node:os";
import path from "node:path";

const testPort = Number(process.env.PLAYWRIGHT_PORT || 3211);
const testRunId = String(process.pid);

const viewports = [
  { name: "office-1280", width: 1280, height: 800, deviceScaleFactor: 1 },
  { name: "laptop-1366", width: 1366, height: 768, deviceScaleFactor: 1 },
  { name: "hidpi-3k-200", width: 1536, height: 960, deviceScaleFactor: 2 },
  { name: "desktop-1080p", width: 1920, height: 1080, deviceScaleFactor: 1 },
  { name: "laptop-16-10-150", width: 1707, height: 1067, deviceScaleFactor: 1.5 },
  { name: "desktop-qhd", width: 2560, height: 1440, deviceScaleFactor: 1 },
];

export default defineConfig({
  testDir: "./tests/responsive",
  testMatch: "**/*.pw.ts",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${testPort}`,
    channel: "msedge",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run build:test-ui && node scripts/run-server.mjs .playwright/server/index.js",
    url: `http://127.0.0.1:${testPort}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      PORT: String(testPort),
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      WEB_DIST_DIR: path.join(process.cwd(), ".playwright", "dist"),
      SESSION_COOKIE_NAME: `pm_playwright_${testRunId}`,
      SEED_DEMO: "0",
      DB_PATH: path.join(os.tmpdir(), `project-manage-playwright-${testRunId}.db`),
      BACKUP_DIR: path.join(os.tmpdir(), `project-manage-playwright-backups-${testRunId}`),
      APP_PASSWORD_HASH: "scrypt$4c63a6f93ff4f94b031b7e7583592177$b598dbddaf9dd06678ff8756923d9e0a7f2d68eaa45bc644fbf4a73c9298970c7489671dfcfc8be282022c26a3370fb040f3f086a45faa1e1abde04bbe4a51ef",
      ADMIN_PASSWORD: "",
      SESSION_SECRET: "playwright-session-secret-with-more-than-thirty-two-characters",
    },
  },
  projects: viewports.map(({ name, width, height, deviceScaleFactor }) => ({
    name,
    use: {
      viewport: { width, height },
      deviceScaleFactor,
    },
  })),
});
