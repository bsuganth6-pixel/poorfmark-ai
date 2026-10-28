import { createHash } from "node:crypto";
import type { Finding } from "./review";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export type Status = "draft" | "in_review" | "changes_requested" | "approved" | "rejected";

const TRANSITIONS: Record<Status, Status[]> = {
  draft: ["in_review"],
  in_review: ["approved", "changes_requested", "rejected"],
  changes_requested: ["in_review"],
  // An approved review can only leave "approved" by being re-approved or revised.
  approved: ["in_review", "draft"],
  rejected: [],
};

export function transition(from: Status, to: Status): Status {
  if (!TRANSITIONS[from].includes(to)) throw new Error(`Cannot move from ${from} to ${to}`);
  return to;
}

export interface Ruleset {
  version: string;
  hash: string;
}

export interface Approval {
  contentHash: string;
  rulesetVersion: string;
  rulesetHash: string;
  findingsHash: string;
  reviewer: string;
  overrideReason?: string;
  at: string;
}

export function createApproval(i: {
  text: string;
  findings: Finding[];
  reviewer: string;
  ruleset: Ruleset;
  overrideReason?: string;
  now?: Date;
}): Approval {
  if (!i.reviewer.trim()) throw new Error("Reviewer name is required.");
  const errors = i.findings.filter((f) => f.severity === "error").length;
  if (errors > 0 && !i.overrideReason?.trim()) {
    throw new Error(`${errors} error finding(s) are open. Fix the text or give an override reason.`);
  }
  return {
    contentHash: sha256(i.text),
    rulesetVersion: i.ruleset.version,
    rulesetHash: i.ruleset.hash,
    findingsHash: sha256(JSON.stringify(i.findings.map((f) => [f.ruleId, f.start, f.end]))),
    reviewer: i.reviewer.trim(),
    overrideReason: i.overrideReason?.trim() || undefined,
    at: (i.now ?? new Date()).toISOString(),
  };
}

export type ApprovalState = "none" | "current" | "content_changed" | "ruleset_changed";

// An approval covers one exact text under one exact ruleset. If either moves, it no longer applies.
export function approvalState(a: Approval | null | undefined, text: string, rs: Ruleset): ApprovalState {
  if (!a) return "none";
  if (a.contentHash !== sha256(text)) return "content_changed";
  if (a.rulesetVersion !== rs.version || a.rulesetHash !== rs.hash) return "ruleset_changed";
  return "current";
}

export const isApprovalCurrent = (a: Approval, text: string, rs: Ruleset) => approvalState(a, text, rs) === "current";

export interface AuditEvent {
  seq: number;
  type: string;
  actor: string;
  at: string;
  data: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

const eventHash = (e: Omit<AuditEvent, "hash">) =>
  sha256(JSON.stringify([e.seq, e.type, e.actor, e.at, e.data, e.prevHash]));

export function appendAudit(
  log: AuditEvent[],
  e: { type: string; actor: string; data?: Record<string, unknown>; at?: string },
): AuditEvent[] {
  const body = {
    seq: log.length + 1,
    type: e.type,
    actor: e.actor,
    at: e.at ?? new Date().toISOString(),
    data: e.data ?? {},
    prevHash: log.at(-1)?.hash ?? "genesis",
  };
  return [...log, { ...body, hash: eventHash(body) }];
}

export function verifyChain(log: AuditEvent[]): boolean {
  return log.every((e, i) => {
    const { hash, ...body } = e;
    return e.prevHash === (i === 0 ? "genesis" : log[i - 1].hash) && hash === eventHash(body);
  });
}
