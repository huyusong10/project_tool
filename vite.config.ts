import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import {themes, dayTheme, nightTheme, resolveAppearance} from './src/client/theme-preference.ts';
import {toolbarForRoute} from './src/client/page-presentation.ts';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiPort = process.env.PORT || env.PORT || '3210';
  const apiTarget = `http://127.0.0.1:${apiPort}`;
  return {
  test: { env: { ADMIN_PASSWORD: '' } },
  plugins: [react(), {
    name: 'initial-shell',
    transformIndexHtml: {
      order: 'post',
      handler: () => [
        {tag:'meta',attrs:{charset:'UTF-8'},injectTo:'head-prepend'},
        {tag:'script',injectTo:'head-prepend',children:`(()=>{let stored=null,collapsed=false;try{stored=localStorage.getItem('project-manage:theme');collapsed=localStorage.getItem('project-manage:sidebar-collapsed')==='true';}catch{}const value=(${resolveAppearance.toString()})(stored,matchMedia('(prefers-color-scheme: dark)').matches,${JSON.stringify(themes.map(theme=>theme.id))},${JSON.stringify(dayTheme)},${JSON.stringify(nightTheme)});document.documentElement.dataset.theme=value.theme;document.documentElement.dataset.themePreference=value.preference;document.documentElement.dataset.bootSidebarCollapsed=String(collapsed);})();`},
        {tag:'script',injectTo:'body-prepend',children:`(()=>{const root=document.documentElement,collapsed=matchMedia('(max-width:620px)').matches||root.dataset.bootSidebarCollapsed==='true';const sidebar=collapsed?72:parseFloat(getComputedStyle(root).getPropertyValue('--sidebar-width'))||228;const layout=(${toolbarForRoute.toString()})(location.pathname,location.search);root.style.setProperty('--boot-sidebar-width',sidebar+'px');root.style.setProperty('--boot-header-height',(52+(layout==='none'?0:root.clientWidth-sidebar<960?88:56))+'px');})();`},
      ],
    },
  }],
  root: '.',
  server: {
    watch: { ignored: ['**/data/**', '**/.playwright/**', '**/.preview/**', '**/dist-server/**', '**/test-results/**'] },
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
