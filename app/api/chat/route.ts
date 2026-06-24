import { NextResponse } from "next/server";
import { streamGrounded, type ChatTurn } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      question?: unknown;
      excerpts?: unknown;
      history?: unknown;
    };

    const question = typeof body.question === "string" ? body.question : "";
    const excerpts = Array.isArray(body.excerpts)
      ? body.excerpts.filter((e): e is string => typeof e === "string")
      : [];
    const history: ChatTurn[] = Array.isArray(body.history)
      ? body.history
          .filter(
            (t): t is ChatTurn =>
              typeof t === "object" &&
              t !== null &&
              "role" in t &&
              "content" in t
          )
          .slice(-6)
      : [];

    if (!question.trim()) {
      return NextResponse.json({ error: "Missing 'question'" }, { status: 400 });
    }

    const stream = await streamGrounded(question, excerpts, history);
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
