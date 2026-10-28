import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes, randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { col, demoMode, type Doc } from "../../../lib/db";
import { COOKIE, checkPassword, cookieOptions, hashPassword, makeToken, readToken } from "../../../lib/auth";
import { BRAND_GUIDE, RULES } from "../../../lib/rules";
import { reviewText, ruleEvidenceProblem, vetAiFindings } from "../../../lib/review";
import { aiEnabled, analyzeWithClaude } from "../../../lib/ai";
import { appendAudit, approvalState, createApproval, transition, verifyChain, type Ruleset, type Status } from "../../../lib/approval";
import { rulesetHash } from "../../../lib/ruleset";
import { radar } from "../../../lib/radar";
import {
  BrandSaveSchema, CredsSchema, MemberSchema, NewBrandSchema, NoteSchema, ReviewInputSchema, ReviseSchema,
  type BrandRule, type Role,
} from "../../../lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
const fail = (status: number, msg: string): never => {
  throw new HttpError(status, msg);
};
// Domain errors thrown by lib/ (bad transition, open blocking findings) become 409s.
const guard = <T>(fn: () => T): T => {
  try {
    return fn();
  } catch (e) {
    throw new HttpError(409, (e as Error).message);
  }
};
const now = () => new Date().toISOString();

// --- sessions: signed cookie + server-side session version (sign-out revokes every token)
async function sessionUser(): Promise<string | null> {
  const t = (await cookies()).get(COOKIE)?.value;
  const s = t ? readToken(t) : null;
  if (!s) return null;
  const u = await (await col("users")).findOne({ _id: s.user });
  return u && (u.sv ?? 0) === s.sv ? s.user : null;
}
const needUser = async () => (await sessionUser()) ?? fail(401, "Please sign in.");

async function startSession(email: string, sv: number) {
  (await cookies()).set(COOKIE, makeToken({ user: email, sv }), cookieOptions);
  return { user: email };
}
let dummy: string | undefined;
const dummyHash = () => (dummy ??= hashPassword(randomBytes(16).toString("hex")));

// --- brand isolation: a non-member gets 404, exactly like a brand that does not exist
async function brandFor(user: string, id: string, roles?: Role[]) {
  const b = await (await col("brands")).findOne({ _id: id, memberIds: user });
  if (!b) fail(404, "Brand not found.");
  const role: Role = b!.members.find((m: Doc) => m.userId === user).role;
  if (roles && !roles.includes(role)) fail(403, "Your role cannot do this.");
  return { b: b!, role };
}
async function reviewFor(user: string, id: string, roles?: Role[]) {
  const r = await (await col("reviews")).findOne({ _id: id });
  if (!r) fail(404, "Review not found.");
  const { b, role } = await brandFor(user, r!.brandId, roles);
  return { r: r!, b, role };
}

// --- ruleset binding: approvals and checks are tied to the brand's exact ruleset
const rulesetOf = (b: Doc): Ruleset => ({ version: String(b.version), hash: (b.rulesetHash as string | undefined) ?? rulesetHash(b as never) });
const latestOf = (r: Doc) => r.versions[r.versions.length - 1];
const effectiveStatus = (r: Doc, rs: Ruleset) =>
  r.status === "approved" && approvalState(r.approval, latestOf(r).text, rs) !== "current" ? "reapproval_required" : r.status;
const archive = (r: Doc, reason: string) => ({
  approval: null,
  approvalHistory: [...(r.approvalHistory ?? []), { ...r.approval, supersededAt: now(), reason }],
});

async function makeVersion(n: number, text: string, b: Doc, by: string) {
  const rules: BrandRule[] = b.rules;
  const rs = rulesetOf(b);
  const found = reviewText(text, rules, b.guide);
  const valid = rules.filter((r) => !ruleEvidenceProblem(r, b.guide));
  const ai = await analyzeWithClaude(text, { guide: b.guide, rules: valid, claims: b.claims });
  let findings = found;
  let note = ai.ok ? "" : ai.error;
  let rejected: { quote: string; reason: string }[] = [];
  if (ai.ok) {
    const vet = vetAiFindings(text, ai.candidates, rules, b.guide, b.claims.map((c: Doc) => c.text));
    const extra = vet.accepted.filter((f) => !found.some((x) => x.ruleId === f.ruleId && x.start === f.start));
    findings = [...found, ...extra].sort((x, y) => x.start - y.start);
    rejected = vet.rejected.slice(0, 10);
    note = `Claude returned ${ai.candidates.length} suggestion(s); ${extra.length} kept, ${vet.rejected.length} rejected as unverifiable.`;
  }
  return {
    n, text, findings, ai: { status: ai.ok ? "ok" : ai.status, note, rejected },
    skippedRules: rules.length - valid.length, rulesetVersion: rs.version, rulesetHash: rs.hash, by, at: now(),
  };
}

async function save(r: Doc, set: Record<string, unknown>, type: string, actor: string, data: Record<string, unknown> = {}) {
  const next = { ...set, events: appendAudit(r.events, { type, actor, data }), updatedAt: now() };
  await (await col("reviews")).update(r._id, next);
  return { review: { ...r, ...next } };
}

type H = (a: { p: string[]; body: any }) => Promise<unknown>;
const ID = "([\\w-]+)";
const routes: [string, RegExp, H][] = [
  ["GET", /^\/me$/, async () => ({ user: await sessionUser(), demoMode, aiEnabled: aiEnabled() })],
  ["POST", /^\/auth\/register$/, async ({ body }) => {
    const { email, password } = CredsSchema.parse(body);
    const users = await col("users");
    if (await users.findOne({ _id: email })) fail(409, "That email is already registered.");
    await users.insert({ _id: email, pw: hashPassword(password), sv: 0, createdAt: now() });
    return startSession(email, 0);
  }],
  ["POST", /^\/auth\/login$/, async ({ body }) => {
    const { email, password } = CredsSchema.parse(body);
    const u = await (await col("users")).findOne({ _id: email });
    const good = checkPassword(password, u?.pw ?? dummyHash()); // same work whether or not the user exists
    if (!u || !good) fail(401, "Invalid email or password.");
    return startSession(email, u!.sv ?? 0);
  }],
  ["POST", /^\/auth\/logout$/, async () => {
    const user = await sessionUser();
    if (user) {
      const users = await col("users");
      const u = await users.findOne({ _id: user });
      if (u) await users.update(user, { sv: (u.sv ?? 0) + 1 });
    }
    (await cookies()).set(COOKIE, "", { ...cookieOptions, maxAge: 0 });
    return { ok: true };
  }],
  ["GET", /^\/brands$/, async () => {
    const user = await needUser();
    const list = await (await col("brands")).find({ memberIds: user });
    return { brands: list.map((b) => ({ id: b._id, name: b.name, role: b.members.find((m: Doc) => m.userId === user).role })) };
  }],
  ["POST", /^\/brands$/, async ({ body }) => {
    const user = await needUser();
    const { name, sample } = NewBrandSchema.parse(body);
    const guide = sample ? BRAND_GUIDE : "";
    const rules = sample ? RULES : [];
    const brand = {
      _id: randomUUID(), name, guide, rules, claims: [], version: 1, rulesetHash: rulesetHash({ guide, rules, claims: [] }),
      members: [{ userId: user, email: user, role: "owner" }], memberIds: [user], createdAt: now(), updatedAt: now(),
    };
    await (await col("brands")).insert(brand);
    return { brand };
  }],
  ["GET", new RegExp(`^/brands/${ID}$`), async ({ p }) => {
    const { b, role } = await brandFor(await needUser(), p[0]);
    return { brand: { ...b, role, rulesetHash: rulesetOf(b).hash } };
  }],
  ["PUT", new RegExp(`^/brands/${ID}$`), async ({ p, body }) => {
    const { b } = await brandFor(await needUser(), p[0], ["owner", "editor"]);
    const d = BrandSaveSchema.parse(body);
    const guide = d.guide ?? b.guide;
    const claims = d.claims ?? b.claims;
    // The source label is fixed server-side so a rule cannot cite a document that does not exist.
    const rules = (d.rules ?? b.rules).map((r: BrandRule) => ({ ...r, source: "Brand guidelines" }));
    const ids = new Set<string>();
    for (const r of rules as BrandRule[]) {
      if (ids.has(r.id)) fail(400, `Duplicate rule id "${r.id}".`);
      ids.add(r.id);
      const problem = ruleEvidenceProblem(r, guide);
      if (problem) fail(400, `Rule "${r.pattern}": ${problem}.`);
    }
    const hash = rulesetHash({ guide, rules, claims });
    const set = {
      name: d.name ?? b.name, guide, rules, claims, rulesetHash: hash,
      version: hash === rulesetOf(b).hash ? b.version : b.version + 1, // bumps only when the ruleset really changes
      updatedAt: now(),
    };
    await (await col("brands")).update(b._id, set);
    return { brand: { ...b, ...set } };
  }],
  ["POST", new RegExp(`^/brands/${ID}/members$`), async ({ p, body }) => {
    const { b } = await brandFor(await needUser(), p[0], ["owner"]);
    const { email, role } = MemberSchema.parse(body);
    if (!(await (await col("users")).findOne({ _id: email }))) fail(404, "No account with that email. Ask them to register first.");
    if (b.memberIds.includes(email)) fail(409, "Already a member.");
    const members = [...b.members, { userId: email, email, role }];
    await (await col("brands")).update(b._id, { members, memberIds: members.map((m: Doc) => m.userId) });
    return { members };
  }],
  ["GET", new RegExp(`^/brands/${ID}/reviews$`), async ({ p }) => {
    const { b } = await brandFor(await needUser(), p[0]);
    const rs = rulesetOf(b);
    const list = await (await col("reviews")).find({ brandId: b._id });
    list.sort((x, y) => (y.updatedAt > x.updatedAt ? 1 : -1));
    return {
      reviews: list.map((r) => ({
        id: r._id, title: r.title, status: effectiveStatus(r, rs), versions: r.versions.length, updatedAt: r.updatedAt,
        errors: latestOf(r).findings.filter((x: Doc) => x.severity === "error").length,
      })),
    };
  }],
  ["POST", new RegExp(`^/brands/${ID}/reviews$`), async ({ p, body }) => {
    const user = await needUser();
    const { b } = await brandFor(user, p[0], ["owner", "editor"]);
    const { title, text } = ReviewInputSchema.parse(body);
    const t = now();
    const review = {
      _id: randomUUID(), brandId: b._id, title, status: "draft" as Status, versions: [await makeVersion(1, text, b, user)],
      events: appendAudit([], { type: "submitted", actor: user, data: { version: 1 } }), createdBy: user, createdAt: t, updatedAt: t,
    };
    await (await col("reviews")).insert(review);
    return { review };
  }],
  ["GET", new RegExp(`^/reviews/${ID}$`), async ({ p }) => {
    const { r, b, role } = await reviewFor(await needUser(), p[0]);
    const rs = rulesetOf(b);
    const v = latestOf(r);
    return {
      review: r, role, ruleset: rs, chainValid: verifyChain(r.events), stale: v.rulesetHash !== rs.hash,
      approvalState: approvalState(r.approval, v.text, rs), effectiveStatus: effectiveStatus(r, rs),
    };
  }],
  ["POST", new RegExp(`^/reviews/${ID}/revise$`), async ({ p, body }) => {
    const user = await needUser();
    const { r, b } = await reviewFor(user, p[0], ["owner", "editor"]);
    if (!["draft", "changes_requested", "approved"].includes(r.status)) fail(409, `A review that is ${r.status.replace("_", " ")} cannot be revised.`);
    const { text } = ReviseSchema.parse(body);
    if (text === latestOf(r).text) fail(409, "The content has not changed.");
    const n = r.versions.length + 1;
    const versions = [...r.versions, await makeVersion(n, text, b, user)];
    // Changing approved content withdraws the approval; it must be approved again.
    const withdrawn = r.status === "approved" ? { status: guard(() => transition("approved", "draft")), ...archive(r, "content_changed") } : {};
    return save(r, { versions, ...withdrawn }, "revised", user, { version: n, approvalWithdrawn: r.status === "approved" });
  }],
  ["POST", new RegExp(`^/reviews/${ID}/recheck$`), async ({ p }) => {
    const user = await needUser();
    const { r, b } = await reviewFor(user, p[0], ["owner", "editor"]);
    if (r.status === "approved") fail(409, "Use “Request reapproval” for an approved review.");
    const n = r.versions.length + 1;
    return save(r, { versions: [...r.versions, await makeVersion(n, latestOf(r).text, b, user)] }, "rechecked", user, { version: n });
  }],
  ["POST", new RegExp(`^/reviews/${ID}/request-approval$`), async ({ p }) => {
    const user = await needUser();
    const { r, b } = await reviewFor(user, p[0], ["owner", "editor"]);
    const rs = rulesetOf(b);
    const v = latestOf(r);
    const state = approvalState(r.approval, v.text, rs);
    if (r.status === "approved" && state === "current") fail(409, "This approval is still valid.");
    const status = guard(() => transition(r.status, "in_review"));
    // Re-check first when the brand rules moved since the latest version was analysed.
    const versions = v.rulesetHash === rs.hash ? r.versions : [...r.versions, await makeVersion(r.versions.length + 1, v.text, b, user)];
    const again = r.status === "approved";
    return save(r, { status, versions, ...(again ? archive(r, state) : {}) }, again ? "reapproval_requested" : "approval_requested", user, {
      version: versions.length, rechecked: versions.length !== r.versions.length,
    });
  }],
  ["POST", new RegExp(`^/reviews/${ID}/approve$`), async ({ p, body }) => {
    const user = await needUser();
    const { r, b } = await reviewFor(user, p[0], ["owner", "approver"]);
    const { note } = NoteSchema.parse(body);
    const rs = rulesetOf(b);
    const v = latestOf(r);
    const status = guard(() => transition(r.status, "approved"));
    if (v.rulesetHash !== rs.hash) fail(409, "The brand rules changed after this version was checked. Ask the author to re-check it, then approve.");
    // Blocking findings are recomputed server-side; the approval binds this exact text AND ruleset.
    const approval = guard(() =>
      createApproval({ text: v.text, findings: reviewText(v.text, b.rules, b.guide), reviewer: user, ruleset: rs, overrideReason: note }),
    );
    return save(r, { status, approval }, "approved", user, {
      version: v.n, contentHash: approval.contentHash, rulesetVersion: rs.version, override: approval.overrideReason ?? null,
    });
  }],
  ["POST", new RegExp(`^/reviews/${ID}/request-changes$`), async ({ p, body }) => {
    const user = await needUser();
    const { r } = await reviewFor(user, p[0], ["owner", "approver"]);
    const { note } = NoteSchema.parse(body);
    if (!note) fail(400, "Explain what needs to change.");
    const status = guard(() => transition(r.status, "changes_requested"));
    return save(r, { status }, "changes_requested", user, { comment: note });
  }],
  ["GET", new RegExp(`^/brands/${ID}/radar$`), async ({ p }) => {
    const { b } = await brandFor(await needUser(), p[0]);
    return radar((await (await col("reviews")).find({ brandId: b._id })) as never, b.rules, b.claims);
  }],
];

async function dispatch(req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const path = "/" + ((await ctx.params).path ?? []).join("/");
  try {
    for (const [method, re, fn] of routes) {
      const m = method === req.method ? re.exec(path) : null;
      if (!m) continue;
      let body = {};
      if (method !== "GET") {
        if (!req.headers.get("content-type")?.includes("application/json")) fail(415, "Send JSON.");
        if (Number(req.headers.get("content-length") ?? 0) > 250_000) fail(413, "Request too large.");
        body = await req.json().catch(() => ({}));
      }
      return NextResponse.json(await fn({ p: m.slice(1), body }));
    }
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof ZodError) {
      const i = e.issues[0];
      return NextResponse.json({ error: i ? `${i.path.length ? i.path.join(".") + ": " : ""}${i.message}` : "Invalid input." }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ error: "Something went wrong on the server." }, { status: 500 });
  }
}
export { dispatch as GET, dispatch as POST, dispatch as PUT };
