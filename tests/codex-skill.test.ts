import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterAll, expect, it } from 'vitest';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-skill-'));
const source = fileURLToPath(new URL('../skills/project-manage-intake', import.meta.url));
const script = fileURLToPath(new URL('../scripts/sync-codex-skill.mjs', import.meta.url));
const name = 'project-manage-intake';
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));

function run(codexHome: string, cwd = directory) {
  return spawnSync(process.execPath, [script], { cwd, encoding: 'utf8', env: { ...process.env, CODEX_HOME: codexHome } });
}
function contents(root: string, prefix = ''): Record<string, string> {
  return Object.assign({}, ...fs.readdirSync(path.join(root, prefix), { withFileTypes: true }).map(entry => {
    const relative = path.join(prefix, entry.name);
    return entry.isDirectory() ? contents(root, relative) : { [relative]: fs.readFileSync(path.join(root, relative)).toString('base64') };
  }));
}

it('使用 CODEX_HOME 完整安装并刷新技能，清理过期资源且保留其他技能', () => {
  const codexHome = path.join(directory, 'Codex 中文目录');
  const installed = path.join(codexHome, 'skills', name);
  const sibling = path.join(codexHome, 'skills', 'another-skill', 'SKILL.md');
  fs.mkdirSync(path.dirname(sibling), { recursive: true });
  fs.writeFileSync(sibling, 'Keep this skill');
  const first = run(codexHome);
  expect(first.status, first.stderr).toBe(0);
  expect(JSON.parse(first.stdout).destination).toBe(installed);
  expect(contents(installed)).toEqual(contents(source));

  fs.writeFileSync(path.join(installed, 'SKILL.md'), 'Previous software version');
  fs.mkdirSync(path.join(installed, 'obsolete'));
  fs.writeFileSync(path.join(installed, 'obsolete', 'old.md'), 'Removed resource');
  // Windows cannot remove a directory in use as a process working directory.
  const refreshed = run(codexHome, installed);
  expect(refreshed.status, refreshed.stderr).toBe(0);
  expect(contents(installed)).toEqual(contents(source));
  expect(fs.readFileSync(sibling, 'utf8')).toBe('Keep this skill');
  expect(fs.readdirSync(path.join(codexHome, 'skills')).sort()).toEqual(['another-skill', name]);
});

it('目标是普通文件时明确失败并保留原文件', () => {
  const codexHome = path.join(directory, 'invalid-destination');
  const target = path.join(codexHome, 'skills', name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'Do not replace a non-directory');
  expect(run(codexHome).status).not.toBe(0);
  expect(fs.readFileSync(target, 'utf8')).toBe('Do not replace a non-directory');
});
