import { describe, expect, it } from 'vitest';
import { pageNumbers, pageRange, readPagination } from '../src/client/pagination';
describe('分页边界', () => {
  it.each([0, 1, 10, 20, 21, 145, 1000])('数量 %i 的末页不重复或越界', total => {
    const range = pageRange(total, 9999, 20);
    expect(range.page).toBe(Math.max(1, Math.ceil(total / 20)));
    expect(range.end).toBe(total);
    expect(range.end - range.start).toBeLessThanOrEqual(20);
  });
  it('非法参数回到默认值，同页不同列表分别读取', () => {
    expect(readPagination(new URLSearchParams('page=-2&pageSize=100'))).toEqual({page: 1, pageSize: 20});
    expect(readPagination(new URLSearchParams('page=Infinity&pageSize=10'), 50, 'main', [20, 50])).toEqual({page: 1, pageSize: 50});
    expect(readPagination(new URLSearchParams('work.page=3&owned.page=2&work.pageSize=10'),20,'work')).toEqual({page: 3,pageSize: 10});
  });
  it('大页数只展示首尾与当前附近的页码', () => {
    expect(pageNumbers(50, 100)).toEqual([1,'gap',49,50,51,'gap',100]);
    expect(pageNumbers(1, 2)).toEqual([1,2]);
  });
});
