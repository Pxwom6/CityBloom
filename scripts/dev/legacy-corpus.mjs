// Build the legacy save corpus (Phase 2 review): for each save version from M12 on, check out the
// commit that last wrote it in a worktree, grow a small town on each map preset with that commit's
// own balance mayor, and keep the save in Saves/legacy/v<version>-<preset>.citybloom.
//
// Usage: node scripts/dev/legacy-corpus.mjs [versions, e.g. 10,15] [--jobs 3]
// The only change made to the old code is the map preset the mayor founds its city on (it was
// hard-wired to the river map); towns grow for a different length on each preset so their saves
// land in different months of the year.
import { execFileSync, spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const COMMITS = {
  10: 'ef6815c', // M12 complete
  11: 'b55076e', // after the playtest fixes, before M13
  12: '636c3b0', // M13 complete
  13: '621a709', // M14 complete
  14: 'c1f3f6d', // M16 complete
  15: 'a0349e4', // M17 complete
  16: 'c3d7b31', // M18 complete
  17: '8933090', // M19 complete
  18: '05a3b31', // M20 complete
  19: '1fb178b', // M21 complete
  20: '211d441', // M22 complete
  21: '859dc11', // M23 (v21, the last commit before v22)
};
/** Years each preset's town grows (ending in different seasons). */
const PRESETS = { river: 2, coast: 1.5, lakes: 1.75, highlands: 1.25 };

const args = process.argv.slice(2);
const jobsAt = args.indexOf('--jobs');
const jobs = jobsAt >= 0 ? Number(args.splice(jobsAt, 2)[1]) : 3;
const versions = args[0] ? args[0].split(',').map(Number) : Object.keys(COMMITS).map(Number);
const out = join(ROOT, 'Saves/legacy');
mkdirSync(out, { recursive: true });
const base = join(tmpdir(), 'citybloom-legacy');
mkdirSync(base, { recursive: true });

const tasks = [];
for (const v of versions) {
  const commit = COMMITS[v];
  const dir = join(base, `v${v}`);
  if (!existsSync(dir)) {
    execFileSync('git', ['worktree', 'add', '-f', dir, commit], { cwd: ROOT, stdio: 'ignore' });
    symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
    // The preset, from the environment.
    for (const f of ['scripts/balance.ts', 'scripts/lib/mayor.ts']) {
      const p = join(dir, f);
      if (!existsSync(p)) continue;
      const s = readFileSync(p, 'utf8')
        .replace("preset: 'river'", "preset: (process.env.PRESET ?? 'river') as 'river'")
        .replace(
          "preset: city.preset ?? 'river'",
          "preset: city.preset ?? ((process.env.PRESET ?? 'river') as 'river')",
        );
      writeFileSync(p, s);
    }
  }
  for (const [preset, years] of Object.entries(PRESETS)) tasks.push({ v, dir, preset, years });
}

const run = ({ v, dir, preset, years }) =>
  new Promise((done) => {
    const saves = join(dir, 'out', preset);
    const t0 = Date.now();
    const child = spawn(
      'npx',
      ['tsx', 'scripts/balance.ts', String(years), 'careful', '--seed', `legacy-${preset}`, '--save', saves],
      { cwd: dir, env: { ...process.env, PRESET: preset }, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let log = '';
    child.stdout.on('data', (d) => (log += d));
    child.stderr.on('data', (d) => (log += d));
    child.on('close', (code) => {
      const file = join(saves, 'careful.citybloom');
      const dest = join(out, `v${String(v).padStart(2, '0')}-${preset}.citybloom`);
      if (code === 0 && existsSync(file)) {
        copyFileSync(file, dest);
        const last = log
          .trim()
          .split('\n')
          .find((l) => /^ +\d+ +[\d,]+/.test(l) && l.trim().startsWith(String(Math.ceil(years))));
        console.log(
          `v${v} ${preset}: ${((Date.now() - t0) / 1000).toFixed(0)} s ${last?.trim().split(/ +/).slice(0, 3).join(' ') ?? ''}`,
        );
      } else console.log(`v${v} ${preset}: FAILED (${code})\n${log.slice(-800)}`);
      done();
    });
  });

const queue = [...tasks];
await Promise.all(
  Array.from({ length: jobs }, async () => {
    for (let t = queue.shift(); t; t = queue.shift()) await run(t);
  }),
);
for (const v of versions) {
  execFileSync('git', ['worktree', 'remove', '--force', join(base, `v${v}`)], { cwd: ROOT, stdio: 'ignore' });
}
rmSync(base, { recursive: true, force: true });
