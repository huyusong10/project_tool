import {test,expect} from '@playwright/test';
import {analysePaths} from '../../src/shared/paths';
import {graphFixture} from './graph-fixture';
import {mockGraphAnalysis} from './graph-analysis-fixture';
import {largeGraphInput} from './large-graph-fixture';
import {openGraph,graphToolbar} from './graph-interactions';

for(const count of [20,80,200])test(`${count} 节点与三倍连线的标签不遮挡卡片`,{tag:'@responsive'},async({page},info)=>{
  const {project}=await graphFixture(page);
  await mockGraphAnalysis(page,project.id,analysePaths(largeGraphInput(project,count,1)));
  await openGraph(page,'/paths?pathScope=all');await expect(page.locator('.dependency-canvas')).toHaveAttribute('data-layout-ready','true');
  await expect(page.locator('.react-flow__node')).toHaveCount(count);await graphToolbar(page,'适配视图');
  await expect.poll(()=>page.locator('.dependency-canvas').evaluate(root=>{
    const nodes=Array.from(root.querySelectorAll('.react-flow__node')).map(n=>n.getBoundingClientRect());
    const labels=Array.from(root.querySelectorAll('.dependency-edge-label rect')).map(n=>n.getBoundingClientRect());
    return labels.filter(a=>nodes.some(b=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)).length;
  })).toBe(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width+1);
  await page.locator('.dependency-canvas').screenshot({path:info.outputPath('graph-'+count+'.png'),animations:'disabled'});
});
