import { z } from "zod";

export const BrandRuleSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["banned_term", "preferred_term", "required_with"]),
  // banned/preferred: the term to find. required_with: the trigger term.
  pattern: z.string().trim().min(1),
  // preferred: the approved term. required_with: the phrase that must appear.
  replacement: z.string().optional(),
  rationale: z.string().trim().min(1),
  severity: z.enum(["error", "warning"]),
  source: z.string().min(1),
  // Must appear verbatim in the brand guide, or the finding is flagged unverified.
  sourceQuote: z.string().trim().min(1),
});
export type BrandRule = z.infer<typeof BrandRuleSchema>;

export const Email = z.string().trim().toLowerCase().email("Enter a valid email.").max(200);
export const CredsSchema = z.object({
  email: Email,
  password: z.string().min(8, "Password must be at least 8 characters.").max(200),
});
export const RoleSchema = z.enum(["owner", "editor", "approver"]);
export type Role = z.infer<typeof RoleSchema>;
export const ClaimSchema = z.object({ id: z.string().min(1).max(40), text: z.string().trim().min(1).max(300) });
export const BrandSaveSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  guide: z.string().max(20000).optional(),
  rules: z.array(BrandRuleSchema).max(100).optional(),
  claims: z.array(ClaimSchema).max(100).optional(),
});
export const NewBrandSchema = z.object({
  name: z.string().trim().min(1, "Brand name is required.").max(80),
  sample: z.boolean().optional(),
});
export const MemberSchema = z.object({ email: Email, role: z.enum(["editor", "approver"]) });
const Content = z.string().trim().min(1, "Content is required.").max(20000);
export const ReviewInputSchema = z.object({ title: z.string().trim().min(1, "Title is required.").max(120), text: Content });
export const ReviseSchema = z.object({ text: Content });
export const NoteSchema = z.object({ note: z.string().trim().max(500).optional() });
