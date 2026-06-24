import OpenAI from "openai";
import { Agent, type Dispatcher } from "undici";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  const p = path.replace(/^\/+/, "");
  return `${b}/${p}`;
}

export function getChatClient(): OpenAI {
  return new OpenAI({
    apiKey: requireEnv("OPENAI_API_KEY"),
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  });
}

export function getChatModel(): string {
  return requireEnv("OPENAI_MODEL");
}

export function getEmbedModel(): string {
  return requireEnv("EMBED_MODEL");
}

let cachedDispatcher: Dispatcher | null = null;
function getDispatcher(): Dispatcher {
  if (!cachedDispatcher) {
    cachedDispatcher = new Agent({
      keepAliveTimeout: 30_000,
      keepAliveMaxTimeout: 60_000,
      connections: 16,
      pipelining: 0,
    });
  }
  return cachedDispatcher;
}

function parseEmbeddingResponse(raw: unknown): number[][] {
  if (raw == null) {
    throw new Error("Empty embedding response");
  }

  if (Array.isArray(raw)) {
    if (raw.length === 0) throw new Error("Empty array from embedding API");
    if (Array.isArray(raw[0])) return raw as number[][];
    if (raw[0] && typeof raw[0] === "object") {
      return raw.map((item) => {
        if (Array.isArray(item)) return item as number[];
        if (item && typeof item === "object") {
          const obj = item as Record<string, unknown>;
          const v = obj.embedding ?? obj.values ?? obj.vector;
          if (Array.isArray(v)) return v as number[];
        }
        throw new Error(
          `Could not find vector in array item (keys: ${Object.keys(item as object).join(", ")})`
        );
      });
    }
    throw new Error(
      "Embedding response is an array but items don't look like vectors"
    );
  }

  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;

    if (Array.isArray(obj.data)) {
      const data = obj.data;
      if (data.length === 0) throw new Error("Empty 'data' array");
      if (Array.isArray(data[0])) return data as number[][];
      if (data[0] && typeof data[0] === "object") {
        const items = data as Array<Record<string, unknown>>;
        const hasIndex = items.some((it) => "index" in it);
        const sorted = hasIndex
          ? [...items].sort(
              (a, b) => Number(a.index ?? 0) - Number(b.index ?? 0)
            )
          : items;
        return sorted.map((it) => {
          const v = it.embedding ?? it.values ?? it.vector;
          if (!Array.isArray(v)) {
            throw new Error(
              `Could not find vector in embedding item (keys: ${Object.keys(it).join(", ")})`
            );
          }
          return v as number[];
        });
      }
    }

    if (Array.isArray(obj.embeddings)) {
      return obj.embeddings as number[][];
    }

    if (Array.isArray(obj.embedding)) {
      return [obj.embedding as number[]];
    }

    throw new Error(
      `Unrecognized embedding response shape. Top-level keys: ${Object.keys(obj).join(", ")}`
    );
  }

  throw new Error("Embedding response is not an object or array");
}

async function callEmbedApi(
  url: string,
  apiKey: string,
  model: string,
  batch: string[]
): Promise<number[][]> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input: batch }),
    // undici extension — reuses TCP/TLS connections across parallel calls.
    ...({ dispatcher: getDispatcher() } as Record<string, unknown>),
  } as RequestInit);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Embedding API ${res.status}: ${text.slice(0, 300) || res.statusText}`
    );
  }

  const raw = await res.json();
  const vectors = parseEmbeddingResponse(raw);
  if (vectors.length !== batch.length) {
    throw new Error(
      `Embedding count mismatch: sent ${batch.length}, got ${vectors.length}`
    );
  }
  return vectors;
}

export async function embedTexts(
  texts: string[],
  opts: { concurrency?: number; batchSize?: number } = {}
): Promise<number[][]> {
  const apiKey = requireEnv("EMBED_API_KEY");
  const baseURL = process.env.EMBED_BASE_URL || "https://api.openai.com/v1";
  const model = getEmbedModel();
  const url = joinUrl(baseURL, "/embeddings");

  const batchSize = opts.batchSize ?? 32;
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 4, 8));

  if (texts.length === 0) return [];

  const batches: string[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    batches.push(texts.slice(i, i + batchSize));
  }

  const results: number[][] = new Array(texts.length);
  let nextBatch = 0;

  async function worker(): Promise<void> {
    while (true) {
      const idx = nextBatch++;
      if (idx >= batches.length) return;
      const batch = batches[idx];
      const startIdx = idx * batchSize;
      const vectors = await callEmbedApi(url, apiKey, model, batch);
      for (let i = 0; i < vectors.length; i++) {
        results[startIdx + i] = vectors[i];
      }
    }
  }

  const workerCount = Math.min(concurrency, batches.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

export async function embedOne(text: string): Promise<number[]> {
  const [vec] = await embedTexts([text]);
  return vec;
}

export type EmbedStreamOptions = {
  concurrency?: number;
  batchSize?: number;
};

/**
 * Streams embeddings for chunks produced by an async source. The producer
 * (e.g. page-by-page PDF extraction) pushes chunk arrays; the consumer pool
 * embeds them in parallel batches. Returns chunks and embeddings aligned by
 * insertion order.
 */
export async function embedStream(
  source: AsyncIterable<readonly string[]>,
  opts: EmbedStreamOptions = {}
): Promise<{ chunks: string[]; embeddings: number[][] }> {
  const apiKey = requireEnv("EMBED_API_KEY");
  const baseURL = process.env.EMBED_BASE_URL || "https://api.openai.com/v1";
  const model = getEmbedModel();
  const url = joinUrl(baseURL, "/embeddings");

  const batchSize = opts.batchSize ?? 32;
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 4, 8));

  const chunks: string[] = [];
  const embeddings: number[][] = [];

  type Job = { startIndex: number; items: string[] };

  // Broadcast-channel-like signaling: an array of pending waiters that get
  // resolved on every push. Polling is the fallback.
  const queue: Job[] = [];
  const waiters: Array<() => void> = [];
  let producerDone = false;
  let workersActive = concurrency;

  const wake = () => {
    while (waiters.length > 0) {
      const w = waiters.shift();
      w?.();
    }
  };

  const waitForWork = async (): Promise<Job | null> => {
    while (true) {
      const job = queue.shift();
      if (job) return job;
      if (producerDone) return null;
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
      });
    }
  };

  const worker = async () => {
    try {
      while (true) {
        const job = await waitForWork();
        if (!job) return;
        const vectors = await callEmbedApi(url, apiKey, model, job.items);
        for (let i = 0; i < vectors.length; i++) {
          embeddings[job.startIndex + i] = vectors[i];
        }
      }
    } finally {
      workersActive--;
      if (workersActive === 0) wake();
    }
  };

  const workers = Array.from({ length: concurrency }, () => worker());

  try {
    for await (const batch of source) {
      if (batch.length === 0) continue;
      const startIndex = chunks.length;
      for (const c of batch) chunks.push(c);
      for (let i = 0; i < batch.length; i += batchSize) {
        queue.push({
          startIndex: startIndex + i,
          items: batch.slice(i, i + batchSize),
        });
      }
      wake();
    }
  } finally {
    producerDone = true;
    wake();
  }

  await Promise.all(workers);
  return { chunks, embeddings };
}
