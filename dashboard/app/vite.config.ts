import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const devHost = env.FMD_DEV_HOST || '0.0.0.0'
  const envPort = Number.parseInt(env.FMD_DEV_PORT || '', 10)
  const fallbackPort = Number.parseInt(env.PORT || '', 10)
  const devPort = Number.isFinite(envPort) ? envPort : Number.isFinite(fallbackPort) ? fallbackPort : 5173
  const apiProxyTarget = env.FMD_API_PROXY_TARGET || `http://127.0.0.1:${env.FMD_API_PORT || '8787'}`

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      host: devHost,
      port: devPort,
      strictPort: true,
      watch: {
        ignored: [
          '**/api/**/*.db',
          '**/api/**/*.db-*',
          '**/api/**/*.log',
          '**/api/**/.runner_state.json',
          '**/api/**/control_plane_snapshot.json',
        ],
      },
      allowedHosts: [
        'localhost',
        '127.0.0.1',
        '.nahrup.ngrok.app',
        '.ngrok-free.app',
        '.ngrok.app',
      ],
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
