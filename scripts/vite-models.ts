// Build-time model pipeline (phase 3): every GLB in assets/models is checked and the good ones
// converted into one packed file the game fetches at start, so the game ships without a glTF
// loader. The file is an asset named by its content; `virtual:citybloom-models` is its URL.
// In dev the file is built on request and the page reloads when a model is added or changed.
import { createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { MODELS_DIR, buildModels } from './lib/modelPipeline';

const ID = 'virtual:citybloom-models';
const RESOLVED = '\0' + ID;

export function models(): Plugin {
  let config: ResolvedConfig;
  let cache: { bytes: Uint8Array; hash: string } | null = null;

  const build = () => {
    const t0 = performance.now();
    const b = buildModels(config.root);
    for (const r of b.reports)
      if (!r.ok) config.logger.warn(`models: ${r.file} skipped (${r.errors.join('; ')})`);
    config.logger.info(
      `models: ${b.models.length} of ${b.reports.length} hand-made models, ${(b.bytes.length / 1024).toFixed(0)} KB, ${(performance.now() - t0).toFixed(0)} ms`,
    );
    cache = { bytes: b.bytes, hash: createHash('sha256').update(b.bytes).digest('hex').slice(0, 10) };
    return cache;
  };

  return {
    name: 'citybloom-models',
    configResolved(c) {
      config = c;
    },
    resolveId(id) {
      return id === ID ? RESOLVED : undefined;
    },
    load(id) {
      if (id !== RESOLVED) return undefined;
      const b = build();
      if (config.command === 'serve')
        return `export default import.meta.env.BASE_URL + ${JSON.stringify(`__models.bin?v=${b.hash}`)};`;
      const fileName = `assets/models-${b.hash}.bin`;
      this.emitFile({ type: 'asset', fileName, source: b.bytes });
      return `export default import.meta.env.BASE_URL + ${JSON.stringify(fileName)};`;
    },
    configureServer(server) {
      const dir = resolve(config.root, MODELS_DIR);
      server.watcher.add(dir);
      server.middlewares.use((req, res, next) => {
        if (!req.url?.includes('/__models.bin')) return next();
        const b = cache ?? build();
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store');
        res.end(Buffer.from(b.bytes));
      });
      // What the check reads besides the models: the budgets, and the lots and sites in the data.
      const inputs = [resolve(config.root, 'docs/models/PROMPTS.md'), resolve(config.root, 'src/data')];
      for (const f of inputs) server.watcher.add(f);
      // A model dropped into the folder (or changed, or removed), or a budget or a site size
      // changed: convert again and reload.
      const changed = (file: string) => {
        const model = file.startsWith(dir + sep) && file.toLowerCase().endsWith('.glb');
        if (!model && !inputs.some((f) => file === f || file.startsWith(f + sep))) return;
        cache = null;
        const mod = server.moduleGraph.getModuleById(RESOLVED);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', changed);
      server.watcher.on('change', changed);
      server.watcher.on('unlink', changed);
    },
  };
}
