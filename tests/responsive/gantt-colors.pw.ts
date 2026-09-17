import { expect, test, type Page } from "@playwright/test";
import { mockGanttData, mockGanttReport, requirement, workItem } from "./gantt-fixture";

const skins = ["classic", "swiss", "forest", "midnight", "soft", "industrial", "dcim"];
const cases = [
  { status: "not_started", progress: 0, actualStart: null, actualEnd: null },
  { status: "in_progress", progress: 99.6, actualStart: "2026-09-01", actualEnd: "2026-09-14" },
  { status: "completed", progress: 100, actualStart: "2026-09-01", actualEnd: "2026-09-14" },
  { status: "cancelled", progress: 30, actualStart: "2026-09-01", actualEnd: "2026-09-03" },
];

async function changeSkin(page: Page, skin: string) {
  await page.evaluate((value) => {
    localStorage.setItem("project-manage:theme", value);
    window.dispatchEvent(new StorageEvent("storage", { key: "project-manage:theme", newValue: value }));
  }, skin);
  await expect(page.locator("html")).toHaveAttribute("data-theme", skin);
}

test("夜间默认杰瑞橙，保留已选皮肤并迁移旧明暗偏好", async ({ page }) => {
  await mockGanttData(page);
  await page.emulateMedia({ colorScheme: "dark" });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/execution");
  await expect(page.getByRole("button", { name: "切换风格，当前杰瑞橙" })).toBeVisible();
  for (const [stored, expected] of [["forest", "forest"], ["light", "classic"], ["dark", "dcim"], ["invalid", "dcim"]]) {
    await page.evaluate((value) => localStorage.setItem("project-manage:theme", value), stored);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", expected);
  }
  await page.addInitScript(() => {
    const unavailable = () => { throw new Error("storage unavailable"); };
    Storage.prototype.getItem = unavailable;
    Storage.prototype.setItem = unavailable;
    Storage.prototype.removeItem = unavailable;
  });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dcim");
  await page.getByRole("button",{name:"展开全部",exact:true}).click();
  await expect(page.locator(".workspace-gantt-row.kind-requirement")).toHaveCount(2);
  await page.getByRole("button", { name: /^切换风格/ }).click();
  await page.getByRole("menuitemradio", { name: /瑞士排版/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "swiss");
  await page.getByRole("button", { name: "收起侧边栏" }).click();
  await expect(page.getByRole("button", { name: "展开侧边栏" })).toBeVisible();
  expect(errors).toEqual([]);
});

for(const surface of ['project','requirement'] as const)test(surface+'：七套皮肤共用完成、执行、取消和延期色',{tag:'@responsive'},async({page},info)=>{
  await mockGanttData(page);
  const rows=surface==='project'?cases.map(item=>({...requirement,...item,id:item.status,title:item.status,executionMode:'direct' as const,observationEnd:item.actualEnd,workItems:[]}))
    :[{...requirement,workItems:cases.map(item=>({...workItem,...item,id:item.status,title:item.status,milestoneLabel:null,cancelledAt:item.status==='cancelled'?'2026-09-03':null}))}];
  await mockGanttReport(page,()=>rows,()=> '2026-09-14');
  await page.goto('/?projectId=p1&workspaceView=progress&scopeType='+surface+'&scopeId='+(surface==='project'?'p1':'r1'));
  await page.getByRole('button',{name:'展开全部',exact:true}).click();
  const row=(status:string)=>page.locator('.workspace-gantt-row[data-row-id="'+status+'"]');
  const fill=(status:string)=>row(status).locator('.gantt-completion-fill');
  const bar=(status:string)=>row(status).locator('.gantt-date-actual');
  for(const skin of skins){
    await changeSkin(page,skin);const dark=['midnight','dcim'].includes(skin);
    const green=dark?'rgb(120, 173, 147)':'rgb(53, 116, 91)',blue=dark?'rgb(120, 153, 188)':'rgb(68, 107, 145)',red=dark?'rgb(226, 132, 134)':'rgb(190, 79, 81)';
    await expect(fill('completed')).toHaveCSS('background-color',green);
    if(surface==='requirement')await expect(fill('in_progress')).toHaveCSS('background-color',blue);else await expect(bar('in_progress')).toHaveCSS('background-color',blue);
    await expect(row('in_progress')).toHaveAttribute('data-status','in_progress');
    // Current work capsules preserve the numeric estimate, without changing the business status.
    await expect(row('in_progress').locator('.gantt-progress-value')).toHaveText('99.6%');
    await expect(bar('cancelled')).toHaveCSS('background-color',dark?'rgb(150, 157, 169)':'rgb(104, 113, 129)');
    await expect(bar('cancelled')).not.toHaveCSS('background-image','none');
    await expect(bar('not_started')).toHaveCount(0);await expect(row('cancelled').locator('.gantt-progress-value')).toHaveCount(0);
    await expect(row('completed').locator('.gantt-date-delay')).toHaveCSS('border-top-color',red);
  }
  for(const viewport of [page.viewportSize()!,{width:390,height:844}]){
    await page.setViewportSize(viewport);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await expect(page.locator('.workspace-gantt-scroll')).toBeVisible();
    await page.screenshot({path:info.outputPath(surface+'-states-'+viewport.width+'.png'),animations:'disabled'});
  }
});

test('各执行阶段共用蓝色，阶段文字、测试进度和并行阶段保留',{tag:'@responsive'},async({page},info)=>{
  await mockGanttData(page);
  const rows=[
    ...(['analysis','development','integration','testing'] as const).map(workStage=>({...requirement,id:workStage,title:workStage,progress:99,workItems:[{...workItem,id:workStage+'-work',workStage,progress:70}]})),
    {...requirement,id:'parallel',title:'并行推进',workItems:[{...workItem,id:'dev',workStage:'development' as const,progress:40},{...workItem,id:'test',workStage:'testing' as const,progress:70}]},
    {...requirement,id:'submitted',title:'已提测需求',workItems:[],executionStage:{key:'test_submitted',label:'已提测',tone:'submitted',stages:[],currentWork:[]}},
  ];
  await mockGanttReport(page,()=>rows);await page.goto('/execution');await page.getByRole('button',{name:'展开全部',exact:true}).click();
  const reqRows=page.locator('.workspace-gantt-row.kind-requirement'),testing=reqRows.filter({has:page.getByRole('button',{name:'testing',exact:true})});
  await expect(testing.locator('.gantt-progress-text')).toContainText('测试');await expect(testing.locator('.gantt-progress-value')).toHaveText('70%');await expect(testing).not.toContainText('99%');
  await expect(page.locator('[data-row-id="parallel"] .gantt-progress-text')).toContainText('开发');await expect(page.locator('[data-row-id="parallel"] .gantt-progress-text')).toContainText('测试');
  await expect(page.locator('[data-row-id="submitted"] .gantt-progress-text')).toContainText('已提测');
  for(const skin of skins){
    await changeSkin(page,skin);const blue=['midnight','dcim'].includes(skin)?'rgb(120, 153, 188)':'rgb(68, 107, 145)';
    await expect(reqRows.locator('.gantt-date-actual')).toHaveCount(rows.length);
    // Filled stage tracks and unfilled parallel tracks use the same running color.
    for(const r of await reqRows.all()){
      const fill=r.locator('.gantt-completion-fill');await expect(await fill.count()?fill:r.locator('.gantt-date-actual')).toHaveCSS('background-color',blue);
    }
    await expect(testing.locator('.gantt-progress-value')).toHaveCSS('color',blue);
  }
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('stages-mobile.png'),fullPage:true});
});
