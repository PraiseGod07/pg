// PG service worker: offline app shell, network-first for app files so updates arrive quickly.
const CACHE = "pg-v3.7.0";
const SHELL = ["./", "./index.html", "./styles.css", "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png",
  "./js/app.js", "./js/commands.js", "./js/dates.js", "./js/nlu.js", "./js/scheduler.js", "./js/store.js", "./js/voice.js", "./js/coach.js", "./js/library.js", "./js/util.js",
  "./js/bass.js", "./js/bible.js", "./js/bibledata.js", "./js/brain.js", "./js/learn.js", "./js/food.js", "./js/school.js", "./js/speech.js", "./js/agent.js", "./js/sync.js", "./js/config.js", "./js/daily.js", "./js/verses.js", "./js/canto.js", "./js/web.js", "./js/hearing.js", "./js/merge.js", "./js/timetable.js", "./js/phrasebook.js", "./js/carryover.js"];
SHELL.push("./js/collections.js", "./js/alarms.js", "./js/goals.js", "./js/routines.js", "./js/appearance.js");
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(windows => {
    const app = windows.find(w => w.url.startsWith(self.registration.scope));
    return app ? app.focus() : self.clients.openWindow(self.registration.scope);
  }));
});
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && /^pg-v\d/.test(k)).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith(fetch(req, { cache: "no-cache" }).then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; }).catch(() => caches.match(req).then(r => r || (req.mode === "navigate" ? caches.match("./index.html") : Response.error()))));
  } else if (/fonts\.(googleapis|gstatic)\.com|fontshare\.com|i\.ytimg\.com/.test(url.host)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })));
  }
});
