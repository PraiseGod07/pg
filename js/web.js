// PG's internet: web search through PG Cloud (free Bing and Google News feeds), live weather from Open-Meteo,
// match lists from TheSportsDB, and Wikipedia straight from the browser as a backup. No keys and no cost.
import { S } from "./store.js";
import * as SY from "./sync.js";

const HOME = { name: "Hong Kong", lat: 22.3193, lon: 114.1694 };
const WMO = { 0: "clear skies", 1: "mostly clear", 2: "partly cloudy", 3: "cloudy", 45: "fog", 48: "fog", 51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 56: "freezing drizzle", 57: "freezing drizzle", 61: "light rain", 63: "rain", 65: "heavy rain", 66: "freezing rain", 67: "freezing rain", 71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains", 80: "light showers", 81: "showers", 82: "heavy showers", 85: "snow showers", 86: "heavy snow showers", 95: "thunderstorms", 96: "thunderstorms with hail", 99: "thunderstorms with hail" };

export const WEATHER_RE = /\b(?:weather|forecast|temperature outside|how (?:hot|cold|warm) is it|is it (?:hot|cold|raining|going to rain|gonna rain|sunny|windy)|will it rain|going to rain|gonna rain|(?:need|bring|take) an? umbrella|typhoon|rainstorm warning)\b/i;
// Questions that clearly need fresh facts from the internet.
export const LIVE_RE = /\b(?:news|latest|currently|right now|today'?s|this week|yesterday|tonight|score|scores|who won|won the|result of|results of|standings|price of|stock|share price|bitcoin|crypto|exchange rate|how much is|how much does|release date|come out|coming out|open (?:now|today)|opening hours|election|president of|ceo of|founder of|revenue|net worth|valuation|market cap|stock market|market share|ipo|earnings|funding round|raised \$?\d|how much (?:did|does) .{1,30} (?:make|earn)|biggest companies|top companies|trending|interest rates?|inflation|search (?:the )?(?:web|internet|online)|look (?:it )?up|google)\b/i;

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, j) => setTimeout(() => j(new Error("timeout")), ms))]);
// A real video needs a confirmed YouTube ID, not a model-generated URL.
export async function exerciseVideo(name, supplied) {
  if (!SY.on()) return null;
  let candidates = supplied ? [supplied] : [];
  if (!candidates.length) {
    const found = await withTimeout(search(String(name) + " exercise proper form YouTube"), 7000).catch(() => null);
    candidates = (found?.sources || []).flatMap(x => {
      try {
        const u = new URL(x.url);
        if (/^(?:www\.|m\.)?youtube\.com$/.test(u.hostname)) {
          const id = u.searchParams.get("v") || u.pathname.match(/^\/(?:shorts|embed)\/([\w-]{11})/)?.[1];
          return /^[\w-]{11}$/.test(id || "") ? [id] : [];
        }
        return u.hostname === "youtu.be" && /^[\w-]{11}$/.test(u.pathname.slice(1)) ? [u.pathname.slice(1)] : [];
      } catch { return []; }
    }).slice(0, 2);
  }
  for (const id of candidates) {
    const r = await withTimeout(fetch(SY.url() + "/v1/video?id=" + encodeURIComponent(id), {
      headers: { authorization: "Bearer " + (S.dev.cloud?.token || "") }
    }), 5000).catch(() => null);
    if (!r?.ok) continue;
    const video = await r.json();
    if (video.id === id && video.title) return { id, by: video.by || "YouTube", title: video.title };
  }
  return null; // UI honestly labels its fallback as a YouTube search.
}
const n = x => Math.round(x);

async function place(text) {
  let p = (String(text).match(/\b(?:in|at|for)\s+([A-Za-z][A-Za-z .'-]{1,40}?)(?:\s+(?:right now|now|today|tomorrow|this (?:morning|afternoon|evening|week|weekend)|tonight|later))?\s*[?.!]*$/i) || [])[1] || "";
  p = p.replace(/\b(?:right now|now|today|tomorrow|tonight|later)\b/gi, "").trim();
  if (!p || /^(?:the )?(?:morning|afternoon|evening|night|week|weekend|moment|hong ?kong|hk|here|home)$/i.test(p)) return HOME;
  let j = {}; try { j = await (await withTimeout(fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(p)}&count=1&language=en`), 6000)).json(); } catch {}
  const g = j.results?.[0];
  return g ? { name: g.name + (g.country && g.name !== g.country ? `, ${g.country}` : ""), lat: g.latitude, lon: g.longitude } : HOME;
}

export async function weather(text) {
  const loc = await place(text);
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&timezone=auto&forecast_days=3`;
  let w;
  try { w = await (await withTimeout(fetch(u), 7000)).json(); if (!w.current) throw new Error("bad"); }
  catch (e) {   // phone can't reach Open-Meteo: go through PG Cloud
    if (!SY.on()) throw e;
    w = await (await withTimeout(fetch(SY.url() + "/v1/weather" + u.slice(u.indexOf("?")), { headers: { authorization: "Bearer " + (S.dev.cloud?.token || "") } }), 9000)).json();
  }
  const c = w.current, d = w.daily;
  const day = i => `${i === 1 ? "Tomorrow" : "The day after"}: ${WMO[d.weather_code[i]] || "mixed"}, ${n(d.temperature_2m_min[i])} to ${n(d.temperature_2m_max[i])}°C, ${d.precipitation_probability_max[i]}% chance of rain.`;
  return {
    text: `Live weather for ${loc.name} at ${c.time.replace("T", " ")} local time: ${n(c.temperature_2m)}°C, feels like ${n(c.apparent_temperature)}°C, ${WMO[c.weather_code] || "mixed"}, humidity ${c.relative_humidity_2m}%, wind ${n(c.wind_speed_10m)} km/h. Today ${n(d.temperature_2m_min[0])} to ${n(d.temperature_2m_max[0])}°C, ${d.precipitation_probability_max[0]}% chance of rain. ${day(1)} ${day(2)}`,
    spoken: `Right now in ${loc.name} it's ${n(c.temperature_2m)} degrees, feels like ${n(c.apparent_temperature)}, with ${WMO[c.weather_code] || "mixed weather"}. Today goes from ${n(d.temperature_2m_min[0])} to ${n(d.temperature_2m_max[0])}, with a ${d.precipitation_probability_max[0]}% chance of rain.${d.precipitation_probability_max[0] >= 50 ? " Take an umbrella." : ""}`,
    sources: [{ title: "Open-Meteo", url: "https://open-meteo.com/" }]
  };
}

async function wiki(q) {
  const s = await (await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&origin=*&srlimit=3`)).json();
  const hits = s.query?.search || [];
  if (!hits.length) return [];
  const ex = await (await fetch(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exintro=1&format=json&origin=*&titles=${encodeURIComponent(hits.slice(0, 2).map(h => h.title).join("|"))}`)).json();
  return Object.values(ex.query?.pages || {}).map(p => ({ title: p.title + " - Wikipedia", url: "https://en.wikipedia.org/wiki/" + encodeURIComponent(p.title.replace(/ /g, "_")), snippet: "", text: String(p.extract || "").slice(0, 2000) }));
}

// Search the internet. Returns { text: facts for the AI, sources: [{title, url}] } or null.
export async function search(q, news = /\b(?:news|headlines?|happening)\b/i.test(q)) {
  const y = new Date().getFullYear();
  q = String(q).replace(/[?!.]+$/g, "").replace(/\bthis year\b/gi, String(y)).replace(/\blast year\b/gi, String(y - 1)).trim();
  let results = [];
  if (SY.on()) {
    try {
      const r = await withTimeout(fetch(SY.url() + "/v1/web", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + (S.dev.cloud?.token || "") }, body: JSON.stringify({ q, news }) }), 15000);
      if (r.ok) { const j = await r.json(); results = j.results || []; if (j.via) console.info("PG web", j.via); }
    } catch (e) { console.warn(e); }
  }
  results = relevant(q, results);
  if (!results.length) { try { results = relevant(q, await withTimeout(wiki(q), 8000)); } catch (e) { console.warn(e); } }
  if (!results.length) return null;
  const text = results.slice(0, 8).map((x, i) => `[${i + 1}] ${x.title}${x.site ? ` (${x.site})` : ""}${x.date ? ` (${x.date})` : ""} ${x.url}\n${x.snippet || ""}${x.text ? `\nPage text: ${x.text}` : ""}`).join("\n\n");
  return { text, sources: results.slice(0, 8).map(x => ({ title: x.title, url: x.url, site: x.site || "" })) };
}

// Keep only results that are actually about the question (drops junk like unrelated Microsoft pages).
const STOP = new Set("a an the and or of to in on at for from with by is are was were be been it its this that these those what whats which who whom how when where why do does did can could will would should i me my you your we our they them their he she his her about tell please now right today latest current there any some get find show give".split(" "));
const words = q => String(q).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length > 1 && !STOP.has(w));
export function relevant(q, list) {
  const k = words(q); if (!k.length) return list;
  const need = k.length >= 4 ? 2 : 1;
  return list.filter(x => { const t = `${x.title} ${x.snippet || ""} ${x.url}`.toLowerCase(); return k.filter(w => t.includes(w)).length >= need; });
}

// Fixtures and results for big leagues, from TheSportsDB's free public feed.
const LEAGUES = [
  { re: /\b(?:premier league|epl|english premier|prem)\b/i, id: 4328, name: "Premier League" },
  { re: /\bla ?liga\b/i, id: 4335, name: "La Liga" },
  { re: /\bserie a\b/i, id: 4332, name: "Serie A" },
  { re: /\bbundesliga\b/i, id: 4331, name: "Bundesliga" },
  { re: /\bligue 1\b/i, id: 4334, name: "Ligue 1" },
  { re: /\bchampions league\b|\bucl\b/i, id: 4480, name: "Champions League" },
  { re: /\bnba\b/i, id: 4387, name: "NBA" }
];
export const SPORTS_RE = new RegExp(LEAGUES.map(l => l.re.source).join("|"), "i");
const DB = "https://www.thesportsdb.com/api/v1/json/123/";
const when = ts => { const d = new Date(ts.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? "" : "Z")); return isNaN(d) ? ts : d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Hong_Kong" }); };
export async function sports(text) {
  const lg = LEAGUES.find(l => l.re.test(text)); if (!lg) return null;
  const get = async p => (await (await withTimeout(fetch(DB + p), 8000)).json()).events || [];
  const [next, past] = await Promise.all([get(`eventsnextleague.php?id=${lg.id}`).catch(() => []), get(`eventspastleague.php?id=${lg.id}`).catch(() => [])]);
  const round = async e => e ? (await get(`eventsround.php?id=${lg.id}&r=${e.intRound}&s=${e.strSeason}`).catch(() => [])) : [];
  const [up, done] = await Promise.all([round(next[0]), round(past[0])]);
  const line = e => `${when(e.strTimestamp || e.dateEvent)}: ${e.strHomeTeam} vs ${e.strAwayTeam}${e.intHomeScore != null && e.intHomeScore !== "" ? ` (final ${e.intHomeScore}-${e.intAwayScore})` : ""}${e.strVenue ? ` at ${e.strVenue}` : ""}`;
  const sort = l => [...l].sort((a, b) => String(a.strTimestamp).localeCompare(String(b.strTimestamp)));
  if (!up.length && !done.length) return null;
  return {
    text: `${lg.name} from TheSportsDB (times are Hong Kong time, today is ${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Hong_Kong" })}).\nIf he asks about this weekend or today and the next round starts later, tell him there are no matches then (often an international break) and give him the next round's dates and matches.\nNEXT ROUND${next[0] ? " (round " + next[0].intRound + ")" : ""}:\n${sort(up).map(line).join("\n") || "none listed"}\nLAST ROUND RESULTS${past[0] ? " (round " + past[0].intRound + ")" : ""}:\n${sort(done).map(line).join("\n") || "none listed"}`,
    sources: [{ title: "TheSportsDB", url: `https://www.thesportsdb.com/league/${lg.id}`, site: "TheSportsDB" }]
  };
}
