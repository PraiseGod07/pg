// Bass course: basics to pro. 26 lessons, each with a verified YouTube lesson and a practice drill.
import { S, save } from "./store.js";
import { today } from "./util.js";

const L = (lvl, t, id, by, drill, pass) => ({ lvl, t, video: { id, by }, drill, pass });

export const LEVELS = ["Foundations", "Building blocks", "Intermediate", "Advanced to pro"];

export const CURRICULUM = [
  L(0, "Your first bass lesson", "7anFuDXV2j8", "BassBuzz", "Tune to E A D G, check your posture, then play the riffs from the video slowly.", "You can tune by yourself and play one riff without stopping."),
  L(0, "Plucking hand", "CR8yQCZX2HQ", "BassBuzz", "Alternate index and middle finger, 4 notes per open string, metronome at 60.", "Even volume on every note at 80 bpm."),
  L(0, "Fretting hand", "ux-i7FWOLzs", "BassBuzz", "One finger per fret on frets 1 to 4, every string, up and back. Press just behind the fret.", "Clean notes with no buzz and a relaxed thumb."),
  L(0, "Rhythm: whole, half and quarter notes", "y7DhgZpeXXw", "Josh Fossgreen", "Count out loud while you play whole, half and quarter notes on the open E. Metronome at 70.", "You can switch between them without losing the beat."),
  L(0, "Notes on the neck", "tcok98Vk6uA", "BassBuzz", "Find every C and every G on the E and A strings up to fret 12. Say each name as you play.", "You can find any note on E and A in under 3 seconds."),
  L(0, "Muting", "b2HBaiTgOxE", "BassBuzz", "Play quarter notes across the strings and stop every string you're not playing. Record and listen back.", "No strings ring when you stop."),
  L(1, "Root notes for church songs", "nHLj-J_0mP4", "Gospel Bass", "Pick one church song. Play only the root of each chord, locked with the kick drum.", "You play the whole song on roots without getting lost."),
  L(1, "The major scale", "2bvgAbWRdIA", "Scott's Bass Lessons", "C major, one octave, up and down, saying the note names. Then move the shape to G and F.", "Major scale in 3 keys at 80 bpm."),
  L(1, "Your first full groove", "7N9umcpdTYk", "TalkingBass", "Learn the riff slowly using small shifts, not stretches. Speed up 5 bpm at a time.", "You play the groove 4 times in a row cleanly."),
  L(1, "Staying in the pocket", "f59EE2x_Sm0", "Gospel Bass", "Play along with a drum loop. Hit exactly with the kick, then try leaving space.", "You stay locked with the drums for a full song."),
  L(1, "Minor pentatonic", "hhnf8nVUgDM", "TalkingBass", "A minor pentatonic at fret 5, up and down, then make a 2-bar riff from it.", "You can make up 3 different riffs from the shape."),
  L(1, "12-bar blues", "wIbQIWXM8Zw", "Greg's Bass Shed", "Play the 12-bar form in A with root, fifth and octave.", "You play the form twice through without counting out loud."),
  L(2, "Roots, fifths and thirds", "okpW_IY6x_E", "Scott's Bass Lessons", "Over a 4-chord loop: roots, then add fifths, then thirds, then approach notes.", "You can outline each chord without looking."),
  L(2, "The whole fingerboard", "VQct6xSNLrs", "Scott's Bass Lessons", "Play one major scale in all three zones of the neck without stopping.", "You move between zones smoothly in 2 keys."),
  L(2, "Worship moves and fills", "MyDP_-OYlXA", "Great Moses Bass Lesson", "Learn 3 moves and use one fill at the end of every 4 bars of a worship song.", "Your fills land back on beat one every time."),
  L(2, "Ghost notes", "UvkeY87QvDA", "Become A Bassist", "Mute with the fretting hand and add ghost notes between the real notes.", "Ghost notes sound percussive, not like pitches."),
  L(2, "16th-note funk accuracy", "x55DCin1GK8", "TalkingBass", "Count 1 e and a out loud. Play the groove at 60 bpm and accent the off-beats.", "Clean at 90 bpm."),
  L(2, "The 2-5-1-6 gospel progression", "5C5eIfcqNbI", "Gospel Bass", "Play 2-5-1-6 in C, F and G. Roots first, then connect with passing notes.", "You can play it in 3 keys with passing notes."),
  L(2, "Learning songs by ear", "OGXmbfW-nOA", "Become A Bassist", "Pick a song your church plays. Find the first note by ear, then the next, one phrase at a time.", "You work out a full verse by ear."),
  L(3, "Chords on bass", "VIOKJrN_fUo", "Scott's Bass Lessons", "Play fifths, thirds and tenths over a slow progression. Let each chord ring clean.", "Every chord rings with no muddy notes."),
  L(3, "Walking bass", "XcpUZWb3aJg", "Scott's Bass Lessons", "Walk over a simple progression: roots and fifths, then passing notes, then chord tones.", "You walk 2 choruses at 100 bpm."),
  L(3, "Traditional gospel bass lines", "jEwy-rosnbs", "Travis Dykes", "Work through each level of the line, then play it with the track.", "You play the full line with the track."),
  L(3, "Slap bass", "MN7TJl_xN9M", "Scott's Bass Lessons", "Thumb on the E string, pop on the G, slow eighth notes, then the groove from the lesson.", "Even thumb and pop volume at 80 bpm."),
  L(3, "Pro-level muting", "Cm88F69SlW4", "Dan Hawkins", "Floating thumb across all strings, combined with fretting-hand muting at speed.", "Fast lines sound clean with no ringing."),
  L(3, "Speed and stamina", "TjVUt1JvlKM", "TalkingBass", "Play 16th notes for 2 minutes at 90 bpm, rest, then 95, and keep going up to 120.", "2 clean minutes at 120 bpm."),
  L(3, "Jaco-style funk", "_V1DELz_qL8", "Joe Hubbard Bass", "Learn the climbing pattern, then the full 16th-note groove. Record it and compare.", "You play the groove along with the lesson.")
];

export const EXTRAS = [
  { t: "Learn the fretboard in 9 minutes", video: { id: "pQoWKra9LdQ", by: "BassBuzz" } },
  { t: "Tips for playing on a worship team", video: { id: "AjlPGodXfWY", by: "Mike O'Brien" } },
  { t: "Gospel major scale workout", video: { id: "4MMrmf2t-Gk", by: "Gospel Bass" } },
  { t: "A daily practice routine", video: { id: "W53qBX-8DIE", by: "eBassGuitar" } },
  { t: "Groove roadmap", video: { id: "Ccgsx5Nj234", by: "TalkingBass" } }
];

export function bass() {
  if (!S.bass) S.bass = { idx: 0, done: {}, log: [] };
  return S.bass;
}
export const lessonNo = () => bass().idx + 1;
export const lesson = (i = bass().idx) => CURRICULUM[Math.min(i, CURRICULUM.length - 1)];
export const finished = () => bass().idx >= CURRICULUM.length;
export const pct = () => Math.round(Object.keys(bass().done).length / CURRICULUM.length * 100);

// Session plan for N minutes
export function plan(min = 30) {
  const st = bass(), i = Math.min(st.idx, CURRICULUM.length - 1), ls = CURRICULUM[i], prev = i > 0 ? CURRICULUM[i - 1] : null;
  const r = f => Math.max(2, Math.round(min * f));
  const steps = [
    { min: r(0.1), t: "Warm up", d: i === 0 ? "Tune up and loosen your hands." : "Chromatic 1-2-3-4 on each string, metronome at 60." },
    { min: r(0.3), t: "Watch the lesson", d: `${ls.t}. Pause and copy each step.`, video: ls.video },
    { min: r(0.35), t: "Practice", d: ls.drill }
  ];
  if (prev) steps.push({ min: r(0.1), t: "Review", d: `Quick run of last lesson: ${prev.t.toLowerCase()}.` });
  const used = steps.reduce((a, s) => a + s.min, 0);
  steps.push({ min: Math.max(2, min - used), t: "Play a song", d: "Use today's skill on a song you love." });
  return { lesson: ls, n: i + 1, steps, pass: ls.pass };
}

export function brief(min = 30) {
  if (finished()) return "You've finished all 26 lessons. Keep learning songs by ear and work through the groove roadmap.";
  const p = plan(min);
  return `Today is lesson ${p.n} of ${CURRICULUM.length}: ${p.lesson.t}. Warm up for ${p.steps[0].min} minutes, watch the video, then practice for ${p.steps[2].min} minutes. You're ready to move on when: ${p.pass} Say complete when you've got it.`;
}

export function complete() {
  const st = bass();
  if (finished()) return null;
  const ls = CURRICULUM[st.idx];
  st.done[st.idx] = today();
  st.log.push({ date: today(), idx: st.idx });
  st.idx++;
  save();
  return { done: ls, next: finished() ? null : CURRICULUM[st.idx] };
}
export function jump(i) { bass().idx = Math.max(0, Math.min(CURRICULUM.length - 1, i)); save(); }
export function logTry() { bass().log.push({ date: today(), idx: bass().idx, repeat: true }); save(); }
