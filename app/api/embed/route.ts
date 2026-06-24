import { NextResponse } from "next/server";
import { embedOne } from "@/lib/embeddings";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { text?: unknown };
    const text = typeof body.text === "string" ? body.text : "";

    if (!text.trim()) {
      return NextResponse.json({ error: "Missing 'text'" }, { status: 400 });
    }

    const embedding = await embedOne(text);
    return NextResponse.json({ embedding });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
