import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { ToastProvider } from './components/Toast';
import { initTheme } from './theme';
import { initMotion } from './motion';
import { keys } from './query-keys';
import './tokens.css';
import './styles.css';
import './themes.css';
import './responsive.css';
import './components/pagination.css';
import './components/topbar.css';

initTheme();
initMotion();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});
// 个人页不绑定项目，独立读取本人工作；隐藏页面时使用查询库默认的暂停轮询行为。
queryClient.setQueryDefaults(keys.myWork, { refetchOnWindowFocus: true, refetchInterval: 60_000 });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* 导航先提交当前页面占位，正文由局部 Suspense 加载，不保留上一页的可操作外壳。 */}
      <BrowserRouter useTransitions={false}>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
