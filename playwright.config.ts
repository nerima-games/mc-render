import { defineConfig, type PlaywrightTestConfig } from '@playwright/test'
import { env } from 'node:process'

const WEB_SERVER_PORT = 5182

const config: PlaywrightTestConfig = defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  workers: 1,
  reporter: 'list',
  use: {
    browserName: 'chromium',
    headless: true,
    launchOptions: {
      args: [
        '--enable-webgl',
        '--ignore-gpu-blocklist',
        '--use-gl=angle',
        '--use-angle=swiftshader-webgl',
      ],
    },
  },
  webServer: {
    command: 'corepack pnpm dev:web --host 127.0.0.1',
    url: `http://127.0.0.1:${String(WEB_SERVER_PORT)}/apps/shader-probe/`,
    reuseExistingServer: !env['CI'],
    timeout: 60_000,
  },
})

export default config
