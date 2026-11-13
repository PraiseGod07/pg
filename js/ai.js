// PG's optional AI brain, using your own API key. Calls go straight from this device to the provider.
import { S, save } from "./store.js";

// "oa" = speaks the OpenAI chat format, which most AI companies support.
// pick: how to choose a good chat model from the provider's own list when no model is set.
export const PROVIDERS = {
  openai:     { label: "OpenAI (ChatGPT)",  kind: "openai", base: "https://api.openai.com/v1", model: "gpt-6.1-terra", keyUrl: "https://platform.openai.com/api-keys", re: /^sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{30,}$/ },
  anthropic:  { label: "Claude",            kind: "anthropic", model: "claude-haiku-5-5", keyUrl: "https://platform.claude.com/settings/keys", re: /^sk-ant-/ },
  gemini:     { label: "Google Gemini",     kind: "gemini", model: "gemini-3.6-flash", keyUrl: "https://aistudio.google.com/app/apikey", re: /^AIza/ },
  openrouter: { label: "OpenRouter (any model)", kind: "oa", base: "https://openrouter.ai/api/v1", model: "openrouter/auto", keyUrl: "https://openrouter.ai/keys", re: /^sk-or-/ },
  groq:       { label: "Groq",              kind: "oa", base: "https://api.groq.com/openai/v1", keyUrl: "https://console.groq.com/keys", re: /^gsk_/, pick: /llama.*(?:70b|maverick|scout)|gpt-oss|qwen|llama/i },
  xai:        { label: "xAI (Grok)",        kind: "oa", base: "https://api.x.ai/v1", keyUrl: "https://console.x.ai", re: /^xai-/, pick: /grok.*(?:fast|mini)|grok/i },
  deepseek:   { label: "DeepSeek",          kind: "oa", base: "https://api.deepseek.com", model: "deepseek-chat", keyUrl: "https://platform.deepseek.com/api_keys", re: /^sk-[a-f0-9]{32}$/ },
  mistral:    { label: "Mistral",           kind: "oa", base: "https://api.mistral.ai/v1", model: "mistral-small-latest", keyUrl: "https://console.mistral.ai/api-keys", re: null },
  perplexity: { label: "Perplexity",        kind: "oa", base: "https://api.perplexity.ai", model: "sonar", keyUrl: "https://www.perplexity.ai/settings/api", re: /^pplx-/, noJson: true },
  together:   { label: "Together AI",       kind: "oa", base: "https://api.together.xyz/v1", keyUrl: "https://api.together.ai/settings/api-keys", re: /^tgp_/, pick: /llama.*(?:70b|instruct)|qwen.*instruct|deepseek-v/i },
  fireworks:  { label: "Fireworks",         kind: "oa", base: "https://api.fireworks.ai/inference/v1", keyUrl: "https://fireworks.ai/account/api-keys", re: /^fw_/, pick: /llama.*instruct|qwen|deepseek/i },
  cerebras:   { label: "Cerebras",          kind: "oa", base: "https://api.cerebras.ai/v1", keyUrl: "https://cloud.cerebras.ai", re: /^csk-/, pick: /llama|qwen|gpt-oss/i },
  custom:     { label: "Other (paste its web address)", kind: "oa", keyUrl: "", re: null, pick: /chat|instruct|turbo|mini|flash|llama|qwen|gpt/i }
};
// Retired defaults from older versions get upgraded automatically.
const OLD = /^(?:gpt-4o-mini|gpt-4o|gpt-5-mini|gemini-2\.5-flash|gemini-1\.5-flash|gemini-3\.8-flash)$/;

export function detect(key) {
  key = (key || "").trim();
  for (const [k, v] of Object.entries(PROVIDERS)) if (v.re && k !== "openai" && v.re.test(key)) return k;
  if (/^sk-/.test(key)) return "openai";
  return null;
}
// Keys with no telltale prefix: these are the services to try one by one.
const PROBE = ["openai", "deepseek", "mistral", "together", "groq", "fireworks", "openrouter", "xai", "cerebras"];
export const on = () => !!(S.ai && S.ai.key && S.ai.provider && S.ai.provider !== "none");
const P = () => PROVIDERS[S.ai.provider] || PROVIDERS.custom;
const baseOf = () => (S.ai.provider === "custom" ? (S.ai.base || "") : P().base || "").replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
export const label = () => S.ai.provider === "custom" ? (S.ai.base ? new URL(S.ai.base).host : "your AI") : P().label.replace(/ \(.*\)$/, "");
export const modelOf = () => { const m = (S.ai.model || "").trim(); return m && !OLD.test(m) ? m : (S.ai.autoModel || P().model || ""); };

const withTimeout = (p, ms = 25000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
async function fail(r) {
  let msg = ""; try { const j = await r.json(); msg = j.error?.message || j.error?.type || j.message || j.detail || JSON.stringify(j).slice(0, 200); } catch {}
  const e = new Error(typeof msg === "string" ? msg : JSON.stringify(msg) || "HTTP " + r.status); e.status = r.status; throw e;
}
const auth = key => ({ "Content-Type": "application/json", Authorization: "Bearer " + key });

// Ask the provider which models it has and choose a sensible chat model.
async function chooseModel(base, key, pick) {
  const r = await withTimeout(fetch(base + "/models", { headers: auth(key) }), 15000);
  if (!r.ok) await fail(r);
  const j = await r.json();
  const ids = (j.data || j.models || []).map(m => m.id || m.name).filter(Boolean)
    .filter(id => !/embed|whisper|tts|audio|image|vision-only|guard|moderation|rerank|transcri|speech|dall|sora/i.test(id));
  return ids.find(id => pick?.test(id)) || ids[0] || "";
}

// messages: [{role:"user"|"assistant", content}]
export async function call(system, messages, { json = false, max = 700 } = {}) {
  const { key } = S.ai, p = P();
  let model = modelOf();
  if (typeof messages === "string") messages = [{ role: "user", content: messages }];
  if (p.kind === "openai" || p.kind === "oa") {
    const base = baseOf();
    if (!base) { const e = new Error("nobase"); throw e; }
    if (!model) { model = S.ai.autoModel = await chooseModel(base, key, p.pick); save(); }
    const body = { model, messages: [{ role: "system", content: system }, ...messages], ...(p.kind === "openai" ? { max_completion_tokens: max } : { max_tokens: max }), ...(json && !p.noJson ? { response_format: { type: "json_object" } } : {}) };
    const go = b => withTimeout(fetch(base + "/chat/completions", { method: "POST", headers: { ...auth(key), ...(S.ai.provider === "openrouter" ? { "HTTP-Referer": location.origin, "X-Title": "PG" } : {}) }, body: JSON.stringify(b) }));
    let r = await go(p.kind === "openai" ? { ...body, reasoning_effort: "none" } : body);
    if (r.status === 400) { const { response_format, ...plain } = body; r = await go(plain); }   // model without those options
    if (r.status === 404 && !S.ai.model && p.pick) { S.ai.autoModel = await chooseModel(base, key, p.pick); save(); r = await go({ ...body, model: S.ai.autoModel }); }
    if (!r.ok) await fail(r);
    const j = await r.json(), c = j.choices?.[0]?.message?.content;
    return Array.isArray(c) ? c.map(x => x.text || "").join("") : (c || "");
  }
  if (p.kind === "anthropic") {
    const r = await withTimeout(fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" }, body: JSON.stringify({ model, max_tokens: max + 800, system, messages: merge(messages) }) }));
    if (!r.ok) await fail(r);
    const j = await r.json();
    return (j.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  }
  if (p.kind === "gemini") {
    // Newer Gemini models "think" before answering by default, which is too slow for a voice chat.
    // Keep thinking as low as the model allows; if a model rejects that setting, retry without it.
    const level = /^gemini-3\.8-flash|pro/.test(model) ? "low" : "minimal";
    const gen = { ...(json ? { responseMimeType: "application/json" } : {}) };
    const go = g => withTimeout(fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: merge(messages).map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })), generationConfig: g }) }), 30000);
    let r = /^gemini-[3-9]/.test(model) ? await go({ ...gen, thinkingConfig: { thinkingLevel: level } }) : await go(gen);
    if (r.status === 400) r = await go(gen);
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
  S.ai.autoModel = "";
  const once = async () => /\w/.test(await call("Reply with the single word: ready", "Are you there?", { max: 20 }));
  if (S.ai.provider !== "auto") return once();
  // Unknown key type: try each service until one accepts the key.
  let last;
  for (const k of PROBE) {
    S.ai.provider = k;
    try { const r = await withTimeout(fetch(PROVIDERS[k].base + "/models", { headers: auth(S.ai.key) }), 8000); if (r.ok) { await once(); return true; } last = r; } catch (e) { last = e; }
  }
  S.ai.provider = "auto";
  const e = new Error("unknownkey"); throw e;
}
export function friendlyError(e) {
  if (e?.status === 401 || e?.status === 403) return "That key didn't work. Check it was copied fully.";
  if (e?.status === 429) return "The key is out of credit or rate limited right now.";
  if (e?.status === 404) return "That model name wasn't found. Clear the model box to use the default.";
  if (e?.message === "timeout") return "The AI took too long to answer. Tap Test to try again, or try a faster model such as gemini-3.5-flash-lite.";
  if (e?.message === "unknownkey") return "None of the AI services I know accepted that key. Pick the company under Provider, or choose Other and paste its web address.";
  if (e?.message === "nobase") return "Paste the service's web address (it usually ends in /v1).";
  if (e instanceof TypeError) return navigator.onLine === false ? "You're offline. Check your internet." : "Couldn't reach that AI from the browser. Check your internet. If it keeps failing, that company may block apps like PG. OpenRouter works with almost any model and does allow it.";
  return "The AI had a problem: " + String(e?.message || e).slice(0, 120);
}
