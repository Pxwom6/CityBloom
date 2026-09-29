/**
 * Fields a new city has that a loaded one lacks (Phase 2 review): walks plain objects, arrays and
 * the values of maps, comparing against a reference city grown from scratch. Optional fields that a
 * city only sometimes has are skipped (`optional`).
 */
export function missingFields(
  fresh: unknown,
  loaded: unknown,
  optional: Set<string>,
  path = 'state',
): string[] {
  const out: string[] = [];
  const walk = (f: unknown, l: unknown, p: string) => {
    if (f === null || typeof f !== 'object' || ArrayBuffer.isView(f)) return;
    if (l === null || l === undefined) {
      out.push(p);
      return;
    }
    if (f instanceof Map) {
      if (!(l instanceof Map)) return void out.push(`${p} (not a map)`);
      const fv = [...f.values()][0];
      if (fv === undefined) return;
      for (const lv of [...l.values()].slice(0, 25)) walk(fv, lv, `${p}[]`);
      return;
    }
    if (Array.isArray(f)) {
      if (!Array.isArray(l)) return void out.push(`${p} (not an array)`);
      if (f.length && l.length && typeof f[0] === 'object') walk(f[0], l[0], `${p}[0]`);
      return;
    }
    const fo = f as Record<string, unknown>;
    const lo = l as Record<string, unknown>;
    for (const k of Object.keys(fo)) {
      if (fo[k] === undefined) continue;
      const q = `${p}.${k}`;
      const key = q.replace(/\[\d*\]/g, '[]');
      if (optional.has(key)) continue;
      if (!(k in lo) || lo[k] === undefined) out.push(q);
      else walk(fo[k], lo[k], q);
    }
  };
  walk(fresh, loaded, path);
  return [...new Set(out.map((p) => p.replace(/\[\d*\]/g, '[]')))].sort();
}
