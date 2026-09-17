import {execFileSync} from 'node:child_process';
import fs from 'node:fs';

const report=JSON.parse(execFileSync(process.execPath,['node_modules/@playwright/test/cli.js','test','--list','--reporter=json'],{encoding:'utf8',maxBuffer:20*1024*1024}));
const counts={functional:0,responsive:0,performance:0,instances:0,byProject:{}};
const scenarios=new Map();
function visit(suite){
  for(const spec of suite.specs||[]){
    if(spec.tags?.some(tag=>tag.replace(/^@/,'')==='performance'))throw Error(`Performance scenario entered the normal matrix: ${spec.title}`);
    const layout=spec.tags?.some(tag=>tag==='@responsive'||tag==='responsive');
    const key=JSON.stringify([spec.file,spec.line,spec.column,spec.title]);
    const scenario=scenarios.get(key)||{title:spec.title,layout,projects:new Set()};scenarios.set(key,scenario);
    for(const test of spec.tests){
      if(!layout&&test.projectName!=='office-1280')throw Error(`Functional scenario repeated in ${test.projectName}: ${spec.title}`);
      scenario.projects.add(test.projectName);
      counts.instances++;counts.byProject[test.projectName]=(counts.byProject[test.projectName]||0)+1;
    }
  }
  for(const child of suite.suites||[])visit(child);
}
visit(report);
for(const scenario of scenarios.values()){
  counts[scenario.layout?'responsive':'functional']++;
  if(scenario.layout&&scenario.projects.size!==6)throw Error(`Layout scenario must retain six viewports: ${scenario.title}`);
}
const performanceReport=JSON.parse(execFileSync(process.execPath,['node_modules/@playwright/test/cli.js','test','--config','playwright.performance.config.ts','--list','--reporter=json'],{encoding:'utf8',maxBuffer:20*1024*1024}));
function checkPerformance(suite){
  for(const spec of suite.specs||[]){
    if(!spec.tags?.some(tag=>tag.replace(/^@/,'')==='performance')||spec.tests.length!==1||spec.tests[0].projectName!=='browser-performance')throw Error(`Invalid isolated performance scenario: ${spec.title}`);
    counts.performance++;
  }
  for(const child of suite.suites||[])checkPerformance(child);
}
checkPerformance(performanceReport);
fs.mkdirSync('coverage/browser-matrix',{recursive:true});
fs.writeFileSync('coverage/browser-matrix/counts.json',JSON.stringify(counts,null,2)+'\n');
console.log(JSON.stringify(counts,null,2));
