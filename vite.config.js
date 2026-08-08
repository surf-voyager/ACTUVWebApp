import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { ntripBridgePlugin } from './tools/ntripBridgePlugin.mjs'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), ntripBridgePlugin()],
})
