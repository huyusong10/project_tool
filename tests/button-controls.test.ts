import { describe, expect, it } from 'vitest';
import { Linter } from 'eslint';
import parser from '@typescript-eslint/parser';
// @ts-expect-error Local lint scripts are JavaScript modules.
import buttons from '../scripts/button-controls-rule.mjs';
// @ts-expect-error Local lint scripts are JavaScript modules.
import { checkButtonStyles } from '../scripts/check-button-styles.mjs';

describe('公共按钮约束', () => {
  const lint = (source: string) => new Linter().verify(source, [{files:['**/*.tsx'], languageOptions:{parser, parserOptions:{ecmaFeatures:{jsx:true}}}, plugins:{controls:{rules:{buttons}}}, rules:{'controls/buttons':'error'}}], {filename:'NewPage.tsx'});
  it('新操作必须选用公共组件，不能用原生按钮或行内样式另配一套颜色', () => {
    expect(lint('<button onClick={save}>保存</button>')).toHaveLength(1);
    expect(lint('<Link className="ghost-button" to="/">返回</Link>')).toHaveLength(1);
    expect(lint('<Button style={{color:"red"}}>保存</Button>')).toHaveLength(1);
    expect(lint('<Button data-tone="red">保存</Button>')).toHaveLength(1);
    expect(lint('<Button variant="soft" tone="success" size="small">完成</Button>')).toHaveLength(0);
    expect(lint('<button role="option" aria-selected={true}>人员选项</button>')).toHaveLength(0);
  });
  it('页面及异步加载的 CSS 不能覆盖公共预设', () => {
    const file='src/client/page.css';
    expect(checkButtonStyles('@layer application, controls; @layer application {.row {gap:8px}}',file)).toEqual([]);
    expect(checkButtonStyles('.row button {color:red}',file).length).toBeGreaterThan(0);
    expect(checkButtonStyles('@layer application {.ui-button {background:red}}',file).length).toBeGreaterThan(0);
    expect(checkButtonStyles('@layer application {.row {--button-bg:red}}',file).length).toBeGreaterThan(0);
    expect(checkButtonStyles('@layer application {.row button {height:100px!important}}',file).length).toBeGreaterThan(0);
    expect(checkButtonStyles('@layer controls {.row button {color:red}}',file).length).toBeGreaterThan(0);
  });
  it('只有应用清单可以按顺序导入本地分层样式', () => {
    const source="@layer application, controls; @import './features/issues/workspace.css';";
    expect(checkButtonStyles(source,'src/client/styles.css')).toEqual([]);
    expect(checkButtonStyles(source,'src/client/page.css').length).toBeGreaterThan(0);
    expect(checkButtonStyles("@import 'https://example.com/style.css';",'src/client/styles.css').length).toBeGreaterThan(0);
    expect(checkButtonStyles("@import '../outside.css';",'src/client/styles.css').length).toBeGreaterThan(0);
    expect(checkButtonStyles('@layer controls {.row {color:red}}','src/client/features/issues/workspace.css').length).toBeGreaterThan(0);
  });
});
