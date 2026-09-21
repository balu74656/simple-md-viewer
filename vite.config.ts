import { defineConfig } from 'vite';

// Tauri ocekava fixni port a nepotrebuje obfuskaci sourcemap v dev rezimu.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    // WebView2 na Win10/11 je vzdy novejsi nez chrome110
    target: 'chrome110',
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 2500,
  },
});
