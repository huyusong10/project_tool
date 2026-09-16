import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import postcss from 'postcss';

/** Keep lazy-loaded page styles below the shared presets in the CSS cascade. */
export function checkButtonStyles(source, file) {
  const errors = [], root = postcss.parse(source, {from: file});
  const presets = file.replaceAll('\\', '/').endsWith('/components/button.css');
  for (const node of root.nodes) {
    if (node.type === 'comment') continue;
    if (node.type === 'atrule' && node.name === 'layer' && (node.params === 'application, controls' || node.params === (presets ? 'controls' : 'application'))) continue;
    if (node.type === 'atrule' && node.name === 'import' && /layer\(application\)/.test(node.params)) continue;
    errors.push(`${file}:${node.source.start.line} 样式必须放入 application 层；公共按钮由 controls 层管理。`);
  }
  if (!presets) {
    root.walkAtRules('layer', rule => { if (rule.nodes && rule.params !== 'application') errors.push(`${file} 页面不能定义控件层。`); });
    root.walkDecls(decl => {
      if (decl.prop.startsWith('--button-') || decl.parent.selector?.includes('.ui-button')) errors.push(`${file}:${decl.source.start.line} 请在 Button 预设中定义控件样式。`);
      if (decl.important && /button|work-next-action|inline-action/.test(decl.parent.selector || '') && /^(color|background|border|font|padding|width|height|min-|max-|box-shadow|filter|transform)/.test(decl.prop)) errors.push(`${file}:${decl.source.start.line} 按钮不能用 !important 覆盖预设。`);
    });
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = dir => fs.readdirSync(dir, {withFileTypes:true}).flatMap(entry => entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
  const errors = files('src/client').filter(file => file.endsWith('.css')).flatMap(file => checkButtonStyles(fs.readFileSync(file, 'utf8'), file));
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log('按钮预设与样式层检查通过');
}
