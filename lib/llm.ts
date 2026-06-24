import { getChatClient, getChatModel } from "@/lib/embeddings";

export type ChatTurn = { role: "user" | "assistant"; content: string };

export const GROUNDED_SYSTEM_PROMPT = `You are a precise document assistant. You answer questions using ONLY the excerpts from a single PDF document that the user has uploaded.

Strict rules:
1. Use only the information in the provided excerpts to answer.
2. If the answer is not in the excerpts, reply with EXACTLY this sentence and nothing else: "That's not in the document."
3. Quote or paraphrase excerpts faithfully. Do not invent numbers, names, dates, or claims.
4. If the excerpts only partially answer the question, answer what you can and clearly state what is not covered.
5. Never use outside knowledge, even if you recognise the topic.
6. Keep answers concise and direct.`;

function buildMessages(
  question: string,
  excerpts: string[],
  history: ChatTurn[]
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const excerptBlock = excerpts
    .map((e, i) => `[Excerpt ${i + 1}]\n${e}`)
    .join("\n\n");

  const userMessage =
    excerpts.length > 0
      ? `Document excerpts:\n\n${excerptBlock}\n\nQuestion: ${question}`
      : `Question: ${question}`;

  return [
    { role: "system", content: GROUNDED_SYSTEM_PROMPT },
    ...history.map((t) => ({ role: t.role, content: t.content })),
    { role: "user", content: userMessage },
  ];
}

export async function askGrounded(
  question: string,
  excerpts: string[],
  history: ChatTurn[] = []
): Promise<string> {
  const client = getChatClient();
  const model = getChatModel();
  const completion = await client.chat.completions.create({
    model,
    messages: buildMessages(question, excerpts, history),
    temperature: 0,
  });
  return (
    completion.choices[0]?.message?.content?.trim() ||
    "That's not in the document."
  );
}

export async function streamGrounded(
  question: string,
  excerpts: string[],
  history: ChatTurn[] = []
): Promise<ReadableStream<Uint8Array>> {
  const client = getChatClient();
  const model = getChatModel();
  const stream = await client.chat.completions.create({
    model,
    messages: buildMessages(question, excerpts, history),
    temperature: 0,
    stream: true,
  });

  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`)
            );
          }
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Stream error";
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`)
        );
        controller.close();
      }
    },
  });
}
