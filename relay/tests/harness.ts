/**
 * Test rooms and headless players (M30): a Room in this process, players talking to it over
 * loopback links (or real sockets through the local relay), each with its own sim run in place.
 */
import { Room, MemoryStore } from '../room';
import { loopbackPair, type Link } from '../../src/net/link';
import { HeadlessDriver } from '../../src/net/driver';
import { RoomSession, type NetNotice, type SessionOptions } from '../../src/net/session';
import { Sim } from '../../src/sim/sim';

/** Game ticks a second at speeds 0–3 in tests: a game month in a few seconds. */
export const FAST = [0, 300, 600, 1200] as const;

export function makeRoom(code = 'TESTRM', store = new MemoryStore()): Room {
  return new Room(code, 'local', store, { now: () => performance.now() });
}

/** A way to reach `room` over a loopback link, as a transport would. */
export function loopTo(room: Room): () => Promise<Link> {
  return async () => {
    const [mine, theirs] = loopbackPair();
    const conn = {
      send: (m: unknown) => theirs.send(JSON.stringify(m)),
      close: () => theirs.close(),
    };
    room.open(conn);
    theirs.onmessage = (t) => room.message(conn, t);
    theirs.onclose = () => room.closed(conn);
    return mine;
  };
}

export interface TestPlayer {
  name: string;
  driver: HeadlessDriver;
  session: RoomSession;
  notices: NetNotice[];
}

export function player(
  name: string,
  connect: () => Promise<Link>,
  sim: Sim | null,
  opts: Partial<SessionOptions> = {},
): TestPlayer {
  const driver = new HeadlessDriver(sim ?? Sim.create({ seed: 'placeholder' }), 30, 20);
  const session = new RoomSession(driver, connect, {
    name,
    color: 0,
    ticksPerSecond: FAST,
    statusEvery: 100,
    clockEvery: 50,
    ...opts,
  });
  const notices: NetNotice[] = [];
  session.onNotice = (n) => notices.push(n);
  return { name, driver, session, notices };
}

export async function until(
  cond: () => boolean,
  timeoutMs = 30_000,
  what: string | (() => string) = 'condition',
): Promise<void> {
  const t0 = performance.now();
  while (!cond()) {
    if (performance.now() - t0 > timeoutMs)
      throw new Error(`timed out waiting for ${typeof what === 'string' ? what : what()}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Pause the room and wait until every player has run to the same tick. */
export async function settle(host: TestPlayer, all: TestPlayer[]): Promise<number> {
  host.session.setSpeed(0);
  await until(() => host.session.room?.speed === 0, 5000, 'pause');
  await new Promise((r) => setTimeout(r, 300));
  const allow = host.session.allowed;
  await until(
    () => all.every((p) => p.driver.tick === allow && p.session.allowed === allow),
    30_000,
    'players to settle',
  );
  return allow;
}

export function stopAll(players: TestPlayer[]): void {
  for (const p of players) {
    p.session.leave();
    p.driver.stop();
  }
}
