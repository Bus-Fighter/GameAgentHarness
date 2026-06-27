import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: "src/dashboard-client",
  build: {
    outDir: "../../dist/dashboard",
    emptyOutDir: true,
  },
  plugins: [react(), tailwindcss()],
});
