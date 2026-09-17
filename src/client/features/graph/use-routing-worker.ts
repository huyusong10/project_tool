import { useEffect, useRef } from 'react';
import type { PositionedNode } from '../../fixed-routing';
import type { LayoutEdge, RoutedLayout } from '../../path-layout';

type RoutingInput = { nodes: PositionedNode[]; edges: LayoutEdge[]; obstacles?: Array<{left: number; right: number; top: number; bottom: number}> };

/** Owns the worker and every pending response for one canvas lifetime. */
export function useRoutingWorker(retry: number) {
  const workerRef = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, {resolve: (layout: RoutedLayout) => void; reject: (error: Error) => void}>());
  const sequence = useRef(0);
  useEffect(() => {
    const worker = new Worker(new URL('../../fixed-routing.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    const requests = pending.current;
    const fail = (message: string) => { for (const request of requests.values()) request.reject(new Error(message)); requests.clear(); };
    worker.onmessage = event => {
      const request = requests.get(event.data.id);
      if (!request) return;
      requests.delete(event.data.id);
      if (event.data.error) request.reject(new Error(event.data.error)); else request.resolve(event.data.layout);
    };
    worker.onerror = () => fail('连线路由暂不可用，请重试');
    return () => { worker.terminate(); workerRef.current = null; fail('画布已关闭'); };
  }, [retry]);
  return (input: RoutingInput) => new Promise<RoutedLayout>((resolve, reject) => {
    const worker = workerRef.current;
    if (!worker) { reject(new Error('画布已关闭')); return; }
    const id = ++sequence.current;
    pending.current.set(id, { resolve, reject });
    try { worker.postMessage({ id, ...input }); }
    catch (error) { pending.current.delete(id); reject(error); }
  });
}
