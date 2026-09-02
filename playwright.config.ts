import { defineConfig } from "@playwright/test";

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
    baseURL: "http://127.0.0.1:3210",
    channel: "msedge",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run build && npm start",
    url: "http://127.0.0.1:3210/health",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: viewports.map(({ name, width, height, deviceScaleFactor }) => ({
    name,
    use: {
      viewport: { width, height },
      deviceScaleFactor,
    },
  })),
});
