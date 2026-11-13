// PG's internet: web search through PG Cloud (free Bing and Google News feeds), live weather from Open-Meteo,
// and Wikipedia straight from the browser as a backup. No keys and no cost.
import { S } from "./store.js";
import * as SY from "./sync.js";

const HOME = { name: "Hong Kong", lat: 22.3193, lon: 114.1694 };
const WMO = { 0: "clear skies", 1: "mostly clear", 2: "partly cloudy", 3: "cloudy", 45: "fog", 48: "fog", 51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 56: "freezing drizzle", 57: "freezing drizzle", 61: "light rain", 63: "rain", 65: "heavy rain", 66: "freezing rain", 67: "freezing rain", 71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains", 80: "light showers", 81: "showers", 82: "heavy showers", 85: "snow showers", 86: "heavy snow showers", 95: "thunderstorms", 96: "thunderstorms with hail", 99: "thunderstorms with hail" };

export const WEATHER_RE = /\b(?:weather|forecast|temperature outside|how (?:hot|cold|warm) is it|is it (?:hot|cold|raining|going to rain|gonna rain|sunny|windy)|will it rain|going to rain|gonna rain|(?:need|bring|take) an? umbrella|typhoon|rainstorm warning)\b/i;
// Questions that clearly need fresh facts from the internet.
export const LIVE_RE = /\b(?:news|latest|currently|right now|today'?s|this week|yesterday|tonight|score|scores|who won|won the|result of|results of|standings|price of|stock|share price|bitcoin|crypto|exchange rate|how much is|how much does|release date|come out|coming out|open (?:now|today)|opening hours|election|president of|ceo of|search (?:the )?(?:web|internet|online)|look (?:it )?up|google)\b/i;

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, j) => setTimeout(() => j(new Error("timeout")), ms))]);
const n = x => Math.round(x);

async function place(text) {
  let p = (String(text).match(/\b(?:in|at|for)\s+([A-Za-z][A-Za-z .'-]{1,40}?)(?:\s+(?:right now|now|today|tomorrow|this (?:morning|afternoon|evening|week|weekend)|tonight|later))?\s*[?.!]*$/i) || [])[1] || "";
  p = p.replace(/\b(?:right now|now|today|tomorrow|tonight|later)\b/gi, "").trim();
  if (!p || /^(?:the )?(?:morning|afternoon|evening|night|week|weekend|moment|hong ?kong|hk|here|home)$/i.test(p)) return HOME;
  const j = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(p)}&count=1&language=en`)).json();
  const g = j.results?.[0];
  return g ? { name: g.name + (g.country && g.name !== g.country ? `, ${g.country}` : ""), lat: g.latitude, lon: g.longitude } : HOME;
}

export async function weather(text) {
  const loc = await place(text);
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&timezone=auto&forecast_days=3`;
  const w = await (await withTimeout(fetch(u), 8000)).json();
  const c = w.current, d = w.daily;
  const day = i => `${i === 1 ? "Tomorrow" : "The day after"}: ${WMO[d.weather_code[i]] || "mixed"}, ${n(d.temperature_2m_min[i])} to ${n(d.temperature_2m_max[i])}°C, ${d.precipitation_probability_max[i]}% chance of rain.`;
  return {
    text: `Live weather for ${loc.name} at ${c.time.replace("T", " ")} local time: ${n(c.temperature_2m)}°C, feels like ${n(c.apparent_temperature)}°C, ${WMO[c.weather_code] || "mixed"}, humidity ${c.relative_humidity_2m}%, wind ${n(c.wind_speed_10m)} km/h. Today ${n(d.temperature_2m_min[0])} to ${n(d.temperature_2m_max[0])}°C, ${d.precipitation_probability_max[0]}% chance of rain. ${day(1)} ${day(2)}`,
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
      if (r.ok) results = (await r.json()).results || [];
    } catch (e) { console.warn(e); }
  }
  if (!results.length) { try { results = await withTimeout(wiki(q), 8000); } catch (e) { console.warn(e); } }
  if (!results.length) return null;
  const text = results.slice(0, 8).map((x, i) => `[${i + 1}] ${x.title}${x.site ? ` (${x.site})` : ""}${x.date ? ` (${x.date})` : ""} ${x.url}\n${x.snippet || ""}${x.text ? `\nPage text: ${x.text}` : ""}`).join("\n\n");
  return { text, sources: results.slice(0, 8).map(x => ({ title: x.title, url: x.url, site: x.site || "" })) };
}
