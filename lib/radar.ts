import { locate, type Finding } from "./review";
import type { BrandRule } from "./schema";

export interface Conflict {
  type: "suggestion-triggers-ban" | "same-term-different-rules" | "swap-loop" | "claim-contains-ban";
  message: string;
  ruleIds: string[];
}

// Potential conflicts found purely from the saved rules and approved claims.
export function findConflicts(rules: BrandRule[], claims: { text: string }[]): Conflict[] {
  const out: Conflict[] = [];
  const banned = rules.filter((r) => r.kind === "banned_term");
  for (const a of rules)
    for (const b of banned)
      if (a.id !== b.id && a.replacement && locate(a.replacement, b.pattern).length)
        out.push({ type: "suggestion-triggers-ban", ruleIds: [a.id, b.id], message: `Rule "${a.pattern}" suggests "${a.replacement}", but rule "${b.pattern}" bans it.` });
  for (let i = 0; i < rules.length; i++)
    for (let j = i + 1; j < rules.length; j++) {
      const a = rules[i];
      const b = rules[j];
      if (a.pattern.toLowerCase() === b.pattern.toLowerCase() && (a.kind !== b.kind || a.replacement !== b.replacement))
        out.push({ type: "same-term-different-rules", ruleIds: [a.id, b.id], message: `Two rules govern "${a.pattern}" in different ways.` });
      if (a.kind === "preferred_term" && b.kind === "preferred_term" && a.replacement?.toLowerCase() === b.pattern.toLowerCase() && b.replacement?.toLowerCase() === a.pattern.toLowerCase())
        out.push({ type: "swap-loop", ruleIds: [a.id, b.id], message: `Rules "${a.pattern}" and "${b.pattern}" tell writers to swap each term for the other.` });
    }
  for (const c of claims)
    for (const b of banned)
      if (locate(c.text, b.pattern).length)
        out.push({ type: "claim-contains-ban", ruleIds: [b.id], message: `Approved claim "${c.text}" contains the banned term "${b.pattern}".` });
  return out;
}

interface SavedReview {
  _id: string;
  versions: { findings: Finding[] }[];
}

// Recurring violations, computed only from findings stored on real reviews.
export function radar(reviews: SavedReview[], rules: BrandRule[], claims: { text: string }[]) {
  const stat = new Map<string, { hits: number; reviews: Set<string> }>();
  let versions = 0;
  for (const r of reviews)
    for (const v of r.versions) {
      versions++;
      for (const f of v.findings) {
        const s = stat.get(f.ruleId) ?? { hits: 0, reviews: new Set<string>() };
        s.hits++;
        s.reviews.add(r._id);
        stat.set(f.ruleId, s);
      }
    }
  const rows = [...stat].map(([ruleId, s]) => {
    const rule = rules.find((x) => x.id === ruleId);
    return {
      ruleId,
      label: rule ? `${rule.kind.replace("_", " ")}: ${rule.pattern}` : ruleId.startsWith("ai-") ? `Claude: ${ruleId.slice(3)}` : `${ruleId} (rule removed)`,
      severity: rule?.severity ?? "warning",
      hits: s.hits,
      reviews: s.reviews.size,
      recurring: s.reviews.size >= 2,
    };
  });
  rows.sort((a, b) => b.reviews - a.reviews || b.hits - a.hits);
  return { reviews: reviews.length, versions, rows, conflicts: findConflicts(rules, claims) };
}
