import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/** Builds only the local render harness (scripts/preview). Kept separate so
 *  the harness never reaches the app bundle. */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist-harness',
    emptyOutDir: true,
    rollupOptions: { input: 'harness.html' },
  },
})
