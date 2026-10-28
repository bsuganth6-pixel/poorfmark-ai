import { describe, expect, it } from "vitest";
import { BRAND_GUIDE, RULES } from "./rules";
import { related, reviewText, ruleEvidenceProblem, verifyQuote, vetAiFindings, type AiCandidate } from "./review";
import { appendAudit, approvalState, createApproval, transition, verifyChain } from "./approval";
import { rulesetHash } from "./ruleset";

const bad = "Log in to start your free trial. Our world-class team has guaranteed results.";

describe("review", () => {
  it("flags banned, preferred and missing-required terms with verified evidence", () => {
    const f = reviewText(bad, RULES, BRAND_GUIDE);
    expect(f.map((x) => x.ruleId).sort()).toEqual(["no-guaranteed", "no-superlatives", "sign-in", "trial-terms"]);
    expect(f.every((x) => x.evidence.verified)).toBe(true);
  });
  it("accepts a free trial that includes the terms line", () => {
    expect(reviewText("Start your free trial. Terms apply.", RULES, BRAND_GUIDE)).toEqual([]);
  });
  it("flags a quote that is not in the guide", () => {
    expect(verifyQuote("invented rule", BRAND_GUIDE)).toBe(false);
  });
});

describe("proof trail evidence", () => {
  it("accepts evidence that is genuine and about the rule's own terms", () => {
    expect(RULES.map((r) => ruleEvidenceProblem(r, BRAND_GUIDE))).toEqual([null, null, null, null]);
  });
  it("rejects fabricated or unrelated rule evidence", () => {
    expect(ruleEvidenceProblem({ ...RULES[0], sourceQuote: "Invented policy sentence." }, BRAND_GUIDE)).toMatch(/not in the guidelines/);
    // a real sentence from the guide that is about something else
    expect(ruleEvidenceProblem({ ...RULES[0], sourceQuote: 'Say "sign in", never "log in".' }, BRAND_GUIDE)).toMatch(/never mentions "guaranteed"/);
    expect(ruleEvidenceProblem({ ...RULES[2], replacement: "register" }, BRAND_GUIDE)).toMatch(/never mentions "register"/);
    expect(ruleEvidenceProblem({ ...RULES[3], replacement: "" }, BRAND_GUIDE)).toMatch(/needs a replacement/);
  });
  it("never emits a finding for a rule whose evidence is invalid", () => {
    expect(reviewText("guaranteed", [{ ...RULES[0], sourceQuote: 'Say "sign in", never "log in".' }], BRAND_GUIDE)).toEqual([]);
    expect(reviewText("guaranteed", RULES, "A different guide")).toEqual([]);
  });
});

describe("AI evidence vetting", () => {
  const text = "Our best-in-class platform cuts costs by 50%.";
  const Q = 'Do not use unsubstantiated superlatives such as "world-class" or "best-in-class".';
  const cand = (o: Partial<AiCandidate>): AiCandidate => ({ ruleId: "", quote: "best-in-class platform", message: "m", ...o });
  it("keeps only candidates with a real, relevant excerpt and evidence", () => {
    const { accepted, rejected } = vetAiFindings(
      text,
      [
        cand({ guideQuote: Q }),
        cand({ guideQuote: "Never be funny." }),
        cand({ quote: "not in the text", guideQuote: Q }),
        cand({ ruleId: "ghost", guideQuote: Q }),
        cand({ ruleId: "no-guaranteed" }),
        cand({ guideQuote: 'Say "sign in", never "log in".' }),
        cand({ quote: "cuts costs by 50%", guideQuote: "Cuts costs by up to 30%" }),
        cand({ guideQuote: Q }),
      ],
      RULES,
      BRAND_GUIDE,
      ["Cuts costs by up to 30%"],
    );
    expect(accepted.map((f) => f.evidence.source)).toEqual(["Brand guidelines", "Approved claims"]);
    expect(accepted.every((f) => f.origin === "ai" && f.severity === "warning" && f.evidence.verified)).toBe(true);
    expect(rejected.map((r) => r.reason)).toEqual([
      "evidence quote is not in the guidelines or approved claims",
      "excerpt is not in the content",
      'cites unknown rule "ghost"',
      'excerpt is unrelated to rule "no-guaranteed"',
      "evidence quote is unrelated to the excerpt",
      "duplicate suggestion",
    ]);
  });
  it("accepts a rule-cited finding only when the excerpt concerns that rule", () => {
    const r = vetAiFindings("This is guaranteed to work", [cand({ ruleId: "no-guaranteed", quote: "guaranteed to work" })], RULES, BRAND_GUIDE);
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0].evidence.quote).toBe(RULES[0].sourceQuote);
  });
  it("rejects a rule-cited finding when that rule's own evidence is invalid", () => {
    const rules = [{ ...RULES[0], sourceQuote: "Invented policy sentence." }];
    expect(vetAiFindings("guaranteed", [cand({ ruleId: "no-guaranteed", quote: "guaranteed" })], rules, BRAND_GUIDE).rejected[0].reason).toMatch(/no valid evidence/);
  });
  it("relates texts by shared meaningful words", () => {
    expect(related("guaranteed results", "guaranteed")).toBe(true);
    expect(related("Log in", "log in sign in")).toBe(true);
    expect(related("best-in-class platform", 'Say "sign in"')).toBe(false);
  });
});

describe("approval integrity", () => {
  const rs = { version: "1", hash: "h1" };
  const clean = "Sign in to start your free trial. Terms apply.";
  it("binds approval to the exact text and the ruleset version", () => {
    const a = createApproval({ text: clean, findings: [], reviewer: "Sam", ruleset: rs });
    expect(approvalState(a, clean, rs)).toBe("current");
    expect(approvalState(a, clean + " ", rs)).toBe("content_changed");
    expect(approvalState(a, clean, { version: "2", hash: "h1" })).toBe("ruleset_changed");
    expect(approvalState(a, clean, { version: "1", hash: "other" })).toBe("ruleset_changed");
    expect(approvalState(undefined, clean, rs)).toBe("none");
  });
  it("blocks approval with open errors unless overridden", () => {
    const f = reviewText(bad, RULES, BRAND_GUIDE);
    expect(() => createApproval({ text: bad, findings: f, reviewer: "Sam", ruleset: rs })).toThrow();
    expect(createApproval({ text: bad, findings: f, reviewer: "Sam", ruleset: rs, overrideReason: "Legal signed off" }).overrideReason).toBe("Legal signed off");
  });
  it("enforces the status machine, including leaving 'approved'", () => {
    expect(transition("draft", "in_review")).toBe("in_review");
    expect(transition("approved", "in_review")).toBe("in_review");
    expect(transition("approved", "draft")).toBe("draft");
    expect(() => transition("draft", "approved")).toThrow();
    expect(() => transition("approved", "approved")).toThrow();
    expect(() => transition("approved", "changes_requested")).toThrow();
  });
  it("hashes rulesets deterministically and detects any change", () => {
    const a = { guide: BRAND_GUIDE, rules: RULES, claims: [{ id: "1", text: "a" }] };
    expect(rulesetHash(a)).toBe(rulesetHash({ ...a, rules: [...RULES].reverse() }));
    expect(rulesetHash(a)).not.toBe(rulesetHash({ ...a, guide: BRAND_GUIDE + " " }));
    expect(rulesetHash(a)).not.toBe(rulesetHash({ ...a, claims: [] }));
    expect(rulesetHash(a)).not.toBe(rulesetHash({ ...a, rules: [{ ...RULES[0], severity: "warning" }, ...RULES.slice(1)] }));
  });
  it("detects a tampered audit log", () => {
    let log = appendAudit([], { type: "submitted", actor: "a" });
    log = appendAudit(log, { type: "approved", actor: "b" });
    expect(verifyChain(log)).toBe(true);
    log[0] = { ...log[0], actor: "evil" };
    expect(verifyChain(log)).toBe(false);
  });
});
