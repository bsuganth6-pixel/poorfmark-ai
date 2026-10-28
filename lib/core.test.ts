import { afterEach, describe, expect, it, vi } from "vitest";
import { findConflicts, radar } from "./radar";
import { checkPassword, hashPassword, makeToken, readToken } from "./auth";
import { analyzeWithClaude, parseAiJson } from "./ai";
import { reviewText } from "./review";
import { BRAND_GUIDE, RULES } from "./rules";
import { assertSecureUri, col } from "./db";
import { assessRoles } from "../scripts/db-check.mjs";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("auth", () => {
  it("hashes and checks passwords", () => {
    const h = hashPassword("correct horse");
    expect(checkPassword("correct horse", h)).toBe(true);
    expect(checkPassword("wrong", h)).toBe(false);
  });
  it("round-trips sessions and rejects tampered or expired tokens", () => {
    const t = makeToken({ user: "a@b.co", sv: 3 });
    expect(readToken(t)).toEqual({ user: "a@b.co", sv: 3 });
    expect(readToken(t.slice(0, -2) + "xx")).toBeNull();
    expect(readToken(t, Date.now() + 25 * 3600 * 1000)).toBeNull();
  });
  it("uses hardened production cookies and a relaxed local override", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_INSECURE_COOKIES", "");
    const prod = await import("./auth");
    expect(prod.COOKIE.startsWith("__Host-")).toBe(true);
    expect(prod.cookieOptions).toMatchObject({ httpOnly: true, secure: true, sameSite: "strict", path: "/" });
    expect(prod.cookieOptions).not.toHaveProperty("domain");
    vi.resetModules();
    vi.stubEnv("ALLOW_INSECURE_COOKIES", "1");
    const local = await import("./auth");
    expect(local.cookieOptions.secure).toBe(false);
    expect(local.COOKIE.startsWith("__Host-")).toBe(false);
  });
  it("refuses to sign sessions in production without SESSION_SECRET", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", "");
    const m = await import("./auth");
    expect(() => m.makeToken({ user: "a", sv: 0 })).toThrow(/SESSION_SECRET/);
  });
});

describe("claude integration", () => {
  const ctx = { guide: BRAND_GUIDE, rules: RULES, claims: [] };
  it("is skipped, not faked, without an API key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(await analyzeWithClaude("hi", ctx)).toMatchObject({ ok: false, status: "skipped" });
  });
  it("rejects malformed model output", () => {
    expect(() => parseAiJson("sorry, no JSON")).toThrow();
    expect(() => parseAiJson('{"findings":[{"quote":""}]}')).toThrow();
  });
  it("parses fenced JSON and reports API errors", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    const body = { content: [{ type: "text", text: '```json\n{"findings":[{"ruleId":"sign-in","quote":"log in","message":"m"}]}\n```' }] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body))));
    expect(await analyzeWithClaude("log in", ctx)).toMatchObject({ ok: true });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    expect(await analyzeWithClaude("x", ctx)).toMatchObject({ ok: false, status: "failed" });
  });
});

describe("health radar", () => {
  it("counts recurring violations from saved findings only", () => {
    const f = reviewText("This is guaranteed.", RULES, BRAND_GUIDE);
    const rows = radar([{ _id: "1", versions: [{ findings: f }] }, { _id: "2", versions: [{ findings: f }] }, { _id: "3", versions: [{ findings: [] }] }], RULES, []).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ruleId: "no-guaranteed", reviews: 2, recurring: true });
    expect(radar([], RULES, []).rows).toEqual([]);
  });
  it("detects conflicting rules and claims", () => {
    const c = findConflicts([...RULES, { ...RULES[2], id: "x", pattern: "sign in", replacement: "guaranteed" }], [{ text: "A world-class claim" }]);
    expect(c.map((x) => x.type).sort()).toEqual(["claim-contains-ban", "suggestion-triggers-ban"]);
    expect(findConflicts(RULES, [])).toEqual([]);
  });
});

describe("database safety", () => {
  it("inserts, filters by array membership, updates, rejects duplicates (demo store)", async () => {
    const c = await col("t_" + Math.random());
    await c.insert({ _id: "1", memberIds: ["a", "b"], n: 1 });
    await expect(c.insert({ _id: "1" })).rejects.toThrow();
    expect(await c.find({ memberIds: "b" })).toHaveLength(1);
    expect(await c.findOne({ memberIds: "z" })).toBeNull();
    await c.update("1", { n: 2 });
    expect((await c.findOne({ _id: "1" }))?.n).toBe(2);
  });
  it("requires TLS for production connections", () => {
    const prod = { NODE_ENV: "production" };
    expect(() => assertSecureUri("mongodb://db.example.com:27017/x", prod)).toThrow(/mongodb\+srv/);
    expect(() => assertSecureUri("mongodb+srv://u:p@c.mongodb.net/x", prod)).not.toThrow();
    expect(() => assertSecureUri("mongodb://h/x?tls=true", prod)).not.toThrow();
    expect(() => assertSecureUri("mongodb://localhost/x", { NODE_ENV: "development" })).not.toThrow();
  });
  it("flags over-privileged MongoDB roles", () => {
    expect(assessRoles([{ role: "readWrite", db: "proofmark" }], "proofmark").problems).toEqual([]);
    expect(assessRoles([{ role: "atlasAdmin", db: "admin" }], "proofmark").problems).toHaveLength(1);
    expect(assessRoles([{ role: "readWrite", db: "other" }], "proofmark").problems[0]).toMatch(/other/);
    expect(assessRoles([{ role: "dbOwner", db: "proofmark" }], "proofmark").problems[0]).toMatch(/broader/);
    const custom = assessRoles([{ role: "pmApp", db: "admin" }], "proofmark");
    expect(custom.problems).toEqual([]);
    expect(custom.notes).toHaveLength(1);
  });
});
