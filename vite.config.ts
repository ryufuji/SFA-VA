import build from '@hono/vite-build/cloudflare-pages'
import devServer from '@hono/vite-dev-server'
import adapter from '@hono/vite-dev-server/cloudflare'
import { defineConfig } from 'vite'
import { copyFileSync } from 'fs'

export default defineConfig({
  plugins: [
    build(),
    devServer({
      adapter,
      entry: 'src/index.tsx'
    }),
    {
      name: 'copy-wrangler-toml',
      closeBundle() {
        try {
          copyFileSync('wrangler.toml', 'dist/wrangler.toml')
          console.log('✓ Copied wrangler.toml to dist/')
        } catch (e) {
          console.warn('Could not copy wrangler.toml:', e)
        }
      }
    }
  ]
})
