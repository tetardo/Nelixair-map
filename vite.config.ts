import { cpSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

const root = resolve(__dirname, "web");
const outDir = resolve(__dirname, "dist");

// Les données (web/data, produites par scripts/build.sh) ne passent pas par Vite :
// servies telles quelles en développement, copiées dans dist/ au build.
export default defineConfig({
  root,
  base: "./",
  publicDir: resolve(root, "public"),
  plugins: [
    vue(),
    {
      name: "copy-data",
      apply: "build",
      closeBundle() {
        const data = resolve(root, "data");
        if (existsSync(data)) cpSync(data, resolve(outDir, "data"), { recursive: true });
      },
    },
  ],
  build: { outDir, emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: { fs: { allow: [__dirname] } },
});
