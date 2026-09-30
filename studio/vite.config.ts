import build from '@hono/vite-build/cloudflare-pages'
import { defineConfig } from 'vite'
// Studio 独立构建：产物在 studio/dist，与玩家端 dist 互不影响
export default defineConfig({
  root: __dirname,
  publicDir: 'public',
  plugins: [build({ entry: 'src/index.tsx', outputDir: 'dist' })],
  build: { outDir: 'dist', emptyOutDir: true }
})
