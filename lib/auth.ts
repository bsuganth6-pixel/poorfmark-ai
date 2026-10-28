import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Production cookie: __Host- prefixed (so it can only be set by this exact host over HTTPS),
// Secure, HttpOnly, SameSite=Strict, Path=/, no Domain. ALLOW_INSECURE_COOKIES=1 relaxes
// Secure/__Host- for plain-http local testing only.
const hardened = process.env.NODE_ENV === "production" && process.env.ALLOW_INSECURE_COOKIES !== "1";
export const COOKIE = hardened ? "__Host-pm_session" : "pm_session";
export const MAX_AGE = 24 * 3600;
export const cookieOptions = { httpOnly: true, secure: hardened, sameSite: "strict" as const, path: "/", maxAge: MAX_AGE };

const g = globalThis as unknown as { __devSecret?: string };
function secret() {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET (16+ chars) must be set in production.");
  return (g.__devSecret ??= randomBytes(32).toString("hex"));
}
const sign = (v: string) => createHmac("sha256", secret()).update(v).digest("base64url");

export function hashPassword(pw: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 64).toString("hex")}`;
}

export function checkPassword(pw: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, "hex");
  const b = scryptSync(pw, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

// sv = the user's session version; signing out bumps it, which revokes every issued token.
export interface Session {
  user: string;
  sv: number;
}

export function makeToken(s: Session, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ u: s.user, v: s.sv, e: now + MAX_AGE * 1000 })).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function readToken(token: string, now = Date.now()): Session | null {
  const i = token.lastIndexOf(".");
  if (i < 0) return null;
  const body = token.slice(0, i);
  const sig = Buffer.from(token.slice(i + 1));
  const want = Buffer.from(sign(body));
  if (sig.length !== want.length || !timingSafeEqual(sig, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    return typeof p.u === "string" && typeof p.v === "number" && p.e > now ? { user: p.u, sv: p.v } : null;
  } catch {
    return null;
  }
}
