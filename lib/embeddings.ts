import OpenAI from "openai";

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

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, input: batch }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Embedding API ${res.status}: ${text.slice(0, 300) || res.statusText}`
        );
      }

      const raw = await res.json();
      const batchVectors = parseEmbeddingResponse(raw);

      if (batchVectors.length !== batch.length) {
        throw new Error(
          `Embedding count mismatch: sent ${batch.length}, got ${batchVectors.length}`
        );
      }

      for (let i = 0; i < batchVectors.length; i++) {
        results[startIdx + i] = batchVectors[i];
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
