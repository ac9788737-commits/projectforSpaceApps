import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

const backend = process.env.ASTROCROP_API ?? "http://127.0.0.1:8000";

/** «/» is the site's entry page (public/landing.html), the same as nginx does in production. */
const landing = {
  name: "astrocrop-landing",
  configureServer(server: { middlewares: { use: (fn: (req: { url?: string }, res: unknown, next: () => void) => void) => void } }) {
    server.middlewares.use((req, _res, next) => {
      if (req.url === "/" || req.url?.startsWith("/?")) req.url = "/landing.html" + (req.url.slice(1) || "");
      next();
    });
  },
};

export default defineConfig({
  plugins: [landing, react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    host: "0.0.0.0",
    proxy: {
      "/api": { target: backend, ws: true, rewrite: (path) => path.replace(/^\/api/, "") },
    },
  },
  build: {
    chunkSizeWarningLimit: 1200,
  },
});
