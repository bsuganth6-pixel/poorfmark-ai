import { sha256 } from "./approval";
import type { BrandRule } from "./schema";

export interface RulesetInput {
  guide: string;
  rules: BrandRule[];
  claims: { id: string; text: string }[];
}

const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

// Content hash of everything a review is judged against: guidelines, rules and approved claims.
export function rulesetHash(b: RulesetInput): string {
  const rules = byId(b.rules).map((r) => [r.id, r.kind, r.pattern, r.replacement ?? "", r.severity, r.rationale, r.source, r.sourceQuote]);
  const claims = byId(b.claims).map((c) => [c.id, c.text]);
  return sha256(JSON.stringify([b.guide, rules, claims]));
}
