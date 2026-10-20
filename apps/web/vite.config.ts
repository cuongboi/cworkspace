import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import * as fs from "node:fs"

/** One chunk per npm package (scoped packages keep their scope); react-dom pulls in its scheduler. */
// function vendorChunk(id: string) {
//   const path = id.split(/node_modules[\\/]/).pop() ?? ""
//   const [first, second] = path.split(/[\\/]/)
//   const pkg = first.startsWith("@") ? `${first.slice(1)}-${second}` : first
//   return pkg === "scheduler" ? "vendor-react-dom" : `vendor-${pkg}`
// }

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
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
  const key = resolve(import.meta.dirname, "../../certs/local/localhost-key.pem")
  const cert = resolve(import.meta.dirname, "../../certs/local/localhost.pem")
  if (command !== "serve" || !fs.existsSync(key) || !fs.existsSync(cert)) return {}
  return {
    host: "0.0.0.0",
    port: 443,
    https: { key: fs.readFileSync(key), cert: fs.readFileSync(cert) },
  }
}
