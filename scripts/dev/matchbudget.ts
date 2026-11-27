/**
 * The network budget of a quick match (M43): four players in a region room (in this process, on a
 * clock this script moves), each city grown by the careful mayor on the fast start, sending what a
 * match page sends: a report every 5 s, its picture every 60 s, a save to look round every 5 minutes,
 * and its last report at the end. Prints each player's messages and bytes sent and received per
 * minute and for the whole match, and what a match costs a Durable Object against Cloudflare's free
 * plan (requests, duration, rows written).
 *
 *   npx tsx scripts/dev/matchbudget.ts [minutes=20] [players=4] [thumbChars=14000]
 *
 * The picture is a stand-in of the given size: the game's is a 192×120 JPEG at quality 0.6, about
 * 6–12 kB, so 14,000 characters of base64 is on the heavy side.
 */
import { MemoryRegionStore, RegionRoom, type RegionConn } from '../../relay/region';
import { PROTOCOL_VERSION } from '../../relay/protocol';
import { MATCH, defaultMatch } from '../../src/data/match';
import { matchOptions } from '../../src/client/matchBoot';
import { Sim } from '../../src/sim/sim';
import { regionReport } from '../../src/sim/systems/region';
import { encodeSnapshot } from '../../src/net/snapshot';
import { SPEED_TICKS_PER_SECOND, TICKS_PER_HOUR } from '../../src/sim/time';
import { Player } from '../lib/mayor';
import { FakeClock } from '../../relay/tests/harness';

const minutes = Number(process.argv[2] ?? 20);
const count = Number(process.argv[3] ?? 4);
const thumbChars = Number(process.argv[4] ?? 14_000);
const TPS = SPEED_TICKS_PER_SECOND[MATCH.speed];

const clock = new FakeClock();
const store = new MemoryRegionStore();
const room = new RegionRoom('7BUDGT', 'online', store, clock);
const settings = { ...defaultMatch('mbudget'), mode: 'mixed' as const, minutes };
const thumb = `data:image/jpeg;base64,${'A'.repeat(thumbChars)}`;

interface P {
  name: string;
  conn: RegionConn;
  slot: number;
  mayor: Player;
  sent: { messages: number; bytes: number };
  got: { messages: number; bytes: number };
}
const players: P[] = [];
let incoming = 0;
for (let k = 0; k < count; k++) {
  const sim = Sim.create(matchOptions(settings, `City${k + 1}`));
  const p: P = {
    name: `City${k + 1}`,
    conn: null as unknown as RegionConn,
    slot: 0,
    mayor: new Player('careful', sim),
    sent: { messages: 0, bytes: 0 },
    got: { messages: 0, bytes: 0 },
  };
  p.conn = {
    send: (m) => {
      p.got.messages++;
      p.got.bytes += JSON.stringify(m).length;
      if (m.t === 'rwelcome') p.slot = m.slot;
    },
    close: () => undefined,
  };
  players.push(p);
}
const say = (p: P, m: object) => {
  const t = JSON.stringify(m);
  p.sent.messages++;
  p.sent.bytes += t.length;
  incoming++;
  room.message(p.conn, t);
};
const report = (p: P, extra: object = {}, withThumb = false) => {
  const r = regionReport(p.mayor.sim);
  say(p, {
    t: 'report',
    city: p.name,
    report: { ...r, match: { ...r.match!, round: 1, ...extra } },
    ...(withThumb ? { thumb } : {}),
  });
};
const save = (p: P) => {
  const { parts } = encodeSnapshot(
    { save: p.mayor.sim.save('now'), history: [], seq: -1, eventHash: 0 },
    `${p.slot}`,
  );
  const id = `${p.slot}-${clock.now()}`;
  parts.forEach((data, part) => say(p, { t: 'save', id, part, parts: parts.length, data }));
};

for (const [k, p] of players.entries()) {
  room.open(p.conn);
  say(p, {
    t: 'rhello',
    v: PROTOCOL_VERSION,
    mayor: `Mayor${k + 1}`,
    color: k,
    city: p.name,
    ...(k === 0 ? { create: { name: 'Quick match', match: settings } } : {}),
  });
  // The page's first report comes with its picture and a save (as on joining).
  report(p, {}, true);
  save(p);
  say(p, { t: 'mready', round: 1 });
}
const base = { incoming, rows: store.rowsWritten };
for (const p of players) p.sent = { messages: 0, bytes: 0 };
for (const p of players) p.got = { messages: 0, bytes: 0 };
say(players[0]!, { t: 'mstart' });
clock.advance(MATCH.countdownMs);
const step = MATCH.reportMs;
const end = minutes * 60_000;
for (let t = step; t <= end; t += step) {
  clock.advance(step);
  for (const p of players) {
    const target = Math.floor((t * TPS) / 1000);
    while (p.mayor.sim.state.tick < target) {
      if (p.mayor.sim.state.tick % (TICKS_PER_HOUR * 6) === 0) p.mayor.play();
      p.mayor.sim.advance(Math.min(TICKS_PER_HOUR, target - p.mayor.sim.state.tick));
    }
    const last = t === end;
    report(p, last ? { final: true, hash: p.mayor.sim.hash() } : {}, t % MATCH.thumbMs === 0 || last);
    if (t % MATCH.saveMs === 0 || last) save(p);
  }
}
room.poke();
const m = room.record()!.match!;
const perMin = (v: number) => Math.round(v / minutes);
console.log(
  `${count} players, a ${minutes}-minute match (${settings.mode}), phase ${m.phase}, winner slot ${m.result?.winner}`,
);
for (const p of players)
  console.log(
    `  ${p.name} (${p.mayor.sim.state.totals.population} residents): sent ${perMin(p.sent.messages)} msgs/min, ${perMin(p.sent.bytes)} B/min (${Math.round(p.sent.bytes / 1024)} kB in all); received ${perMin(p.got.messages)} msgs/min, ${perMin(p.got.bytes)} B/min (${Math.round(p.got.bytes / 1024)} kB in all)`,
  );
const messages = incoming - base.incoming;
const rows = store.rowsWritten - base.rows;
const gbs = (minutes * 60 + MATCH.countdownMs / 1000 + MATCH.finalWaitMs / 1000) * 0.125;
console.log(`One match against the free plan's day:`);
console.log(`  requests: ${messages} incoming messages = ${Math.round(messages / 20)} requests (of 100,000)`);
console.log(`  duration: at most ${gbs} GB-s awake (of 13,000: ${((gbs / 13_000) * 100).toFixed(1)} %)`);
console.log(`  rows written: ${rows} (of 100,000; the region's own day allows ${3000})`);
console.log(
  `  matches a day within the free plan: about ${Math.floor(13_000 / gbs)} (duration is the limit)`,
);
process.exit(0);
