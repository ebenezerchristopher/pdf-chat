"use client";

import { useEffect, useRef, useState } from "react";
import { topKSimilar } from "@/lib/cosine";
import {
  getLatestDoc,
  type StoredDoc,
  deleteDoc,
  listDocs,
} from "@/lib/db";

type Message = { role: "user" | "assistant"; content: string };

const TOP_K = 5;

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function Home() {
  const [doc, setDoc] = useState<StoredDoc | null>(null);
  const [allDocs, setAllDocs] = useState<StoredDoc[]>([]);
  const [loadingDoc, setLoadingDoc] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const docs = await listDocs();
        setAllDocs(docs);
        const latest = await getLatestDoc();
        setDoc(latest ?? null);
      } catch (err) {
        console.error("Failed to load doc from IndexedDB", err);
      } finally {
        setLoadingDoc(false);
      }
    })();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, asking]);

  async function handleFile(file: File) {
    setUploadError(null);
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setUploadError("Please choose a .pdf file");
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/extract", { method: "POST", body: form });
      if (!res.ok) {
        const detail = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(detail.error || `Upload failed (${res.status})`);
      }
      const data = (await res.json()) as {
        name: string;
        pageCount: number;
        chunks: string[];
        embeddings: number[][];
      };
      const newDoc: StoredDoc = {
        id: makeId(),
        name: data.name,
        pageCount: data.pageCount,
        chunks: data.chunks,
        embeddings: data.embeddings,
        createdAt: Date.now(),
      };
      const { saveDoc } = await import("@/lib/db");
      await saveDoc(newDoc);
      setDoc(newDoc);
      setAllDocs((prev) => [newDoc, ...prev]);
      setMessages([]);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleRemove() {
    if (!doc) return;
    await deleteDoc(doc.id);
    setAllDocs((prev) => prev.filter((d) => d.id !== doc.id));
    setDoc(null);
    setMessages([]);
  }

  async function handleSelect(id: string) {
    const next = allDocs.find((d) => d.id === id);
    if (!next) return;
    setDoc(next);
    setMessages([]);
  }

  async function handleAsk(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || !doc || asking) return;

    setAskError(null);
    setInput("");
    const nextMessages: Message[] = [...messages, { role: "user", content: question }];
    setMessages(nextMessages);
    setAsking(true);

    try {
      const embedRes = await fetch("/api/embed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: question }),
      });
      if (!embedRes.ok) {
        const detail = (await embedRes.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(detail.error || `Embedding failed (${embedRes.status})`);
      }
      const { embedding } = (await embedRes.json()) as { embedding: number[] };

      const items = doc.chunks.map((text, i) => ({
        embedding: doc.embeddings[i],
        payload: text,
      }));
      const top = topKSimilar(embedding, items, TOP_K);
      const excerpts = top.map((t) => t.payload);

      const chatRes = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          excerpts,
          history: nextMessages
            .filter((_, idx) => idx < nextMessages.length - 1)
            .map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      if (!chatRes.ok) {
        const detail = (await chatRes.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(detail.error || `Chat failed (${chatRes.status})`);
      }
      if (!chatRes.body) {
        throw new Error("Chat response had no body");
      }

      const working: Message[] = [
        ...nextMessages,
        { role: "assistant", content: "" },
      ];
      setMessages(working);

      const reader = chatRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullAnswer = "";
      let streamError: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const parsed = JSON.parse(payload) as {
              delta?: string;
              error?: string;
            };
            if (parsed.error) {
              streamError = parsed.error;
            } else if (parsed.delta) {
              fullAnswer += parsed.delta;
              working[working.length - 1] = {
                role: "assistant",
                content: fullAnswer,
              };
              setMessages([...working]);
            }
          } catch {
            // ignore malformed line
          }
        }
      }

      if (streamError) {
        setAskError(streamError);
        setMessages(nextMessages);
      } else if (!fullAnswer) {
        setMessages([
          ...nextMessages,
          { role: "assistant", content: "That's not in the document." },
        ]);
      }
    } catch (err) {
      setAskError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setAsking(false);
    }
  }

  if (loadingDoc) {
    return (
      <div className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <p className="text-zinc-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900 sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              Chat with your PDF
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Upload a document, then ask questions. Answers come only from the document.
            </p>
          </div>
          <DocPicker
            docs={allDocs}
            current={doc}
            onSelect={handleSelect}
            onRemove={handleRemove}
            onUploadClick={() => fileInputRef.current?.click()}
            uploading={uploading}
          />
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6">
        {!doc ? (
          <UploadView
            uploading={uploading}
            error={uploadError}
            onPick={() => fileInputRef.current?.click()}
            onDrop={(f) => handleFile(f)}
          />
        ) : (
          <ChatView
            doc={doc}
            messages={messages}
            asking={asking}
            askError={askError}
            input={input}
            onInputChange={setInput}
            onSubmit={handleAsk}
            messagesEndRef={messagesEndRef}
          />
        )}
      </main>
    </div>
  );
}

function DocPicker({
  docs,
  current,
  onSelect,
  onRemove,
  onUploadClick,
  uploading,
}: {
  docs: StoredDoc[];
  current: StoredDoc | null;
  onSelect: (id: string) => void;
  onRemove: () => void;
  onUploadClick: () => void;
  uploading: boolean;
}) {
  if (current) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select
          value={current.id}
          onChange={(e) => onSelect(e.target.value)}
          className="max-w-[180px] truncate rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
          title={current.name}
        >
          {docs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <button
          onClick={onUploadClick}
          disabled={uploading}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          {uploading ? "Uploading…" : "New PDF"}
        </button>
        <button
          onClick={onRemove}
          className="rounded-md px-3 py-1.5 text-zinc-500 transition hover:text-red-600 dark:hover:text-red-400"
        >
          Remove
        </button>
      </div>
    );
  }
  return (
    <button
      onClick={onUploadClick}
      disabled={uploading}
      className="self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
    >
      {uploading ? "Uploading…" : "Upload PDF"}
    </button>
  );
}

function UploadView({
  uploading,
  error,
  onPick,
  onDrop,
}: {
  uploading: boolean;
  error: string | null;
  onPick: () => void;
  onDrop: (file: File) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div className="flex flex-1 items-center justify-center">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onDrop(f);
        }}
        className={`flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border-2 border-dashed p-10 text-center transition ${
          dragOver
            ? "border-zinc-900 bg-zinc-100 dark:border-zinc-50 dark:bg-zinc-900"
            : "border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900"
        }`}
      >
        <div className="text-4xl">📄</div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Drop a PDF here
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          or pick a file from your computer. Max 4.5MB.
        </p>
        <button
          onClick={onPick}
          disabled={uploading}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {uploading ? "Uploading…" : "Choose PDF"}
        </button>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </div>
  );
}

function ChatView({
  doc,
  messages,
  asking,
  askError,
  input,
  onInputChange,
  onSubmit,
  messagesEndRef,
}: {
  doc: StoredDoc;
  messages: Message[];
  asking: boolean;
  askError: string | null;
  input: string;
  onInputChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="font-medium text-zinc-900 dark:text-zinc-50">
          {doc.name}
        </div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          {doc.pageCount} page{doc.pageCount === 1 ? "" : "s"} ·{" "}
          {doc.chunks.length} chunks indexed
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        {messages.length === 0 && (
          <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
            Ask anything about the document.
          </p>
        )}
        {messages.map((m, i) => (
          <MessageBubble key={i} message={m} />
        ))}
        {asking && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-zinc-100 px-4 py-2 text-sm text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              Thinking…
            </div>
          </div>
        )}
        {askError && (
          <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {askError}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form
        onSubmit={onSubmit}
        className="flex gap-2 rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder="Ask a question about the PDF…"
          disabled={asking}
          className="flex-1 bg-transparent px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 disabled:opacity-50 dark:text-zinc-50"
        />
        <button
          type="submit"
          disabled={asking || !input.trim()}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Send
        </button>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${
          isUser
            ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
            : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
        }`}
      >
        {message.content}
      </div>
    </div>
  );
}
