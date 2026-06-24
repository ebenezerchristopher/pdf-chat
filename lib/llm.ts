import { getChatClient, getChatModel } from "./embeddings";

export const GROUNDED_SYSTEM_PROMPT = `You are a precise document assistant. You answer questions using ONLY the excerpts from a single PDF document that the user has uploaded.

Strict rules:
1. Use only the information in the provided excerpts to answer.
2. If the answer is not in the excerpts, reply with EXACTLY this sentence and nothing else: "That's not in the document."
3. Quote or paraphrase excerpts faithfully. Do not invent numbers, names, dates, or claims.
4. If the excerpts only partially answer the question, answer what you can and clearly state what is not covered.
5. Never use outside knowledge, even if you recognise the topic.
6. Keep answers concise and direct.`;

export type ChatTurn = { role: "user" | "assistant"; content: string };

export async function askGrounded(
  question: string,
  excerpts: string[],
  history: ChatTurn[] = []
): Promise<string> {
  const client = getChatClient();
  const model = getChatModel();

  const excerptBlock = excerpts
    .map((e, i) => `[Excerpt ${i + 1}]\n${e}`)
    .join("\n\n");

  const userMessage =
    excerpts.length > 0
      ? `Document excerpts:\n\n${excerptBlock}\n\nQuestion: ${question}`
      : `Question: ${question}`;

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: GROUNDED_SYSTEM_PROMPT },
    ...history.map((t) => ({ role: t.role, content: t.content })),
    { role: "user", content: userMessage },
  ];

  const completion = await client.chat.completions.create({
    model,
    messages,
    temperature: 0,
  });

  return completion.choices[0]?.message?.content?.trim() || "That's not in the document.";
}
