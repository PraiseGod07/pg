// PG Cloud: your private PG server on your own Cloudflare account.
// 1) Runs Workers AI for PG (needs a Workers AI binding named AI).
// 2) Keeps PG's data so your laptop and phone stay the same (needs a D1 database binding named DB).
// 3) Gives PG a natural voice (Deepgram Aura-2) and good hearing (Deepgram Nova-3), also through Workers AI.
// 4) Lets PG look things up on the internet for free (Bing and Google News search feeds, then reads the top pages).
// 5) Only devices that enter your passcode can use it. The passcode is set the first time you connect
//    and is stored only as a salted hash in your database. Wrong guesses are limited.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Max-Age": "86400" };
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const VERSION = 3;
const VOICES = /^(amalthea|andromeda|apollo|arcas|aries|asteria|athena|atlas|aurora|callista|cora|cordelia|delia|draco|electra|harmonia|helena|hera|hermes|hyperion|iris|janus|juno|jupiter|luna|mars|minerva|neptune|odysseus|ophelia|orion|orpheus|pandora|phoebe|pluto|saturn|thalia|theia|vesta|zeus)$/;
const out = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "content-type": "application/json" } });
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const rand = n => hex(crypto.getRandomValues(new Uint8Array(n)));
async function hash(s, salt) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(s), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 100000 }, k, 256));
}
const sha = async s => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
async function setup(db) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, t INTEGER)"),
    db.prepare("CREATE TABLE IF NOT EXISTS dev (tok TEXT PRIMARY KEY, name TEXT, t INTEGER)"),
    db.prepare("CREATE TABLE IF NOT EXISTS fails (who TEXT, t INTEGER)")
  ]);
}
const get = async (db, k) => (await db.prepare("SELECT v, t FROM kv WHERE k = ?").bind(k).first()) || null;
const put = (db, k, v, t = Date.now()) => db.prepare("INSERT INTO kv (k, v, t) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, t = excluded.t").bind(k, v, t).run();

// Internet lookups, free and keyless: Bing and Google News search feeds, then the text of the top pages.
const UA = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", "accept-language": "en-US,en;q=0.9" };
const ent = s => String(s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const tag = (x, t) => ent((x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1] || "").replace(/<[^>]+>/g, "").trim();
async function rss(u, n) {
  const r = await fetch(u, { headers: UA, redirect: "follow", cf: { cacheTtl: 300 } });
  if (!r.ok) return [];
  return ((await r.text()).match(/<item>[\s\S]*?<\/item>/g) || []).slice(0, n).map(x => ({ title: tag(x, "title"), url: tag(x, "link"), snippet: tag(x, "description").slice(0, 400), date: tag(x, "pubDate"), site: tag(x, "source") }));
}
async function pageText(u) {
  try {
    const r = await Promise.race([fetch(u, { headers: UA, redirect: "follow" }), new Promise((_, j) => setTimeout(() => j(new Error("slow")), 5000))]);
    if (!r.ok || !/html|text/.test(r.headers.get("content-type") || "")) return "";
    let h = (await r.text()).slice(0, 600000);
    h = h.replace(/<(script|style|noscript|svg|header|footer|nav|form|aside)[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
    const main = (h.match(/<(?:article|main)[\s\S]*?<\/(?:article|main)>/i) || [h])[0];
    return ent(main.replace(/<\/(?:p|div|li|h\d|tr|br)>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim().slice(0, 2500);
  } catch { return ""; }
}
async function web(q, news) {
  const e = encodeURIComponent(q);
  const [b, g] = await Promise.all([
    rss(`https://www.bing.com/search?q=${e}&format=rss&setlang=en`, 8).catch(() => []),
    news ? rss(`https://news.google.com/rss/search?q=${e}&hl=en-US&gl=US&ceid=US:en`, 8).catch(() => []) : Promise.resolve([])
  ]);
  const results = [...g.slice(0, 5), ...b].filter(x => x.title && x.url);
  const read = results.filter(x => !/news\.google\.com|youtube\.com|facebook\.com|instagram\.com|tiktok\.com|x\.com|twitter\.com/.test(x.url)).slice(0, 2);
  const texts = await Promise.all(read.map(x => pageText(x.url)));
  read.forEach((x, i) => { if (texts[i]) x.text = texts[i]; });
  return results.slice(0, 8);
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const db = env.DB, path = new URL(req.url).pathname.replace(/\/+$/, "") || "/";
    if (!db) return out({ error: { message: "PG Cloud needs a D1 database binding named DB." } }, 500);
    await setup(db);
    const pass = await get(db, "pass");
    if (path === "/") return out({ pg: true, v: VERSION, voice: !!env.AI, ready: !!pass, ai: !!env.AI });

    if (path === "/unlock" && req.method === "POST") {
      const ip = req.headers.get("cf-connecting-ip") || "?", now = Date.now();
      await db.prepare("DELETE FROM fails WHERE t < ?").bind(now - 3600000).run();
      const mine = (await db.prepare("SELECT COUNT(*) n FROM fails WHERE who = ? AND t > ?").bind(ip, now - 900000).first()).n;
      const all = (await db.prepare("SELECT COUNT(*) n FROM fails").first()).n;
      if (mine >= 5 || all >= 30) return out({ error: { message: "Too many wrong passcodes. Try again in 15 minutes." } }, 429);
      const b = await req.json().catch(() => ({})), code = String(b.passcode || "");
      if (!pass) {
        if (code.length < 4) return out({ error: { message: "Choose a passcode with at least 4 characters." } }, 400);
        const salt = rand(16); await put(db, "pass", salt + ":" + await hash(code, salt));
      } else {
        const [salt, h] = pass.v.split(":");
        if (await hash(code, salt) !== h) { await db.prepare("INSERT INTO fails (who, t) VALUES (?, ?)").bind(ip, now).run(); return out({ error: { message: "Wrong passcode." } }, 401); }
      }
      const tok = rand(32);
      await db.prepare("INSERT INTO dev (tok, name, t) VALUES (?, ?, ?)").bind(await sha(tok), String(b.device || "Device").slice(0, 60), now).run();
      return out({ token: tok, first: !pass });
    }

    // Everything below needs an unlocked device
    const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!tok || !(await db.prepare("SELECT 1 FROM dev WHERE tok = ?").bind(await sha(tok)).first())) return out({ error: { message: "Locked. Enter your passcode." } }, 401);

    if (path === "/state" && req.method === "GET") { const s = await get(db, "state"); return out({ t: s?.t || 0, data: s ? JSON.parse(s.v) : null }); }
    if (path === "/state" && req.method === "PUT") {
      const b = await req.json(), cur = await get(db, "state");
      if (cur && b.t < cur.t) return out({ t: cur.t, data: JSON.parse(cur.v), stale: true }, 409);
      await put(db, "state", JSON.stringify(b.data), b.t); return out({ t: b.t });
    }
    if (path === "/devices" && req.method === "DELETE") { await db.prepare("DELETE FROM dev WHERE tok != ?").bind(await sha(tok)).run(); return out({ ok: true }); }

    if (path === "/v1/chat/completions" && req.method === "POST") {
      if (!env.AI) return out({ error: { message: "PG Cloud needs a Workers AI binding named AI." } }, 500);
      const b = await req.json(), model = /^@cf\//.test(b.model || "") ? b.model : MODEL;
      const input = { messages: b.messages, max_tokens: b.max_tokens || b.max_completion_tokens || 700 };
      for (const k of ["temperature"]) if (b[k] != null) input[k] = b[k];
      try {
        const r = await env.AI.run(model, input);
        if (r?.choices) return out(r);
        const c = r?.response ?? r?.output_text ?? r?.result?.response ?? "";
        return out({ model, choices: [{ index: 0, message: { role: "assistant", content: typeof c === "string" ? c : JSON.stringify(c) } }] });
      } catch (e) { return out({ error: { message: String(e?.message || e) } }, 502); }
    }
    // PG's voice: text in, natural speech (mp3) out
    if (path === "/v1/tts" && req.method === "POST") {
      if (!env.AI) return out({ error: { message: "PG Cloud needs a Workers AI binding named AI." } }, 500);
      const b = await req.json().catch(() => ({})), text = String(b.text || "").slice(0, 1900);
      if (!text.trim()) return out({ error: { message: "No text." } }, 400);
      try {
        let a = await env.AI.run("@cf/deepgram/aura-2-en", { text, speaker: VOICES.test(b.voice || "") ? b.voice : "luna", encoding: "mp3" });
        if (a instanceof Response) a = a.body;
        else if (a?.audio) a = Uint8Array.from(atob(a.audio), c => c.charCodeAt(0));
        return new Response(a, { headers: { ...CORS, "content-type": "audio/mpeg", "cache-control": "no-store" } });
      } catch (e) { return out({ error: { message: String(e?.message || e) } }, 502); }
    }
    // PG's ears: recorded speech (wav) in, words out
    if (path === "/v1/web" && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      const q = String(b.q || "").trim().slice(0, 200);
      if (!q) return out({ results: [] });
      try { return out({ results: await web(q, !!b.news) }); } catch (e) { return out({ error: { message: String(e?.message || e) } }, 502); }
    }
    if (path === "/v1/stt" && req.method === "POST") {
      if (!env.AI) return out({ error: { message: "PG Cloud needs a Workers AI binding named AI." } }, 500);
      const buf = await req.arrayBuffer(), type = req.headers.get("content-type") || "audio/wav";
      if (buf.byteLength < 500 || buf.byteLength > 8e6) return out({ text: "" });
      try {
        const r = await env.AI.run("@cf/deepgram/nova-3", { audio: { body: new Response(buf).body, contentType: type }, smart_format: true, punctuate: true, language: "en" });
        const t = r?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? r?.text;
        if (typeof t === "string") return out({ text: t.trim(), by: "nova-3" });
        throw new Error("no transcript");
      } catch (e) {
        try {
          const u = new Uint8Array(buf); let bin = "";
          for (let i = 0; i < u.length; i += 32768) bin += String.fromCharCode.apply(null, u.subarray(i, i + 32768));
          const r = await env.AI.run("@cf/openai/whisper-large-v3-turbo", { audio: btoa(bin), language: "en" });
          return out({ text: String(r?.text || "").trim(), by: "whisper" });
        } catch (e2) { return out({ error: { message: String(e2?.message || e2) } }, 502); }
      }
    }
    return out({ error: { message: "Not found" } }, 404);
  }
};
