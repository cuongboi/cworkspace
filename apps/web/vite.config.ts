import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv, type Plugin } from "vite"
import * as fs from "node:fs"
// relative: the config bundler doesn't follow workspace package exports to .ts sources
import {
  buildManifest,
  HEAD_PLACEHOLDER,
  parseAppConfig,
  renderHead,
} from "../../packages/shared/src/app-config.ts"

/**
 * Dev only: renders APP_NAME / APP_INFO from the root .env into index.html and serves the
 * manifest, like the API does in production. Builds keep the placeholder so the server renders
 * it at runtime (one build, any company).
 */
function appConfigPlugin(mode: string): Plugin {
  const cfg = parseAppConfig(
    loadEnv(mode, resolve(import.meta.dirname, "../.."), "")
  )
  return {
    name: "app-config",
    apply: "serve",
    transformIndexHtml: (html, ctx) =>
      html.replace(
        HEAD_PLACEHOLDER,
        renderHead(cfg, ctx.server?.resolvedUrls?.local[0])
      ),
    configureServer(server) {
      server.middlewares.use("/manifest.webmanifest", (_req, res) => {
        res.setHeader("content-type", "application/manifest+json")
        res.end(JSON.stringify(buildManifest(cfg)))
      })
    },
  }
}

/** One chunk per npm package (scoped packages keep their scope); react-dom pulls in its scheduler. */
// function vendorChunk(id: string) {
//   const path = id.split(/node_modules[\\/]/).pop() ?? ""
//   const [first, second] = path.split(/[\\/]/)
//   const pkg = first.startsWith("@") ? `${first.slice(1)}-${second}` : first
//   return pkg === "scheduler" ? "vendor-react-dom" : `vendor-${pkg}`
// }

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => ({
  plugins: [react(), tailwindcss(), appConfigPlugin(mode)],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  // build: {
  //   // Warn if any chunk still ends up over the 100 kB budget.
  //   chunkSizeWarningLimit: 100,
  //   rolldownOptions: {
  //     output: {
  //       codeSplitting: {
  //         // Split only at package boundaries. Size-based splitting (`maxSize`)
  //         // cuts packages mid-graph into circular chunks and breaks at runtime
  //         // ("x is not a function"), so app code is split by lazy routes instead.
  //         groups: [
  //           {
  //             name: (id) => vendorChunk(id),
  //             test: /node_modules[\\/]/,
  //           },
  //         ],
  //       },
  //     },
  //   },
  // },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:3000",
        ws: true,
      },
      "/openapi": {
        target: "http://localhost:3000",
        changeOrigin: true,
        rewrite: (path) => {
          return path
        },
      },
    },
    ...devHttps(command),
  },
}))

/** Local HTTPS on :443 for `vite dev` only, and only when the dev certs exist; builds and other machines skip it. */
function devHttps(command: "build" | "serve") {
  const key = resolve(
    import.meta.dirname,
    "../../certs/local/localhost-key.pem"
  )
  const cert = resolve(import.meta.dirname, "../../certs/local/localhost.pem")
  if (command !== "serve" || !fs.existsSync(key) || !fs.existsSync(cert))
    return {}
  return {
    host: "0.0.0.0",
    port: 443,
    https: { key: fs.readFileSync(key), cert: fs.readFileSync(cert) },
  }
}
