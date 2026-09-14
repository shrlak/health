import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * A GitHub Pages project site is served from https://<user>.github.io/<repo>/,
 * so built asset URLs need that prefix or every request 404s. The deploy
 * workflow sets VITE_BASE from the repository name; local dev and any
 * root-served host fall back to "/".
 */
const base = process.env.VITE_BASE ?? '/'

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  build: { target: 'es2022' },
  worker: { format: 'es' },
})
