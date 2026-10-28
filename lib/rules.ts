import type { BrandRule } from "./schema";

export const RULESET_VERSION = "demo-1";

export const BRAND_GUIDE = `Voice and claims
Never promise outcomes. Avoid the word "guaranteed" in any customer-facing copy.
Do not use unsubstantiated superlatives such as "world-class" or "best-in-class".
Terminology
Say "sign in", never "log in".
Offers
Any mention of a free trial must include the line "terms apply".`;

const source = "Brand guidelines";

export const RULES: BrandRule[] = [
  {
    id: "no-guaranteed",
    kind: "banned_term",
    pattern: "guaranteed",
    rationale: "Outcome promises are not allowed in customer-facing copy.",
    severity: "error",
    source,
    sourceQuote: 'Avoid the word "guaranteed" in any customer-facing copy.',
  },
  {
    id: "no-superlatives",
    kind: "banned_term",
    pattern: "world-class",
    rationale: "Unsubstantiated superlatives are not allowed.",
    severity: "warning",
    source,
    sourceQuote: 'Do not use unsubstantiated superlatives such as "world-class"',
  },
  {
    id: "sign-in",
    kind: "preferred_term",
    pattern: "log in",
    replacement: "sign in",
    rationale: "Approved terminology is \"sign in\".",
    severity: "warning",
    source,
    sourceQuote: 'Say "sign in", never "log in".',
  },
  {
    id: "trial-terms",
    kind: "required_with",
    pattern: "free trial",
    replacement: "terms apply",
    rationale: "Free-trial mentions need the terms line.",
    severity: "error",
    source,
    sourceQuote: 'Any mention of a free trial must include the line "terms apply".',
  },
];
