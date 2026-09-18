import {expect,it} from 'vitest';
import {inferReferenceLink,readReferenceLinks,referenceLinksEqual,referenceLinksInput,requirementReferenceLinks} from '../src/shared/reference-links';
it('类型识别只给出建议，自定义名称与来源均可保存',()=>{
  expect(inferReferenceLink('https://jira.example.com/browse/TEAM-12')).toMatchObject({title:'TEAM-12',kind:'task'});
  expect(inferReferenceLink('https://example.com/spaces/PROJ/pages/1')).toMatchObject({kind:'document'});
  expect(referenceLinksInput.parse([{title:'MDS / 任意内部系统',url:'https://internal.example.com/a',kind:'other'}])).toHaveLength(1);
});
it('显式空列表不会复活旧链接，旧单链接更新只影响对应条目',()=>{
  expect(readReferenceLinks([], 'https://example.com')).toEqual([]);
  expect(readReferenceLinks(undefined, 'https://example.com')).toHaveLength(1);
  const links=[{title:'文档',url:'https://example.com/a'},{title:'任务',url:'https://example.com/b'}];
  expect(requirementReferenceLinks({referenceUrl:null},{referenceLinks:links,referenceUrl:links[0].url}).map(l=>l.url)).toEqual([links[1].url]);
  expect(requirementReferenceLinks({referenceLinks:[]},{referenceLinks:links,referenceUrl:links[0].url})).toEqual([]);
});
it('写入核对忽略服务端去掉的空格，保留名称、地址、类型和顺序差异',()=>{
  const saved=[{title:'设计',url:'https://example.com/pages/1',kind:'document'},{title:'任务',url:'https://example.com/browse/PM-1',kind:'task'}];
  expect(referenceLinksEqual(saved,[{url:' https://example.com/pages/1 ',title:' 设计 '},{url:'https://example.com/browse/PM-1',title:'任务',kind:'task'}])).toBe(true);
  for(const patch of [{title:'另一份设计'},{url:'https://example.com/pages/2'},{kind:'other'},{title:'  '},{url:'javascript:alert(1)'}]){
    expect(referenceLinksEqual(saved,[{...saved[0],...patch},saved[1]])).toBe(false);
  }
  expect(referenceLinksEqual(saved,[...saved].reverse())).toBe(false);
  expect(referenceLinksEqual(saved,[...saved,saved[0]])).toBe(false);
  expect(referenceLinksEqual([],undefined)).toBe(true);
});
