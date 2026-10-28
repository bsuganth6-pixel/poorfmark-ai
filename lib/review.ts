import type { BrandRule } from "./schema";

export interface Evidence {
  source: string;
  quote: string;
  verified: boolean;
}

export interface Finding {
  ruleId: string;
  severity: "error" | "warning";
  origin: "rule" | "ai";
  start: number;
  end: number;
  excerpt: string;
  message: string;
  suggestion?: string;
  evidence: Evidence;
}

export interface AiCandidate {
  ruleId: string;
  quote: string;
  message: string;
  guideQuote?: string;
  suggestion?: string;
  category?: string;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

export const verifyQuote = (quote: string, guide: string) =>
  quote.trim().length > 0 && norm(guide).includes(norm(quote));

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function locate(text: string, term: string) {
  const re = new RegExp(`(?<!\\w)${esc(term)}(?!\\w)`, "gi");
  return [...text.matchAll(re)].map((m) => ({
    start: m.index as number,
    end: (m.index as number) + m[0].length,
  }));
}

export function reviewText(text: string, rules: BrandRule[], guide: string): Finding[] {
  const out: Finding[] = [];
  for (const r of rules) {
    // A rule without genuine, relevant evidence never produces a finding.
    if (ruleEvidenceProblem(r, guide)) continue;
    const evidence: Evidence = { source: r.source, quote: r.sourceQuote, verified: true };
    const hits = locate(text, r.pattern);
    const base = { ruleId: r.id, severity: r.severity, origin: "rule" as const, evidence };

    if (r.kind === "required_with") {
      const required = r.replacement ?? "";
      if (hits.length > 0 && locate(text, required).length === 0) {
        const h = hits[0];
        out.push({
          ...base,
          ...h,
          excerpt: text.slice(h.start, h.end),
          message: `${r.rationale} Add "${required}".`,
          suggestion: required,
        });
      }
      continue;
    }

    for (const h of hits) {
      out.push({
        ...base,
        ...h,
        excerpt: text.slice(h.start, h.end),
        message: r.rationale,
        suggestion: r.replacement,
      });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

const STOP = new Set([
  "that", "this", "with", "from", "your", "have", "been", "will", "would", "should", "could", "must", "never",
  "always", "avoid", "does", "such", "than", "then", "them", "they", "what", "when", "where", "which", "while",
  "into", "also", "more", "most", "very", "include", "using", "used", "word", "words", "line", "copy", "text",
]);
const terms = (s: string) =>
  new Set((s.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length >= 4 && !STOP.has(w)).map((w) => w.slice(0, 5)));

// True when two texts share a meaningful word (compared by 5-letter stem) or one contains the other.
export function related(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const tb = terms(b);
  return [...terms(a)].some((t) => tb.has(t));
}

// Why a rule's evidence cannot be trusted, or null when it is genuine AND about the rule's own terms.
export function ruleEvidenceProblem(
  r: Pick<BrandRule, "kind" | "pattern" | "replacement" | "sourceQuote">,
  guide: string,
): string | null {
  if (!verifyQuote(r.sourceQuote, guide)) return "its source quote is not in the guidelines text";
  const q = norm(r.sourceQuote);
  if (!q.includes(norm(r.pattern))) return `its source quote never mentions "${r.pattern}"`;
  if (r.kind !== "banned_term") {
    const rep = norm(r.replacement ?? "");
    if (!rep) return "it needs a replacement or required phrase";
    if (!q.includes(rep)) return `its source quote never mentions "${r.replacement}"`;
  }
  return null;
}

export interface Rejected {
  quote: string;
  reason: string;
}

// AI output is advisory. A candidate becomes a finding only if (1) its excerpt really is in the
// content, (2) it cites a real rule whose evidence is valid and about the excerpt, or quotes a
// sentence that really is in the guidelines / approved claims and relates to the excerpt.
// Everything else is rejected with a reason, never invented or repaired.
export function vetAiFindings(
  text: string,
  candidates: AiCandidate[],
  rules: BrandRule[],
  guide: string,
  claims: string[] = [],
): { accepted: Finding[]; rejected: Rejected[] } {
  const accepted: Finding[] = [];
  const rejected: Rejected[] = [];
  for (const c of candidates) {
    const no = (reason: string) => rejected.push({ quote: c.quote.slice(0, 80), reason });
    const start = c.quote ? text.indexOf(c.quote) : -1;
    if (start < 0) {
      no("excerpt is not in the content");
      continue;
    }
    let evidence: Evidence;
    let ruleId: string;
    if (c.ruleId) {
      const rule = rules.find((r) => r.id === c.ruleId);
      if (!rule) {
        no(`cites unknown rule "${c.ruleId}"`);
        continue;
      }
      if (ruleEvidenceProblem(rule, guide)) {
        no(`rule "${rule.id}" has no valid evidence`);
        continue;
      }
      if (!related(c.quote, `${rule.pattern} ${rule.replacement ?? ""}`)) {
        no(`excerpt is unrelated to rule "${rule.id}"`);
        continue;
      }
      ruleId = rule.id;
      evidence = { source: rule.source, quote: rule.sourceQuote, verified: true };
    } else {
      const gq = c.guideQuote ?? "";
      const source = verifyQuote(gq, guide) ? "Brand guidelines" : claims.some((t) => verifyQuote(gq, t)) ? "Approved claims" : null;
      if (!source) {
        no("evidence quote is not in the guidelines or approved claims");
        continue;
      }
      if (!related(c.quote, gq)) {
        no("evidence quote is unrelated to the excerpt");
        continue;
      }
      ruleId = `ai-${c.category ?? "messaging"}`;
      evidence = { source, quote: gq, verified: true };
    }
    if (accepted.some((f) => f.ruleId === ruleId && f.start === start)) {
      no("duplicate suggestion");
      continue;
    }
    accepted.push({
      ruleId, severity: "warning", origin: "ai", start, end: start + c.quote.length,
      excerpt: c.quote, message: c.message, suggestion: c.suggestion, evidence,
    });
  }
  return { accepted, rejected };
}

export const acceptAiFindings = (...a: Parameters<typeof vetAiFindings>) => vetAiFindings(...a).accepted;
