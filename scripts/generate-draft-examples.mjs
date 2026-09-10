import fs from 'node:fs';
const root=new URL('../skills/project-manage-intake/assets/',import.meta.url);
for(const name of ['log','org']){
  const input=JSON.parse(fs.readFileSync(new URL(name+'-intake.json',root),'utf8'));
  const requirementId=key=>`case-${name}:${key}`;
  const workId=(req,key)=>`${requirementId(req)}:${key}`;
  const content={formatVersion:1,documents:input.documents.map(d=>({...d,url:'',version:d.version||''})),entities:[],references:[],links:[],dependencies:[],templates:[],questions:['建议拆分；人员、工期和排期由人类核对。'],positions:{}};
  for(const r of input.requirements){
    content.entities.push({id:requirementId(r.key),entity:'requirement',...(r.group?{group:r.group}:{}),data:{title:r.title,background:r.background||'',acceptanceCriteria:r.acceptanceCriteria||'',tags:r.tags||[],deliveryScope:'candidate',ownerId:null}});
    for(const w of r.workItems||[])content.entities.push({id:workId(r.key,w.key),entity:'work',requirementId:requirementId(r.key),data:{title:w.title,ownerId:null,durationDays:null}});
  }
  content.links=input.links.map(l=>({requirementId:requirementId(l.requirement),workItemId:l.workItem?workId(l.requirement,l.workItem):null,document:l.document,clause:l.clause,scope:l.scope}));
  content.dependencies=input.dependencies.map((d,i)=>({clientId:`case-${name}:edge:${i}`,sourceRequirementId:requirementId(d.source.requirement),sourceWorkItemId:d.source.workItem?workId(d.source.requirement,d.source.workItem):null,targetRequirementId:requirementId(d.target.requirement),targetWorkItemId:d.target.workItem?workId(d.target.requirement,d.target.workItem):null}));
  fs.writeFileSync(new URL(name+'-draft.json',root),JSON.stringify(content,null,2)+'\n');
}
