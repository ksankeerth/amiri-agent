import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the API runs on :8000 (uv run amiri serve); Vite forwards to it,
// so the browser sees one origin. In production amiri-server serves dist/ itself.
const api = process.env.AMIRI_API ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": api, "/health": api, "/internal": api },
  },
});
