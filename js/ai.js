// PG's optional AI brain, using your own API key. Calls go straight from this device to the provider.
import { S } from "./store.js";

export const PROVIDERS = {
  openai:    { label: "OpenAI",        model: "gpt-6.1-terra",    keyUrl: "https://platform.openai.com/api-keys" },
  anthropic: { label: "Claude",        model: "claude-haiku-5-5", keyUrl: "https://platform.claude.com/settings/keys" },
  gemini:    { label: "Google Gemini", model: "gemini-3.8-flash", keyUrl: "https://aistudio.google.com/app/apikey" }
};
// Retired defaults from older versions get upgraded automatically.
const OLD = /^(?:gpt-4o-mini|gpt-4o|gpt-5-mini|gemini-2\.5-flash|gemini-1\.5-flash)$/;

export function detect(key) {
  key = (key || "").trim();
  if (/^sk-ant-/.test(key)) return "anthropic";
  if (/^AIza/.test(key)) return "gemini";
  if (/^sk-/.test(key)) return "openai";
  return null;
}
export const on = () => !!(S.ai && S.ai.key && S.ai.provider && S.ai.provider !== "none");
export const modelOf = () => { const m = (S.ai.model || "").trim(); return m && !OLD.test(m) ? m : PROVIDERS[S.ai.provider]?.model; };

const withTimeout = (p, ms = 25000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
async function fail(r) {
  let msg = ""; try { const j = await r.json(); msg = j.error?.message || j.error?.type || JSON.stringify(j).slice(0, 200); } catch {}
  const e = new Error(msg || "HTTP " + r.status); e.status = r.status; throw e;
}

// messages: [{role:"user"|"assistant", content}]
export async function call(system, messages, { json = false, max = 700 } = {}) {
  const { provider, key } = S.ai, model = modelOf();
  if (typeof messages === "string") messages = [{ role: "user", content: messages }];
  if (provider === "openai") {
    const body = { model, messages: [{ role: "system", content: system }, ...messages], max_completion_tokens: max, ...(json ? { response_format: { type: "json_object" } } : {}) };
    const go = b => withTimeout(fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + key }, body: JSON.stringify(b) }));
    let r = await go({ ...body, reasoning_effort: "none" });
    if (r.status === 400) r = await go(body);               // model without that option
    if (!r.ok) await fail(r);
    return (await r.json()).choices?.[0]?.message?.content || "";
  }
  if (provider === "anthropic") {
    const r = await withTimeout(fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" }, body: JSON.stringify({ model, max_tokens: max + 800, system, messages: merge(messages) }) }));
    if (!r.ok) await fail(r);
    const j = await r.json();
    return (j.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  }
  if (provider === "gemini") {
    const r = await withTimeout(fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: merge(messages).map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })), generationConfig: json ? { responseMimeType: "application/json" } : {} }) }));
    if (!r.ok) await fail(r);
    const j = await r.json();
    return (j.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join("");
  }
  return "";
}
// Providers want turns to alternate and start with the user.
function merge(ms) {
  const out = [];
  ms.forEach(m => { if (!m.content) return; const last = out.at(-1); if (last && last.role === m.role) last.content += "\n" + m.content; else out.push({ ...m }); });
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}
export function parseJSON(raw) {
  const s = String(raw || "").replace(/^```(?:json)?\s*|```\s*$/g, "");
  try { return JSON.parse(s); } catch {}
  const m = s.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}
export async function test() {
  const t = await call("Reply with the single word: ready", "Are you there?", { max: 20 });
  return /\w/.test(t);
}
export function friendlyError(e) {
  if (e?.status === 401 || e?.status === 403) return "That key didn't work. Check it was copied fully.";
  if (e?.status === 429) return "The key is out of credit or rate limited right now.";
  if (e?.status === 404) return "That model name wasn't found. Clear the model box to use the default.";
  if (e?.message === "timeout") return "The AI took too long to answer.";
  if (e instanceof TypeError) return "Couldn't reach the AI. Check your internet.";
  return "The AI had a problem: " + String(e?.message || e).slice(0, 120);
}
