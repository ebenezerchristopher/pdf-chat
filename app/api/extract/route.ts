import { NextResponse } from "next/server";
import { chunkText, extractPdfText } from "@/lib/pdf";
import { embedTexts } from "@/lib/embeddings";

export const runtime = "nodejs";
export const maxDuration = 45;

const MAX_BYTES = 4.5 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "No file uploaded under field 'file'" },
        { status: 400 }
      );
    }

    if (file.type && file.type !== "application/pdf") {
      return NextResponse.json(
        { error: `Expected application/pdf, got ${file.type}` },
        { status: 400 }
      );
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `PDF exceeds ${(MAX_BYTES / 1024 / 1024).toFixed(1)}MB limit` },
        { status: 413 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { text, pageCount } = await extractPdfText(buffer);

    if (!text.trim()) {
      return NextResponse.json(
        { error: "Could not extract any text from the PDF (scanned PDF?)" },
        { status: 422 }
      );
    }

    const chunks = chunkText(text);

    if (chunks.length === 0) {
      return NextResponse.json(
        { error: "PDF text was empty after chunking" },
        { status: 422 }
      );
    }

    const embeddings = await embedTexts(chunks);

    return NextResponse.json({
      name: file.name,
      pageCount,
      chunks,
      embeddings,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
