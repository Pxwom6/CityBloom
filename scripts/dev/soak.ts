/**
 * The multiplayer soak (M33): four headless players in one online room on the local relay, in real
 * time at mixed speeds, for as long as asked (two hours for the milestone). They build as they go;
 * now and then someone's connection drops, someone leaves and comes back, the speed changes, and
 * once a deliberate desync is made. Every resync is logged with what caused it: any that wasn't the
 * deliberate one fails the soak. At the end every game is paused and compared part by part.
 *
 *   npx tsx scripts/dev/soak.ts [minutes] [--log file]
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { startRelay } from '../../relay/local';
import { webSocketLink } from '../../src/net/link';
import { HeadlessDriver } from '../../src/net/driver';
import { RoomSession } from '../../src/net/session';
import { Sim } from '../../src/sim/sim';
import { simDesync } from '../../src/sim/sync';
import { Rng } from '../../src/sim/rng';
import { buildTown, serveTown } from '../../tests/helpers';
import type { Command } from '../../src/sim/commands';
import type { Speed } from '../../relay/protocol';

const minutes = Number(process.argv[2] ?? 120);
/** SOAK_FAST=1: every event ten times as often (a quick check of the soak itself). */
const K = process.env.SOAK_FAST ? 0.1 : 1;
const logAt = process.argv.includes('--log')
  ? process.argv[process.argv.indexOf('--log') + 1]!
  : 'bench-results/soak.log';
writeFileSync(logAt, '');
const t0 = Date.now();
const log = (s: string) => {
  const line = `[${((Date.now() - t0) / 60_000).toFixed(1)} min] ${s}`;
  console.log(line);
  appendFileSync(logAt, `${line}\n`);
};

const relay = await startRelay(8798);
const code = '3SQAKW';
const url = `ws://127.0.0.1:8798/room/${code}`;
const rng = Rng.fromSeed('soak');
const sim = Sim.create({ seed: 'soak', preset: 'river', cityName: 'Soakworth' });
buildTown(sim, { length: 600, streets: 5 });
serveTown(sim);

interface P {
  name: string;
  d: HeadlessDriver;
  s: RoomSession;
  away: boolean;
}
const players: P[] = [];
let deliberate = 0;
let unexplained = 0;
const join = async (name: string, i: number, create = false): Promise<P> => {
  const d = new HeadlessDriver(create ? sim : Sim.create({ seed: 'x' }), 25, 50);
  const prev = players.find((p) => p.name === name);
  const s = new RoomSession(d, () => webSocketLink(url), {
    name,
    color: i,
    ...(create ? { create: { cityName: 'Soakworth' } } : {}),
    ...(prev?.s.credentials ? { rejoin: prev.s.credentials } : {}),
  });
  // Ada (who never leaves) hears of every resync once.
  s.onNotice = (n) => {
    if (name === 'Ada' && /fell out of step/.test(n.text)) {
      const who = n.text.split("'")[0];
      if (deliberate > 0 && who === 'Kit') {
        deliberate--;
        log(`resync (deliberate): ${n.text}`);
      } else if (n.text.startsWith('Your game')) {
        /* the same event, from the player's side */
      } else {
        unexplained++;
        log(`UNEXPLAINED resync: ${n.text}`);
      }
    }
  };
  await s.start();
  const p = { name, d, s, away: false };
  const at = players.findIndex((x) => x.name === name);
  if (at >= 0) players[at] = p;
  else players.push(p);
  return p;
};

await join('Ada', 0, true);
for (const [i, n] of ['Sam', 'Kit', 'Lou'].entries()) await join(n, i + 1);
log('four players in the room');
players[0]!.s.setSpeed(2);

const n = sim.state.net.nodes.get(sim.state.highway.connect)!;
let built = 0;
const act = (): Command => {
  const k = rng.int(5);
  const z = n.z - 250 - rng.int(30) * 12;
  const x = n.x + 40 + rng.int(40) * 12;
  if (k === 0)
    return {
      type: 'zone',
      zone: (['R', 'C', 'I'] as const)[rng.int(3)]!,
      area: { kind: 'brush', points: [{ x, z }], radius: 25 },
    };
  if (k === 1) return { type: 'setTax', zone: 'R', wealth: 'all', rate: 0.08 + rng.int(5) / 100 };
  if (k === 2)
    return {
      type: 'buildRoad',
      road: 'street',
      points: [
        { x, z },
        { x: x + 120, z },
      ],
    };
  if (k === 3) return { type: 'setFunding', dept: 'police', pct: 90 + rng.int(20) };
  return { type: 'undo' };
};

const end = Date.now() + minutes * 60_000;
const next = {
  act: Date.now() + 3000,
  drop: Date.now() + 4 * 60_000 * K,
  leave: Date.now() + 9 * 60_000 * K,
  speed: Date.now() + 6 * 60_000 * K,
  desync: Date.now() + 15 * 60_000 * K,
  report: Date.now() + 60_000 * K,
};
while (Date.now() < end) {
  await new Promise((r) => setTimeout(r, 500));
  const now = Date.now();
  const here = players.filter((p) => !p.away && p.s.state === 'playing');
  if (now > next.act && here.length) {
    const p = here[rng.int(here.length)]!;
    void p.s.command(act()).then((r) => r.ok && built++);
    next.act = now + 1500 + rng.int(4000);
  }
  if (now > next.drop && here.length > 1) {
    const p = here[1 + rng.int(here.length - 1)]!;
    log(`${p.name}'s connection drops`);
    p.s.dropForTest();
    next.drop = now + 5 * 60_000 * K + rng.int(4 * 60_000 * K);
  }
  if (now > next.leave) {
    const p = players[1 + rng.int(players.length - 1)]!;
    if (!p.away) {
      log(`${p.name} leaves`);
      p.away = true;
      p.s.leave();
      p.d.stop();
      setTimeout(
        () => {
          log(`${p.name} comes back`);
          void join(p.name, players.indexOf(p)).catch((e: unknown) =>
            log(`${p.name} couldn't come back: ${String(e)}`),
          );
        },
        (60_000 + rng.int(120_000)) * K,
      );
    }
    next.leave = now + 12 * 60_000 * K + rng.int(6 * 60_000 * K);
  }
  if (now > next.speed) {
    const sp = ([1, 2, 3, 3, 2, 0] as Speed[])[rng.int(6)]!;
    here[rng.int(here.length)]?.s.setSpeed(sp === 0 ? 1 : sp);
    next.speed = now + 4 * 60_000 * K + rng.int(4 * 60_000 * K);
  }
  if (now > next.desync) {
    const kit = players.find((p) => p.name === 'Kit' && !p.away);
    if (kit) {
      log('Kit’s game is knocked out of step (deliberately)');
      deliberate++;
      kit.d.sim.rng.growth.next();
    }
    next.desync = now + 40 * 60_000 * K;
  }
  if (now > next.report) {
    const ticks = players.map((p) => `${p.name}:${p.away ? 'away' : `${p.d.tick}/${p.s.state}`}`).join(' ');
    log(
      `city tick ${players[0]!.d.tick}, pop ${players[0]!.d.sim.state.totals.population}, ${built} commands applied; ${ticks}`,
    );
    next.report = now + 5 * 60_000 * K;
  }
}
// Pause, let everyone settle, and compare.
players[0]!.s.setSpeed(0);
for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const t = players[0]!.d.tick;
  if (i > 4 && players.every((p) => p.away || p.d.tick === t)) break;
}
const ref = players[0]!;
let mismatched = 0;
for (const p of players.slice(1)) {
  if (p.away) continue;
  const r = simDesync(ref.d.sim, p.d.sim);
  if (r.part) mismatched++;
  log(`${p.name} against Ada at tick ${p.d.tick}/${ref.d.tick}: ${r.text}`);
}
log(
  `soak over: ${unexplained} unexplained resyncs, ${mismatched} mismatched at the end, ${built} commands applied`,
);
for (const p of players) {
  p.s.leave();
  p.d.stop();
}
await relay.close();
process.exit(unexplained || mismatched ? 1 : 0);
