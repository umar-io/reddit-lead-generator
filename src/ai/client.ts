/** Shared Groq client + strict JSON helper. */
import Groq from "groq-sdk";
import { config } from "../env.js";

let client: Groq | null = null;

export function getGroq(): Groq {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY is missing. Make sure src/env.ts ran first."
    );
  }
  if (!client) client = new Groq({ apiKey });
  return client;
}

export function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1]!.trim() : trimmed;
}

export async function chatJson(
  system: string,
  user: string,
  opts: { temperature?: number; maxTokens?: number } = {}
): Promise<unknown> {
  const groq = getGroq();
  const completion = await groq.chat.completions.create({
    model: config.groqModel,
    temperature: opts.temperature ?? 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("Groq returned an empty response");
  try {
    return JSON.parse(stripCodeFences(content)) as unknown;
  } catch {
    throw new Error(`Groq returned invalid JSON: ${content.slice(0, 500)}`);
  }
}
