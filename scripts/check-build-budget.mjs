import fs from 'node:fs';
import path from 'node:path';

const directory=path.resolve(process.argv[2]||'dist/assets');
const budgets=[
  {name:'main JS',pattern:/^index-[^.]+\.js$/,baseline:912730},
  {name:'main CSS',pattern:/^index-[^.]+\.css$/,baseline:343620},
  {name:'ELK worker',pattern:/^elk-worker.*\.js$/,baseline:1595330},
];
const files=fs.readdirSync(directory),report=[];
for(const budget of budgets){
  const matches=files.filter(file=>budget.pattern.test(file));
  if(matches.length!==1)throw new Error(`Expected one ${budget.name} asset; found ${matches.length}`);
  const bytes=fs.statSync(path.join(directory,matches[0])).size,growth=bytes/budget.baseline-1;
  report.push({name:budget.name,file:matches[0],bytes,baselineBytes:budget.baseline,growthPercent:+(growth*100).toFixed(2)});
  const message=`${budget.name}: ${(bytes/1000).toFixed(2)} KB (${growth>=0?'+':''}${(growth*100).toFixed(1)}% against R0)`;
  if(growth>.1)console.warn(`WARNING: ${message}; growth exceeds 10%`);else console.log(message);
}
fs.mkdirSync('test-results/build',{recursive:true});
fs.writeFileSync('test-results/build/budget.json',JSON.stringify(report,null,2)+'\n');
