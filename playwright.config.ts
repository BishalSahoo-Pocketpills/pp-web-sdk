import 'dotenv/config';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3456',
    headless: true,
  },
  webServer: {
    command: 'npx serve dist -l 3456 --no-clipboard',
    port: 3456,
    reuseExistingServer: !process.env.CI,
  },
});
