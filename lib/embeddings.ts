import OpenAI from "openai";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export function getChatClient(): OpenAI {
  return new OpenAI({
    apiKey: requireEnv("OPENAI_API_KEY"),
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  });
}

export function getEmbedClient(): OpenAI {
  return new OpenAI({
    apiKey: requireEnv("EMBED_API_KEY"),
    baseURL: process.env.EMBED_BASE_URL || undefined,
  });
}

export function getChatModel(): string {
  return requireEnv("OPENAI_MODEL");
}

export function getEmbedModel(): string {
  return requireEnv("EMBED_MODEL");
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const client = getEmbedClient();
  const model = getEmbedModel();
  const vectors: number[][] = [];
  const batchSize = 64;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const res = await client.embeddings.create({ model, input: batch });
    const sorted = [...res.data].sort((a, b) => a.index - b.index);
    for (const item of sorted) {
      vectors.push(item.embedding);
    }
  }
  return vectors;
}

export async function embedOne(text: string): Promise<number[]> {
  const [vec] = await embedTexts([text]);
  return vec;
}
