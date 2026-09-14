import {describe,it,expect} from 'vitest';
import {pageReturnScope,validPageReturn} from '../src/client/page-return';
describe('页面返回来源',()=>{
  it('视图和筛选沿用来源，下钻改变范围',()=>{
    expect(pageReturnScope('/','view=feature&featureId=a&mode=graph&phaseId=p')).toBe(pageReturnScope('/paths','view=feature&featureId=a&mode=table&q=x'));
    expect(pageReturnScope('/','view=feature&featureId=a')).not.toBe(pageReturnScope('/','view=requirement&requirementId=r&featureId=a'));
    expect(pageReturnScope('/requirements/r','view=path')).toBe(pageReturnScope('/requirements/r',''));
    expect(pageReturnScope('/templates','edit=a')).not.toBe(pageReturnScope('/templates',''));
  });
  it('跨账号、无权限项目、异常地址和历史位置不能作为返回来源',()=>{
    const source={account:'a',projectId:'p',url:'/requirements?q=资产',index:2};
    expect(validPageReturn(source,'a',5,['p'])).toBe(true);
    expect(validPageReturn(source,'b',5,['p'])).toBe(false);
    expect(validPageReturn(source,'a',5,[])).toBe(false);
    expect(validPageReturn(source,'a',2,['p'])).toBe(false);
    expect(validPageReturn({...source,url:'//example.com'},'a',5,['p'])).toBe(false);
    expect(validPageReturn({...source,projectId:'',url:'/my-work'},'a',5,[])).toBe(true);
    expect(validPageReturn(undefined,'a',5,[])).toBe(false);
  });
});
