import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const repository = fileURLToPath(new URL('..', import.meta.url));
const linkedWorktree = fs.statSync(path.join(repository, '.git'), { throwIfNoEntry: false })?.isFile();
// Inherited CODEX_HOME must never implicitly opt a linked worktree into global installation.
if (process.env.SKIP_CODEX_SKILL_SYNC === '1' || (linkedWorktree && process.env.ALLOW_CODEX_SKILL_SYNC !== '1')) {
  console.log('Codex skill sync skipped (disabled or linked worktree).');
  process.exit(0);
}

const name = 'project-manage-intake';
const source = fs.realpathSync(fileURLToPath(new URL(`../skills/${name}`, import.meta.url)));
const codexHome = path.resolve(process.env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex'));
const skills = path.join(codexHome, 'skills');

function filesIn(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) return filesIn(path.join(directory, entry.name), relative);
    if (!entry.isFile()) throw new Error(`Skill contains a non-regular file: ${relative}`);
    return [relative];
  });
}

function contains(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

const files = filesIn(source);
if (!files.includes('SKILL.md')) throw new Error('Skill source is missing SKILL.md');
fs.mkdirSync(skills, { recursive: true });
// Resolve the parent before replacing this one managed skill; never delete the skills directory.
const destination = path.join(fs.realpathSync(skills), name);
if (contains(source, destination) || contains(destination, source)) throw new Error('Skill source and destination overlap');
const existing = fs.lstatSync(destination, { throwIfNoEntry: false });
if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new Error(`Skill destination must be a regular directory: ${destination}`);

// Keep the directory open Codex sessions may be watching or using as their cwd on Windows.
// Reject nested links before writing, so copying never follows them outside this skill.
if (existing) filesIn(destination);
function syncDirectory(from, to) {
  fs.mkdirSync(to, { recursive: true });
  const entries = fs.readdirSync(from, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) syncDirectory(path.join(from, entry.name), target);
    else fs.copyFileSync(path.join(from, entry.name), target);
  }
  const names = new Set(entries.map(entry => entry.name));
  for (const entry of fs.readdirSync(to)) {
    if (!names.has(entry)) fs.rmSync(path.join(to, entry), { recursive: true, force: true });
  }
}
syncDirectory(source, destination);
for (const file of files) {
  if (!fs.readFileSync(path.join(source, file)).equals(fs.readFileSync(path.join(destination, file)))) throw new Error(`Installed skill differs: ${file}`);
}
const sha256 = createHash('sha256').update(fs.readFileSync(path.join(destination, 'SKILL.md'))).digest('hex');
console.log(JSON.stringify({ skill: name, destination, files: files.length, sha256 }, null, 2));
