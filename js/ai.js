// PG's optional AI brain, using your own API key. Calls go straight from this device to the provider.
import { S, save } from "./store.js";
import * as SY from "./sync.js";

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
  cloudflare: { label: "Cloudflare Workers AI (PG Cloud)", kind: "oa", model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", keyUrl: "https://dash.cloudflare.com/?to=/:account/ai/workers-ai", cf: true },
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
// A broken setup (unknown service, or "other" with no web address) falls back to his Cloudflare AI on PG Cloud.
function fix() {
  if (!S.ai) return;
  const pv = S.ai.provider, broken = !PROVIDERS[pv] || (pv === "custom" && !/^https:\/\//.test(S.ai.base || "")) || (pv !== "cloudflare" && pv !== "none" && !S.ai.key);
  if (broken && pv !== "none" && SY.on()) { S.ai.provider = "cloudflare"; S.ai.autoModel = ""; if (/^(?!@cf\/)/.test(S.ai.model || "@cf/")) S.ai.model = ""; save(); }
}
const P = () => { fix(); return PROVIDERS[S.ai.provider] || PROVIDERS.custom; };
const baseOf = () => {
  if (S.ai.provider === "cloudflare") return SY.on() ? SY.url() + "/v1" : "";
  return (S.ai.provider === "custom" ? (S.ai.base || "") : P().base || "").replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
};
// The Worker you paste into Cloudflare: runs Workers AI, keeps devices in sync, checks the passcode.
export const CLOUD_CODE = "// PG Cloud: your private PG server on your own Cloudflare account.\n// 1) Runs Workers AI for PG (needs a Workers AI binding named AI).\n// 2) Keeps PG's data so your laptop and phone stay the same (needs a D1 database binding named DB).\n// 3) Gives PG a natural voice (Deepgram Aura-2) and good hearing (Deepgram Nova-3), also through Workers AI.\n// 4) Only devices that enter your passcode can use it. The passcode is set the first time you connect\n//    and is stored only as a salted hash in your database. Wrong guesses are limited.\nconst CORS = { \"Access-Control-Allow-Origin\": \"*\", \"Access-Control-Allow-Methods\": \"GET, PUT, POST, DELETE, OPTIONS\", \"Access-Control-Allow-Headers\": \"authorization, content-type\", \"Access-Control-Max-Age\": \"86400\" };\nconst MODEL = \"@cf/meta/llama-3.3-70b-instruct-fp8-fast\";\nconst VERSION = 2;\nconst VOICES = /^(amalthea|andromeda|apollo|arcas|aries|asteria|athena|atlas|aurora|callista|cora|cordelia|delia|draco|electra|harmonia|helena|hera|hermes|hyperion|iris|janus|juno|jupiter|luna|mars|minerva|neptune|odysseus|ophelia|orion|orpheus|pandora|phoebe|pluto|saturn|thalia|theia|vesta|zeus)$/;\nconst out = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, \"content-type\": \"application/json\" } });\nconst hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, \"0\")).join(\"\");\nconst rand = n => hex(crypto.getRandomValues(new Uint8Array(n)));\nasync function hash(s, salt) {\n  const k = await crypto.subtle.importKey(\"raw\", new TextEncoder().encode(s), \"PBKDF2\", false, [\"deriveBits\"]);\n  return hex(await crypto.subtle.deriveBits({ name: \"PBKDF2\", hash: \"SHA-256\", salt: new TextEncoder().encode(salt), iterations: 100000 }, k, 256));\n}\nconst sha = async s => hex(await crypto.subtle.digest(\"SHA-256\", new TextEncoder().encode(s)));\nasync function setup(db) {\n  await db.batch([\n    db.prepare(\"CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, t INTEGER)\"),\n    db.prepare(\"CREATE TABLE IF NOT EXISTS dev (tok TEXT PRIMARY KEY, name TEXT, t INTEGER)\"),\n    db.prepare(\"CREATE TABLE IF NOT EXISTS fails (who TEXT, t INTEGER)\")\n  ]);\n}\nconst get = async (db, k) => (await db.prepare(\"SELECT v, t FROM kv WHERE k = ?\").bind(k).first()) || null;\nconst put = (db, k, v, t = Date.now()) => db.prepare(\"INSERT INTO kv (k, v, t) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, t = excluded.t\").bind(k, v, t).run();\n\nexport default {\n  async fetch(req, env) {\n    if (req.method === \"OPTIONS\") return new Response(null, { headers: CORS });\n    const db = env.DB, path = new URL(req.url).pathname.replace(/\\/+$/, \"\") || \"/\";\n    if (!db) return out({ error: { message: \"PG Cloud needs a D1 database binding named DB.\" } }, 500);\n    await setup(db);\n    const pass = await get(db, \"pass\");\n    if (path === \"/\") return out({ pg: true, v: VERSION, voice: !!env.AI, ready: !!pass, ai: !!env.AI });\n\n    if (path === \"/unlock\" && req.method === \"POST\") {\n      const ip = req.headers.get(\"cf-connecting-ip\") || \"?\", now = Date.now();\n      await db.prepare(\"DELETE FROM fails WHERE t < ?\").bind(now - 3600000).run();\n      const mine = (await db.prepare(\"SELECT COUNT(*) n FROM fails WHERE who = ? AND t > ?\").bind(ip, now - 900000).first()).n;\n      const all = (await db.prepare(\"SELECT COUNT(*) n FROM fails\").first()).n;\n      if (mine >= 5 || all >= 30) return out({ error: { message: \"Too many wrong passcodes. Try again in 15 minutes.\" } }, 429);\n      const b = await req.json().catch(() => ({})), code = String(b.passcode || \"\");\n      if (!pass) {\n        if (code.length < 4) return out({ error: { message: \"Choose a passcode with at least 4 characters.\" } }, 400);\n        const salt = rand(16); await put(db, \"pass\", salt + \":\" + await hash(code, salt));\n      } else {\n        const [salt, h] = pass.v.split(\":\");\n        if (await hash(code, salt) !== h) { await db.prepare(\"INSERT INTO fails (who, t) VALUES (?, ?)\").bind(ip, now).run(); return out({ error: { message: \"Wrong passcode.\" } }, 401); }\n      }\n      const tok = rand(32);\n      await db.prepare(\"INSERT INTO dev (tok, name, t) VALUES (?, ?, ?)\").bind(await sha(tok), String(b.device || \"Device\").slice(0, 60), now).run();\n      return out({ token: tok, first: !pass });\n    }\n\n    // Everything below needs an unlocked device\n    const tok = (req.headers.get(\"authorization\") || \"\").replace(/^Bearer\\s+/i, \"\");\n    if (!tok || !(await db.prepare(\"SELECT 1 FROM dev WHERE tok = ?\").bind(await sha(tok)).first())) return out({ error: { message: \"Locked. Enter your passcode.\" } }, 401);\n\n    if (path === \"/state\" && req.method === \"GET\") { const s = await get(db, \"state\"); return out({ t: s?.t || 0, data: s ? JSON.parse(s.v) : null }); }\n    if (path === \"/state\" && req.method === \"PUT\") {\n      const b = await req.json(), cur = await get(db, \"state\");\n      if (cur && b.t < cur.t) return out({ t: cur.t, data: JSON.parse(cur.v), stale: true }, 409);\n      await put(db, \"state\", JSON.stringify(b.data), b.t); return out({ t: b.t });\n    }\n    if (path === \"/devices\" && req.method === \"DELETE\") { await db.prepare(\"DELETE FROM dev WHERE tok != ?\").bind(await sha(tok)).run(); return out({ ok: true }); }\n\n    if (path === \"/v1/chat/completions\" && req.method === \"POST\") {\n      if (!env.AI) return out({ error: { message: \"PG Cloud needs a Workers AI binding named AI.\" } }, 500);\n      const b = await req.json(), model = /^@cf\\//.test(b.model || \"\") ? b.model : MODEL;\n      const input = { messages: b.messages, max_tokens: b.max_tokens || b.max_completion_tokens || 700 };\n      for (const k of [\"temperature\"]) if (b[k] != null) input[k] = b[k];\n      try {\n        const r = await env.AI.run(model, input);\n        if (r?.choices) return out(r);\n        const c = r?.response ?? r?.output_text ?? r?.result?.response ?? \"\";\n        return out({ model, choices: [{ index: 0, message: { role: \"assistant\", content: typeof c === \"string\" ? c : JSON.stringify(c) } }] });\n      } catch (e) { return out({ error: { message: String(e?.message || e) } }, 502); }\n    }\n    // PG's voice: text in, natural speech (mp3) out\n    if (path === \"/v1/tts\" && req.method === \"POST\") {\n      if (!env.AI) return out({ error: { message: \"PG Cloud needs a Workers AI binding named AI.\" } }, 500);\n      const b = await req.json().catch(() => ({})), text = String(b.text || \"\").slice(0, 1900);\n      if (!text.trim()) return out({ error: { message: \"No text.\" } }, 400);\n      try {\n        let a = await env.AI.run(\"@cf/deepgram/aura-2-en\", { text, speaker: VOICES.test(b.voice || \"\") ? b.voice : \"luna\", encoding: \"mp3\" });\n        if (a instanceof Response) a = a.body;\n        else if (a?.audio) a = Uint8Array.from(atob(a.audio), c => c.charCodeAt(0));\n        return new Response(a, { headers: { ...CORS, \"content-type\": \"audio/mpeg\", \"cache-control\": \"no-store\" } });\n      } catch (e) { return out({ error: { message: String(e?.message || e) } }, 502); }\n    }\n    // PG's ears: recorded speech (wav) in, words out\n    if (path === \"/v1/stt\" && req.method === \"POST\") {\n      if (!env.AI) return out({ error: { message: \"PG Cloud needs a Workers AI binding named AI.\" } }, 500);\n      const buf = await req.arrayBuffer(), type = req.headers.get(\"content-type\") || \"audio/wav\";\n      if (buf.byteLength < 500 || buf.byteLength > 8e6) return out({ text: \"\" });\n      try {\n        const r = await env.AI.run(\"@cf/deepgram/nova-3\", { audio: { body: new Response(buf).body, contentType: type }, smart_format: true, punctuate: true, language: \"en\" });\n        const t = r?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? r?.text;\n        if (typeof t === \"string\") return out({ text: t.trim(), by: \"nova-3\" });\n        throw new Error(\"no transcript\");\n      } catch (e) {\n        try {\n          const u = new Uint8Array(buf); let bin = \"\";\n          for (let i = 0; i < u.length; i += 32768) bin += String.fromCharCode.apply(null, u.subarray(i, i + 32768));\n          const r = await env.AI.run(\"@cf/openai/whisper-large-v3-turbo\", { audio: btoa(bin), language: \"en\" });\n          return out({ text: String(r?.text || \"\").trim(), by: \"whisper\" });\n        } catch (e2) { return out({ error: { message: String(e2?.message || e2) } }, 502); }\n      }\n    }\n    return out({ error: { message: \"Not found\" } }, 404);\n  }\n};\n";
export const label = () => S.ai.provider === "custom" ? (S.ai.base ? new URL(S.ai.base).host : "your AI") : P().label.replace(/ \(.*\)$/, "");
export const modelOf = () => { const m = (S.ai.model || "").trim().replace(/^@cf\/zai-org\/glm-5\.3-flash$/, ""); return m && !OLD.test(m) ? m : (S.ai.autoModel || P().model || ""); };

export const on = () => (fix(), S.ai?.provider === "cloudflare") ? SY.on() : !!(S.ai && S.ai.key && S.ai.provider && S.ai.provider !== "none");
const withTimeout = (p, ms = 25000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
async function fail(r) {
  let msg = ""; try { const j = await r.json(); msg = j.error?.message || j.error?.type || j.errors?.[0]?.message || j.message || j.detail || JSON.stringify(j).slice(0, 200); } catch {}
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
  const p = P(), key = p.cf ? SY.on() && S.dev.cloud.token : S.ai.key;
  let model = modelOf();
  if (typeof messages === "string") messages = [{ role: "user", content: messages }];
  if (p.kind === "openai" || p.kind === "oa") {
    const base = baseOf();
    if (!base) { const e = new Error(p.cf ? "nocloud" : "nobase"); throw e; }
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
  const s = String(raw || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim().replace(/^```(?:json)?\s*|```\s*$/g, "");
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
  if (e?.message === "nocloud") return "Connect PG Cloud first, in the PG Cloud card above.";
  if (S.ai?.provider === "cloudflare" && e?.status === 502) return "Workers AI had a problem: " + (e.message || "try again.");
  if (S.ai?.provider === "cloudflare" && e instanceof TypeError) return "Couldn't reach PG Cloud. Check your internet connection.";
  if (S.ai?.provider === "cloudflare" && e?.status === 401) return "This device is locked out of PG Cloud. Enter your passcode in the PG Cloud card.";
  if (e?.status === 401 || e?.status === 403) return "That key didn't work. Check it was copied fully.";
  if (e?.status === 429) return "The key is out of credit or rate limited right now.";
  if (e?.status === 404) return "That model name wasn't found. Clear the model box to use the default.";
  if (e?.message === "timeout") return "The AI took too long to answer. Tap Test to try again, or try a faster model such as gemini-3.5-flash-lite.";
  if (e?.message === "unknownkey") return "None of the AI services I know accepted that key. Pick the company under Provider, or choose Other and paste its web address.";
  if (e?.message === "nobase") return "Paste the service's web address (it usually ends in /v1).";
  if (e instanceof TypeError) return navigator.onLine === false ? "You're offline. Check your internet." : "Couldn't reach that AI from the browser. Check your internet. If it keeps failing, that company may block apps like PG. OpenRouter works with almost any model and does allow it.";
  return "The AI had a problem: " + String(e?.message || e).slice(0, 120);
}
