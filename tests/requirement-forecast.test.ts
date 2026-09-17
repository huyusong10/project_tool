import { expect,it } from 'vitest';
import { analysePaths } from '../src/shared/paths';
import { nodeForecastBasis,requirementDeliveryForecast } from '../src/shared/forecast-basis';
import { requirementForecastLookup } from '../src/server/services/requirement-forecast';
import { pathFixture } from './fixtures/path-network';

it('indexed forecast preserves completed, unknown and active snapshot projections',()=>{
  for(const status of ['not_started','in_progress','completed','cancelled']){
    const input=pathFixture();input.workItems[0].status=status;
    if(status==='in_progress'){input.workItems[0].durationDays=null;input.workItems[0].plannedEnd=null;}
    const analysis=analysePaths(input),lookup=requirementForecastLookup(analysis);
    for(const requirement of analysis.requirements){
      expect(lookup.delivery(requirement.id)).toEqual(requirementDeliveryForecast(requirement.id,analysis));
      expect(lookup.basis(requirement.id)).toEqual(nodeForecastBasis(analysis.nodes,requirement.id));
      expect(lookup.facts.get(requirement.id)).toBe(requirement);
    }
    for(const node of analysis.nodes)expect(lookup.nodes.get(node.id)).toBe(node);
  }
});
