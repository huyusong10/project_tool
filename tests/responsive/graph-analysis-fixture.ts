import type {Page} from '@playwright/test';
import type {PathAnalysis} from '../../src/shared/paths';
import {summarizeFeatureOverview} from '../../src/shared/feature-overview';

/** Keep the current workspace envelope when a test replaces the network. */
export async function mockGraphAnalysis(page:Page,projectId:string,analysis:PathAnalysis){
  const formal=(await(await page.request.get('/api/projects/'+projectId+'/path-graph?view=features')).json()).analysis as PathAnalysis;
  const features=formal.featureContext!.overview.features;
  const requirements=analysis.requirements.map(r=>({...r,featureId:r.featureId||features.find(f=>f.kind==='other')!.id}));
  const result={...analysis,requirements,featureContext:{...formal.featureContext!,requirements,overview:summarizeFeatureOverview(features,requirements,analysis.asOfDate)}};
  await page.route('**/api/projects/'+projectId+'/path-graph**',route=>route.fulfill({json:{analysis:result}}));
}
