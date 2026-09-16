import {describe,expect,it} from 'vitest';
import {requirementSourceIndex} from '../src/client/requirement-sources';

const excerpt = (entry:string,kind='功能需求',version='v24',url='https://example.com/log') => `原始需求：${entry}\n出处：日志管理 MPS ${url}\n版本：Confluence ${version} / 2026-09-07 ${kind}\n完整原文\n已有实现说明：范围说明\n工作项：测试`;

describe('legacy requirement source index',()=>{
  it('merges repeated requirement and work-item excerpts while preserving all distinct clauses',()=>{
    const notes=[excerpt('LOG-001 统一模型'),excerpt('LOG-001 统一模型'),excerpt('DFX-004 安全性','DFX需求'),excerpt('AC-01 类型覆盖','验收需求')].join('\r\n\r\n');
    expect(requirementSourceIndex(notes)).toEqual([{title:'日志管理 MPS',url:'https://example.com/log',version:'Confluence v24 / 2026-09-07',entries:['LOG-001 统一模型','DFX-004 安全性','AC-01 类型覆盖']}]);
  });
  it('keeps different documents and versions separate',()=>{
    expect(requirementSourceIndex([excerpt('LOG-001'),excerpt('LOG-001','功能需求','v25'),excerpt('LOG-001','功能需求','v24','https://example.com/org')].join('\n\n'))).toHaveLength(3);
  });
  it('does not mistake ordinary notes or incomplete excerpts for structured sources',()=>{
    for(const notes of [undefined,'','会议补充：保留断线日志','原始需求：只有编号'])expect(requirementSourceIndex(notes)).toEqual([]);
    expect(requirementSourceIndex('原始需求：安全要求\n出处：javascript:alert(1)')[0].url).toBeNull();
  });
});
