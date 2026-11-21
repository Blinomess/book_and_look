import { defineConfig } from "vite";
export default defineConfig({
  root: "web",
  build: { outDir: "../web-dist", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/graphql": "http://127.0.0.1:3000" },
  },
});
