const STORE = "pg-appearance";
const CACHE = "pg-appearance-data";
const fileURL = () => new URL("./__pgdata/wallpaper", location.href).href;
export const accents = { gold: "", blue: "#79BDF4", green: "#79C9A8", rose: "#E5A0BA" };
export const appearanceDefaults = () => ({ fontScale: 1, theme: "dark", accent: "gold" });
export function appearanceValues(input = {}) {
  const num = Number(input.fontScale);
  return { fontScale: Number.isFinite(num) ? Math.round(Math.min(1.6, Math.max(.8, num)) * 100) / 100 : 1,
    theme: ["light", "dark", "auto"].includes(input.theme) ? input.theme : "dark",
    accent: Object.hasOwn(accents, input.accent) ? input.accent : "gold" };
}
export function applyAppearance(input) {
  const a = appearanceValues(input), root = document.documentElement;
  root.dataset.theme = a.theme;
  root.style.setProperty("--font-scale", a.fontScale);
  root.style.setProperty("--user-accent", accents[a.accent]);
  try { localStorage.setItem(STORE, JSON.stringify(a)); } catch {}
}
let objectURL = "";
function paintWallpaper(blob) {
  if (objectURL) URL.revokeObjectURL(objectURL);
  objectURL = blob ? URL.createObjectURL(blob) : "";
  document.documentElement.style.setProperty("--wallpaper", objectURL ? `url("${objectURL}")` : "none");
}
export async function loadWallpaper() {
  try {
    const r = await (await caches.open(CACHE)).match(fileURL());
    paintWallpaper(r ? await r.blob() : null);
  } catch {}
}
export async function setWallpaper(file) {
  if (!file || !/^image\/(?:png|jpeg|webp|avif|gif|heic|heif)$/.test(file.type) || file.size > 24 * 1024 * 1024)
    throw new Error("Choose a supported image under 24 MB.");
  const src = URL.createObjectURL(file), image = new Image();
  try {
    image.src = src; await image.decode();
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight)), canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", .82));
    if (!blob) throw new Error("Could not resize that image.");
    await (await caches.open(CACHE)).put(fileURL(), new Response(blob)); paintWallpaper(blob);
  } finally { URL.revokeObjectURL(src); }
}
export async function removeWallpaper() { await (await caches.open(CACHE)).delete(fileURL()); paintWallpaper(null); }
