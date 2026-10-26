/**
 * Bundled for a bare JavaScript engine shell (SpiderMonkey's `js`, M29): no DOM, no atob. The test
 * prepends `var CITYBLOOM_ARGS = {...}` and reads the result from what the shell prints.
 */
import { decodeSave } from '../../src/client/saves';
import { base64ToBytes } from '../../src/sim/serialize';
import { runDeterminism } from './determinism';

declare const CITYBLOOM_ARGS: { months: number; id: string; save: string };
declare const print: (s: string) => void;

const a = CITYBLOOM_ARGS;
print(JSON.stringify(runDeterminism(a.months, { id: a.id, save: decodeSave(base64ToBytes(a.save)) })));
