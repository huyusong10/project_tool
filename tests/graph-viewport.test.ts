import { expect, it } from 'vitest';
import { validGraphViewport, viewportShowsNode } from '../src/client/graph-viewport';

const bounds = { left: 0, top: 0, right: 800, bottom: 600 };
const node = { x: 100, y: 100, width: 244, height: 154 };

it('拒绝损坏的缓存坐标和超出画布支持范围的缩放', () => {
  for (const view of [null, {}, { x: '0', y: 0, zoom: 1 }, { x: Infinity, y: 0, zoom: 1 }, { x: 0, y: NaN, zoom: 1 }, { x: 0, y: 0, zoom: 0 }, { x: 0, y: 0, zoom: 2 }]) expect(validGraphViewport(view)).toBe(false);
  expect(validGraphViewport({ x: -800, y: 200, zoom: 0.02 })).toBe(true);
});

it('保留仍能看到节点的平移缩放，全部离屏时拒绝恢复', () => {
  expect(viewportShowsNode({ x: 0, y: 0, zoom: 1 }, [node], bounds)).toBe(true);
  expect(viewportShowsNode({ x: -300, y: 0, zoom: 1 }, [node], bounds)).toBe(true);
  expect(viewportShowsNode({ x: -1000, y: -1000, zoom: 1 }, [node], bounds)).toBe(false);
  expect(viewportShowsNode({ x: 750, y: 0, zoom: 0.5 }, [node], bounds)).toBe(false);
});

it('视口落在节点之间的大块空白时不能用整图包围盒判定可见', () => {
  const nodes = [{ ...node, x: -1000 }, { ...node, x: 1000 }];
  expect(viewportShowsNode({ x: 0, y: 0, zoom: 1 }, nodes, bounds)).toBe(false);
  expect(viewportShowsNode({ x: 0, y: 0, zoom: 1 }, [], bounds)).toBe(false);
});
