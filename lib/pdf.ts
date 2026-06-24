import { PDFParse } from "pdf-parse";

export type ExtractedPdf = {
  text: string;
  pageCount: number;
};

export async function extractPdfText(buffer: Buffer): Promise<ExtractedPdf> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return {
      text: result.text ?? "",
      pageCount: result.total ?? result.pages?.length ?? 0,
    };
  } finally {
    await parser.destroy();
  }
}

export function chunkText(
  text: string,
  opts: { size?: number; overlap?: number } = {}
): string[] {
  const size = opts.size ?? 800;
  const overlap = opts.overlap ?? 100;
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    const end = Math.min(start + size, clean.length);
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = end - overlap;
  }
  return chunks;
}
