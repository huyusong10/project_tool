import {defineConfig} from '@playwright/test';
import base from './playwright.config';

// Record measurements and failure screenshots, not a continuous DOM trace during sampling.
export default defineConfig({...base,grep:/@performance/,grepInvert:undefined,use:{...base.use,actionTimeout:10000,trace:'off'},projects:[{name:'browser-performance',use:{viewport:{width:1280,height:800},deviceScaleFactor:1}}]});
