import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EvalRun } from './types.js';

/** Eval persistence port (Section 127) - the eval core never talks to a database directly. */
export interface EvalStore {
  save(run: EvalRun): Promise<void>;
  get(runId: string): Promise<EvalRun | undefined>;
  list(datasetId?: string): Promise<readonly EvalRun[]>;
  setBaseline(datasetId: string, runId: string): Promise<void>;
  getBaseline(datasetId: string): Promise<EvalRun | undefined>;
}

export function createInMemoryEvalStore(): EvalStore {
  const runs = new Map<string, EvalRun>();
  const baselines = new Map<string, string>();
  return {
    save: (run) => Promise.resolve(void runs.set(run.id, run)),
    get: (runId) => Promise.resolve(runs.get(runId)),
    list: (datasetId) => Promise.resolve([...runs.values()].filter((run) => !datasetId || run.dataset.id === datasetId)),
    setBaseline(datasetId, runId) {
      if (!runs.has(runId)) return Promise.reject(new Error(`Unknown eval run "${runId}".`));
      baselines.set(datasetId, runId);
      return Promise.resolve();
    },
    getBaseline: (datasetId) => Promise.resolve(runs.get(baselines.get(datasetId) ?? '')),
  };
}

const SAFE_ID = /^[A-Za-z0-9._-]+$/;

function safe(id: string): string {
  if (!SAFE_ID.test(id)) throw new Error(`Refusing unsafe eval id "${id}" as a file name.`);
  return id;
}

/** Plain JSON files in a directory - `runs/<id>.json` and `baselines/<datasetId>.json`. */
export function createFileEvalStore(directory: string): EvalStore {
  const runsDir = join(directory, 'runs');
  const baselinesDir = join(directory, 'baselines');
  const read = async (path: string): Promise<EvalRun | undefined> => {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as EvalRun;
    } catch {
      return undefined;
    }
  };
  return {
    async save(run) {
      await mkdir(runsDir, { recursive: true });
      await writeFile(join(runsDir, `${safe(run.id)}.json`), JSON.stringify(run, null, 2), 'utf8');
    },
    async get(runId) {
      return read(join(runsDir, `${safe(runId)}.json`));
    },
    async list(datasetId) {
      const files = await readdir(runsDir).catch(() => [] as string[]);
      const runs = await Promise.all(files.filter((file) => file.endsWith('.json')).map((file) => read(join(runsDir, file))));
      return runs.filter((run): run is EvalRun => run !== undefined && (!datasetId || run.dataset.id === datasetId));
    },
    async setBaseline(datasetId, runId) {
      await mkdir(baselinesDir, { recursive: true });
      await writeFile(join(baselinesDir, `${safe(datasetId)}.json`), JSON.stringify({ runId: safe(runId) }), 'utf8');
    },
    async getBaseline(datasetId) {
      try {
        const { runId } = JSON.parse(await readFile(join(baselinesDir, `${safe(datasetId)}.json`), 'utf8')) as { runId: string };
        return await read(join(runsDir, `${safe(runId)}.json`));
      } catch {
        return undefined;
      }
    },
  };
}
