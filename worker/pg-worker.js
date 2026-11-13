// PG Cloud: your private PG server on your own Cloudflare account.
// 1) Runs Workers AI for PG (needs a Workers AI binding named AI).
// 2) Keeps PG's data so your laptop and phone stay the same (needs a D1 database binding named DB).
// 3) Only devices that enter your passcode can use it. The passcode is set the first time you connect
//    and is stored only as a salted hash in your database. Wrong guesses are limited.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Max-Age": "86400" };
const MODEL = "@cf/zai-org/glm-5.3-flash";
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

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const db = env.DB, path = new URL(req.url).pathname.replace(/\/+$/, "") || "/";
    if (!db) return out({ error: { message: "PG Cloud needs a D1 database binding named DB." } }, 500);
    await setup(db);
    const pass = await get(db, "pass");
    if (path === "/") return out({ pg: true, ready: !!pass, ai: !!env.AI });

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
      try {
        const r = await env.AI.run(model, { messages: b.messages, max_tokens: b.max_tokens || 700 });
        if (r?.choices) return out(r);
        const c = r?.response ?? r?.output_text ?? r?.result?.response ?? "";
        return out({ model, choices: [{ index: 0, message: { role: "assistant", content: typeof c === "string" ? c : JSON.stringify(c) } }] });
      } catch (e) { return out({ error: { message: String(e?.message || e) } }, 502); }
    }
    return out({ error: { message: "Not found" } }, 404);
  }
};
