// Build-time model pipeline (phase 3): every GLB in assets/models is checked and the good ones
// converted into one packed file the game fetches at start, so the game ships without a glTF
// loader. The file is an asset named by its content; `virtual:citybloom-models` is its URL.
// The war models (phase 5, assets/models/war) go in a file of their own behind
// `virtual:citybloom-war-models`, fetched only in a city with war on: a peaceful city never loads it.
// In dev the files are built on request and the page reloads when a model is added or changed.
import { createHash } from 'node:crypto';
import { basename, dirname, resolve, sep } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import {
  MODELS_DIR,
  PROMPTS_DIR,
  PROMPTS_NAME,
  WAR_MODELS_DIR,
  buildModels,
  buildWarModels,
} from './lib/modelPipeline';

const ID = 'virtual:citybloom-models';
const RESOLVED = '\0' + ID;
const WAR_ID = 'virtual:citybloom-war-models';
const WAR_RESOLVED = '\0' + WAR_ID;

interface Built {
  bytes: Uint8Array;
  hash: string;
}

export function models(): Plugin {
  let config: ResolvedConfig;
  let cache: Built | null = null;
  let warCache: Built | null = null;
  const hashOf = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex').slice(0, 10);

  const build = () => {
    const t0 = performance.now();
    const b = buildModels(config.root);
    for (const r of b.reports)
      if (!r.ok) config.logger.warn(`models: ${r.file} skipped (${r.errors.join('; ')})`);
    config.logger.info(
      `models: ${b.models.length} of ${b.reports.length} hand-made models, ${(b.bytes.length / 1024).toFixed(0)} KB, ${(performance.now() - t0).toFixed(0)} ms`,
    );
    cache = { bytes: b.bytes, hash: hashOf(b.bytes) };
    return cache;
  };

  const buildWar = () => {
    const t0 = performance.now();
    const b = buildWarModels(config.root);
    for (const r of [...b.reports, ...b.unitReports])
      if (!r.ok) config.logger.warn(`war models: ${r.file} skipped (${r.errors.join('; ')})`);
    config.logger.info(
      `war models: ${b.models.length} of ${b.reports.length} buildings and ${b.units.length} of ${b.unitReports.length} units, ${(b.bytes.length / 1024).toFixed(0)} KB, ${(performance.now() - t0).toFixed(0)} ms`,
    );
    warCache = { bytes: b.bytes, hash: hashOf(b.bytes) };
    return warCache;
  };

  return {
    name: 'citybloom-models',
    configResolved(c) {
      config = c;
    },
    resolveId(id) {
      return id === ID ? RESOLVED : id === WAR_ID ? WAR_RESOLVED : undefined;
    },
    load(id) {
      if (id !== RESOLVED && id !== WAR_RESOLVED) return undefined;
      const war = id === WAR_RESOLVED;
      const b = war ? buildWar() : build();
      const name = war ? 'war-models' : 'models';
      if (config.command === 'serve')
        return `export default import.meta.env.BASE_URL + ${JSON.stringify(`__${name}.bin?v=${b.hash}`)};`;
      const fileName = `assets/${name}-${b.hash}.bin`;
      this.emitFile({ type: 'asset', fileName, source: b.bytes });
      return `export default import.meta.env.BASE_URL + ${JSON.stringify(fileName)};`;
    },
    configureServer(server) {
      const dir = resolve(config.root, MODELS_DIR);
      const warDir = resolve(config.root, WAR_MODELS_DIR);
      server.watcher.add(dir);
      server.middlewares.use((req, res, next) => {
        const war = req.url?.includes('/__war-models.bin');
        if (!war && !req.url?.includes('/__models.bin')) return next();
        const b = war ? (warCache ?? buildWar()) : (cache ?? build());
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store');
        res.end(Buffer.from(b.bytes));
      });
      // What the check reads besides the models: the budgets (every batch of prompts), and the
      // lots and sites in the data.
      const prompts = resolve(config.root, PROMPTS_DIR);
      const data = resolve(config.root, 'src/data');
      for (const f of [prompts, data]) server.watcher.add(f);
      const reload = (id: string) => {
        const mod = server.moduleGraph.getModuleById(id);
        if (mod) server.moduleGraph.invalidateModule(mod);
      };
      // A model dropped into a folder (or changed, or removed), or a budget or a site size
      // changed: convert again and reload.
      const changed = (file: string) => {
        const glb = file.toLowerCase().endsWith('.glb');
        const warModel = glb && file.startsWith(warDir + sep);
        const model = glb && !warModel && dirname(file) === dir;
        const prompt = dirname(file) === prompts && PROMPTS_NAME.test(basename(file));
        const both = prompt || file.startsWith(data + sep);
        if (!model && !warModel && !both) return;
        if (model || both) {
          cache = null;
          reload(RESOLVED);
        }
        if (warModel || both) {
          warCache = null;
          reload(WAR_RESOLVED);
        }
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', changed);
      server.watcher.on('change', changed);
      server.watcher.on('unlink', changed);
    },
  };
}
