import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
// Tailwind v4 dùng Vite plugin riêng, KHÔNG cần file postcss.config.js
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
