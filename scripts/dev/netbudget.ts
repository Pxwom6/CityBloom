/**
 * The network budget and the free-plan cost of shared cities (M30): four headless players in one
 * room, in real time at a chosen speed, each building something every so often, through the local
 * relay's real sockets. Prints messages and bytes per player per minute, and what an hour of such
 * play costs against Cloudflare's free-plan limits (requests, duration, rows read and written). Rows
 * are counted as the room's store counts them: a row per batch of events (F8), each record and
 * snapshot part, and the batches a snapshot deletes.
 *
 *   npx tsx scripts/dev/netbudget.ts [minutes] [speed] [players]
 */
import { startRelay } from '../../relay/local';
import { MemoryStore } from '../../relay/room';
import { webSocketLink } from '../../src/net/link';
import { HeadlessDriver } from '../../src/net/driver';
import { RoomSession } from '../../src/net/session';
import { Sim } from '../../src/sim/sim';
import { buildTown, serveTown } from '../../tests/helpers';
import type { Speed } from '../../relay/protocol';

const minutes = Number(process.argv[2] ?? 2);
const speed = Number(process.argv[3] ?? 3) as Speed;
const count = Number(process.argv[4] ?? 4);

const relay = await startRelay(0);
const code = 'B2DGET';
const url = `ws://localhost:${relay.port}/room/${code}`;
const sim = Sim.create({ seed: 'budget', preset: 'river', cityName: 'Budgetby' });
buildTown(sim, { zone: true });
serveTown(sim);

const players: { s: RoomSession; d: HeadlessDriver }[] = [];
for (let i = 0; i < count; i++) {
  const d = new HeadlessDriver(i === 0 ? sim : Sim.create({ seed: 'x' }));
  const s = new RoomSession(d, () => webSocketLink(url), {
    name: `P${i + 1}`,
    color: i,
    ...(i === 0 ? { create: { cityName: 'Budgetby' } } : {}),
  });
  await s.start();
  players.push({ s, d });
}
const room = relay.rooms.get(code)!;
const store = (room as unknown as { store: MemoryStore }).store;
const base = { received: room.received, written: store.rowsWritten, read: store.rowsRead };
for (const p of players) {
  p.s.sent = { messages: 0, bytes: 0 };
  p.s.received = { messages: 0, bytes: 0 };
}
players[0]!.s.setSpeed(speed);
const t0 = Date.now();
const n = sim.state.net.nodes.get(sim.state.highway.connect)!;
// A busy co-op city: every player does something about every 15 s (zoning, a road, a tax change).
let k = 0;
const busy = setInterval(() => {
  const p = players[k % count]!;
  const dz = -200 - 12 * (k % 20);
  const cmds = [
    {
      type: 'zone',
      zone: 'R',
      area: {
        kind: 'brush',
        points: [
          { x: n.x + 20, z: n.z + dz },
          { x: n.x + 300, z: n.z + dz },
        ],
        radius: 10,
      },
    },
    { type: 'setTax', zone: 'C', wealth: 'all', rate: 0.09 + 0.001 * (k % 5) },
    { type: 'setFunding', dept: 'fire', pct: 100 + (k % 3) },
  ] as const;
  void p.s.command(cmds[k % cmds.length] as never);
  k++;
}, 15_000 / count);
await new Promise((r) => setTimeout(r, minutes * 60_000));
clearInterval(busy);
// Events still waiting for their batch count too.
room.flush();
const mins = (Date.now() - t0) / 60_000;
const perMin = (v: number) => Math.round(v / mins);
console.log(`${count} players, ${mins.toFixed(1)} min at speed ${speed}, city at tick ${players[0]!.d.tick}`);
for (const p of players)
  console.log(
    `  ${p.s.me?.name}: sent ${perMin(p.s.sent.messages)} msgs/min (${perMin(p.s.sent.bytes)} B/min), received ${perMin(p.s.received.messages)} msgs/min (${perMin(p.s.received.bytes)} B/min)`,
  );
const incoming = room.received - base.received;
const perHour = (v: number) => Math.round((v / mins) * 60);
const requests = perHour(incoming) / 20;
const gbs = 3600 * 0.125; // awake the whole hour (messages never stop), at 128 MB
console.log(`An hour of this play against the free plan (per day):`);
console.log(
  `  requests: ${perHour(incoming)} incoming messages = ${Math.round(requests)} requests (of 100,000: ${((requests / 100_000) * 100).toFixed(1)} %)`,
);
console.log(`  duration: at most ${gbs} GB-s (of 13,000: ${((gbs / 13_000) * 100).toFixed(1)} %)`);
console.log(
  `  rows written: ${perHour(store.rowsWritten - base.written)} (of 100,000: ${((perHour(store.rowsWritten - base.written) / 100_000) * 100).toFixed(1)} %)`,
);
console.log(`  rows read: ${perHour(store.rowsRead - base.read)} (of 5,000,000)`);
const snap = store.snapshot;
if (snap)
  console.log(
    `  stored snapshot: ${snap.parts.length} parts, ${snap.parts.reduce((a, p) => a + p.length, 0)} characters`,
  );
for (const p of players) {
  p.s.leave();
  p.d.stop();
}
await relay.close();
process.exit(0);
