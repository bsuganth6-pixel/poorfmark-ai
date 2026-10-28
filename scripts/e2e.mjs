// End-to-end checks over HTTP against a running production server (see scripts/integration.mjs).
// With MOCK_AI=1 a local stand-in for the Claude API is started on :4010. It is test infrastructure
// only: it proves our request, validation and evidence gating, not real Claude output.
import http from "node:http";

const BASE = process.env.BASE || "http://localhost:3000";
const jars = {};
let fails = 0;
let total = 0;
const ok = (c, m) => {
  total++;
  console.log(`${c ? "PASS" : "FAIL"}  ${m}`);
  if (!c) fails++;
};

async function call(who, method, path, body) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { "content-type": "application/json", ...(jars[who] ? { cookie: jars[who] } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const cookies = res.headers.getSetCookie?.() ?? [];
  if (cookies.length) jars[who] = cookies[0].split(";")[0];
  return { status: res.status, cookies, ...(await res.json().catch(() => ({}))) };
}

const seen = [];
let mock;
if (process.env.MOCK_AI) {
  const Q = 'Do not use unsubstantiated superlatives such as "world-class" or "best-in-class".';
  const quote = "best-in-class platform";
  const findings = [
    { ruleId: "", quote, guideQuote: Q, message: "Unsubstantiated superlative.", category: "messaging", suggestion: "a reliable platform" },
    { ruleId: "", quote, guideQuote: "Never be funny.", message: "invented evidence" },
    { ruleId: "", quote: "text that is not in the document", guideQuote: Q, message: "invented excerpt" },
    { ruleId: "ghost-rule", quote, message: "unknown rule" },
    { ruleId: "no-guaranteed", quote, message: "real rule, unrelated excerpt" },
    { ruleId: "", quote, guideQuote: 'Say "sign in", never "log in".', message: "genuine but unrelated evidence" },
  ];
  mock = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      seen.push({ key: req.headers["x-api-key"], ver: req.headers["anthropic-version"], url: req.url });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ content: [{ type: "text", text: "```json\n" + JSON.stringify({ findings }) + "\n```" }] }));
    });
  }).listen(4010, "127.0.0.1");
}

const stamp = Date.now();
const A = `a${stamp}@test.dev`, B = `b${stamp}@test.dev`, C = `c${stamp}@test.dev`, PW = "password123";
const BAD = "Log in to start your free trial. Our world-class team has guaranteed results. Our best-in-class platform is loved.";
const FIXED = "Sign in to start your free trial. Terms apply. Our team delivers.";
const types = (r) => r.events.map((e) => e.type).join();

const me0 = await call("a", "GET", "/me");
const aiOn = me0.aiEnabled;
console.log(`server: demoMode=${me0.demoMode} aiEnabled=${aiOn}`);

// ---- auth, cookies, headers
const regA = await call("a", "POST", "/auth/register", { email: A, password: PW });
ok(regA.status === 200, "register A");
const ck = regA.cookies[0] ?? "";
ok(/^__Host-pm_session=/.test(ck) && /;\s*HttpOnly/i.test(ck) && /;\s*Secure/i.test(ck) && /samesite=strict/i.test(ck) && /;\s*Path=\//i.test(ck) && !/domain=/i.test(ck), "session cookie is __Host-, HttpOnly, Secure, SameSite=Strict, Path=/, no Domain");
ok((await call("b", "POST", "/auth/register", { email: B, password: PW })).status === 200, "register B");
ok((await call("x", "POST", "/auth/register", { email: A, password: PW })).status === 409, "duplicate email rejected");
ok((await call("x", "POST", "/auth/register", { email: "c@test.dev", password: "short" })).status === 400, "short password rejected");
ok((await call("x", "GET", "/brands")).status === 401, "anonymous request rejected (401)");
const wrong = await call("x", "POST", "/auth/login", { email: A, password: "wrongpass1" });
const ghost = await call("x", "POST", "/auth/login", { email: "nobody@test.dev", password: PW });
ok(wrong.status === 401 && ghost.status === 401 && wrong.error === ghost.error, "bad password and unknown user look identical");
const home = await fetch(BASE + "/");
ok(home.headers.get("x-content-type-options") === "nosniff" && home.headers.get("x-frame-options") === "DENY" && /max-age/.test(home.headers.get("strict-transport-security") ?? ""), "security headers on pages");
ok((await fetch(BASE + "/api/me")).headers.get("cache-control")?.includes("no-store"), "API responses are no-store");
const html = await (await fetch(BASE + "/")).text();
const assets = [...html.matchAll(/(?:src|href)="(\/_next\/[^"]+)"/g)].map((m) => m[1]);
const got0 = await Promise.all(assets.map(async (a) => ({ a, r: await fetch(BASE + a) })));
const css = await Promise.all(got0.filter((x) => x.a.includes(".css")).map((x) => x.r.clone().text()));
ok(assets.length > 0 && got0.every((x) => x.r.status === 200) && css.some((t) => t.includes("rounded-xl") && t.includes("bg-indigo-600")), "page serves its JS/CSS assets; Tailwind CSS contains the UI's utilities");
ok((await call("a", "POST", "/brands", { name: "x".repeat(300000) })).status === 413, "oversized request rejected (413)");

// ---- brand management, isolation, evidence rules
const nb = await call("a", "POST", "/brands", { name: "Acme", sample: true });
const bid = nb.brand?._id;
const g = nb.brand.guide, rules = nb.brand.rules;
const brand = async () => (await call("a", "GET", `/brands/${bid}`)).brand;
ok(nb.status === 200 && rules.length === 4 && nb.brand.version === 1, "A creates brand with sample rules (ruleset v1)");
ok((await call("b", "GET", `/brands/${bid}`)).status === 404, "B cannot read A's brand (404)");
ok((await call("b", "GET", "/brands")).brands.length === 0, "B's brand list is empty");
ok((await call("b", "GET", `/brands/${bid}/reviews`)).status === 404, "B cannot list A's reviews");
ok((await call("b", "PUT", `/brands/${bid}`, { guide: "x" })).status === 404, "B cannot edit A's brand");
const g2 = g + '\nNever say "cheap".\nPrefer "cheap" over "inexpensive".';
const mk = (o) => ({ id: "z" + Math.random().toString(36).slice(2, 6), kind: "banned_term", pattern: "cheap", rationale: "r", severity: "warning", source: "Fake Legal Handbook", sourceQuote: 'Never say "cheap".', ...o });
const fake = await call("a", "PUT", `/brands/${bid}`, { rules: [...rules, mk({ sourceQuote: "This sentence is not in the guide." })] });
ok(fake.status === 400 && /not in the guidelines/.test(fake.error), "fabricated source quote rejected");
const unrel = await call("a", "PUT", `/brands/${bid}`, { guide: g2, rules: [...rules, mk({ sourceQuote: 'Say "sign in", never "log in".' })] });
ok(unrel.status === 400 && /never mentions "cheap"/.test(unrel.error), "genuine but unrelated quote rejected");
const unrel2 = await call("a", "PUT", `/brands/${bid}`, { guide: g2, rules: [...rules, mk({ kind: "preferred_term", pattern: "inexpensive", replacement: "cheap" })] });
ok(unrel2.status === 400 && /never mentions "inexpensive"/.test(unrel2.error), "quote that omits the rule's term rejected");
ok((await call("a", "POST", `/brands/${bid}/members`, { email: B, role: "approver" })).status === 200, "A adds B as approver");
ok((await call("b", "GET", `/brands/${bid}`)).status === 200, "B (member) can read the brand");
ok((await call("b", "PUT", `/brands/${bid}`, { guide: g })).status === 403, "approver B cannot edit brand rules (403)");
ok((await call("b", "POST", `/brands/${bid}/reviews`, { title: "t", text: "x" })).status === 403, "approver B cannot submit content (403)");

// ---- proof trail
const r1 = await call("a", "POST", `/brands/${bid}/reviews`, { title: "Launch email", text: BAD });
const rid = r1.review?._id;
const v1 = r1.review?.versions[0];
const f = v1?.findings ?? [];
ok(r1.status === 200 && r1.review.status === "draft", "A submits content (draft)");
ok(f.filter((x) => x.origin === "rule").length === 4, `rule checks found 4 issues (got ${f.filter((x) => x.origin === "rule").length})`);
ok(f.every((x) => x.excerpt && x.message && x.severity && x.ruleId && x.evidence?.quote && x.evidence.verified === true), "every finding has excerpt, rule, explanation, severity and a verified source quote");
ok(f.every((x) => x.origin === "ai" || (x.evidence.quote.toLowerCase().includes(x.excerpt.toLowerCase()) || x.evidence.quote.toLowerCase().includes((rules.find((r) => r.id === x.ruleId)?.pattern ?? "").toLowerCase()))), "each rule finding's evidence mentions the rule's own term");
ok(f.some((x) => x.suggestion === "sign in"), "suggested correction present");
ok(v1.rulesetVersion === "1" && v1.rulesetHash === (await brand()).rulesetHash, "version records the ruleset it was checked against");
if (aiOn) {
  const ai = f.filter((x) => x.origin === "ai");
  ok(ai.length === 1 && ai[0].evidence.verified && ai[0].severity === "warning", `Claude: 1 of 6 suggestions kept (kept ${ai.length})`);
  ok(JSON.stringify(v1.ai.rejected.map((x) => x.reason)) === JSON.stringify([
    "evidence quote is not in the guidelines or approved claims", "excerpt is not in the content", 'cites unknown rule "ghost-rule"',
    'excerpt is unrelated to rule "no-guaranteed"', "evidence quote is unrelated to the excerpt",
  ]), "Claude: invented, unknown-rule and unrelated citations rejected with reasons");
  ok(seen.length >= 1 && seen[0].key === "test" && seen[0].ver === "2023-06-01" && seen[0].url === "/v1/messages", "Claude request sent with key, version and path");
} else {
  ok(v1.ai.status === "skipped" && f.every((x) => x.origin === "rule"), "Claude skipped (no key), nothing faked");
}

// ---- review workflow + approval integrity
ok((await call("a", "POST", `/reviews/${rid}/approve`, {})).status === 409, "cannot approve a draft (409)");
ok((await call("a", "POST", `/reviews/${rid}/request-approval`)).review?.status === "in_review", "A requests approval");
ok((await call("b", "POST", `/reviews/${rid}/approve`, {})).status === 409, "approval blocked by open errors without an override");
ok((await call("b", "POST", `/reviews/${rid}/request-changes`, {})).status === 400, "request-changes needs a comment");
ok((await call("b", "POST", `/reviews/${rid}/request-changes`, { note: "Remove the claims" })).review?.status === "changes_requested", "B requests changes");
const rv = await call("a", "POST", `/reviews/${rid}/revise`, { text: FIXED });
ok(rv.review?.versions.length === 2 && rv.review.versions[1].findings.filter((x) => x.severity === "error").length === 0, "A revises: v2 has no blocking findings");
ok((await call("a", "POST", `/reviews/${rid}/request-approval`)).review?.status === "in_review", "A re-requests approval");
ok((await call("b", "POST", `/reviews/${rid}/approve`, {})).review?.status === "approved", "B approves");
let got = await call("a", "GET", `/reviews/${rid}`);
ok(got.approvalState === "current" && got.effectiveStatus === "approved" && got.review.approval.rulesetVersion === "1" && /^[0-9a-f]{64}$/.test(got.review.approval.contentHash) && got.review.approval.rulesetHash === (await brand()).rulesetHash, "approval binds text hash AND ruleset version/hash");
const same = await call("a", "PUT", `/brands/${bid}`, { guide: g, rules, claims: [] });
got = await call("a", "GET", `/reviews/${rid}`);
ok(same.status === 200 && same.brand.version === 1 && got.approvalState === "current", "saving an unchanged ruleset keeps the version and the approval");
const k1 = [{ id: "k1", text: "Reduces onboarding time by up to 30%" }];
ok((await call("a", "PUT", `/brands/${bid}`, { claims: k1 })).brand?.version === 2, "changing approved claims bumps the ruleset to v2");
got = await call("a", "GET", `/reviews/${rid}`);
ok(got.approvalState === "ruleset_changed" && got.effectiveStatus === "reapproval_required" && got.review.status === "approved", "ruleset change invalidates the approval (reapproval required)");
ok((await call("a", "GET", `/brands/${bid}/reviews`)).reviews.find((x) => x.id === rid)?.status === "reapproval_required", "review list shows reapproval required");
const re = await call("a", "POST", `/reviews/${rid}/request-approval`);
ok(re.review?.status === "in_review" && re.review.approval === null && re.review.approvalHistory.length === 1 && re.review.versions.length === 3 && re.review.versions[2].rulesetVersion === "2", "reapproval re-checks under v2, archives the old approval");
ok((await call("a", "POST", `/reviews/${rid}/request-approval`)).status === 409, "cannot request approval twice");
const ap2 = await call("b", "POST", `/reviews/${rid}/approve`, {});
ok(ap2.review?.status === "approved" && ap2.review.approval.rulesetVersion === "2" && ap2.review.approval.rulesetHash === (await brand()).rulesetHash, "reapproved against ruleset v2");
const rv2 = await call("a", "POST", `/reviews/${rid}/revise`, { text: FIXED + " Updated." });
ok(rv2.review?.status === "draft" && rv2.review.approval === null && rv2.review.approvalHistory.length === 2, "editing approved content withdraws the approval");
ok((await call("a", "POST", `/reviews/${rid}/revise`, { text: FIXED + " Updated." })).status === 409, "revising with unchanged content rejected");
await call("a", "POST", `/reviews/${rid}/request-approval`);
await call("b", "POST", `/reviews/${rid}/approve`, {});
got = await call("a", "GET", `/reviews/${rid}`);
ok(got.review.status === "approved" && got.approvalState === "current" && got.chainValid === true, "content re-approved; audit chain valid");
ok(types(got.review) === "submitted,approval_requested,changes_requested,revised,approval_requested,approved,reapproval_requested,approved,revised,approval_requested,approved", "review history recorded in order");

// ---- ruleset changes while a review is waiting
const r2 = await call("a", "POST", `/brands/${bid}/reviews`, { title: "Second", text: "This is guaranteed." });
const rid2 = r2.review._id;
await call("a", "POST", `/reviews/${rid2}/request-approval`);
const k2 = [...k1, { id: "k2", text: "Setup takes under 10 minutes" }];
ok((await call("a", "PUT", `/brands/${bid}`, { claims: k2 })).brand?.version === 3, "ruleset moves to v3 while review 2 awaits approval");
const stale = await call("b", "POST", `/reviews/${rid2}/approve`, { note: "ok" });
ok(stale.status === 409 && /rules changed/.test(stale.error), "approval blocked: version was checked against an older ruleset");
ok((await call("a", "GET", `/reviews/${rid2}`)).stale === true, "review flagged as stale");
ok((await call("b", "POST", `/reviews/${rid2}/recheck`)).status === 403, "approver cannot re-check (403)");
const rc = await call("a", "POST", `/reviews/${rid2}/recheck`);
ok(rc.review?.versions.length === 2 && rc.review.versions[1].rulesetVersion === "3", "author re-checks against v3");
const ov = await call("b", "POST", `/reviews/${rid2}/approve`, { note: "Legal signed off" });
ok(ov.review?.approval?.overrideReason === "Legal signed off" && ov.review.approval.rulesetVersion === "3", "blocking findings approved only with an override reason, bound to v3");

// ---- guideline health radar from saved reviews
const rd1 = await call("a", "GET", `/brands/${bid}/radar`);
const row = rd1.rows.find((x) => x.ruleId === "no-guaranteed");
ok(row?.reviews === 2 && row.recurring === true, "radar: recurring violation across 2 saved reviews");
ok(rd1.conflicts.length === 0, "radar: no conflicts in current rules");
const more = [mk({ id: "c1" }), mk({ id: "c2", kind: "preferred_term", pattern: "inexpensive", replacement: "cheap", sourceQuote: 'Prefer "cheap" over "inexpensive".' })];
const k3 = [...k2, { id: "k3", text: "Our cheap plan" }];
ok((await call("a", "PUT", `/brands/${bid}`, { guide: g2, rules: [...rules, ...more], claims: k3 })).status === 200, "A saves edited guidelines, rules and approved claims");
const saved = await brand();
ok(saved.claims.length === 3 && saved.rules.length === 6 && saved.rules.every((r) => r.source === "Brand guidelines"), "saved claims persisted; source labels fixed by the server");
const rd2 = await call("a", "GET", `/brands/${bid}/radar`);
ok(rd2.conflicts.length === 2, `radar: 2 conflicts detected (got ${rd2.conflicts.length})`);

// ---- isolation + session revocation
await call("c", "POST", "/auth/register", { email: C, password: PW });
ok((await call("c", "GET", `/reviews/${rid}`)).status === 404, "non-member cannot read a review (404)");
jars.old = jars.a;
await call("a", "POST", "/auth/logout");
ok((await call("a", "GET", "/brands")).status === 401, "signed out: requests rejected");
ok((await call("old", "GET", "/brands")).status === 401, "a copied session cookie stops working after sign-out (server-side revocation)");
ok((await call("a", "POST", "/auth/login", { email: A, password: PW })).status === 200 && (await call("a", "GET", "/brands")).status === 200, "signing in again works");

mock?.close();
console.log(`\n${total} checks, ${fails ? `${fails} FAILED` : "ALL PASSED"}`);
process.exit(fails ? 1 : 0);
