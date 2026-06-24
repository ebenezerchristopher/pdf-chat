import { extractText } from "unpdf";

export type ExtractedPdf = {
  text: string;
  pageCount: number;
};

export async function extractPdfText(buffer: Buffer): Promise<ExtractedPdf> {
  const result = await extractText(new Uint8Array(buffer), { mergePages: true });
  return {
    text: result.text ?? "",
    pageCount: result.totalPages ?? 0,
  };
}

export function chunkText(
  text: string,
  opts: { size?: number; overlap?: number } = {}
): string[] {
  const size = opts.size ?? 1500;
  const overlap = opts.overlap ?? 150;
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
