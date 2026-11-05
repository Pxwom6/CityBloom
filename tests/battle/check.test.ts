import { describe, expect, it } from 'vitest';
import { gzipSync, strToU8 } from 'fflate';
import { checkBattleInput } from '../../src/sim/battle/check';
import { S } from '../../src/sim/battle/types';
import { BATTLE_MAX_BYTES, decodeBattle, encodeBattle } from '../../src/net/snapshot';
import { bytesToBase64 } from '../../src/sim/serialize';
import { input, lineLayout, TOWN, units } from './handmade';

/** M35 review: a battle from outside is read with care. */
describe('reading a battle from outside (M35)', () => {
  const good = () => input(lineLayout(TOWN, units('tank', 2, { x: 900, z: 540 }, 0)), units('tank', 4));

  it('a sound battle passes, and travels unchanged', () => {
    expect(checkBattleInput(good())).toBeNull();
    const b = good();
    expect(decodeBattle(encodeBattle(b))).toEqual(b);
  });

  it('a malformed one is turned away, with a reason', () => {
    const cases: [string, (b: ReturnType<typeof good>) => void][] = [
      ['a road to nowhere', (b) => (b.layout.edges[0] = 999)],
      ['a road with too few points', (b) => (b.layout.edges[4] = 1)],
      ['a building off its road', (b) => (b.layout.structs[S.edge] = 99)],
      ['a building made of nothing', (b) => (b.layout.structs[S.hp] = 0)],
      ['a number that isn’t one', (b) => (b.layout.structs[S.x] = Number.NaN)],
      ['ground of the wrong size', (b) => b.layout.grid.cells.pop()],
      ['an unknown unit', (b) => ((b.attacker.units[0]! as { kind: string }).kind = 'dragon')],
      ['too many attackers', (b) => (b.attacker.units = units('tank', 40))],
      ['a defender based nowhere', (b) => (b.layout.defenders[0]!.base = 9999)],
      ['a scale that isn’t', (b) => ((b as { scale: string }).scale = 'atomic')],
      ['caps below nothing', (b) => (b.caps.maxCollapse = -1)],
      ['another version', (b) => (b.v = 99)],
      ['a very long name', (b) => (b.attacker.name = 'x'.repeat(500))],
    ];
    for (const [what, spoil] of cases) {
      const b = good();
      spoil(b);
      expect(checkBattleInput(b), what).not.toBeNull();
    }
    for (const junk of [null, 5, 'battle', [], {}]) expect(checkBattleInput(junk)).not.toBeNull();
  });

  it('a battle that would unpack too big is refused before it’s unpacked', () => {
    // A gzip bomb: megabytes of spaces pack into a few kilobytes.
    const bomb = gzipSync(new Uint8Array(BATTLE_MAX_BYTES + 1024).fill(32), { level: 9 });
    expect(bomb.length).toBeLessThan(200_000);
    expect(() => decodeBattle([bytesToBase64(bomb)])).toThrow(/too big/);
    // A trailer that lies about its size gets no more room than it claims: it doesn't parse.
    const liar = gzipSync(strToU8(JSON.stringify(good())), { level: 6 });
    liar.set([10, 0, 0, 0], liar.length - 4);
    expect(() => decodeBattle([bytesToBase64(liar)])).toThrow();
  });
});
