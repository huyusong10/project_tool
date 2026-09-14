import {expect,it} from 'vitest';
import {applyFeatureRelationDraft} from '../src/shared/features';
import {mergeFeatureLayouts} from '../src/client/legacy-feature-draft';
import {rebaseEditor} from '../src/client/editor-rebase';
import {analysePaths,type PathInput} from '../src/shared/paths';
import type {Feature} from '../src/shared/intake';

const relation={id:'ab',projectId:'p',sourceFeatureId:'a',targetFeatureId:'b',note:'原说明',version:1};
const empty=()=>({add:[],remove:[],estimates:[]});
it('规划草稿投影不改写正式资料；删除规划不涉及执行依赖',()=>{
 const result=applyFeatureRelationDraft([relation],[{op:'update',id:'ab',expectedVersion:1,note:'新说明'},{op:'create',id:'bc',sourceFeatureId:'b',targetFeatureId:'c',note:''}],'p');
 expect(result.map(r=>r.note)).toEqual(['新说明','']);expect(relation.note).toBe('原说明');
 expect(applyFeatureRelationDraft(result,[{op:'delete',id:'ab',expectedVersion:1}],'p').map(r=>r.id)).toEqual(['bc']);
});
it('旧布局导入保留双方，选择后合并为一个撤销步骤的值',()=>{
 const current={scope:'features',direction:'right' as const,expectedVersion:1,positions:{a:{x:1,y:2}}},legacy={...current,positions:{a:{x:9,y:8}}};
 const changes={...empty(),layouts:[current]};expect(mergeFeatureLayouts(changes,[legacy]).conflicts).toEqual(['features:right']);
 expect(mergeFeatureLayouts(changes,[legacy],{'features:right':'legacy'}).changes.layouts).toEqual([legacy]);
 expect(mergeFeatureLayouts(changes,[legacy],{'features:right':'current'}).changes.layouts).toEqual([current]);
 expect(changes.layouts).toEqual([current]);
});
it('规划版本冲突保留说明，失效端点不能强行继续',()=>{
 const base=analysePaths({projectId:'p',projectName:'P',revision:1,asOfDate:'2026-09-11',projectEnd:null,highRiskDelayDays:3,requirements:[],workItems:[],dependencies:[]} as PathInput);
 base.featureContext={overview:{projectId:'p',asOfDate:'2026-09-11',unassignedCount:0,features:['a','b'].map(id=>({id,archivedAt:null} as Feature))} as never,requirements:[],relations:[relation]};
 const server=structuredClone(base);server.featureContext!.relations[0]={...relation,note:'其他人的修改',version:2};
 const draft={...empty(),featureRelations:[{op:'update' as const,id:'ab',expectedVersion:1,note:'我的输入'}]};
 const result=rebaseEditor(base,server,draft);expect(result.pending).toHaveLength(1);expect(result.changes.featureRelations?.[0]).toMatchObject({note:'我的输入',expectedVersion:2});
 server.featureContext!.overview.features[0].archivedAt='2026-09-11';expect(rebaseEditor(base,server,draft).pending[0].canKeep).toBe(false);
});
