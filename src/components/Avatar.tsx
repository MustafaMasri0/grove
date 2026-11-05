import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import { avatarHue, createAvatarLoader, initials } from "../lib/avatar";
import { useAt } from "../store";

/** One picture size for every place, so each author is fetched and cached once. */
const FETCH_SIZE = 64;
type Hint = { at: { repo: string; cwd: string }; sha: string };
const avatars = createAvatarLoader<Hint>((email, hint) => api.avatar(email, FETCH_SIZE, hint?.at, hint?.sha), 4);

/** The commit author's picture, with their initials until it loads or when there is none. */
export function Avatar({ name, email, size, sha }: { name: string; email: string; size: number; sha?: string }) {
  const at = useAt();
  const [url, setUrl] = useState(() => avatars.peek(email) ?? null);

  useEffect(() => {
    const known = avatars.peek(email);
    if (known !== undefined) return setUrl(known);
    setUrl(null);
    let live = true;
    void avatars(email, at && sha ? { at, sha } : undefined).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
    // The hint only helps the first lookup; it is not a reason to look up again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  return (
    <InitialsAvatar seed={email} text={initials(name, email)} size={size}>
      {url && <img src={url} alt="" draggable={false} onError={() => setUrl(null)} />}
    </InitialsAvatar>
  );
}

/** Initials on a colour picked from `seed`; a picture given as `children` covers them. */
export function InitialsAvatar({ seed, text, size, children }: { seed: string; text: string; size: number; children?: ReactNode }) {
  return (
    <span className="avatar" aria-hidden="true" style={{ width: size, height: size, fontSize: Math.round(size * 0.42), background: `hsl(${avatarHue(seed)} 42% var(--avatar-lightness, 44%))` }}>
      {text}
      {children}
    </span>
  );
}
