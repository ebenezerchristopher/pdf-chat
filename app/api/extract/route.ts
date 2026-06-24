import { NextResponse } from "next/server";
import { chunkText, extractPdfPagesStream } from "@/lib/pdf";
import { embedStream } from "@/lib/embeddings";

export const runtime = "nodejs";
export const maxDuration = 45;
export const dynamic = "force-dynamic";

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

    // Pipeline: as soon as a page's text is parsed, chunk it and hand the
    // chunks to the embed worker pool. The workers embed in parallel while
    // the producer keeps extracting later pages.
    let pageCount = 0;
    async function* chunkSource(): AsyncGenerator<string[]> {
      for await (const pageText of extractPdfPagesStream(buffer)) {
        pageCount++;
        const chunks = chunkText(pageText);
        if (chunks.length > 0) yield chunks;
      }
    }

    const { chunks, embeddings } = await embedStream(chunkSource(), {
      concurrency: 4,
      batchSize: 32,
    });

    if (pageCount === 0) {
      return NextResponse.json(
        { error: "PDF has no pages" },
        { status: 422 }
      );
    }

    if (chunks.length === 0) {
      return NextResponse.json(
        { error: "Could not extract any text from the PDF (scanned PDF?)" },
        { status: 422 }
      );
    }

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
