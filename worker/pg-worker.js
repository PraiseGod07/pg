// PG Cloud: your private PG server on your own Cloudflare account.
// 2) Keeps PG's data so your laptop and phone stay the same (needs a D1 database binding named DB).
// 4) Lets PG look things up on the internet for free (DuckDuckGo, Google News, Bing and Wikipedia, then reads the top pages),
//    and gets live weather from Open-Meteo.
// 5) Only devices that enter your passcode can use it. The passcode is set the first time you connect
//    and is stored only as a salted hash in your database. Wrong guesses are limited.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Max-Age": "86400" };
const VERSION = 6;
const withoutCredentials = data => JSON.stringify(data, (key, value) => /^(?:ai|dev|api[_-]?key|secret[_-]?key|search[_-]?key|access[_-]?token|password|credential)$/i.test(key) ? undefined : value);
const out = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" } });
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

// Internet lookups, free and keyless: DuckDuckGo, Google News and Wikipedia, then the text of the top pages.
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
// Keep only results that are actually about the question.
const STOP = new Set("a an the and or of to in on at for from with by is are was were be been it its this that these those what whats which who whom how when where why do does did can could will would should i me my you your we our they them their he she his her about tell please now right today latest current there any some get find show give".split(" "));
const words = q => String(q).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length > 1 && !STOP.has(w));
function relevant(q, list) {
  const k = words(q); if (!k.length) return list;
  const need = k.length >= 4 ? 2 : 1;
  return list.filter(x => { const t = (x.title + " " + x.snippet + " " + x.url).toLowerCase(); return k.filter(w => t.includes(w)).length >= need; });
}
async function ddg(q) {
  const r = await fetch("https://html.duckduckgo.com/html/", { method: "POST", headers: { ...UA, "content-type": "application/x-www-form-urlencoded", referer: "https://html.duckduckgo.com/" }, body: "q=" + encodeURIComponent(q) + "&kl=us-en" });
  if (r.status !== 200) return [];
  const h = await r.text(), outl = [];
  const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>)?/g;
  let m;
  while ((m = re.exec(h)) && outl.length < 8) {
    let u = ent(m[1]); const d = u.match(/[?&]uddg=([^&]+)/); if (d) u = decodeURIComponent(d[1]); if (u.startsWith("//")) u = "https:" + u;
    if (/duckduckgo\.com\/y\.js|ad_provider/.test(u)) continue;
    outl.push({ title: ent(m[2].replace(/<[^>]+>/g, "")).trim(), url: u, snippet: ent(String(m[3] || "").replace(/<[^>]+>/g, "")).trim().slice(0, 400) });
  }
  return outl;
}
async function wiki(q) {
  const s = await (await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=3`, { headers: UA })).json();
  const t = (s.query?.search || []).slice(0, 2).map(x => x.title); if (!t.length) return [];
  const ex = await (await fetch(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exintro=1&format=json&titles=${encodeURIComponent(t.join("|"))}`, { headers: UA })).json();
  return Object.values(ex.query?.pages || {}).map(p => ({ title: p.title + " - Wikipedia", url: "https://en.wikipedia.org/wiki/" + encodeURIComponent(p.title.replace(/ /g, "_")), snippet: String(p.extract || "").slice(0, 400), text: String(p.extract || "").slice(0, 2000), site: "Wikipedia" }));
}
async function web(q, news) {
  const e = encodeURIComponent(q);
  const [d, g, w, bg] = await Promise.all([
    ddg(q).catch(() => []),
    rss(`https://news.google.com/rss/search?q=${e}&hl=en-US&gl=US&ceid=US:en`, 10).catch(() => []),
    wiki(q).catch(() => []),
    rss(`https://www.bing.com/search?q=${e}&format=rss&setlang=en&cc=US`, 8).catch(() => [])
  ]);
  const dd = relevant(q, d), gg = relevant(q, g), ww = relevant(q, w), bb = relevant(q, bg);
  const results = (news ? [...gg.slice(0, 6), ...dd, ...bb, ...ww] : [...dd, ...bb.slice(0, 4), ...gg.slice(0, 4), ...ww]).filter((x, i, a) => x.title && x.url && a.findIndex(y => y.url === x.url) === i);
  const read = results.filter(x => !x.text && !/news\.google\.com|youtube\.com|facebook\.com|instagram\.com|tiktok\.com|x\.com|twitter\.com|reddit\.com/.test(x.url)).slice(0, 4);
  const texts = await Promise.all(read.map(x => pageText(x.url)));
  read.forEach((x, i) => { if (texts[i]) x.text = texts[i]; });
  return { results: results.slice(0, 8), via: { ddg: d.length, news: g.length, wiki: w.length, bing: bb.length } };
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const db = env.DB, path = new URL(req.url).pathname.replace(/\/+$/, "") || "/";
    if (!db) return out({ error: { message: "PG Cloud needs a D1 database binding named DB." } }, 500);
    await setup(db);
    const pass = await get(db, "pass");
    if (path === "/") return out({ pg: true, v: VERSION, ready: !!pass });

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

    if (path === "/state" && req.method === "GET") { const s = await get(db, "state"); return out({ t: s?.t || 0, data: s ? JSON.parse(s.v) : null, sync: 2 }); }
    if (path === "/state" && req.method === "PUT") {
      const b = await req.json(), cur = await get(db, "state");
      if (!b.data || typeof b.data !== "object" || Array.isArray(b.data))
        return out({ error: { message: "Invalid PG state." } }, 400);
      if (b.sync !== 2 || !Number.isSafeInteger(b.base))
        return out({ error: { message: "Reopen PG to update before syncing. This prevents an older device erasing your data." } }, 426);
      if ((cur?.t || 0) !== b.base)
        return out({ t: cur?.t || 0, data: cur ? JSON.parse(cur.v) : null, stale: true, sync: 2 }, 409);
      // Recovery snapshot of the first state replaced each hour. Uses the
      // existing kv schema; no migrations, deletions, or renamed columns.
      if (cur) await db.prepare("INSERT INTO kv (k, v, t) VALUES (?, ?, ?) ON CONFLICT(k) DO NOTHING")
        .bind("recovery:" + Math.floor(Date.now() / 3600000), withoutCredentials(JSON.parse(cur.v)), cur.t).run();
      const t = Math.max(Date.now(), (cur?.t || 0) + 1);
      const result = cur
        ? await db.prepare("UPDATE kv SET v = ?, t = ? WHERE k = ? AND t = ?").bind(withoutCredentials(b.data), t, "state", b.base).run()
        : await db.prepare("INSERT INTO kv (k, v, t) VALUES (?, ?, ?) ON CONFLICT(k) DO NOTHING").bind("state", withoutCredentials(b.data), t).run();
      if (!result.meta?.changes) {
        const latest = await get(db, "state");
        return out({ t: latest?.t || 0, data: latest ? JSON.parse(latest.v) : null, stale: true, sync: 2 }, 409);
      }
      return out({ t, sync: 2 });
    }
    if (path === "/devices" && req.method === "DELETE") { await db.prepare("DELETE FROM dev WHERE tok != ?").bind(await sha(tok)).run(); return out({ ok: true }); }

    // PG's internet
    if (path === "/v1/web" && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      const q = String(b.q || "").trim().slice(0, 200);
      if (!q) return out({ results: [] });
      try { return out(await web(q, !!b.news)); } catch (e) { return out({ error: { message: String(e?.message || e) } }, 502); }
    }
    // Confirm a public YouTube video before embedding it. No API key needed.
    if (path === "/v1/video" && req.method === "GET") {
      const id = new URL(req.url).searchParams.get("id") || "";
      if (!/^[\w-]{11}$/.test(id)) return out({ error: { message: "Invalid video ID." } }, 400);
      try {
        const r = await fetch("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent("https://www.youtube.com/watch?v=" + id));
        if (!r.ok) return out({ error: { message: "This video is unavailable." } }, 404);
        const v = await r.json();
        return out({ id, title: String(v.title || "").slice(0, 300), by: String(v.author_name || "YouTube").slice(0, 100) });
      } catch { return out({ error: { message: "Couldn't check the video." } }, 502); }
    }
    // Live weather, for phones that can't reach Open-Meteo directly
    if (path === "/v1/weather" && req.method === "GET") {
      const u = new URL(req.url);
      const r = await fetch("https://api.open-meteo.com/v1/forecast" + u.search);
      return new Response(r.body, { status: r.status, headers: { ...CORS, "content-type": "application/json" } });
    }
    return out({ error: { message: "Not found" } }, 404);
  }
};
