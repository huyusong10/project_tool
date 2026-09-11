import {describe,it,expect,vi} from 'vitest';
import {analysePaths,acceptanceId,startId,dependencySource,dependencyTarget,type Dependency} from '../src/shared/paths';
import {pathFixture,date} from './fixtures/path-network';
import {draftNetwork} from '../src/client/dependency-draft';
import {relationCaption,relationDescription,relationEndpoints,replaceDeliveryCondition} from '../src/client/path-relations';
import {projectPathGraph} from '../src/client/path-projection';
import type {DependencyChanges} from '../src/shared/path-contracts';
import {remapEditorUrl,remapSavedEditorUrl,remapEditorViews} from '../src/client/path-view';
import {editorAdapter} from '../src/client/editor-adapter';

const empty=():DependencyChanges=>({add:[],remove:[],estimates:[]});
const dependency=(id:string,sr:string,sw:string|null,tr:string,tw:string|null):Dependency=>({id,projectId:'p',sourceRequirementId:sr,sourceWorkItemId:sw,targetRequirementId:tr,targetWorkItemId:tw,origin:'manual'});
function fixture(){const input=pathFixture();input.dependencies=input.dependencies.filter(d=>d.sourceRequirementId===d.targetRequirementId);input.dependencies.push(dependency('whole','A',null,'B',null));return analysePaths(input);}
describe('就地交付条件',()=>{
  it('保存后历史中的草稿地址和节点映射到正式对象，保留筛选与分析目标',()=>{
    const storage=()=>{const values:Record<string,string>={};return {getItem:(key:string)=>values[key]||null,setItem:(key:string,value:string)=>{values[key]=value;},removeItem:(key:string)=>{delete values[key];}};};
    vi.stubGlobal('location',{origin:'http://localhost'});vi.stubGlobal('localStorage',storage());vi.stubGlobal('sessionStorage',storage());
    try{
      remapEditorViews('user:project',{draft:'saved',work:'saved-work'});
      const url=remapSavedEditorUrl('/requirements/draft?view=path&draftProject=project&pathNode=work&target=acceptance%3Adraft&pathSearch=test','user:project');
      expect(url).toBe('/requirements/saved?view=path&pathNode=saved-work&target=acceptance%3Asaved&pathSearch=test');
      expect(remapSavedEditorUrl(url,'user:project')).toBe(url);
      expect(remapSavedEditorUrl('/requirements/draft?view=path','other:project')).toBe('/requirements/draft?view=path');
    }finally{vi.unstubAllGlobals();}
  });
  it('restores saved relation selection and maps both aggregate and execution edge ids',()=>{
    vi.stubGlobal('location',{origin:'http://127.0.0.1:3220'});
    try{
      const url=new URL(remapEditorUrl('/paths?pathRelation=draft-edge&pathEdge=A%3EB&pathNode=acceptance%3AA',{'draft-edge':'saved-edge',A:'saved-A',B:'saved-B'}),location.origin);
      expect(url.searchParams.get('pathRelation')).toBe('saved-edge');expect(url.searchParams.get('pathEdge')).toBe('saved-A>saved-B');expect(url.searchParams.get('pathNode')).toBe('acceptance:saved-A');
      expect(remapEditorUrl('/paths?pathEdge=draft-edge',{'draft-edge':'saved-edge'})).toBe('/paths?pathEdge=saved-edge');
    }finally{vi.unstubAllGlobals();}
  });
  it('relation property editing obeys the shared read-only and save lock',()=>{
    const handler=vi.fn(),command={type:'replaceRelation' as const,id:'whole',source:'A1',target:'B2'};
    expect(editorAdapter({replaceRelation:handler},false).dispatch(command)).toBe(false);expect(handler).not.toHaveBeenCalled();
    expect(editorAdapter({replaceRelation:handler},true).dispatch(command)).toBe(true);expect(handler).toHaveBeenCalledExactlyOnceWith('whole','A1','B2');
  });
  it('replaces the whole-requirement condition without retaining a hidden stronger prerequisite',()=>{
    const formal=fixture(),before=structuredClone(formal),result=replaceDeliveryCondition(formal,empty(),'whole','A1',startId('B'),'draft');
    if('issue' in result)throw new Error(result.issue.message);
    expect(result.changes.remove).toEqual(['whole']);expect(result.changes.add).toHaveLength(1);
    const network=draftNetwork(formal,result.changes),edge=network.dependencies.find(d=>d.id==='draft')!;
    expect(edge.sourceWorkItemId).toBe('A1');expect(edge.targetWorkItemId).toBeNull();expect(network.dependencies.some(d=>d.id==='whole')).toBe(false);expect(formal).toEqual(before);
    const repeated=replaceDeliveryCondition(network,result.changes,'draft','A1','B2','unused');
    if('issue' in repeated)throw new Error(repeated.issue.message);
    expect(repeated.relationId).toBe('draft');expect(repeated.changes.remove).toEqual(['whole']);expect(repeated.changes.add).toHaveLength(1);expect(repeated.changes.add[0].targetWorkItemId).toBe('B2');
  });
  it('editing a new draft relationship never removes a nonexistent formal id',()=>{
    const formal=fixture(),changes:DependencyChanges={...empty(),remove:['whole'],add:[{clientId:'new',sourceRequirementId:'A',sourceWorkItemId:null,targetRequirementId:'B',targetWorkItemId:null}]};
    const result=replaceDeliveryCondition(draftNetwork(formal,changes),changes,'new','A2','B2','ignored');
    if('issue' in result)throw new Error(result.issue.message);
    expect(result.changes.remove).toEqual(['whole']);expect(result.changes.add.map(d=>d.clientId)).toEqual(['new']);
  });
  it('validates the execution network after replacement and allows aggregated A ↔ B',()=>{
    const input=pathFixture();input.dependencies=[dependency('old','A','A1','B','B1'),dependency('return','B','B1','A','A3')];
    const data=analysePaths(input),valid=replaceDeliveryCondition(data,empty(),'old','A2','B1','draft');
    expect(valid).toHaveProperty('changes');
    const invalid=replaceDeliveryCondition(data,empty(),'old',acceptanceId('A'),'B1','bad');
    if(!('issue' in invalid))throw new Error('should reject execution cycle');
    expect(invalid.issue.nodeIds).toContain('B1');expect(invalid.issue.nodeIds).toContain('A3');expect(invalid.issue.edgeIds).toContain('return');
  });
  it('rejects duplicate, stale, foreign and completed endpoints without mutating drafts',()=>{
    const data=fixture(),changes=empty();data.dependencies.push(dependency('specific','A','A1','B','B1'));
    expect(replaceDeliveryCondition(data,changes,'whole','A1','B1','new')).toHaveProperty('issue.message','已存在相同交付条件，当前关系未修改');
    for(const [source,target] of [['missing','B2'],['C1','B2'],['A1','C2']])expect(replaceDeliveryCondition(data,changes,'whole',source,target,'new')).toHaveProperty('issue');
    data.nodes.find(n=>n.id==='B2')!.status='completed';expect(replaceDeliveryCondition(data,changes,'whole','A1','B2','new')).toHaveProperty('issue');expect(changes).toEqual(empty());
  });
  it('keeps source and target scopes and supports independent milestones',()=>{
    const input=pathFixture();input.milestones=[{id:'m',projectId:'p',requirementId:'A',title:'设计确认',targetDate:date(3),confirmationMode:'manual',achievedAt:null,version:1}];
    const data=analysePaths(input),edge=data.dependencies.find(d=>d.sourceRequirementId==='A'&&d.targetRequirementId==='B')!;
    expect(relationEndpoints(data,edge,'source').map(n=>n.id)).toEqual([acceptanceId('A'),'A1','A2','A3','m']);
    expect(relationEndpoints(data,edge,'target').map(n=>n.id)).toEqual([startId('B'),'B1','B2']);
    const result=replaceDeliveryCondition(data,empty(),edge.id,'m','B2','draft');
    if('issue' in result)throw new Error(result.issue.message);
    expect(result.changes.add[0]).toMatchObject({sourceMilestoneId:'m',sourceWorkItemId:null});
  });
  it('describes exact handoffs, qualified endpoints and aggregate counts',()=>{
    const data=fixture(),whole=data.dependencies.find(d=>d.id==='whole')!;
    expect(relationCaption(data,whole)).toBe('验收后开始');
    const partial=dependency('partial','A','A1','B',null),targeted=dependency('target','A',null,'B','B2');
    expect(relationCaption(data,partial)).toBe('A1后开始');expect(relationCaption(data,targeted)).toBe('验收 → B2');
    expect(relationDescription(data,partial)).toBe('A · A1 → B · 整个需求开始');
    data.dependencies.push(partial);const edge=projectPathGraph(data).links.find(e=>e.source==='A'&&e.target==='B')!;
    expect(edge.label).toBe('2 条交付关系');expect(edge.description).toContain('A · 整需求验收 → B · 整个需求开始');expect(edge.description).toContain('A · A1');expect(edge.dependencyIds).toEqual(['whole','partial']);
  });
  it('long names stay readable on hover without widening a graph label indefinitely',()=>{
    const data=fixture();data.nodes.find(n=>n.id==='A1')!.title='完整交付条件名称非常长'.repeat(8);data.dependencies=[dependency('p','A','A1','B','B2')];
    const link=projectPathGraph(data).links[0];expect(Array.from(link.label!).length).toBeLessThanOrEqual(22);expect(link.label).toMatch(/…$/);expect(link.description).toContain('完整交付条件名称非常长'.repeat(8));
    const relation=data.dependencies[0];expect(dependencySource(relation)).toBe('A1');expect(dependencyTarget(relation)).toBe('B2');
  });
});
