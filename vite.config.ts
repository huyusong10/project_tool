import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: '.',
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3210',
      '/health': 'http://127.0.0.1:3210',
      '/mcp': 'http://127.0.0.1:3210',
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
});
