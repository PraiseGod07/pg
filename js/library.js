// Static knowledge: categories, gym exercises (with verified YouTube demos), splits, band practice content.

export const CATS = {
  class:   { label: "Class",    color: "#7FA7E8" },
  study:   { label: "Study",    color: "#7CC4A4" },
  work:    { label: "Project",  color: "#C9A86A" },
  commute: { label: "Travel",   color: "#8E96A8" },
  gym:     { label: "Gym",      color: "#E08A6D" },
  band:    { label: "Band",     color: "#B592E0" },
  meal:    { label: "Meal",     color: "#D9B65C" },
  meeting: { label: "Meeting",  color: "#6FB7C9" },
  social:  { label: "Social",   color: "#E39BB6" },
  rest:    { label: "Rest",     color: "#8FA39A" },
  other:   { label: "Personal", color: "#A8A39A" }
};

// Default minutes when the user doesn't give a length.
export const DEFAULT_MIN = { class: 60, study: 60, work: 60, commute: 20, gym: 75, band: 60, meal: 30, meeting: 45, social: 90, rest: 30, other: 30 };

const yt = (id, by) => ({ id, by });

export const EXERCISES = {
  bench:     { name: "Barbell bench press", muscles: "Chest, front delts, triceps", video: yt("CayG6UYqL8g", "NASM"),
    cues: ["Eyes under the bar, grip just outside shoulder width", "Squeeze shoulder blades together and keep feet planted", "Lower to mid-chest with elbows about 45 degrees, then press up and slightly back"] },
  ohp:       { name: "Overhead press", muscles: "Shoulders, triceps, upper chest", video: yt("8-_78Vn6O8o", "Mindful Muscle"),
    cues: ["Bar rests on front delts, grip just outside shoulders", "Brace abs and squeeze glutes so your lower back doesn't arch", "Press straight up, move your head back then through once the bar passes your face"] },
  inclineDb: { name: "Incline dumbbell press", muscles: "Upper chest, shoulders, triceps", video: yt("rXbRz-x_loo", "FlexXP"),
    cues: ["Bench at 30 to 45 degrees", "Lower the dumbbells to the sides of your upper chest", "Press up and slightly in without clanging the weights"] },
  lateral:   { name: "Dumbbell lateral raise", muscles: "Side delts", video: yt("4W-o_xK_XR4", "Training Tips & Tricks"),
    cues: ["Slight bend in the elbows, lean a touch forward", "Lift out to the sides until arms are level with shoulders", "Lower slowly, no swinging; light weight is fine"] },
  pushdown:  { name: "Triceps pushdown", muscles: "Triceps", video: yt("TT9SzlHxNM4", "Training By Matt"),
    cues: ["Pin elbows to your sides", "Push down until arms are straight and squeeze", "Let the bar rise to chest height under control"] },
  dips:      { name: "Chest dips", muscles: "Lower chest, triceps, front delts", video: yt("D-gxNnmuDvk", "FitVision Workout"),
    cues: ["Lean your torso forward slightly", "Lower until upper arms are about parallel to the floor", "Press back up without shrugging; use the assisted machine if needed"] },
  pullup:    { name: "Pull-ups", muscles: "Lats, upper back, biceps", video: yt("9yVGh3XbJ34", "NASM"),
    cues: ["Start from a dead hang, hands just wider than shoulders", "Pull your elbows down toward your ribs until chin clears the bar", "Lower all the way with control; use a band or assisted machine if needed"] },
  row:       { name: "Barbell bent-over row", muscles: "Mid back, lats, rear delts", video: yt("-ZBPVZJunHU", "6th Pillar Coaching"),
    cues: ["Hinge at the hips until your torso is about 45 degrees, flat back", "Pull the bar to your lower ribs", "Pause, squeeze your back, then lower under control"] },
  pulldown:  { name: "Lat pulldown", muscles: "Lats, biceps", video: yt("m8xywPIVFw0", "Andrea Obrero"),
    cues: ["Thighs locked under the pad, grip just wider than shoulders", "Lean back slightly and pull the bar to your upper chest", "Let it rise slowly until arms are straight"] },
  cableRow:  { name: "Seated cable row", muscles: "Mid back, lats", video: yt("WeZ8HZEyXIs", "APEXFIT"),
    cues: ["Sit tall with a slight knee bend", "Pull the handle to your stomach, elbows close", "Stretch forward a little on the way back without rounding"] },
  facepull:  { name: "Face pull", muscles: "Rear delts, upper back, rotator cuff", video: yt("EHt4gqtMyms", "Regular Joe Fitness"),
    cues: ["Rope at upper chest to face height", "Pull toward your forehead and spread the rope apart", "Finish with hands beside your ears, elbows high"] },
  curl:      { name: "Barbell curl", muscles: "Biceps", video: yt("9BpYNH4nb_Q", "All Strength Training"),
    cues: ["Shoulder-width grip, elbows at your sides", "Curl up without swinging your back", "Lower slowly all the way down"] },
  hammer:    { name: "Hammer curl", muscles: "Biceps, forearms", video: yt("8_BFFLUDu5Q", "Marz"),
    cues: ["Palms face each other the whole time", "Keep elbows still and curl to shoulder height", "Lower under control"] },
  squat:     { name: "Barbell back squat", muscles: "Quads, glutes, core", video: yt("kscmyDIU-Tc", "Lift With Michelle"),
    cues: ["Bar on upper back, feet about shoulder width", "Brace, then sit down and back with knees tracking over toes", "Go to at least parallel and drive up through the whole foot"] },
  rdl:       { name: "Romanian deadlift", muscles: "Hamstrings, glutes, lower back", video: yt("eqCbK2lxzcc", "6th Pillar Coaching"),
    cues: ["Soft knees, push your hips back", "Keep the bar close to your legs and your back flat", "Stop when you feel a strong hamstring stretch, then stand up by squeezing glutes"] },
  legpress:  { name: "Leg press", muscles: "Quads, glutes", video: yt("WgDRiE1cSAo", "Brendan Wong"),
    cues: ["Feet shoulder width in the middle of the platform", "Lower until knees are about 90 degrees without your lower back lifting", "Press up without locking your knees"] },
  legcurl:   { name: "Lying leg curl", muscles: "Hamstrings", video: yt("lUH80pneL5w", "NASM"),
    cues: ["Pad just above your heels", "Curl up and squeeze at the top", "Lower slowly, hips stay on the bench"] },
  lunge:     { name: "Walking lunge", muscles: "Quads, glutes", video: yt("_p_K5U9_mHs", "Your House Fitness"),
    cues: ["Long step forward, torso upright", "Lower until the back knee nearly touches the floor", "Push through the front heel into the next step"] },
  calf:      { name: "Standing calf raise", muscles: "Calves", video: yt("60jwNoZ1gM4", "Callari Strength & Performance"),
    cues: ["Balls of feet on the edge, heels hanging", "Rise as high as you can and pause", "Lower into a full stretch every rep"] },
  plank:     { name: "Plank", muscles: "Core", video: yt("A2b2EmIg0dA", "E3 Rehab"),
    cues: ["Elbows under shoulders, body in a straight line", "Squeeze glutes and brace your abs", "Breathe steadily; stop when your hips start to sag"] }
};

const s = (ex, sets, reps, rest) => ({ ex, sets, reps, rest });

export const SPLITS = {
  ppl: {
    label: "Push / Pull / Legs",
    days: [
      { key: "push", name: "Push day", focus: "chest, shoulders and triceps",
        plan: [s("bench", 4, "6–8", 120), s("ohp", 3, "8", 90), s("inclineDb", 3, "10", 90), s("lateral", 3, "12–15", 60), s("pushdown", 3, "10–12", 60), s("dips", 2, "to near failure", 90)] },
      { key: "pull", name: "Pull day", focus: "back and biceps",
        plan: [s("pullup", 4, "6–10", 120), s("row", 4, "8", 90), s("pulldown", 3, "10", 75), s("cableRow", 3, "10", 75), s("facepull", 3, "15", 60), s("curl", 3, "10", 60), s("hammer", 2, "12", 60)] },
      { key: "legs", name: "Leg day", focus: "quads, hamstrings, glutes and calves",
        plan: [s("squat", 4, "6–8", 150), s("rdl", 3, "8", 120), s("legpress", 3, "10–12", 90), s("legcurl", 3, "12", 60), s("lunge", 2, "10 each leg", 90), s("calf", 4, "12–15", 60), s("plank", 3, "45 sec", 45)] }
    ]
  },
  ul: {
    label: "Upper / Lower",
    days: [
      { key: "upper", name: "Upper day", focus: "chest, back, shoulders and arms",
        plan: [s("bench", 4, "6–8", 120), s("row", 4, "8", 90), s("ohp", 3, "8", 90), s("pulldown", 3, "10", 75), s("lateral", 3, "15", 60), s("curl", 2, "12", 60), s("pushdown", 2, "12", 60)] },
      { key: "lower", name: "Lower day", focus: "legs and core",
        plan: [s("squat", 4, "6–8", 150), s("rdl", 3, "8", 120), s("legpress", 3, "12", 90), s("legcurl", 3, "12", 60), s("calf", 4, "15", 60), s("plank", 3, "45 sec", 45)] }
    ]
  },
  full: {
    label: "Full body",
    days: [
      { key: "fullA", name: "Full body A", focus: "the whole body, squat focus",
        plan: [s("squat", 3, "6–8", 150), s("bench", 3, "8", 120), s("row", 3, "8", 90), s("lateral", 2, "15", 60), s("plank", 3, "45 sec", 45)] },
      { key: "fullB", name: "Full body B", focus: "the whole body, hinge focus",
        plan: [s("rdl", 3, "8", 120), s("ohp", 3, "8", 90), s("pullup", 3, "6–10", 120), s("lunge", 2, "10 each leg", 90), s("curl", 2, "12", 60)] }
    ]
  }
};

export const GYM_WARMUP = "5 minutes easy cardio, then 2 light warm-up sets of your first lift.";

// Band practice content
export const INSTRUMENTS = {
  bass:   { label: "Bass", warmup: yt("83_0VTNx5aA", "Greg's Bass Shed"), warmTitle: "How to warm up on bass",
    tech: ["Play the root notes of every song with a metronome at 70% speed, then full speed", "Chromatic 1-2-3-4 finger exercise up and down the neck", "Lock in with the kick drum: play along to a drum loop and land on beat one", "Muting practice: clean stops with no ringing strings", "Walk between chords using passing notes"] },
  guitar: { label: "Guitar", warmup: yt("SWNXgfIqLpE", "Steve Stine Guitar Lessons"), warmTitle: "Warm up stiff fingers",
    tech: ["Chord changes: switch between the hardest two chords for 2 minutes", "Alternate picking with a metronome, start slow", "Strumming patterns of your setlist at 70% speed", "Clean up riffs: no buzzing, no extra strings", "Practice lead parts in small chunks"] },
  drums:  { label: "Drums", warmup: yt("Jt6FGcyzr24", "Cowbell & Groove"), warmTitle: "Basic drum warm-up",
    tech: ["Single and double strokes on the pad with a metronome", "Fills into the chorus of each song", "Steady groove for 3 minutes without speeding up", "Dynamics: play a verse soft, a chorus loud", "Song intros and endings, together and clean"] },
  vocals: { label: "Vocals", warmup: yt("H4mYoOBiaXE", "Singeo"), warmTitle: "The everything vocal warm-up",
    tech: ["Lip trills up and down your range", "Breath support: long steady notes", "Hardest phrase of each song, slowly", "Harmony lines against a recording", "Lyrics run without music"] },
  keys:   { label: "Keys", warmup: yt("IAr9bvgNA9k", "Barnsley Music Service"), warmTitle: "Finger warm-up for keys",
    tech: ["Scales in the key of each song, hands separate then together", "Chord voicings for the hardest progression", "Left-hand rhythm with a metronome", "Smooth transitions between sections", "Sound and patch changes between songs"] }
};

export function stageOf(p) {
  if (p >= 90) return { label: "Show-ready", tone: "good" };
  if (p >= 70) return { label: "Tight", tone: "good" };
  if (p >= 40) return { label: "Getting there", tone: "mid" };
  return { label: "Learning", tone: "low" };
}
