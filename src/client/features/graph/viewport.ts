

import { type Viewport } from '@xyflow/react';


import { validGraphViewport } from "../../graph-viewport";

export const viewports = new Map<string, Viewport>();

export function readViewport(key: string): Viewport | undefined {
  try {
    const base=key.replace(/:history:\d+$/,'');
    const saved=base!==key?sessionStorage.getItem('pm-graph-view:'+key):null;
    const value=viewports.get(key)||JSON.parse(saved||localStorage.getItem('pm-graph-view:'+base)||'null');
    return validGraphViewport(value)?value:undefined;
  } catch { return undefined; }
}

export function saveViewport(key: string, value: Viewport) {
  if(!validGraphViewport(value))return;
  viewports.set(key, value);
  try {
    const base=key.replace(/:history:\d+$/,'');
    if(base!==key)sessionStorage.setItem('pm-graph-view:'+key,JSON.stringify(value));
    localStorage.setItem('pm-graph-view:'+base,JSON.stringify(value));
  } catch { /* Current view remains usable. */ }
}
