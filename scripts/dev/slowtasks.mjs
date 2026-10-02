// Dev: the slowest main-thread tasks in a .cpuprofile (as written by `framebench.mjs --profile`),
// each with the functions that took the time. Usage: node scripts/dev/slowtasks.mjs file.cpuprofile [n]
import { readFileSync } from 'node:fs';

const prof = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const top = Number(process.argv[3] ?? 5);
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const name = (n) => {
  const f = n.callFrame;
  const file = (f.url || '')
    .split('/')
    .pop()
    .replace(/-[\w-]{8}\.js$/, '.js');
  return `${f.functionName || '(anon)'} ${file}:${f.lineNumber + 1}:${f.columnNumber + 1}`;
};
const idle = (n) => ['(idle)', '(program)', '(root)'].includes(n.callFrame.functionName);
// A task: a run of samples that aren't idle.
const tasks = [];
let cur = null;
for (let i = 0; i < prof.samples.length; i++) {
  const n = byId.get(prof.samples[i]);
  const dt = (prof.timeDeltas[i + 1] ?? 0) / 1000;
  if (!n || idle(n)) {
    cur = null;
    continue;
  }
  if (!cur) tasks.push((cur = { ms: 0, self: new Map(), total: new Map() }));
  cur.ms += dt;
  cur.self.set(name(n), (cur.self.get(name(n)) ?? 0) + dt);
  const seen = new Set();
  for (let id = n.id; id !== undefined; id = parent.get(id)) {
    const k = name(byId.get(id));
    if (seen.has(k)) continue;
    seen.add(k);
    cur.total.set(k, (cur.total.get(k) ?? 0) + dt);
  }
}
tasks.sort((a, b) => b.ms - a.ms);
console.log(`${tasks.length} tasks; the slowest ${top}:`);
for (const t of tasks.slice(0, top)) {
  console.log(`\n${t.ms.toFixed(1)} ms`);
  console.log(
    '  self:  ' +
      [...t.self]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([k, v]) => `${v.toFixed(1)} ${k}`)
        .join(' | '),
  );
  console.log(
    '  total: ' +
      [...t.total]
        .sort((a, b) => b[1] - a[1])
        .slice(1, 12)
        .map(([k, v]) => `${v.toFixed(1)} ${k}`)
        .join(' | '),
  );
}
