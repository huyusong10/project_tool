import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
if(path.basename(process.cwd())!=='project-manage-drafts')throw new Error('只能试录个人草稿隔离工作区');
const access=JSON.parse(fs.readFileSync('.preview/access.json','utf8')),origin='http://127.0.0.1:3242';
if(access.url!==origin)throw new Error('试用地址与隔离端口不符');
const login=await fetch(origin+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:access.username,password:access.password})});
if(!login.ok)throw new Error('隔离账号登录失败');
const cookie=login.headers.get('set-cookie').split(';')[0];
async function rest(url,body){const response=await fetch(origin+url,{method:body?'POST':'GET',headers:{cookie,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(!response.ok)throw new Error(await response.text());return response.json();}
const projects=await rest('/api/projects');
const project=projects.find(p=>p.name==='LOG / ORG 个人草稿试用')||await rest('/api/projects',{name:'LOG / ORG 个人草稿试用'});
if(!access.mcpToken){access.mcpToken=(await rest('/api/tokens',{name:'个人草稿隔离试录'})).token;fs.writeFileSync('.preview/access.json',JSON.stringify(access,null,2));}
async function mcp(name,args){const response=await fetch(origin+'/mcp',{method:'POST',headers:{authorization:'Bearer '+access.mcpToken,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});const result=await response.json();if(result.error||result.result?.isError)throw new Error(JSON.stringify(result));return result.result.structuredContent.result;}
const existing=await mcp('list_requirement_drafts',{projectId:project.id});const results=[];
for(const name of ['log','org']){
  const title=(name==='log'?'LOG v24':'ORG v18')+' · 建议拆分（待本人审核）';
  const content=JSON.parse(fs.readFileSync(`skills/project-manage-intake/assets/${name}-draft.json`,'utf8'));
  const draft=existing.items.find(d=>d.title===title)||await mcp('create_requirement_draft',{requestId:randomUUID(),projectId:project.id,title,content});
  const preview=await mcp('preview_requirement_draft',{draftId:draft.id,expectedVersion:draft.version});
  const plan=await mcp('preview_requirement_draft_plan',{draftId:draft.id,expectedVersion:draft.version});
  if(preview.errors.length||plan.errors.length)throw new Error(JSON.stringify({preview,plan}));
  results.push({title,id:draft.id,url:origin+'/my-work?space=drafts&draft='+draft.id,projectId:project.id,source:'mcp',warnings:preview.warnings.length});
}
fs.writeFileSync('.preview/demo-drafts.json',JSON.stringify(results,null,2));
console.log(JSON.stringify({projectId:project.id,drafts:results,formalRequirements:(await rest('/api/requirements?projectId='+project.id)).length},null,2));
