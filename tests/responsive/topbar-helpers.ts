import {expect,type Page} from '@playwright/test';
export async function headerAction(page:Page,name:string|RegExp){
 const button=page.getByRole('button',{name,exact:true});
 const more=page.getByRole('region',{name:'页面工具栏',exact:true}).getByRole('button',{name:'更多操作',exact:true});
 await expect(button.or(more).first()).toBeVisible();
 if(!await button.isVisible())await more.click();
 await button.click();
}
