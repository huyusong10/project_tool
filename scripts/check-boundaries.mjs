import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
  ? walk(path.join(dir, entry.name)) : /\.tsx?$/.test(entry.name) ? [path.join(dir, entry.name).replaceAll('\\', '/')] : []);
const files = walk('src'), known = new Set(files), graph = new Map(), violations = [];
for (const file of files) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const edges = [];
  for (const node of source.statements) {
    if (!(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) || !node.moduleSpecifier) continue;
    if (node.isTypeOnly || node.importClause?.isTypeOnly) continue;
    const bindings = node.importClause?.namedBindings ?? node.exportClause;
    if (bindings?.elements?.length && bindings.elements.every(item => item.isTypeOnly) && !node.importClause?.name) continue;
    const specifier = node.moduleSpecifier.text;
    if (!specifier.startsWith('.')) continue;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
    const target = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(candidate => known.has(candidate));
    if (!target) continue;
    edges.push(target);
    if (file.startsWith('src/shared/') && !target.startsWith('src/shared/')) violations.push(`${file} imports ${target}`);
    if (file.startsWith('src/server/services/') && ['src/server/services.ts','src/server/routes.ts','src/server/mcp.ts','src/server/database.ts'].includes(target)) violations.push(`${file} imports entry point ${target}`);
  }
  graph.set(file, edges);
}
let index = 0;
const indices = new Map(), lows = new Map(), stack = [], active = new Set(), cycles = [];
function visit(file) {
  indices.set(file, index); lows.set(file, index++); stack.push(file); active.add(file);
  for (const target of graph.get(file) || []) {
    if (!indices.has(target)) { visit(target); lows.set(file, Math.min(lows.get(file), lows.get(target))); }
    else if (active.has(target)) lows.set(file, Math.min(lows.get(file), indices.get(target)));
  }
  if (lows.get(file) !== indices.get(file)) return;
  const members = []; let member;
  do { member = stack.pop(); active.delete(member); members.push(member); } while (member !== file);
  if (members.length > 1) cycles.push(members.sort());
}
files.forEach(file => { if (!indices.has(file)) visit(file); });
const selected = process.argv.includes('--server') ? cycles.filter(c => c.some(f => f.startsWith('src/server/'))) : cycles;
if (selected.length || violations.length) {
  for (const cycle of selected) console.error(`Dependency cycle: ${cycle.join(' -> ')}`);
  for (const violation of violations) console.error(violation);
  process.exitCode = 1;
} else console.log(`Dependency boundaries passed (${files.length} modules${process.argv.includes('--server') ? ', server cycles' : ''}).`);
