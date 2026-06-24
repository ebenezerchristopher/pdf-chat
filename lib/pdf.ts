import { getDocumentProxy } from "unpdf";

export type ExtractedPdf = {
  text: string;
  pageCount: number;
};

export type PageBatchOptions = {
  pageParallelism?: number;
};

type PdfjsTextItem = {
  str: string;
  hasEOL: boolean;
  dir?: string;
  transform?: number[];
  width?: number;
  height?: number;
  fontName?: string;
};

/**
 * Yields page text strings. Pages are extracted in small parallel batches
 * (default 4) so the consumer can start processing the first batch while
 * later pages are still being parsed.
 */
export async function* extractPdfPagesStream(
  buffer: Buffer,
  opts: PageBatchOptions = {}
): AsyncGenerator<string> {
  const pageParallelism = Math.max(1, Math.min(opts.pageParallelism ?? 4, 8));
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  try {
    const total = pdf.numPages;
    for (let i = 1; i <= total; i += pageParallelism) {
      const promises: Promise<string>[] = [];
      for (let j = 0; j < pageParallelism && i + j <= total; j++) {
        promises.push(extractSinglePage(pdf, i + j));
      }
      const texts = await Promise.all(promises);
      for (const t of texts) yield t;
    }
  } finally {
    await pdf.destroy();
  }
}

async function extractSinglePage(
  pdf: Awaited<ReturnType<typeof getDocumentProxy>>,
  pageNumber: number
): Promise<string> {
  const page = await pdf.getPage(pageNumber);
  const content = await page.getTextContent();
  let out = "";
  for (const raw of content.items) {
    const it = raw as unknown as Partial<PdfjsTextItem>;
    if (typeof it.str === "string") {
      out += it.str + (it.hasEOL ? "\n" : "");
    }
  }
  return out;
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
