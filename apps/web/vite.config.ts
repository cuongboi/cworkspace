import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

/** One chunk per npm package (scoped packages keep their scope); react-dom pulls in its scheduler. */
// function vendorChunk(id: string) {
//   const path = id.split(/node_modules[\\/]/).pop() ?? ""
//   const [first, second] = path.split(/[\\/]/)
//   const pkg = first.startsWith("@") ? `${first.slice(1)}-${second}` : first
//   return pkg === "scheduler" ? "vendor-react-dom" : `vendor-${pkg}`
// }

// https://vite.dev/config/
export default defineConfig({
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
  },
})
