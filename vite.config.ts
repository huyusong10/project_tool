import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiPort = process.env.PORT || env.PORT || '3210';
  const apiTarget = `http://127.0.0.1:${apiPort}`;
  return {
  plugins: [react()],
  root: '.',
  server: {
    host: '0.0.0.0',
    port: Number(process.env.VITE_PORT || env.VITE_PORT || '5173'),
    strictPort: true,
    proxy: {
      '/api': apiTarget,
      '/health': apiTarget,
      '/mcp': apiTarget,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'pinyin',
              test: /node_modules[\\/]pinyin-pro[\\/]/,
              includeDependenciesRecursively: false,
            },
            {
              name: 'zrender',
              test: /node_modules[\\/]zrender[\\/]/,
              includeDependenciesRecursively: false,
            },
            {
              name: 'echarts',
              test: /node_modules[\\/]echarts[\\/]/,
              includeDependenciesRecursively: false,
            },
          ],
        },
      },
    },
  },
  };
});
