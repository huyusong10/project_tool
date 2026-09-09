import { spawnSync } from 'node:child_process';

// The test server uses NODE_ENV=test; the browser must use the shipped React build.
const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', '.playwright/dist'], {
  stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
