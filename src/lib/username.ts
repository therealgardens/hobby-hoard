// Basic profanity list — covers obvious EN/IT slurs. Substring match is intentional
// (catches "fuckyou", "merdaccia", etc.). Keep lowercase.
const BAD_WORDS = [
  "fuck", "shit", "bitch", "cunt", "dick", "pussy", "asshole", "bastard",
  "slut", "whore", "nigger", "nigga", "faggot", "retard", "rape",
  "merda", "stronzo", "stronza", "puttana", "troia", "cazzo", "vaffanculo",
  "fanculo", "minchia", "frocio", "negro", "checca", "zoccola",
];

export const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

export function validateUsername(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = (raw ?? "").trim();
  if (!value) return { ok: false, error: "Username is required." };
  if (!USERNAME_RE.test(value)) {
    return { ok: false, error: "Use 3–20 characters: letters, numbers, underscore." };
  }
  const lower = value.toLowerCase();
  if (BAD_WORDS.some((w) => lower.includes(w))) {
    return { ok: false, error: "Please choose a different username." };
  }
  return { ok: true, value };
}
