import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const repoRoot = fileURLToPath(new URL('.', import.meta.url))

/**
 * The API the dev server proxies to: `pnpm dev:api:next` (Next route handlers) or the Rust server, both on
 * :3000 by default. Override with `env API_URL=http://127.0.0.1:4000 pnpm dev:web`.
 */
const apiTarget = process.env.API_URL ?? 'http://127.0.0.1:3000'

/**
 * Writes dist/.vite/chunk-modules.json: every emitted JS chunk with the source modules bundled into it
 * (repo-relative). `pnpm check:bundle` (scripts/check-client-bundle.mjs) reads it with the manifest to
 * prove the home and rules routes load no engine, Phaser or WASM.
 */
function chunkModules(): Plugin {
  return {
    name: 'autoduck:chunk-modules',
    apply: 'build',
    generateBundle(_options, bundle) {
      const chunks: Record<string, string[]> = {}
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue
        chunks[output.fileName] = Object.keys(output.modules)
          .map((id) => id.replace(/\0/g, '').replace(repoRoot, ''))
          .sort()
      }
      this.emitFile({ type: 'asset', fileName: '.vite/chunk-modules.json', source: `${JSON.stringify(chunks, null, 2)}\n` })
    },
  }
}

/**
 * Preloads the Latin and Vietnamese files of the two main families (Nunito body text, Baloo 2 display), as
 * next/font did, so the text doesn't wait for the CSS to parse before the fonts start downloading.
 */
function preloadFonts(): Plugin {
  const wanted = /(?:^|\/)(?:baloo-2|nunito)-(?:latin|vietnamese)-wght-normal-[^/]+\.woff2$/
  return {
    name: 'autoduck:preload-fonts',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, context) {
        return Object.values(context.bundle ?? {})
          .filter((output) => output.type === 'asset' && wanted.test(output.fileName))
          .map((output) => output.fileName)
          .sort()
          .map((fileName) => ({
            tag: 'link',
            attrs: { rel: 'preload', as: 'font', type: 'font/woff2', href: `/${fileName}`, crossorigin: '' },
            injectTo: 'head' as const,
          }))
      },
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), chunkModules(), preloadFonts()],
  resolve: {
    // Same alias as tsconfig.json: `@/x` is `<repo root>/x` (components/, lib/, src/ and packages/ stay put, D18).
    alias: [{ find: /^@\//, replacement: repoRoot }],
  },
  server: {
    // Vite binds `localhost` only (on macOS that is [::1]): open http://localhost:5173, which is also the
    // origin the Google OAuth client must allow. `pnpm dev:web --host 127.0.0.1` binds IPv4 instead.
    port: 5173,
    strictPort: true,
    // Build output of Next, Cargo and Vite itself would otherwise trigger reloads (and cost watchers).
    watch: { ignored: ['**/.next/**', '**/target/**', '**/dist/**', '**/artifacts/**'] },
    proxy: {
      '/api': {
        target: apiTarget,
        configure(proxy) {
          proxy.on('proxyReq', (proxyReq, req) => {
            // Live races are SSE (EventSource sends `Accept: text/event-stream`). Ask for an uncompressed
            // stream so no compression layer holds frames back until a buffer fills.
            if (req.headers.accept?.includes('text/event-stream')) proxyReq.setHeader('accept-encoding', 'identity')
          })
        },
      },
    },
  },
  // The engine worker (src/engine/sim-worker.ts) is an ES module: the WASM glue it imports uses import.meta.
  worker: { format: 'es' },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // dist/.vite/manifest.json (+ chunk-modules.json above): lets CI check which chunks each route pulls in
    // (home and rules never load Phaser or an engine).
    manifest: true,
    // Phaser alone is ~1.2 MB minified; it is lazy-loaded with the race canvas.
    chunkSizeWarningLimit: 1600,
  },
})
