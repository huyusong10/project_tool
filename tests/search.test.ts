import { describe, expect, it } from 'vitest';
import {
  canonicalizeContent,
  canonicalizeLabel,
  matchesPlainText,
  matchesSearch,
  normalizeSearchText,
  searchScore,
  textSafetyIssue,
} from '../src/shared/search';

describe('shared search foundation', () => {
  it('cleans compatibility and invisible artifacts at the write boundary', () => {
    expect(canonicalizeLabel('  周\u200b方\ufeff正  ')).toBe('周方正');
    expect(canonicalizeLabel('ＤＣＩＭ　项目')).toBe('DCIM 项目');
    expect(canonicalizeLabel('并行交付模板（副本）')).toBe('并行交付模板（副本）');
    expect(canonicalizeContent('第一行\r\n第二\u200b行')).toBe('第一行\n第二行');
    expect(canonicalizeContent('设计完成，等待联调。（保留中文标点）')).toBe('设计完成，等待联调。（保留中文标点）');
    expect(textSafetyIssue('名称\n换行', false)).toBe('line_break');
    expect(textSafetyIssue(`名称\u202e`, false)).toBe('bidi');
  });

  it.each(['周方', '方正', 'zhoufangzheng', 'fangzheng', 'zfz', 'fz', 'zhoufz', 'zhou fang'])(
    'matches Chinese names with %s',
    (query) => expect(matchesSearch(['周\u200b方\u200b正'], query)).toBe(true),
  );

  it('ranks primary-field and direct matches ahead of secondary matches', () => {
    const primary = searchScore([{ text: '周方正', weight: 100 }, '前端工程师'], 'fangzheng');
    const secondary = searchScore([{ text: '其他人员', weight: 100 }, '方正相关岗位'], 'fangzheng');
    expect(primary).toBeGreaterThan(secondary);
  });

  it('treats SQL wildcard characters as ordinary search text', () => {
    expect(matchesPlainText(['完成度达到 90%'], '90%')).toBe(true);
    expect(matchesPlainText(['普通文本'], '%')).toBe(false);
    expect(matchesPlainText(['字段_a'], '_a')).toBe(true);
  });

  it('normalizes the query and stored text in the same way', () => {
    expect(normalizeSearchText(' 周\u200b方 ')).toBe('周方');
    expect(normalizeSearchText('ＺＨＯＵ')).toBe('zhou');
  });
});
