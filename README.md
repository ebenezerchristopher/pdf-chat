# Chat with your PDF

Upload a PDF, then ask questions about it. Answers come only from the document — the model says "That's not in the document." when it can't find the answer.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind 4
- `pdf-parse` for server-side text extraction
- `openai` SDK for both chat and embeddings
- `idb` for storing chunks + embeddings in the browser

## How it works

1. **Upload** — PDF goes to `/api/extract`, gets chunked (~800 chars, 100 char overlap), each chunk is embedded, and the result is stored in your browser's IndexedDB.
2. **Ask** — Your question is embedded via `/api/embed`. The browser does a cosine-similarity top-5 lookup locally and sends the top chunks plus your question to `/api/chat`.
3. **Answer** — The model receives a strict grounded prompt. If the answer isn't in the provided excerpts, it replies exactly: *"That's not in the document."*

## Local dev

```bash
npm install
cp .env.example .env.local
# fill in your keys
npm run dev
```

## Environment variables

| Var | Purpose |
|---|---|
| `OPENAI_API_KEY` | Chat provider key |
| `OPENAI_BASE_URL` | Chat provider base URL (leave blank for OpenAI default) |
| `OPENAI_MODEL` | Chat model name |
| `EMBED_API_KEY` | Embedding provider key (can be a different provider) |
| `EMBED_BASE_URL` | Embedding provider base URL (OpenAI-compatible `/v1/embeddings`) |
| `EMBED_MODEL` | Embedding model name |

## Deploy

Push to GitHub, import the repo in Vercel, add the env vars above, deploy.

## Limits

- 4.5 MB PDF upload (Vercel serverless request body limit)
- The same embedding model is used at upload and query time (enforced by env var)
