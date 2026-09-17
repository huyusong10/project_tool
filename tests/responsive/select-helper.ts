import type {Locator} from '@playwright/test';

/** Read the native value mirrored by a custom picker without changing it. */
export function selectedValue(locator:Locator){
  return locator.locator('xpath=self::select | ancestor::span[contains(@class,"select-field")]/select');
}

/** Exercise the visible picker; unchanged native controls still use selectOption. */
export async function chooseOption(locator:Locator,value:string|{label?:string;value?:string;index?:number}){
  const isSelect=await locator.evaluate(e=>e.tagName==='SELECT');
  if(isSelect&&await locator.isVisible())return locator.selectOption(value);
  const field=isSelect?locator.locator('..'):locator.locator('xpath=ancestor::span[contains(@class,"select-field")]');
  const label=await field.locator('select').evaluate((e,v)=>{const options=Array.from((e as HTMLSelectElement).options);const option=typeof v==='string'?options.find(o=>o.value===v):v.label?options.find(o=>o.label===v.label):v.index!==undefined?options[v.index]:options.find(o=>o.value===v.value);if(!option)throw Error('Option not found');return option.label;},value);
  await field.getByRole('combobox').click();
  const search=locator.page().locator('.select-popover input');if(await search.isVisible())await search.fill(label);
  await locator.page().getByRole('option',{name:label,exact:true}).click();
}
