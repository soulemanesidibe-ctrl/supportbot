// Configuration Vite de l'application Relève. Aucun script en ligne, aucune ressource tierce à l'exécution : les polices Geist
// sont auto-hébergées (paquet « geist »), pour que la politique de sécurité du contenu (CSP) reste « 'self' » (SEC-23).
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    target: "es2022",
    sourcemap: false,
    // Les données fictives (mode démo) ne doivent jamais se retrouver dans le paquet de production : voir src/lib/api/index.ts.
    assetsInlineLimit: 0,
  },
  server: { port: 5173, strictPort: true },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}", "server/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
  },
});
