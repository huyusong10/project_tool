import type { Viewport } from '@xyflow/react';

type Box = { x: number; y: number; width: number; height: number };
type Bounds = { left: number; right: number; top: number; bottom: number };

export function validGraphViewport(value: unknown): value is Viewport {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<Viewport>;
  return Number.isFinite(v.x) && Number.isFinite(v.y) && typeof v.zoom === 'number' && v.zoom >= 0.02 && v.zoom <= 1.5;
}

export function viewportShowsNode(view: Viewport, nodes: Box[], bounds: Bounds): boolean {
  return validGraphViewport(view) && nodes.some(node => {
    const left = view.x + node.x * view.zoom, top = view.y + node.y * view.zoom;
    return left < bounds.right && left + node.width * view.zoom > bounds.left
      && top < bounds.bottom && top + node.height * view.zoom > bounds.top;
  });
}
