// Commit author avatars: initials and a colour per author (shown at once and
// when there is no picture), and a loader that fetches each author's picture once.

const letters = (word: string) => Array.from(word).filter((c) => /\p{L}/u.test(c));

/** "Ada Lovelace" → "AL"; a single name gives one letter; no name falls back to the email. */
export function initials(name: string, email: string): string {
  const words = name.split(/\s+/).map(letters).filter((w) => w.length > 0);
  if (words.length === 0) {
    const first = letters(email.split("@")[0] ?? "")[0];
    return first ? first.toUpperCase() : "?";
  }
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return (first + last).toUpperCase();
}

const normalize = (email: string) => email.trim().toLowerCase();

/** A stable hue (0–359) for an author, so the same person always gets the same colour. */
export function avatarHue(email: string): number {
  let h = 0x811c9dc5;
  for (const c of normalize(email)) h = Math.imul(h ^ c.codePointAt(0)!, 0x01000193) >>> 0;
  return h % 360;
}

export interface AvatarLoader<H = unknown> {
  /**
   * The picture as a data URL, or null when the author has none (or it could not be fetched).
   * `hint` (e.g. the repository and a commit) goes to the lookup; the first caller's is used.
   */
  (email: string, hint?: H): Promise<string | null>;
  /** What is already known: a picture, null for none, undefined when not looked up yet. */
  peek(email: string): string | null | undefined;
}

/** Wraps `fetch` so each author is looked up once and at most `limit` lookups run at a time. */
export function createAvatarLoader<H = unknown>(fetch: (email: string, hint?: H) => Promise<string | null>, limit: number): AvatarLoader<H> {
  const pending = new Map<string, Promise<string | null>>();
  const done = new Map<string, string | null>();
  const queue: (() => void)[] = [];
  let running = 0;

  const next = () => {
    while (running < limit && queue.length) {
      running++;
      queue.shift()!();
    }
  };

  const load = ((email: string, hint?: H) => {
    const key = normalize(email);
    if (!key) return Promise.resolve(null);
    if (done.has(key)) return Promise.resolve(done.get(key)!);
    let p = pending.get(key);
    if (!p) {
      p = new Promise<string | null>((resolve) => {
        queue.push(() => {
          fetch(key, hint)
            .catch(() => null)
            .then((url) => {
              done.set(key, url);
              pending.delete(key);
              running--;
              resolve(url);
              next();
            });
        });
        next();
      });
      pending.set(key, p);
    }
    return p;
  }) as AvatarLoader<H>;
  load.peek = (email) => done.get(normalize(email));
  return load;
}
