import {expect,it} from 'vitest';
import {hashPassword} from '../src/server/auth';
import {createTestApp} from './support/test-app';

it('200字符流程名称仍可连续复制，编号增长不切断字符且保留来源和依赖',async()=>{
  const fixture=await createTestApp();
  try{
    const password='template-copy-test-password';
    fixture.context.sqlite.prepare("UPDATE accounts SET password_hash=? WHERE username='admin'").run(hashPassword(password));
    const login=await fixture.app.inject({method:'POST',url:'/api/login',payload:{username:'admin',password}});
    expect(login.statusCode).toBe(200);
    const cookie=login.cookies.map(c=>c.name+'='+c.value).join('; ');
    const post=async(url:string,payload:object)=>{const response=await fixture.app.inject({method:'POST',url,headers:{cookie},payload});expect(response.statusCode,response.body).toBe(200);return response.json();};
    const sourceProject=await post('/api/projects',{name:'长流程来源'}),target=await post('/api/projects',{name:'长流程复用'});
    const source=await post('/api/templates',{projectId:sourceProject.id,name:'长'.repeat(195)+'😀流程名',description:'保留全部流程内容',dependencyMode:'dependencies',items:[
      {clientKey:'work',title:'实施',durationDays:2,startOffsetDays:0,sortOrder:0,predecessorKeys:[]},
      {clientKey:'gate',title:'交付',kind:'milestone',confirmationMode:'manual',durationDays:0,startOffsetDays:2,sortOrder:1,predecessorKeys:['work']},
    ]});
    expect(source.name.length).toBe(200);
    const names=new Set<string>();
    for(let index=1;index<=12;index++){
      const copy=await post(`/api/projects/${target.id}/templates/${source.id}/copy`,{});
      expect(copy.name).toMatch(new RegExp(`（副本${index===1?'':index}）$`));
      expect(copy.name.length).toBeLessThanOrEqual(200);expect(copy.name).not.toMatch(/[\uD800-\uDFFF]/u);
      expect(names.has(copy.name)).toBe(false);names.add(copy.name);
      expect(copy).toMatchObject({projectId:target.id,description:source.description,dependencyMode:'dependencies'});
      expect(copy.items).toHaveLength(2);
      expect(copy.items[0]).toMatchObject({title:'实施',durationDays:2,predecessorIds:[]});
      expect(copy.items[1]).toMatchObject({title:'交付',kind:'milestone',confirmationMode:'manual',predecessorIds:[copy.items[0].id]});
      expect(copy.items.every((item:{id:string})=>!source.items.some((original:{id:string})=>item.id===original.id))).toBe(true);
    }
    const latest=await fixture.app.inject({method:'GET',url:'/api/templates?projectId='+sourceProject.id,headers:{cookie}});
    expect(latest.statusCode).toBe(200);expect(latest.json().find((t:{id:string})=>t.id===source.id)).toEqual(source);
  }finally{await fixture.close();}
});
