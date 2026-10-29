/** Strip anything that looks like a credential from text that may be logged or returned. */
export function redact(input: string, env: NodeJS.ProcessEnv = process.env): string {
  let s = String(input);
  for (const k of ["QLOO_API_KEY", "ANTHROPIC_API_KEY"]) { const v = env[k]; if (v && v.length >= 8) s = s.split(v).join("[redacted]"); }
  return s.replace(/hack_[0-9a-f]{16,}/gi, "[redacted]").replace(/sk-[A-Za-z0-9_-]{16,}/g, "[redacted]");
}
