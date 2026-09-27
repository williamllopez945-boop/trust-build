import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Local-first: the dev server binds to localhost only.
export default defineConfig({
  root: "app",
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5173 },
  build: { outDir: "../dist", emptyOutDir: true },
});
