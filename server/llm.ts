import { z } from "zod";

export interface LlmConfig { apiKey: string; model: string; fetchImpl?: typeof fetch }

export function llmFromEnv(env = process.env): LlmConfig | undefined {
  if (!env.ANTHROPIC_API_KEY || !env.LLM_MODEL) return undefined;
  return { apiKey: env.ANTHROPIC_API_KEY, model: env.LLM_MODEL };
}

/** Single bounded call; returns validated JSON or throws. The model never executes tools or code here. */
export async function llmJson<T>(cfg: LlmConfig, system: string, user: string, schema: z.ZodType<T>): Promise<T> {
  const res = await (cfg.fetchImpl ?? fetch)("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: cfg.model, max_tokens: 1500, system: system + "\nRespond with a single JSON object only.", messages: [{ role: "user", content: user }] }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`LLM provider returned HTTP ${res.status}`);
  const j: any = await res.json();
  const text: string = j?.content?.find((c: any) => c.type === "text")?.text ?? "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("LLM returned no JSON");
  return schema.parse(JSON.parse(m[0]));
}
