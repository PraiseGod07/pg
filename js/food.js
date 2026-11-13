// Gym food: protein and fiber targets, high-protein recipes you can cook in Hong Kong,
// evidence-based tips (from The Fueled Life Method guide) and a weekly shopping list by where to buy.
import { S, save } from "./store.js";
import { today, uid } from "./util.js";

export const STORES = {
  wet: { label: "Wet market", tip: "Fresh meat, fish, tofu and vegetables. Usually cheaper than the supermarket. Go in the morning." },
  super: { label: "Wellcome or PARKnSHOP", tip: "Eggs, yogurt, tins, frozen edamame, rice and sauces. Check the app for weekly deals." },
  online: { label: "HKTVmall or pandamart", tip: "Delivered to your door. Good for whey and bulk packs." },
  other: { label: "Other", tip: "" }
};

// Shopping items. unit: g, ml, pcs, can, scoop, or "" for kitchen basics.
// p and f = protein and fiber per 100 g (raw, approximate). w = grams per piece/can/scoop.
export const ITEMS = {
  chicken: { n: "Chicken breast", zh: "雞胸肉", store: "wet", unit: "g", p: 22.5, f: 0 },
  fish: { n: "Fresh fish fillet (sea bass or grouper)", zh: "鱸魚 / 石斑魚柳", store: "wet", unit: "g", p: 19, f: 0 },
  salmon: { n: "Salmon fillet", zh: "三文魚柳", store: "super", unit: "g", p: 20, f: 0 },
  beef: { n: "Lean beef, sliced or minced", zh: "瘦牛肉", store: "wet", unit: "g", p: 20, f: 0 },
  pork: { n: "Lean minced pork", zh: "瘦豬肉碎", store: "wet", unit: "g", p: 20, f: 0 },
  shrimp: { n: "Peeled shrimp", zh: "蝦仁", store: "wet", unit: "g", p: 20, f: 0 },
  tofu: { n: "Firm tofu", zh: "硬豆腐", store: "wet", unit: "pcs", w: 300, p: 12, f: 1 },
  choisum: { n: "Choi sum", zh: "菜心", store: "wet", unit: "g", p: 1.6, f: 1.8 },
  broccoli: { n: "Broccoli", zh: "西蘭花", store: "wet", unit: "g", p: 2.8, f: 2.6 },
  cabbage: { n: "Cabbage", zh: "椰菜", store: "wet", unit: "g", p: 1.3, f: 2.5 },
  spinach: { n: "Spinach", zh: "菠菜", store: "wet", unit: "g", p: 2.9, f: 2.2 },
  carrot: { n: "Carrots", zh: "紅蘿蔔", store: "wet", unit: "g", p: 0.9, f: 2.8 },
  onion: { n: "Onions", zh: "洋蔥", store: "wet", unit: "g", p: 1.1, f: 1.7 },
  tomato: { n: "Tomatoes", zh: "番茄", store: "wet", unit: "pcs", w: 120, p: 0.9, f: 1.2 },
  sweetpotato: { n: "Sweet potato", zh: "番薯", store: "wet", unit: "g", p: 1.6, f: 3 },
  banana: { n: "Bananas", zh: "香蕉", store: "wet", unit: "pcs", w: 118, p: 1.1, f: 2.6 },
  ginger: { n: "Ginger", zh: "薑", store: "wet", unit: "" },
  scallion: { n: "Spring onion", zh: "蔥", store: "wet", unit: "" },
  garlic: { n: "Garlic", zh: "蒜頭", store: "wet", unit: "" },
  eggs: { n: "Eggs", zh: "雞蛋", store: "super", unit: "pcs", w: 50, p: 12.6, f: 0 },
  yogurt: { n: "Plain Greek yogurt", zh: "希臘乳酪", store: "super", unit: "g", p: 10, f: 0 },
  mozzarella: { n: "Mozzarella", zh: "水牛芝士", store: "super", unit: "g", p: 24, f: 0 },
  tuna: { n: "Tuna in spring water", zh: "水浸吞拿魚", store: "super", unit: "can", w: 100, p: 25, f: 0 },
  edamame: { n: "Frozen shelled edamame", zh: "毛豆仁", store: "super", unit: "g", p: 12, f: 5.2 },
  lentils: { n: "Lentils, canned or dried", zh: "扁豆", store: "super", unit: "g", p: 9, f: 7.9 },
  beans: { n: "Canned white or kidney beans", zh: "罐頭豆", store: "super", unit: "g", p: 8.9, f: 8.7 },
  tsauce: { n: "Canned tomato sauce", zh: "番茄醬汁", store: "super", unit: "g", p: 1.2, f: 1.5 },
  milk: { n: "Milk or unsweetened soy milk", zh: "牛奶 / 無糖豆漿", store: "super", unit: "ml", p: 3.4, f: 0 },
  oats: { n: "Rolled oats", zh: "燕麥", store: "super", unit: "g", p: 16.9, f: 10.6 },
  rice: { n: "Rice", zh: "白米", store: "super", unit: "g", p: 7.1, f: 1.3 },
  quinoa: { n: "Quinoa", zh: "藜麥", store: "super", unit: "g", p: 14, f: 7 },
  soy: { n: "Light soy sauce", zh: "生抽", store: "super", unit: "" },
  oyster: { n: "Oyster sauce", zh: "蠔油", store: "super", unit: "" },
  miso: { n: "Miso paste", zh: "味噌", store: "super", unit: "" },
  cocoa: { n: "Cocoa powder", zh: "可可粉", store: "super", unit: "" },
  whey: { n: "Whey protein", zh: "乳清蛋白粉", store: "online", unit: "scoop", w: 30, p: 80, f: 0 }
};

const yt = q => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
const IG = c => `https://www.instagram.com/p/${c}/`;
const SAFE = "Fridge within 2 hours (1 hour on days above 32°C). Keeps 3–4 days. Reheat until steaming hot, 74°C.";
// slot: which meal it fills. ing = [item, amount per serving]. batch = servings one cook makes.
// src "flm" = from The Fueled Life Method guide (Sarah's Instagram recipe), adapted for Hong Kong.
export const RECIPES = [
  { k: "fish", t: "Steamed fish with ginger and spring onion", zh: "薑蔥蒸魚", min: 20, slot: "main",
    ing: [["fish", 180], ["ginger", 0], ["scallion", 0], ["soy", 0], ["rice", 80], ["choisum", 150]],
    steps: ["Put the fish on a plate with sliced ginger on top.", "Steam on high for 8 to 10 minutes.", "Pour off the water. Add spring onion and soy sauce.", "Pour a little hot oil over it. Serve with rice and choi sum."],
    q: "Cantonese steamed fish ginger spring onion recipe" },
  { k: "chicken", t: "Chicken, rice and choi sum", zh: "雞胸菜心飯", min: 25, slot: "main",
    ing: [["chicken", 150], ["rice", 80], ["choisum", 150], ["garlic", 0], ["oyster", 0]],
    steps: ["Slice the chicken thin. Mix with a little soy sauce.", "Pan-fry 3 to 4 minutes a side until cooked through.", "Boil choi sum for 2 minutes. Top with oyster sauce.", "Serve with rice."],
    q: "easy high protein chicken breast rice bowl recipe" },
  { k: "beef", t: "Beef and broccoli stir-fry", zh: "西蘭花炒牛肉", min: 20, slot: "main",
    ing: [["beef", 150], ["broccoli", 200], ["garlic", 0], ["oyster", 0], ["rice", 80]],
    steps: ["Mix the beef with soy sauce and a little cornflour.", "Boil the broccoli for 1 minute, then drain.", "Fry garlic, then the beef on high heat for 1 to 2 minutes.", "Add broccoli and oyster sauce. Toss and serve with rice."],
    q: "beef and broccoli stir fry recipe Chinese" },
  { k: "tomegg", t: "Tomato and egg with tofu", zh: "番茄炒蛋豆腐", min: 15, slot: "main",
    ing: [["eggs", 3], ["tomato", 2], ["tofu", 0.5], ["scallion", 0], ["rice", 80]],
    steps: ["Beat the eggs. Scramble softly and set aside.", "Fry the tomato until soft. Add cubed tofu.", "Add the eggs back with a pinch of sugar and salt.", "Top with spring onion. Serve with rice."],
    q: "tomato and egg stir fry recipe Chinese" },
  { k: "steamegg", t: "Steamed egg with minced pork", zh: "肉碎蒸水蛋", min: 20, slot: "main",
    ing: [["eggs", 3], ["pork", 100], ["soy", 0], ["rice", 80], ["choisum", 150]],
    steps: ["Mix the pork with soy sauce. Spread it on a plate.", "Beat the eggs with warm water, about 1.5 times the egg amount.", "Pour over the pork. Cover and steam on low for 12 minutes.", "Add soy sauce. Serve with rice and greens."],
    q: "Cantonese steamed egg minced pork recipe" },
  { k: "shrimp", t: "Garlic shrimp with edamame", zh: "蒜蓉蝦仁炒毛豆", min: 15, slot: "main",
    ing: [["shrimp", 150], ["edamame", 80], ["garlic", 0], ["rice", 80]],
    steps: ["Boil the edamame for 3 minutes.", "Fry plenty of garlic in a little oil.", "Add the shrimp. Cook 2 to 3 minutes until pink.", "Add edamame and salt. Serve with rice."],
    q: "garlic shrimp edamame stir fry recipe" },
  { k: "miso", t: "Miso salmon rice bowl", zh: "味噌三文魚飯", min: 30, slot: "main", batch: 4, src: "flm", ig: "DfVezqMyqyO",
    ing: [["salmon", 140], ["rice", 60], ["carrot", 40], ["edamame", 50], ["miso", 0], ["soy", 0]],
    steps: ["Cook the rice in the rice cooker with sliced carrot and edamame on top.", "Stir miso with a little soy sauce and water to make a sauce.", "Brush it over the salmon. Bake at 200°C for 12 to 15 minutes, until it reaches 63°C inside.", "Flake the salmon over the rice and add more sauce."],
    store: SAFE + " Eat salmon within 3 days." },
  { k: "eggroll", t: "Beef and cabbage rice bowls", zh: "椰菜牛肉飯", min: 25, slot: "lunch", batch: 4, src: "flm", ig: "DU_v-Ybkjtp",
    ing: [["beef", 115], ["cabbage", 75], ["rice", 60], ["garlic", 0], ["ginger", 0], ["soy", 0]],
    steps: ["Cook the rice.", "Brown the minced beef in a hot pan for 6 to 8 minutes, until cooked to 71°C.", "Stir in garlic and ginger for 1 minute.", "Add shredded cabbage and soy sauce. Cook 5 to 7 minutes.", "Serve over rice. Split into 4 boxes for the week."],
    store: SAFE + " Freezes for up to 3 months." },
  { k: "ginger", t: "Sesame ginger chicken with quinoa", zh: "薑汁雞柳藜麥", min: 28, slot: "lunch", batch: 4, src: "flm", ig: "DeXzAHKP8rM",
    ing: [["chicken", 115], ["quinoa", 50], ["broccoli", 75], ["ginger", 0], ["garlic", 0], ["soy", 0]],
    steps: ["Cook the quinoa as the pack says.", "Fry chicken pieces 6 to 8 minutes until cooked to 74°C. Set aside.", "Stir-fry broccoli, garlic and ginger for 4 minutes.", "Add the chicken back with soy sauce and a splash of water. Serve over quinoa."],
    store: SAFE },
  { k: "sheet", t: "Tray-baked salmon, sweet potato and beans", zh: "焗三文魚番薯", min: 35, slot: "lunch", batch: 4, src: "flm", ig: "DesBKhnBTPK",
    ing: [["salmon", 140], ["sweetpotato", 125], ["beans", 60], ["garlic", 0]],
    steps: ["Heat the oven to 220°C. Cube the sweet potato, toss with oil, salt and garlic.", "Roast 15 minutes. Push to one side and add the salmon and drained beans.", "Roast 10 to 12 minutes more, until the salmon reaches 63°C.", "Split into boxes. Great for lunches."],
    store: SAFE + " Eat salmon within 3 days." },
  { k: "stew", t: "Slow cooker beef and lentil stew", zh: "慢煮扁豆牛肉", min: 25, slot: "main", batch: 6, src: "flm", ig: "DfaxwZNozcY",
    ing: [["beef", 85], ["lentils", 75], ["carrot", 35], ["onion", 25], ["tsauce", 65], ["garlic", 0]],
    steps: ["Put the beef, carrot, onion, garlic and tomato sauce in the slow cooker with 2 cups of water.", "Cook on low for 6 to 8 hours.", "Stir in the cooked lentils for the last 30 minutes.", "Check the beef reached 71°C, then season."],
    store: SAFE + " Freezes for up to 3 months." },
  { k: "spegg", t: "Sweet potato egg bake", zh: "番薯焗蛋", min: 50, slot: "breakfast", batch: 6, src: "flm", ig: "DekbRSoSyqX",
    ing: [["sweetpotato", 100], ["eggs", 1.4], ["spinach", 17], ["onion", 17], ["mozzarella", 10]],
    steps: ["Cook the sweet potato until soft. Mash it into the base of an oiled baking dish.", "Fry the onion and spinach until the spinach wilts.", "Whisk the eggs with salt and pepper. Pour over with the vegetables and cheese.", "Bake at 190°C for 30 to 35 minutes, until set in the middle."],
    store: SAFE + " Slice into portions before the fridge." },
  { k: "greenegg", t: "Green vegetable egg bake", zh: "雜菜焗蛋", min: 45, slot: "breakfast", batch: 6, src: "flm", ig: "DdSOPowPU9n",
    ing: [["eggs", 1.4], ["broccoli", 35], ["spinach", 17], ["edamame", 17], ["mozzarella", 10], ["onion", 13]],
    steps: ["Heat the oven to 190°C and oil a baking dish.", "Chop the broccoli small and steam it for 3 minutes.", "Spread the broccoli, spinach, edamame, onion and cheese in the dish.", "Pour the whisked eggs over. Bake 25 to 30 minutes until set."],
    store: SAFE },
  { k: "mocha", t: "Mocha overnight oats", zh: "朱古力隔夜燕麥", min: 5, slot: "breakfast", batch: 4, src: "flm", ig: "De-BajIIOY-",
    ing: [["oats", 50], ["yogurt", 100], ["milk", 60], ["cocoa", 0], ["banana", 0.5]],
    steps: ["Split the oats, yogurt, milk and cocoa between 4 jars.", "Stir well. Add banana slices.", "Cover and chill overnight, or at least 4 hours.", "Stir before eating."],
    store: "Keeps 3–4 days in the fridge." },
  { k: "tuna", t: "Tuna and egg rice bowl", zh: "吞拿魚蛋飯", min: 10, slot: "lunch",
    ing: [["tuna", 1], ["eggs", 1], ["rice", 80], ["edamame", 50], ["soy", 0]],
    steps: ["Drain the tuna.", "Fry or boil an egg.", "Put rice in a bowl. Top with tuna, egg and edamame.", "Add a little soy sauce."],
    q: "high protein tuna rice bowl recipe" },
  { k: "oats", t: "Protein oats", zh: "蛋白燕麥", min: 5, slot: "breakfast",
    ing: [["oats", 50], ["milk", 250], ["whey", 1], ["banana", 1]],
    steps: ["Cook the oats in milk for 3 minutes, or soak overnight.", "Stir in one scoop of whey once it cools a little.", "Top with banana."],
    q: "protein oats recipe whey" },
  { k: "yogurt", t: "Greek yogurt bowl", zh: "希臘乳酪碗", min: 2, slot: "snack",
    ing: [["yogurt", 200], ["banana", 1]],
    steps: ["Put the yogurt in a bowl.", "Add sliced banana and a handful of oats if you want."],
    q: "greek yogurt bowl high protein" },
  { k: "sweetpotato", t: "Sweet potato and eggs", zh: "番薯雞蛋", min: 15, slot: "pre",
    ing: [["sweetpotato", 150], ["eggs", 2]],
    steps: ["Steam the sweet potato for 15 minutes.", "Boil 2 eggs for 9 minutes.", "Eat 1 to 2 hours before training."],
    q: "steamed sweet potato boiled eggs pre workout" },
  { k: "banyog", t: "Banana and yogurt", zh: "香蕉乳酪", min: 1, slot: "pre",
    ing: [["banana", 1], ["yogurt", 150]],
    steps: ["Eat about an hour before training. Easy on the stomach."],
    q: "pre workout snack banana yogurt" }
];
export const recipe = k => RECIPES.find(r => r.k === k);
export const link = r => r.src === "flm" ? { url: IG(r.ig), label: "Sarah's version" } : { url: yt(r.q), label: "Watch how" };

// Protein and fiber per serving, worked out from the ingredients
const grams = (k, a) => { const it = ITEMS[k]; return it.unit === "pcs" || it.unit === "can" || it.unit === "scoop" ? a * (it.w || 0) : a; };
const macro = (r, m) => Math.round(r.ing.reduce((s, [k, a]) => s + (ITEMS[k][m] || 0) * grams(k, a) / 100, 0));
RECIPES.forEach(r => { r.p = macro(r, "p"); r.f = macro(r, "f"); });

export function food() {
  if (!S.food) S.food = { kg: null, week: null, list: [], made: null };
  if (!S.food.week) S.food.week = ["chicken", "shrimp", "fish", "beef", "tomegg", "miso", "tuna", "eggroll", "sweetpotato", "oats", "spegg", "yogurt"];
  return S.food;
}
// Lifting: about 1.6 g/kg a day (ISSN range 1.4–2.0; gains level off near 1.6). Per meal about 0.4 g/kg over 4 meals.
export const kg = () => food().kg || 75;
export function target() { return Math.round(kg() * 1.6 / 5) * 5; }
export function perMeal() { return Math.round(kg() * 0.4); }
export const fiberTarget = () => /ma'?am|madam|miss|mrs?\b/i.test(S.profile?.address || "") ? 25 : 38;
export function setWeight(v) { food().kg = Math.round(v * 10) / 10; save(); return target(); }

// Today's meals. Gym days add a meal before and after training; rest days have a snack instead.
const ROT = {
  breakfast: ["oats", "spegg", "mocha", "greenegg"],
  lunch: ["tuna", "eggroll", "sheet", "ginger"],
  pre: ["sweetpotato", "banyog"],
  post: ["chicken", "shrimp", "miso"],
  dinner: ["fish", "beef", "tomegg", "steamegg", "stew"],
  snack: ["yogurt"]
};
// Learned likes, dislikes and today's swaps
export function prefs() { const f = food(); f.prefs = f.prefs || { no: {}, yes: {}, avoid: [] }; f.swap = f.swap && f.swap.date === today() ? f.swap : { date: today(), set: {}, skip: [] }; return f.prefs; }
const FITS = { breakfast: ["breakfast"], lunch: ["lunch", "main"], pre: ["pre"], post: ["main"], dinner: ["main", "lunch"], snack: ["snack", "pre"] };
const SLOT_OF = { Breakfast: "breakfast", Lunch: "lunch", "Before the gym": "pre", "After the gym": "post", Snack: "snack", Dinner: "dinner" };
const MEAT = ["chicken", "fish", "salmon", "beef", "pork", "shrimp", "tuna"];
const hasIng = (r, keys) => r.ing.some(([k]) => keys.includes(k));
const ok = r => { const p = prefs(); return (p.no[r.k] || 0) < 2 && !hasIng(r, p.avoid); };
function pick(slot, n) {
  const rot = ROT[slot].map(recipe), good = rot.filter(ok);
  if (good.length) return rot[n % rot.length] && ok(rot[n % rot.length]) ? rot[n % rot.length] : good[n % good.length];
  return options(slot)[0] || rot[n % rot.length];
}
// Every recipe that can fill a meal, best first (things you liked rank higher)
export function options(slot, f = {}) {
  const p = prefs(), sw = food().swap;
  return RECIPES.filter(r => FITS[slot].includes(r.slot) && ok(r) && !sw.skip.includes(r.k)
    && (!f.quick || r.min <= 15) && (!f.veg || !hasIng(r, MEAT)) && (!f.no || !hasIng(r, f.no)) && (slot !== "post" || r.p >= 25))
    .sort((a, b) => (p.yes[b.k] || 0) - (p.yes[a.k] || 0) || b.p - a.p);
}
export function todayMeals(date = today(), gym = false) {
  const n = Math.floor(new Date(date + "T12:00").getTime() / 864e5), sw = date === today() ? (prefs(), food().swap.set) : {};
  const one = (when, slot, k) => ({ when, slot, r: (sw[when] && recipe(sw[when])) || pick(slot, k) });
  const ms = [one("Breakfast", "breakfast", n), one("Lunch", "lunch", n)];
  if (gym) ms.push(one("Before the gym", "pre", n), one("After the gym", "post", n));
  else ms.push(one("Snack", "snack", n));
  ms.push(one("Dinner", "dinner", n + 2));
  return ms;
}
// Why PG suggests a meal, in one short phrase
export function why(m) {
  const r = m.r, p = prefs();
  if ((p.yes[r.k] || 0) >= 2) return "you've liked it before";
  if (m.when === "Before the gym") return "it's easy on the stomach before training";
  if (m.when === "After the gym") return `${r.p} grams of protein to help you recover`;
  if (m.when === "Breakfast") return r.min <= 10 ? `it's ready in ${r.min} minutes with ${r.p} grams of protein` : `${r.p} grams of protein and you can make it ahead`;
  if (r.f >= 8) return `${r.p} grams of protein and ${r.f} grams of fiber`;
  return r.min <= 15 ? `it's quick, ${r.min} minutes, with ${r.p} grams of protein` : `${r.p} grams of protein`;
}
export const slotOf = when => SLOT_OF[when];
// "What should I eat today?" as a conversation
export function chat(date = today(), gym = false, only) {
  const ms = todayMeals(date, gym);
  if (only) { const m = ms.find(x => x.when === only) || ms.at(-1); return { text: `For ${lc(m.when)}, try ${lc(m.r.t)}, because ${why(m)}. Sound good?`, focus: m.when }; }
  const pick3 = gym ? ms.filter(m => ["Breakfast", "After the gym", "Dinner"].includes(m.when)) : [ms[0], ms[1], ms.at(-1)];
  const lines = pick3.map(m => `${m.when === "After the gym" ? "After the gym" : "For " + lc(m.when)}, ${lc(m.r.t)}, since ${why(m)}.`);
  return { text: `${gym ? "It's a gym day." : "It's a rest day."} ${lines.join(" ")} That's about ${sum(ms, "p")} grams of protein out of your ${target()}. Want to change anything?`, focus: pick3.at(-1).when };
}
// Swap a meal for something else. Returns {r, when} or null.
export function swap(when, f = {}) {
  const ms = todayMeals(today(), when === "Before the gym" || when === "After the gym" || f.gym);
  const m = ms.find(x => x.when === when) || ms.at(-1);
  const p = prefs(), sw = food().swap;
  p.no[m.r.k] = (p.no[m.r.k] || 0) + 1;
  sw.skip.push(m.r.k);
  const r = options(slotOf(m.when), f).find(x => x.k !== m.r.k && !ms.some(y => y.r.k === x.k));
  if (!r) { save(); return null; }
  sw.set[m.when] = r.k; save();
  return { r, when: m.when, was: m.r };
}
export function like(k) { const p = prefs(); p.yes[k] = (p.yes[k] || 0) + 1; if (p.no[k]) p.no[k] = Math.max(0, p.no[k] - 1); save(); }
export function avoid(q) {
  const k = /\bmeat\b/.test(q) ? null : findItem(q);
  const p = prefs();
  if (/\b(?:meat|vegetarian)\b/.test(q)) MEAT.forEach(x => p.avoid.includes(x) || p.avoid.push(x));
  else if (k && !p.avoid.includes(k)) p.avoid.push(k);
  else if (!k) return null;
  food().week = food().week.filter(x => ok(recipe(x)));
  save();
  return k ? ITEMS[k].n.toLowerCase().replace(/ \(.+\)|, .+$/, "") : "meat";
}
export function learned() {
  const p = prefs(), out = [];
  const liked = Object.entries(p.yes).filter(([, n]) => n >= 1).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => lc(recipe(k)?.t || ""));
  if (liked.length) out.push(`you like ${liked.join(" and ")}`);
  if (p.avoid.length) out.push(`you don't eat ${p.avoid.map(k => ITEMS[k].n.toLowerCase().replace(/ \(.+\)|, .+$/, "")).join(", ")}`);
  return out;
}
export const sum = (ms, m) => ms.reduce((a, x) => a + x.r[m], 0);

// Tips from The Fueled Life Method guide, with the research it cites
export const TIPS = [
  { k: "protein", t: "Protein", d: () => `While lifting, aim for about 1.6 g per kg a day, around ${target()} g for you. Research ranges are 1.4 to 2.0. Spread it over 4 meals of about ${perMeal()} g.`, src: "ISSN position stand 2017; Schoenfeld & Aragon 2018" },
  { k: "fiber", t: "Fiber", d: () => `About ${fiberTarget()} g a day. Add 3 to 5 g a week, not all at once, and drink water through the day. Oats, lentils, beans, edamame, broccoli and sweet potato are easy wins.`, src: "Dietary Guidelines 2025–2030; Veronese 2025 review" },
  { k: "pre", t: "Before the gym", d: () => "1 to 4 hours before, eat a familiar meal that's lower in fat and fiber, like rice and chicken or sweet potato and eggs. Under an hour before, a small banana is enough if you're hungry.", src: "Academy of Nutrition and Dietetics, Dietitians of Canada and ACSM 2016" },
  { k: "post", t: "After the gym", d: () => "No need to rush a shake within 30 minutes. Training keeps working for at least 24 hours, so your next normal meal with protein does the job.", src: "ISSN position stand 2017" },
  { k: "plate", t: "Your plate", d: () => "Gym day: a palm of protein or more, 2 cupped hands of rice or carbs, 1 to 2 fists of vegetables. Rest day: a palm of protein, half to 1 cupped hand of carbs, 2 or more fists of vegetables.", src: "The Fueled Life Method, chapter 2" },
  { k: "safe", t: "Meal prep and leftovers", d: () => "Put cooked food in the fridge within 2 hours, or 1 hour on days above 32°C. Eat leftovers within 3 to 4 days and reheat until steaming hot, 74°C.", src: "USDA FSIS: Safe Handling of Leftovers" }
];
export const tip = k => TIPS.find(t => t.k === k);

export function findRecipe(q) {
  const s = (q || "").toLowerCase();
  if (!s.trim()) return null;
  const words = s.split(/\W+/).filter(w => w.length > 2 && !/^(the|and|with|for|recipe|cook|make|some|high|protein|meal|tonight|today)$/.test(w));
  let best = null, bs = 0;
  RECIPES.forEach(r => {
    const hay = (r.t + " " + r.k + " " + r.ing.map(i => ITEMS[i[0]].n).join(" ")).toLowerCase();
    let sc = 0; words.forEach(w => { const x = w.replace(/s$/, ""); if (hay.includes(x)) sc += r.t.toLowerCase().includes(x) ? 2 : 1; });
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

// Weekly shopping list from the recipes you picked. Each meal slot has a number of meals a week,
// shared across the recipes you picked for it. Batch recipes round up to whole batches.
const SLOTS = { breakfast: 7, lunch: 5, snack: 4, pre: 3, main: 10 };
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
export function servings(r) {
  const f = food(), n = f.week.filter(k => recipe(k)?.slot === r.slot).length || 1;
  const share = Math.max(1, Math.round(SLOTS[r.slot] / n));
  return r.batch ? r.batch * Math.max(1, Math.round(share / r.batch)) : share;
}
export function build() {
  const f = food(), tot = {};
  f.week.forEach(k => {
    const r = recipe(k); if (!r) return;
    const sv = servings(r);
    r.ing.forEach(([it, a]) => { tot[it] = (tot[it] || 0) + a * sv; });
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
const lc = s => s.charAt(0).toLowerCase() + s.slice(1);
export function brief(date = today(), gym = false) {
  const ms = todayMeals(date, gym), din = ms.at(-1).r, post = ms.find(m => m.when === "After the gym");
  const head = `Aim for about ${target()} grams of protein and ${fiberTarget()} grams of fiber today, about ${perMeal()} grams of protein a meal${food().kg ? "" : ". Tell me your weight for an exact target"}.`;
  const mid = post ? ` Before the gym, ${lc(ms.find(m => m.when === "Before the gym").r.t)}. After, ${lc(post.r.t)}, about ${post.r.p} grams.` : ` Breakfast is ${lc(ms[0].r.t)}.`;
  return `${head}${mid} Dinner is ${lc(din.t)}. The recipes are on screen.`;
}
export function recipeBrief(r) { return `${r.t}, about ${r.p} grams of protein and ${r.f} grams of fiber, ${r.min} minutes${r.batch ? `, makes ${r.batch}` : ""}. ${r.steps.join(" ")}`; }
export function listBrief() {
  const ls = list().filter(x => !x.got);
  if (!ls.length) return "Your shopping list is empty.";
  const main = ls.filter(x => x.qty || x.custom), staples = ls.length - main.length;
  const name = { wet: "the wet market", super: "the supermarket", online: "online", other: "elsewhere" };
  const g = byStore(main).map(({ s, rows }) => `From ${name[s]}: ${rows.map(r => r.n.toLowerCase().replace(/ \(.+\)|, .+$/, "")).join(", ")}.`);
  return `${ls.length} items. ${g.join(" ")}${staples ? ` Plus ${staples} kitchen basics like garlic and soy sauce.` : ""}`;
}
export function whereBrief(q) {
  const k = findItem(q);
  if (!k) return null;
  const it = ITEMS[k], st = STORES[it.store];
  return `${it.n}: ${st.label}. ${st.tip}${it.zh ? ` (${it.zh})` : ""}`;
}
export function postLine(date = today()) { const r = todayMeals(date, true).find(m => m.when === "After the gym").r; return `After training, have ${lc(r.t)} for about ${r.p} grams of protein.`; }
