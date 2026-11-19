// Offline-first, three-way cloud sync. Never replace local work with a snapshot.
import { S, save, adopt, onSave, checkpoint, flush, DEFAULTS, inDraft } from "./store.js";
import { mergeState } from "./merge.js";
import { PG_CLOUD } from "./config.js";
const cloud = () => (S.dev.cloud = S.dev.cloud || { url: "", token: "", last: 0 });
export const url = () => (cloud().url || PG_CLOUD || "").replace(/\/+$/, "");
export const on = () => !!(cloud().token && url());
export const locked = () => !S.dev.trusted && !on();
export const last = () => cloud().last || 0;
export const status = () => !on() ? "Not connected to PG Cloud" : cloud().error
  ? "Saved on this device. Cloud sync waiting: " + cloud().error
  : cloud().dirty ? "Saved on this device. Waiting to sync." : "Saved to PG Cloud";
let busy = () => false, changed = () => {}, revoked = () => {}, timer = 0, running = null, again = false;
export function init(o) { busy = o.busy || busy; changed = o.changed || changed; revoked = o.revoked || revoked; }
const copy = o => JSON.parse(JSON.stringify(o));
export const syncContent = o => {
  const v = JSON.parse(JSON.stringify(o, (k, value) => /^(?:api[_-]?key|secret[_-]?key|search[_-]?key|access[_-]?token|password|credential)$/i.test(k) ? undefined : value));
  delete v.dev; delete v.t; delete v.ai;
  if (v.voice) for (const k of ["voiceURI", "handsFree", "alwaysOn", "speak", "natural", "cloudVoice"]) delete v.voice[k];
  return v;
};
const content = syncContent;
const shareable = () => content(S);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const deviceName = () => /iPhone|Android/.test(navigator.userAgent) ? "Phone" : "Laptop";
async function api(path, o = {}) {
  const r = await fetch(url() + path, { cache: "no-store", ...o, headers: { "content-type": "application/json", ...(cloud().token ? { authorization: "Bearer " + cloud().token } : {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error?.message || `PG Cloud error ${r.status}`); e.status = r.status; e.data = j; throw e; }
  return j;
}
function failure(e) {
  cloud().dirty = true;
  cloud().error = e.status === 401 ? "Unlock this device again. Your local data is safe." : "Check your internet connection.";
  if (e.status === 401) { cloud().token = ""; S.dev.trusted = false; revoked(); }
  // Never wipe unsynced work on a network/auth failure.
  save(true);
}
async function synchronize() {
  let notified = false;
  try {
    for (let attempt = 0; attempt < 6; attempt++) {
      again = false;
      const st = await api("/state");
      if (inDraft()) return false;
      const remote = st.data ? content(st.data) : {};
      const local = shareable(), base = cloud().baseline ? content(cloud().baseline) : null;
      if (st.sync !== 2) {
        // Legacy last-write-wins servers are unsafe to upload to. Rescue their
        // existing records locally, but require the new Worker before writing.
        const rescued = mergeState(null, local, remote, content(DEFAULTS()));
        if (!same(local, rescued)) { adopt(rescued, S.t); notified = true; }
        cloud().dirty = true; cloud().safe = false;
        cloud().error = "Update PG Cloud to finish protected sync.";
        save(true); await flush();
        if (notified && !busy()) changed();
        return false;
      }
      const merged = mergeState(base, local, remote, content(DEFAULTS()));
      if (!same(local, merged)) {
        adopt(merged, S.t); save(true); notified = true;
      }
      if (!same(merged, remote) || st.data && (Object.hasOwn(st.data, "ai") || !same(content(st.data), st.data))) {
        // Worker v5 compares base in one atomic DB write.
        const revision = Math.max(Date.now(), (st.t || 0) + 1);
        const sent = copy(merged);
        let accepted;
        try { accepted = await api("/state", { method: "PUT", keepalive: JSON.stringify(sent).length < 55000,
          body: JSON.stringify({ base: st.t || 0, t: revision, data: sent, sync: 2 }) }); }
        catch (e) { if (e.status === 409) continue; throw e; }
        cloud().baseline = sent; cloud().revision = accepted.t || revision;
        cloud().safe = accepted.sync >= 2;
        // Changes made while the request was in flight are still pending.
        cloud().dirty = !same(sent, shareable());
        if (cloud().dirty || again) continue;
      } else {
        cloud().baseline = copy(remote); cloud().revision = st.t || 0;
        cloud().safe = st.sync >= 2; cloud().dirty = false;
      }
      cloud().last = Date.now(); cloud().error = ""; save(true); await flush();
      if (notified && !busy()) changed();
      return true;
    }
    throw new Error("Concurrent edits. Retrying.");
  } catch (e) {
    failure(e); if (notified && !busy()) changed();
    clearTimeout(timer); timer = setTimeout(() => push(), 5000);
    return false;
  }
}
export async function push() {
  if (!on() || inDraft()) return false;
  if (running) { again = true; return running; }
  running = synchronize();
  try { return await running; } finally { running = null; }
}
export const pull = push;
export async function unlock(address, passcode) {
  const u = (address || PG_CLOUD || "").trim().replace(/\/+$/, "");
  if (!/^https:\/\/[^/]+/.test(u)) throw new Error("Paste your PG Cloud address.");
  const r = await fetch(u + "/unlock", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode: String(passcode || "").trim(), device: deviceName() }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || "Couldn't unlock PG Cloud.");
  checkpoint();
  Object.assign(cloud(), { url: u, token: j.token, dirty: true }); S.dev.trusted = true; save(true);
  const ok = await push(); changed();
  if (!ok) throw new Error("Unlocked. Local data is safe, but cloud sync is waiting. Try Sync now.");
  return { first: j.first, adopted: true };
}
export async function signOutOthers() { await api("/devices", { method: "DELETE" }); }
export function disconnect() { Object.assign(cloud(), { token: "", last: 0 }); save(true); }
onSave(() => {
  cloud().dirty = true; save(true);
  if (!on()) return;
  clearTimeout(timer); timer = setTimeout(push, 250);
});
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    clearTimeout(timer); if (on()) push();
  });
  window.addEventListener("online", () => push());
  window.addEventListener("pagehide", () => { if (on()) push(); });
  setInterval(() => { if (!document.hidden && on()) push(); }, 10000);
}
