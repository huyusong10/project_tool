import {req,work} from '../fixtures/path-network';
import type {PathInput} from '../../src/shared/paths';

/** Shared topology for responsive geometry and isolated browser timings. */
export function largeGraphInput(project:{id:string;name:string},count:number,revision:number):PathInput {
  const requirements=Array.from({length:count},(_,i)=>({...req('r'+i),projectId:project.id,title:'交付需求 '+(i+1)}));
  const workItems=requirements.map((r,i)=>work('w'+i,r.id,1)),dependencies:PathInput['dependencies']=[];
  const edge=(id:string,from:number,to:number)=>({id,projectId:project.id,sourceRequirementId:'r'+from,sourceWorkItemId:'w'+from,targetRequirementId:'r'+to,targetWorkItemId:'w'+to,origin:'manual' as const});
  for(let i=1;i<count;i++)for(const delta of [1,3,7])if(i>=delta)dependencies.push(edge(`e${i}-${delta}`,i-delta,i));
  for(let i=12;dependencies.length<count*3;i++){const from=(i-11)%(count-11);dependencies.push(edge('extra'+i,from,from+11));}
  return {projectId:project.id,projectName:project.name,revision,projectEnd:null,asOfDate:'2026-09-07',requirements,workItems,dependencies};
}
