// "I'm learning X": a step-by-step plan with places to learn each step, and progress tracking.
import { S, save } from "./store.js";
import { today, uid } from "./util.js";

const yt = q => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
const web = q => `https://www.google.com/search?q=${encodeURIComponent(q)}`;
const STEPS = [
  ["The big picture", "What it is and how the pieces fit.", "for beginners overview"],
  ["Core basics", "The first skills everyone learns.", "basics tutorial"],
  ["First guided project", "Follow along and build something small.", "beginner project tutorial"],
  ["Common mistakes", "What trips beginners up, and how to fix it.", "common beginner mistakes"],
  ["Next level", "Intermediate skills.", "intermediate tutorial"],
  ["On your own", "Make something without a tutorial.", "project ideas"]
];
export function tracks() { if (!S.learn) S.learn = { tracks: [], active: null }; return S.learn.tracks; }
export const findTrack = topic => tracks().find(t => t.topic.toLowerCase() === topic.toLowerCase()) || tracks().find(t => topic.toLowerCase().includes(t.topic.toLowerCase()) || t.topic.toLowerCase().includes(topic.toLowerCase()));
export function active() { const L = S.learn || {}; return tracks().find(t => t.id === L.active) || tracks().find(t => t.idx < t.steps.length) || null; }
const tidy = s => s.replace(/\s+/g, " ").trim().replace(/^(?:how to |about |the )/, "").replace(/[.?!]+$/, "");
export const titleCase = s => s.replace(/\b[a-z]/g, c => c.toUpperCase()).replace(/\bSolidworks\b/i, "SolidWorks");
export function create(topic, aiSteps) {
  topic = tidy(topic);
  const ex = findTrack(topic); if (ex) { S.learn.active = ex.id; save(); return ex; }
  const steps = (aiSteps && aiSteps.length ? aiSteps : STEPS.map(([t, d, q]) => ({ t, d, q: topic + " " + q })))
    .map(s => ({ t: s.t, d: s.d, links: [{ label: "Videos", url: yt(s.q) }, { label: "Read", url: web(s.q) }] }));
  const tr = { id: uid(), topic: titleCase(topic), steps, idx: 0, created: today(), log: [] };
  tracks().unshift(tr); S.learn.active = tr.id; save();
  return tr;
}
export function complete(tr = active()) {
  if (!tr || tr.idx >= tr.steps.length) return null;
  const s = tr.steps[tr.idx]; tr.log.push({ date: today(), idx: tr.idx }); tr.idx++; save();
  return { done: s, next: tr.steps[tr.idx] || null, tr };
}
export function remove(id) { S.learn.tracks = tracks().filter(t => t.id !== id); save(); }
export function brief(tr = active()) {
  if (!tr) return "";
  if (tr.idx >= tr.steps.length) return `You've finished every step of ${tr.topic}.`;
  const s = tr.steps[tr.idx];
  return `${tr.topic}, step ${tr.idx + 1} of ${tr.steps.length}: ${s.t}. ${s.d} I've put videos and reading on screen. Say complete when you're done.`;
}
