// Stable command proposals. No credentials, model calls or persistence live here.
import { sayTime } from "./util.js";
const copy = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = x => x && typeof x === "object" && !Array.isArray(x);
const excluded = new Set(["dev", "ai", "chat", "t", "daily", "interests", "commandLog"]);
const entityKey = text => String(text || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ")
  .replace(/\b(?:the|my|a|an|that|this)\b/g, " ").replace(/\s+/g, " ").trim();
export function namedBlocks(query, blocks) {
  const key = entityKey(query);
  if (!key) return [];
  const exact = blocks.filter(b => entityKey(b.title) === key);
  if (exact.length) return exact;
  const words = key.split(" ").filter(w => !/^(?:is|for|of|on|to|and)$/.test(w));
  return blocks.filter(b => {
    const tokens = entityKey(b.title).split(" ");
    return words.length && words.every(w => tokens.includes(w));
  });
}

export function changes(before, after, path = []) {
  if (path[0] === "days" && path.at(-1) === "blocks") { before ??= []; after ??= []; }
  if (equal(before, after)) return [];
  if ((object(before) && (object(after) || after === undefined)) || (object(after) && before === undefined)) return [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])]
    .filter(k => path.length || !excluded.has(k))
    .flatMap(k => changes(before?.[k], after?.[k], [...path, k]));
  // Empty calendar scaffolding is not a user command.
  if (path[0] === "days" && before === undefined && equal(after, { blocks: [] })) return [];
  return [{ path, before: copy(before), after: copy(after) }];
}
function read(root, path) { return path.reduce((o, k) => o?.[k], root); }
export function applyProposal(state, proposal) {
  if ((state.commandLog || []).some(x => x.id === proposal.id)) return false;
  if (proposal.changes.some(c => !equal(read(state, c.path) ?? (c.path[0] === "days" && c.path.at(-1) === "blocks" ? [] : undefined), c.before)))
    throw new Error("Your data changed since this preview. Please give the command again so I can confirm the current details.");
  for (const c of proposal.changes) {
    let node = state;
    for (const k of c.path.slice(0, -1)) node = node[k] ||= {};
    if (c.after === undefined) delete node[c.path.at(-1)];
    else node[c.path.at(-1)] = copy(c.after);
  }
  state.commandLog = [...(state.commandLog || []), { id: proposal.id, at: Date.now() }].slice(-100);
  return true;
}
export function describe(proposal) {
  const lines = [];
  for (const c of proposal.changes) {
    if (c.path[0] === "days") {
      const before = c.path.at(-1) === "blocks" ? c.before || [] : c.before?.blocks || [];
      const after = c.path.at(-1) === "blocks" ? c.after || [] : c.after?.blocks || [];
      for (const b of before) if (!after.some(x => x.id === b.id))
        lines.push(`Remove ${b.title} on ${c.path[1]}, ${sayTime(b.start)} to ${sayTime(b.end)}${b.routine ? " (daily routine)" : ""}`);
      for (const b of after) if (!before.some(x => equal(x, b))) {
        const old = before.find(x => x.id === b.id);
        const was = old && (old.start !== b.start || old.end !== b.end) ? ` (was ${sayTime(old.start)} to ${sayTime(old.end)})` : "";
        const details = [b.venue && `Venue: ${b.venue}`, b.fixed || b.flex === false ? "Fixed" : b.flex ? "Flexible" : "",
          b.priority && `Priority: ${["", "must", "normal", "if time"][b.priority] || "normal"}`].filter(Boolean);
        lines.push(`${old ? "Update" : "Add"} ${b.title} on ${c.path[1]}, ${sayTime(b.start)} to ${sayTime(b.end)}${was}${b.continuation ? " (continuation from previous day)" : ""}${b.done ? ", completed" : ""}${details.length ? `. ${details.join(". ")}` : ""}`);
      }
    } else if (c.path[0] === "collections") {
      const before = c.before || [], after = c.after || [];
      for (const old of before) if (!after.some(x => x.id === old.id)) lines.push(`Remove category ${old.name} (${old.items.length} items)`);
      for (const group of after) {
        const old = before.find(x => x.id === group.id);
        if (!old) lines.push(`Created category: ${group.name}`);
        else if (old.name !== group.name) lines.push(`Rename ${old.name} to ${group.name}`);
        for (const item of group.items) {
          const was = old?.items.find(x => x.id === item.id);
          if (!was) lines.push(`Added: ${item.text} in ${group.name}`);
          else if (was.done !== item.done) lines.push(`${item.done ? "Done" : "Reopened"}: ${item.text} in ${group.name}`);
        }
        for (const item of old?.items || []) if (!group.items.some(x => x.id === item.id)) lines.push(`Remove ${item.text} from ${group.name}`);
      }
    } else if (c.path.join(".") === "school.tasks") {
      const before = c.before || [], after = c.after || [];
      for (const task of before) if (!after.some(x => x.id === task.id)) lines.push(`Remove assignment: ${task.title}`);
      for (const task of after) if (!before.some(x => equal(x, task))) {
        const old = before.find(x => x.id === task.id);
        const when = task.due ? `, due ${task.due}${task.dueMin == null ? " (no time)" : ` at ${sayTime(task.dueMin)}`}` : ", no deadline";
        lines.push(`${old ? task.done && !old.done ? "Completed assignment" : "Update assignment" : "Assignment saved"}: ${task.title}${when}${task.done ? "" : ". Pinned on Today"}`);
      }
    } else if (Array.isArray(c.after) || Array.isArray(c.before)) {
      const before = Array.isArray(c.before) ? c.before : [], after = Array.isArray(c.after) ? c.after : [];
      for (const x of before) if (!after.some(y => equal(x, y))) lines.push(`Remove or replace ${x.title || x.text || x.n || x.name || x.ex || JSON.stringify(x)} in ${c.path.join(".")}`);
      for (const x of after) if (!before.some(y => equal(x, y))) lines.push(`Save ${x.title || x.text || x.n || x.name || x.ex || JSON.stringify(x)} in ${c.path.join(".")}${x.due ? `, due ${x.due}${x.dueMin != null ? " at " + sayTime(x.dueMin) : ""}` : ""}`);
    } else lines.push(`${c.path.join(".")}: ${JSON.stringify(c.after ?? "remove")}`);
  }
  return [...new Set(lines)];
}
export function validateChanges(before, after, delta) {
  for (const task of after.school?.tasks || []) {
    if ((before.school?.tasks || []).some(t => t.id === task.id && t.title === task.title)) continue;
    if (/\b(?:gym|workout|shopping|groceries|cooking|recipe|meal|church|bible|prayer|bass|vitamins?)\b/i.test(task.title)
      && !/\b(?:school|college|university|course|class|homework|coursework)\b/i.test(task.title))
      throw new Error("Nothing saved. School is only for schoolwork. Personal activities belong on the timetable.");
  }
  const changedDates = new Set(delta.filter(c => c.path[0] === "days").map(c => c.path[1]));
  for (const date of changedDates) {
    const blocks = after.days?.[date]?.blocks || [];
    if (!Array.isArray(blocks)) throw new Error("The generated timetable is invalid. Nothing saved.");
    for (const b of blocks) if (!b.title || !Number.isInteger(b.start) || !Number.isInteger(b.end) || b.start < 0 || b.end <= b.start || b.end > 1440)
      throw new Error(`Nothing saved. ${b.title || "An activity"} needs a valid date and start/end time.`);
  }
}
export function reconcileWindows(before, after) {
  if (!after.studyWindows || !equal(before.weekPlans, after.weekPlans)) return;
  for (const [date, windows] of Object.entries(after.studyWindows)) {
    after.studyWindows[date] = windows.filter(w => {
      const prior = (before.days?.[date]?.blocks || []).filter(b => b.id === w.id || b.containerId === w.id
        || b.src === "weekly-plan" && b.start >= w.start && b.end <= w.end);
      const next = after.days?.[date]?.blocks || [];
      // Once a user removes or moves any part of a saved window, never resurrect it.
      return prior.length && prior.every(b => next.some(n => n.id === b.id && n.start === b.start && n.end === b.end));
    });
    if (!after.studyWindows[date].length) delete after.studyWindows[date];
  }
}
export const approval = text => {
  const s = String(text).toLowerCase().replace(/[’]/g, "'").replace(/[^a-z' ]/g, " ").replace(/\s+/g, " ").trim().replace(/^(?:pg |sir )|(?: pg| sir| please| thanks| thank you)$/g, "");
  if (/^(?:yes(?: (?:it is|that's|that is|is))?(?: correct| right)?|yeah|yep|correct|right|it's correct|it is correct|that's correct|that is correct|confirm|confirmed|go ahead|do it|okay|ok|sure)$/.test(s)) return "yes";
  if (/^(?:no|nope|nah|not correct|that's wrong|that is wrong|wrong|incorrect|cancel|never mind)$/.test(s)) return "no";
  return null;
};
