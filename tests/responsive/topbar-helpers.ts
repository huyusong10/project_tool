import type { Page } from '@playwright/test';
export async function headerAction(page:Page,name:string){
 const button=page.getByRole('button',{name,exact:true});
 if(!await button.isVisible())await page.getByRole('button',{name:'更多操作',exact:true}).click();
 await button.click();
}
