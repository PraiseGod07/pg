// PG Cloud sync: keeps every unlocked device on the same data through your own Cloudflare Worker.
import { S, save, adopt, onSave, wipe } from "./store.js";
import { PG_CLOUD } from "./config.js";

const cloud = () => (S.dev.cloud = S.dev.cloud || { url: "", token: "", last: 0 });
export const url = () => (cloud().url || PG_CLOUD || "").replace(/\/+$/, "");
export const on = () => !!(cloud().token && url());
export const locked = () => !S.dev.trusted && !on();
export const last = () => cloud().last || 0;
let busy = () => false, changed = () => {}, revoked = () => {}, timer = 0, pushing = false, again = false;
export function init(o) { busy = o.busy || busy; changed = o.changed || changed; revoked = o.revoked || revoked; }

// What leaves this device: everything except this device's own settings.
const shareable = () => { const o = JSON.parse(JSON.stringify(S)); delete o.dev; if (o.voice) delete o.voice.voiceURI; return o; };
const deviceName = () => { const u = navigator.userAgent; return /iPhone/.test(u) ? "iPhone" : /iPad/.test(u) ? "iPad" : /Android/.test(u) ? "Android phone" : /Mac/.test(u) ? "Mac" : /Windows/.test(u) ? "Windows laptop" : "Device"; };

async function api(path, o = {}) {
  const r = await fetch(url() + path, { ...o, headers: { "content-type": "application/json", ...(cloud().token ? { authorization: "Bearer " + cloud().token } : {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error?.message || `PG Cloud error ${r.status}`); e.status = r.status; e.data = j; throw e; }
  return j;
}
function lost(e) {
  // This device was signed out from another device: lock it and clear its copy of the data.
  if (e?.status === 401 && cloud().token && !e.unlocking) { wipe(); revoked(); return true; }
  return false;
}

export async function unlock(address, passcode) {
  const u = (address || PG_CLOUD || "").trim().replace(/\/+$/, "");
  if (!/^https:\/\/[^/]+/.test(u)) { const e = new Error("Paste your PG Cloud address. It starts with https:// and ends in .workers.dev."); throw e; }
  let r;
  try { r = await fetch(u + "/unlock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: String(passcode || "").trim(), device: deviceName() }) }); }
  catch { throw new Error("Couldn't reach PG Cloud. Check the address, and that you pressed Deploy in Cloudflare."); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || (r.status === 404 ? "That address isn't PG Cloud. Check you pasted the PG Cloud code and pressed Deploy." : `PG Cloud error ${r.status}`));
  Object.assign(cloud(), { url: u, token: j.token, last: 0 }); S.dev.trusted = true; save(true);
  const st = await api("/state");
  if (st.data) { adopt(st.data, st.t); cloud().last = Date.now(); save(true); changed(); return { first: j.first, adopted: true }; }
  await push(); return { first: j.first, adopted: false };
}

export async function pull() {
  if (!on() || pushing) return;
  try {
    const st = await api("/state");
    cloud().last = Date.now();
    if (st.data && st.t > (S.t || 0)) {
      if (busy()) { setTimeout(pull, 4000); return; }
      adopt(st.data, st.t); save(true); changed();
    } else save(true);
  } catch (e) { lost(e); }
}
export async function push() {
  if (!on()) return;
  if (pushing) { again = true; return; }
  pushing = true;
  try { await api("/state", { method: "PUT", body: JSON.stringify({ t: S.t || Date.now(), data: shareable() }) }); cloud().last = Date.now(); save(true); }
  catch (e) { if (!lost(e) && e.status === 409 && e.data?.data) { adopt(e.data.data, e.data.t); save(true); changed(); } }
  finally { pushing = false; if (again) { again = false; push(); } }
}
export async function signOutOthers() { await api("/devices", { method: "DELETE" }); }
export function disconnect() { Object.assign(cloud(), { token: "", last: 0 }); save(true); }

onSave(() => { if (!on()) return; clearTimeout(timer); timer = setTimeout(push, 1200); });
document.addEventListener("visibilitychange", () => { if (document.hidden) { if (timer) { clearTimeout(timer); push(); } } else pull(); });
setInterval(() => { if (!document.hidden) pull(); }, 20000);
