// Only normalize the instruction PG parses. The transcript is displayed unchanged.
export function commandText(raw) {
  let t = String(raw || "").trim().replace(/^(?:(?:(?:hey|hi) pg|pg|sir|please|um+|uh+|okay)[, ]+)+/i, "");
  t = t.replace(/^(?:(?:could|would|can) you(?: please)?|i (?:want|need) you to|i'd like you to|let's|go ahead and)\s+(?=add|put|save|make|remove|move|set|show|record|create|book|schedule|delete)/i, "");
  // Collapse full exact echoes only for commands; do not alter titles or note text.
  if (/^(?:add|put|schedule|book)\b/i.test(t)) {
    const words = t.trim().split(/\s+/), clean = x => x.toLowerCase().replace(/[,.!?;]+$/g, "");
    const half = words.length / 2;
    if (Number.isInteger(half) && half >= 3 && words.slice(0, half).every((v, i) => clean(v) === clean(words[i + half]))) t = words.slice(0, half).join(" ");
    t = t.replace(/\bat (\d{1,2}(?::\d\d)?\s*(?:am|pm)?)\s*[,;]\s*(?:no|i mean)\s*[,]?\s*(\d{1,2}(?::\d\d)?\s*(?:am|pm)?)/i, "at $2");
  }
  return t.trim();
}

export const PHRASES = [
  ["Your day", "What do I have today?", "What’s next?", "What do I have tomorrow?", "When am I free tomorrow?", "Brief me"],
  ["Timetable", "Add gym to my timetable tomorrow 5 to 6 pm at the campus gym", "Add shopping tomorrow", "Remove gym from my timetable", "Move gym to 6 pm", "Undo"],
  ["School", "I have a Physics report due Tuesday at 9 pm", "What’s due this week?", "Remove that assignment"],
  ["Everyday tasks", "For my everyday tasks add take vitamins and read my Bible", "Remove vitamins from everyday tasks", "Lessons 09:00 to 12:00 on weekdays", "Eat 7:00 am to 7:30 am every day"],
  ["Alarms and reviews", "Remind me to call Mum tomorrow at 6 pm", "What did I miss yesterday?", "How was my week?"],
  ["Goals", "My goal this term is to finish my CAD portfolio by the end of November", "Short-term goal: pass physics, due December 10", "Long-term goal: start a company", "Remind me about my goals", "What are my goals?", "What are my long-term goals?", "Goal done: finish CAD portfolio", "Drop the goal start a company", "Change the goal deadline to the 15th", "How are my goals going?"],
  ["Collections", "Create a category called books", "Add Atomic Habits to my books", "What’s in my books?", "Merge books into reading", "Find pizza"],
  ["Appearance", "Make the font bigger", "Switch to a light theme"],
  ["Web", "Search the web for Hong Kong museums", "Weather in Hong Kong", "Convert 3 km to miles", "Read it"]
];
