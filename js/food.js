// Gym food: protein target, high-protein recipes you can cook in Hong Kong, and a shopping list by where to buy.
import { S, save } from "./store.js";
import { today, uid } from "./util.js";

export const STORES = {
  wet: { label: "Wet market", tip: "Fresh meat, fish, tofu and vegetables. Usually cheaper than the supermarket. Go in the morning." },
  super: { label: "Wellcome or PARKnSHOP", tip: "Eggs, yogurt, tins, frozen edamame, rice and sauces. Check the app for weekly deals." },
  online: { label: "HKTVmall or pandamart", tip: "Delivered to your door. Good for whey and bulk packs." },
  other: { label: "Other", tip: "" }
};

// Shopping items. unit: g, ml, pcs, can, scoop, pack, or "" for pantry staples
export const ITEMS = {
  chicken: { n: "Chicken breast", zh: "雞胸肉", store: "wet", unit: "g" },
  fish: { n: "Fresh fish fillet (sea bass or grouper)", zh: "鱸魚 / 石斑魚柳", store: "wet", unit: "g" },
  beef: { n: "Sliced lean beef", zh: "牛肉片", store: "wet", unit: "g" },
  pork: { n: "Lean minced pork", zh: "瘦豬肉碎", store: "wet", unit: "g" },
  shrimp: { n: "Peeled shrimp", zh: "蝦仁", store: "wet", unit: "g" },
  tofu: { n: "Firm tofu", zh: "硬豆腐", store: "wet", unit: "pcs" },
  choisum: { n: "Choi sum", zh: "菜心", store: "wet", unit: "g" },
  broccoli: { n: "Broccoli", zh: "西蘭花", store: "wet", unit: "g" },
  tomato: { n: "Tomatoes", zh: "番茄", store: "wet", unit: "pcs" },
  ginger: { n: "Ginger", zh: "薑", store: "wet", unit: "" },
  scallion: { n: "Spring onion", zh: "蔥", store: "wet", unit: "" },
  garlic: { n: "Garlic", zh: "蒜頭", store: "wet", unit: "" },
  sweetpotato: { n: "Sweet potato", zh: "番薯", store: "wet", unit: "g" },
  banana: { n: "Bananas", zh: "香蕉", store: "wet", unit: "pcs" },
  eggs: { n: "Eggs", zh: "雞蛋", store: "super", unit: "pcs" },
  yogurt: { n: "Plain Greek yogurt", zh: "希臘乳酪", store: "super", unit: "g" },
  tuna: { n: "Tuna in spring water", zh: "水浸吞拿魚", store: "super", unit: "can" },
  edamame: { n: "Frozen shelled edamame", zh: "毛豆仁", store: "super", unit: "g" },
  milk: { n: "Milk or unsweetened soy milk", zh: "牛奶 / 無糖豆漿", store: "super", unit: "ml" },
  oats: { n: "Rolled oats", zh: "燕麥", store: "super", unit: "g" },
  rice: { n: "Rice", zh: "白米", store: "super", unit: "g" },
  soy: { n: "Light soy sauce", zh: "生抽", store: "super", unit: "" },
  oyster: { n: "Oyster sauce", zh: "蠔油", store: "super", unit: "" },
  whey: { n: "Whey protein", zh: "乳清蛋白粉", store: "online", unit: "scoop" }
};

const yt = q => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
// p = protein per serving (grams, approximate). ing = [item, amount per serving]
export const RECIPES = [
  { k: "fish", t: "Steamed fish with ginger and spring onion", zh: "薑蔥蒸魚", p: 35, min: 20, meal: "dinner",
    ing: [["fish", 180], ["ginger", 0], ["scallion", 0], ["soy", 0], ["rice", 80], ["choisum", 150]],
    steps: ["Put the fish on a plate with sliced ginger on top.", "Steam on high for 8 to 10 minutes.", "Pour off the water. Add spring onion and soy sauce.", "Pour a little hot oil over it. Serve with rice and choi sum."],
    q: "Cantonese steamed fish ginger spring onion recipe" },
  { k: "chicken", t: "Chicken, rice and choi sum", zh: "雞胸菜心飯", p: 46, min: 25, meal: "post",
    ing: [["chicken", 150], ["rice", 80], ["choisum", 150], ["garlic", 0], ["oyster", 0]],
    steps: ["Slice the chicken thin. Mix with a little soy sauce.", "Pan-fry 3 to 4 minutes a side until cooked through.", "Boil choi sum for 2 minutes. Top with oyster sauce.", "Serve with rice."],
    q: "easy high protein chicken breast rice bowl recipe" },
  { k: "beef", t: "Beef and broccoli stir-fry", zh: "西蘭花炒牛肉", p: 35, min: 20, meal: "dinner",
    ing: [["beef", 150], ["broccoli", 200], ["garlic", 0], ["oyster", 0], ["rice", 80]],
    steps: ["Mix the beef with soy sauce and a little cornflour.", "Boil the broccoli for 1 minute, then drain.", "Fry garlic, then the beef on high heat for 1 to 2 minutes.", "Add broccoli and oyster sauce. Toss and serve with rice."],
    q: "beef and broccoli stir fry recipe Chinese" },
  { k: "tomegg", t: "Tomato and egg with tofu", zh: "番茄炒蛋豆腐", p: 30, min: 15, meal: "dinner",
    ing: [["eggs", 3], ["tomato", 2], ["tofu", 0.5], ["scallion", 0], ["rice", 80]],
    steps: ["Beat the eggs. Scramble softly and set aside.", "Fry the tomato until soft. Add cubed tofu.", "Add the eggs back with a pinch of sugar and salt.", "Top with spring onion. Serve with rice."],
    q: "tomato and egg stir fry recipe Chinese" },
  { k: "steamegg", t: "Steamed egg with minced pork", zh: "肉碎蒸水蛋", p: 32, min: 20, meal: "dinner",
    ing: [["eggs", 3], ["pork", 100], ["soy", 0], ["rice", 80], ["choisum", 150]],
    steps: ["Mix the pork with soy sauce. Spread it on a plate.", "Beat the eggs with warm water, about 1.5 times the egg amount.", "Pour over the pork. Cover and steam on low for 12 minutes.", "Add soy sauce. Serve with rice and greens."],
    q: "Cantonese steamed egg minced pork recipe" },
  { k: "shrimp", t: "Garlic shrimp with edamame", zh: "蒜蓉蝦仁炒毛豆", p: 38, min: 15, meal: "post",
    ing: [["shrimp", 150], ["edamame", 80], ["garlic", 0], ["rice", 80]],
    steps: ["Boil the edamame for 3 minutes.", "Fry plenty of garlic in a little oil.", "Add the shrimp. Cook 2 to 3 minutes until pink.", "Add edamame and salt. Serve with rice."],
    q: "garlic shrimp edamame stir fry recipe" },
  { k: "tuna", t: "Tuna and egg rice bowl", zh: "吞拿魚蛋飯", p: 37, min: 10, meal: "lunch",
    ing: [["tuna", 1], ["eggs", 1], ["rice", 80], ["edamame", 50], ["soy", 0]],
    steps: ["Drain the tuna.", "Fry or boil an egg.", "Put rice in a bowl. Top with tuna, egg and edamame.", "Add a little soy sauce."],
    q: "high protein tuna rice bowl recipe" },
  { k: "oats", t: "Protein oats", zh: "蛋白燕麥", p: 35, min: 5, meal: "breakfast",
    ing: [["oats", 50], ["milk", 250], ["whey", 1], ["banana", 1]],
    steps: ["Cook the oats in milk for 3 minutes, or soak overnight.", "Stir in one scoop of whey once it cools a little.", "Top with banana."],
    q: "protein oats recipe whey" },
  { k: "yogurt", t: "Greek yogurt bowl", zh: "希臘乳酪碗", p: 20, min: 2, meal: "snack",
    ing: [["yogurt", 200], ["banana", 1]],
    steps: ["Put the yogurt in a bowl.", "Add sliced banana and a handful of oats if you want."],
    q: "greek yogurt bowl high protein" },
  { k: "sweetpotato", t: "Pre-gym sweet potato and eggs", zh: "番薯雞蛋", p: 14, min: 15, meal: "pre",
    ing: [["sweetpotato", 200], ["eggs", 2]],
    steps: ["Steam the sweet potato for 15 minutes.", "Boil 2 eggs for 9 minutes.", "Eat 1 to 2 hours before training."],
    q: "steamed sweet potato boiled eggs pre workout" }
];
export const recipe = k => RECIPES.find(r => r.k === k);
export const video = r => yt(r.q);
export const items = () => ITEMS;

export function food() {
  if (!S.food) S.food = { kg: null, week: null, list: [], made: null };
  if (!S.food.week) S.food.week = ["chicken", "fish", "beef", "tomegg", "shrimp", "tuna", "sweetpotato", "oats", "yogurt"];
  return S.food;
}
// 1.6 g of protein per kg of body weight a day, a common target for people lifting weights
export function target() { const kg = food().kg || 75; return Math.round(kg * 1.6 / 5) * 5; }
export function setWeight(kg) { food().kg = Math.round(kg * 10) / 10; save(); return target(); }

// Today's meals: breakfast, lunch, post-gym, dinner, with a different rotation each day
export function todayMeals(date = today()) {
  const n = Math.floor(new Date(date + "T12:00").getTime() / 864e5);
  const dinners = RECIPES.filter(r => r.meal === "dinner"), posts = RECIPES.filter(r => r.meal === "post");
  return [
    { when: "Breakfast", r: recipe("oats") },
    { when: "Lunch", r: recipe("tuna") },
    { when: "Before the gym", r: recipe("sweetpotato") },
    { when: "After the gym", r: posts[n % posts.length] },
    { when: "Dinner", r: dinners[n % dinners.length] }
  ];
}
export const mealsProtein = ms => ms.reduce((a, m) => a + m.r.p, 0);

export function findRecipe(q) {
  const s = (q || "").toLowerCase();
  if (!s.trim()) return null;
  const words = s.split(/\W+/).filter(w => w.length > 2 && !/^(the|and|with|for|recipe|cook|make|some|high|protein|meal)$/.test(w));
  let best = null, bs = 0;
  RECIPES.forEach(r => {
    const hay = (r.t + " " + r.k + " " + r.ing.map(i => ITEMS[i[0]].n).join(" ")).toLowerCase();
    let sc = 0; words.forEach(w => { if (hay.includes(w.replace(/s$/, ""))) sc += r.t.toLowerCase().includes(w.replace(/s$/, "")) ? 2 : 1; });
    if (sc > bs) { bs = sc; best = r; }
  });
  return best;
}
export function findItem(q) {
  const s = (q || "").toLowerCase().replace(/\b(some|a|an|the|fresh|more)\b/g, "").trim();
  if (!s) return null;
  for (const [k, v] of Object.entries(ITEMS)) {
    const n = v.n.toLowerCase();
    if (n.includes(s) || s.includes(k) || s.split(/\s+/).some(w => w.length > 3 && n.includes(w.replace(/e?s$/, "")))) return k;
  }
  return null;
}

// Weekly shopping list from the recipes you picked. Breakfast and snack count 7 times, the rest once.
const round = (n, u) => u === "g" || u === "ml" ? Math.ceil(n / 50) * 50 : Math.ceil(n);
export function fmtQty(n, u) {
  if (!u) return "";
  if (u === "g") return n >= 1000 ? `${Math.round(n / 100) / 10} kg` : `${n} g`;
  if (u === "ml") return n >= 1000 ? `${Math.round(n / 100) / 10} L` : `${n} ml`;
  if (u === "pcs") return `${n}`;
  if (u === "can") return `${n} can${n > 1 ? "s" : ""}`;
  if (u === "scoop") return `${n} scoop${n > 1 ? "s" : ""}`;
  return `${n} ${u}`;
}
export function build() {
  const f = food(), tot = {};
  const mains = f.week.filter(k => ["dinner", "post"].includes(recipe(k)?.meal)).length || 1;
  f.week.forEach(k => {
    const r = recipe(k); if (!r) return;
    // About 10 main meals a week (7 dinners plus post-gym meals), shared across the mains you picked
    const times = r.meal === "breakfast" || r.meal === "snack" ? 7 : r.meal === "lunch" || r.meal === "pre" ? 3 : Math.max(1, Math.round(10 / mains));
    r.ing.forEach(([it, a]) => { tot[it] = (tot[it] || 0) + a * times; });
  });
  const extras = f.list.filter(x => x.custom);
  f.list = Object.entries(tot).map(([k, a]) => { const it = ITEMS[k]; return { id: uid(), k, n: it.n, zh: it.zh, store: it.store, qty: fmtQty(round(a, it.unit), it.unit), got: false }; }).concat(extras);
  f.made = today(); save();
  return f.list;
}
export function list() { const f = food(); if (!f.list.length && !f.made) build(); return f.list; }
export function add(text) {
  const f = food(), k = findItem(text), it = k && ITEMS[k];
  const ex = it && f.list.find(x => x.k === k);
  if (ex) { ex.got = false; save(); return ex; }
  const row = { id: uid(), k: k || null, n: it ? it.n : text.replace(/^./, c => c.toUpperCase()), zh: it ? it.zh : "", store: it ? it.store : "other", qty: "", got: false, custom: true };
  f.list.push(row); save(); return row;
}
export function toggle(id) { const x = food().list.find(r => r.id === id); if (x) { x.got = !x.got; save(); } }
export function removeItem(id) { const f = food(); f.list = f.list.filter(r => r.id !== id); save(); }
export function clearGot() { const f = food(); f.list = f.list.filter(r => !r.got); save(); }
export function toggleWeek(k) { const f = food(); f.week = f.week.includes(k) ? f.week.filter(x => x !== k) : f.week.concat(k); save(); }
export function byStore(ls = list()) {
  const g = {}; ls.forEach(x => { (g[x.store] = g[x.store] || []).push(x); });
  return ["wet", "super", "online", "other"].filter(s => g[s]).map(s => ({ s, rows: g[s] }));
}

// Spoken answers
export function brief(date = today()) {
  const ms = todayMeals(date), tg = target();
  const post = ms.find(m => m.when === "After the gym").r, din = ms.find(m => m.when === "Dinner").r;
  return `Aim for about ${tg} grams of protein today${food().kg ? "" : ". Tell me your weight for an exact target"}. After the gym, ${post.t.toLowerCase()}, about ${post.p} grams. For dinner, ${din.t.toLowerCase()}. The recipes are on screen.`;
}
export function recipeBrief(r) { return `${r.t}, about ${r.p} grams of protein, ${r.min} minutes. ${r.steps.join(" ")}`; }
export function listBrief() {
  const ls = list().filter(x => !x.got);
  if (!ls.length) return "Your shopping list is empty.";
  const main = ls.filter(x => x.qty || x.custom), staples = ls.length - main.length;
  const g = byStore(main).map(({ s, rows }) => `From the ${STORES[s].label.toLowerCase().replace("wellcome or parknshop", "supermarket").replace("hktvmall or pandamart", "online shop")}: ${rows.map(r => r.n.toLowerCase().replace(/ \(.+\)/, "")).join(", ")}.`);
  return `${ls.length} items. ${g.join(" ")}${staples ? ` Plus ${staples} kitchen basics like garlic and soy sauce.` : ""}`;
}
export function whereBrief(q) {
  const k = findItem(q);
  if (!k) return null;
  const it = ITEMS[k], st = STORES[it.store];
  return `${it.n}: ${st.label}. ${st.tip}${it.zh ? ` (${it.zh})` : ""}`;
}
export function postLine(date = today()) { const r = todayMeals(date).find(m => m.when === "After the gym").r; return `After training, have ${r.t.toLowerCase()} for about ${r.p} grams of protein.`; }
