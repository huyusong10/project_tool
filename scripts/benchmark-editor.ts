import os from 'node:os';
import fs from 'node:fs';
import ELK from 'elkjs/lib/elk.bundled.js';
import { analysePaths, type PathInput } from '../src/shared/paths';
import { req,work,date } from '../tests/fixtures/path-network';
import {routeFixedGraph} from '../src/client/fixed-routing';
import { layoutDependencyGraph,type LayoutEdge } from '../src/client/path-layout';
const requirements=Array.from({length:100},(_,i)=>req(`r${i}`));
const workItems=Array.from({length:2000},(_,i)=>work(`w${i}`,`r${Math.floor(i/20)}`,1+i%3));
const dependencies:PathInput['dependencies']=[];
for(let i=1;i<2000;i++)for(const delta of [1,3,7])if(i>=delta)dependencies.push({id:`e${i}-${delta}`,projectId:'p',sourceRequirementId:workItems[i-delta].requirementId,sourceWorkItemId:`w${i-delta}`,targetRequirementId:workItems[i].requirementId,targetWorkItemId:`w${i}`,origin:'manual'});
for(let i=12;dependencies.length<6000;i++)dependencies.push({id:`extra${i}`,projectId:'p',sourceRequirementId:workItems[i-11].requirementId,sourceWorkItemId:`w${i-11}`,targetRequirementId:workItems[i].requirementId,targetWorkItemId:`w${i}`,origin:'manual'});
const input:PathInput={projectId:'p',projectName:'性能试验',projectEnd:date(30),revision:1,asOfDate:date(0),requirements,workItems,dependencies};
const stats=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return {samples:values.length,p50Ms:+sorted[Math.floor(sorted.length*.5)].toFixed(1),p95Ms:+sorted[Math.ceil(sorted.length*.95)-1].toFixed(1),maxMs:+sorted.at(-1)!.toFixed(1)};};
const runs=Number(process.env.PATH_BENCH_RUNS||20);
const timings:number[]=[];
for(let i=0;i<runs+2;i++){const start=performance.now();analysePaths(input);if(i>1)timings.push(performance.now()-start);}
// Every node is an actionable source: measure deduplicated downstream impact as well.
input.workItems.forEach(w=>{w.status='in_progress';w.actualStart=date(-2);w.durationDays=null;w.plannedEnd=null;});
const blocked:number[]=[];
for(let i=0;i<runs+1;i++){const start=performance.now();analysePaths(input);if(i)blocked.push(performance.now()-start);}
const engine=new ELK();const layouts:Record<string,unknown>={};
for(const count of [20,80,200]){
 const nodes=Array.from({length:count},(_,i)=>({id:`n${i}`,width:244,height:110+i%3*20}));const edges:LayoutEdge[]=[];
 for(let i=1;i<count;i++)for(const d of [1,3,7])if(i>=d)edges.push({id:`e${i}-${d}`,source:`n${i-d}`,target:`n${i}`,label:i%11===0?'部分交付':undefined});
 for(let i=12;edges.length<count*3;i++)edges.push({id:`extra${i}`,source:`n${(i-11)%(count-11)}`,target:`n${((i-11)%(count-11))+11}`});
 const routing:number[]=[];const values:number[]=[];for(let i=0;i<runs+1;i++){const start=performance.now();const layout=await layoutDependencyGraph(engine,nodes,edges);if(i)values.push(performance.now()-start);const routeStart=performance.now();routeFixedGraph(nodes.map(n=>({...n,...layout.nodes[n.id]})),edges.map(e=>({...e,id:i+':'+e.id})));if(i)routing.push(performance.now()-routeStart);}
 layouts[String(count)]={nodes:count,edges:edges.length,layout:stats(values),routing:stats(routing)};
}
const result={measuredAt:new Date().toISOString(),device:{cpu:os.cpus()[0].model,logicalCpus:os.cpus().length,memoryGiB:Math.round(os.totalmem()/2**30),os:`${os.platform()} ${os.release()}`,node:process.version},analysis:{nodes:2000,edges:6000,serial:stats(timings),unestimated:stats(blocked)},layouts};
fs.mkdirSync('.preview/qa',{recursive:true});fs.writeFileSync('.preview/qa/editor-performance.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
