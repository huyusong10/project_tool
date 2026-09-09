import {describe,it,expect} from 'vitest';
import {previewCurve,staleRouteIds,routeCrossesBox} from '../src/client/graph-preview';
import type {RoutedLayout} from '../src/client/path-layout';

describe('live graph feedback',()=>{
 const a={x:0,y:0,width:244,height:154},b={x:400,y:80,width:244,height:154};
 const layout:RoutedLayout={nodes:{a,b,c:{x:200,y:300}},edges:{ab:{points:[{x:244,y:77},{x:322,y:77},{x:322,y:157},{x:400,y:157}],label:null}},width:644,height:454};
 const links=[{id:'ab',source:'a',target:'b'}];
 it('starts from all four business ports and lands outside the target border',()=>{
  for(const side of ['left','right','top','bottom'] as const){const curve=previewCurve(a,b,side);expect(curve.start).toEqual({x:side==='left'?0:side==='right'?244:122,y:side==='top'?0:side==='bottom'?154:77});expect(curve.end.x).toBe(b.x-6);expect(curve.end.y).toBe(b.y+b.height/2);expect(curve.d).not.toContain('NaN');}
 });
 it('points towards the fixed successor when reconnecting the predecessor',()=>{
  const result=previewCurve(b,{x:100,y:150},'left',true);expect(result.start).toEqual({x:100,y:150});expect(result.end).toEqual({x:394,y:157});expect(result.d.endsWith('394 157')).toBe(true);
 });
 it('does not draw a loop when a connection has only just been armed',()=>{expect(previewCurve(a,{x:244,y:77},'right').d).toBe('');});
 it('keeps the established ports while a card moves across another card',()=>{const moved={...a,x:800};expect(previewCurve(moved,b,'right',false,'left').end).toEqual({x:394,y:157});});
 it('keeps forward, return and close-port previews out of their own cards',()=>{for(const target of [b,{...b,x:-400},{...b,x:260,y:0}]){const result=previewCurve(a,target,'right',false,'left');expect(routeCrossesBox(result.points,a)).toBe(false);expect(routeCrossesBox(result.points,target)).toBe(false);}});
 it('invalidates moved endpoints before a replacement route is available',()=>{
  const boxes=new Map([['a',a],['b',b]]);expect([...staleRouteIds(layout,links,boxes)]).toEqual([]);expect([...staleRouteIds(layout,links,boxes,['a'])]).toEqual(['ab']);boxes.set('a',{...a,y:30});expect([...staleRouteIds(layout,links,boxes)]).toEqual(['ab']);
  expect([...staleRouteIds({...layout,nodes:{...layout.nodes,a:boxes.get('a')!}},links,boxes)]).toEqual([]);
 });
 it('hides routes crossed by another dragged card but keeps unrelated routes',()=>{
  const boxes=new Map([['a',a],['b',b],['c',{x:300,y:90,width:50,height:50}]]);expect([...staleRouteIds(layout,links,boxes,['c'])]).toEqual(['ab']);boxes.set('c',{x:100,y:300,width:50,height:50});expect([...staleRouteIds(layout,links,boxes,['c'])]).toEqual([]);
  expect(routeCrossesBox([{x:0,y:0},{x:20,y:0}],{x:5,y:0,width:10,height:20})).toBe(false);
 });
});
