import { NextResponse } from "next/server";
import { askGrounded, type ChatTurn } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 60;

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
              "content" in t &&
              (t as { role: unknown }).role !== undefined &&
              (t as { content: unknown }).content !== undefined
          )
          .slice(-6)
      : [];

    if (!question.trim()) {
      return NextResponse.json({ error: "Missing 'question'" }, { status: 400 });
    }

    const answer = await askGrounded(question, excerpts, history);
    return NextResponse.json({ answer });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
