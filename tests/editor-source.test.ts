import {expect,it} from 'vitest';
import {currentEditorAnalysis} from '../src/client/editor-rebase';
import {analysePaths} from '../src/shared/paths';

const older=analysePaths({projectId:'p',projectName:'项目',revision:1,projectEnd:null,asOfDate:'2026-09-17',requirements:[],workItems:[],dependencies:[]});
const newer={...older,revision:2};

it('共享草稿已读取新版本时，旧视角不能把基线反向更新',()=>{
 expect(currentEditorAnalysis(older,newer)).toBe(newer);
 expect(currentEditorAnalysis(newer,older)).toBe(newer);
 let shared=older;
 for(const source of [newer,older,newer,older])shared=currentEditorAnalysis(source,shared);
 expect(shared).toBe(newer);
});
it('相同版本仍接收当前投影，且不复用其他项目资料',()=>{
 const projection={...newer,targetLabel:'当前范围'};
 expect(currentEditorAnalysis(projection,newer)).toBe(projection);
 expect(currentEditorAnalysis(older,{...newer,projectId:'other'})).toBe(older);
 expect(currentEditorAnalysis(older)).toBe(older);
});
