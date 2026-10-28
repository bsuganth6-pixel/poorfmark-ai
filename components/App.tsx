"use client";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ruleEvidenceProblem } from "../lib/review";

async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch(`/api${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status}).`);
  return j;
}

function useRun() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr("");
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, err, run };
}

const inp = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500";
const btn = "rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50";
const ghost = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50";
const card = "rounded-xl bg-white p-4 ring-1 ring-slate-200";
const Err = ({ m }: { m: string }) =>
  m ? <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{m}</p> : null;
const Label = ({ t, children }: { t: string; children: ReactNode }) => (
  <label className="block text-sm font-medium text-slate-700">
    {t}
    <div className="mt-1">{children}</div>
  </label>
);

export default function App() {
  const [me, setMe] = useState<any>(null);
  const load = useCallback(() => api("/me").then(setMe).catch(() => setMe({ user: null, demoMode: false })), []);
  useEffect(() => {
    load();
  }, [load]);
  if (!me) return <p className="p-8 text-slate-500">Loading…</p>;
  return me.user ? <Dash me={me} reload={load} /> : <Auth demo={me.demoMode} onDone={load} />;
}

function Auth({ onDone, demo }: { onDone: () => void; demo: boolean }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { busy, err, run } = useRun();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api(`/auth/${mode}`, "POST", { email, password });
      onDone();
    });
  };
  return (
    <div className={`${card} mx-auto mt-12 w-[calc(100%-2rem)] max-w-sm p-6`}>
      <h1 className="text-xl font-bold">Proofmark AI</h1>
      <p className="mb-4 text-sm text-slate-600">Evidence-backed brand review with human approval.</p>
      <form onSubmit={submit} className="space-y-3">
        <Label t="Email">
          <input className={inp} type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Label>
        <Label t="Password (8+ characters)">
          <input className={inp} type="password" required minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Label>
        <button className={`${btn} w-full`} disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
        <Err m={err} />
      </form>
      <button className="mt-3 text-sm text-indigo-700 underline" onClick={() => setMode(mode === "login" ? "register" : "login")}>
        {mode === "login" ? "New here? Create an account" : "Have an account? Sign in"}
      </button>
      {demo && <p className="mt-4 rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-900">DEMO MODE: no MONGODB_URI is set, so data lives in server memory and disappears on restart.</p>}
    </div>
  );
}

function Dash({ me, reload }: { me: any; reload: () => void }) {
  const [brands, setBrands] = useState<any[]>([]);
  const [bid, setBid] = useState("");
  const [tab, setTab] = useState<"reviews" | "rules" | "radar">("reviews");
  const [name, setName] = useState("");
  const [sample, setSample] = useState(false);
  const { busy, err, run } = useRun();
  const list = useCallback(
    (select?: string) =>
      api("/brands").then((j) => {
        setBrands(j.brands);
        setBid((cur) => select ?? (j.brands.some((b: any) => b.id === cur) ? cur : j.brands[0]?.id ?? ""));
      }),
    [],
  );
  useEffect(() => {
    list().catch(() => {});
  }, [list]);
  const create = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const j = await api("/brands", "POST", { name, sample });
      setName("");
      await list(j.brand._id);
      setTab(sample ? "reviews" : "rules");
    });
  };
  const cur = brands.find((b) => b.id === bid);
  const tabs = { reviews: "Reviews", rules: "Brand rules", radar: "Health radar" } as const;
  return (
    <div className="mx-auto max-w-5xl p-4">
      <header className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold">Proofmark AI</h1>
        {me.demoMode && <span className="rounded bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">DEMO MODE: in-memory data</span>}
        <span className={`rounded px-2 py-1 text-xs font-semibold ${me.aiEnabled ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>
          {me.aiEnabled ? "Claude analysis on" : "Claude analysis off (no API key)"}
        </span>
        <span className="ml-auto text-sm text-slate-600">{me.user}</span>
        <button className={ghost} onClick={() => api("/auth/logout", "POST").then(reload)}>Sign out</button>
      </header>
      <div className={`${card} mb-4 flex flex-wrap items-end gap-3`}>
        <Label t="Brand">
          <select className={inp} value={bid} onChange={(e) => setBid(e.target.value)} disabled={!brands.length}>
            {brands.length ? brands.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.role})</option>) : <option>No brands yet</option>}
          </select>
        </Label>
        <form onSubmit={create} className="flex flex-wrap items-end gap-2">
          <Label t="New brand">
            <input className={inp} required placeholder="Brand name" value={name} onChange={(e) => setName(e.target.value)} />
          </Label>
          <label className="flex items-center gap-1 pb-2 text-xs">
            <input type="checkbox" checked={sample} onChange={(e) => setSample(e.target.checked)} /> Load sample guidelines
          </label>
          <button className={btn} disabled={busy}>{busy ? "Creating…" : "Create"}</button>
        </form>
        <Err m={err} />
      </div>
      {cur ? (
        <>
          <nav className="mb-3 flex gap-1" aria-label="Sections">
            {(Object.keys(tabs) as (keyof typeof tabs)[]).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`rounded-lg px-3 py-2 text-sm font-medium ${tab === t ? "bg-slate-900 text-white" : "bg-white ring-1 ring-slate-200 hover:bg-slate-100"}`}>
                {tabs[t]}
              </button>
            ))}
          </nav>
          {tab === "reviews" && <Reviews key={bid} bid={bid} role={cur.role} />}
          {tab === "rules" && <Rules key={bid} bid={bid} role={cur.role} onSaved={() => list(bid)} />}
          {tab === "radar" && <Radar key={bid} bid={bid} />}
        </>
      ) : (
        <p className={`${card} text-slate-600`}>Create your first brand above. Tick “Load sample guidelines” to start from the demo rules, or add your own under Brand rules.</p>
      )}
    </div>
  );
}

function Findings({ list }: { list: any[] }) {
  if (!list.length) return <p className="text-sm text-emerald-700">No issues found against the current rules.</p>;
  return (
    <ul className="space-y-2">
      {list.map((f, i) => (
        <li key={i} className={`rounded-lg border-l-4 p-3 text-sm ${f.severity === "error" ? "border-red-500 bg-red-50" : "border-amber-500 bg-amber-50"}`}>
          <div className="font-semibold">
            “{f.excerpt}” <span className="ml-1 text-xs font-medium">{f.severity === "error" ? "blocking" : "warning"} · {f.origin === "ai" ? "Claude" : "rule check"}</span>
          </div>
          <div>{f.message}{f.suggestion && <> Suggested fix: <b>{f.suggestion}</b></>}</div>
          <div className="mt-1 text-xs text-slate-600">
            Source: {f.evidence.source} — “{f.evidence.quote}” <b>{f.evidence.verified ? "✓ verified in guidelines" : "✗ not found in guidelines"}</b>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Reviews({ bid, role }: { bid: string; role: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [sel, setSel] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const { busy, err, run } = useRun();
  const load = useCallback(() => api(`/brands/${bid}/reviews`).then((j) => setItems(j.reviews)), [bid]);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const j = await api(`/brands/${bid}/reviews`, "POST", { title, text });
      setTitle("");
      setText("");
      await load();
      setSel(j.review._id);
    });
  };
  return (
    <div className="grid gap-4 md:grid-cols-[280px_1fr]">
      <aside className="space-y-3">
        {role !== "approver" && (
          <form onSubmit={submit} className={`${card} space-y-2`}>
            <h2 className="text-sm font-semibold">Submit content</h2>
            <input className={inp} required placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <textarea className={`${inp} h-28`} required placeholder="Paste the copy to check" value={text} onChange={(e) => setText(e.target.value)} />
            <button className={`${btn} w-full`} disabled={busy}>{busy ? "Checking…" : "Check content"}</button>
            <Err m={err} />
          </form>
        )}
        <ul className="space-y-1">
          {items.map((i) => (
            <li key={i.id}>
              <button onClick={() => setSel(i.id)} className={`w-full rounded-lg px-3 py-2 text-left text-sm ring-1 ring-slate-200 ${sel === i.id ? "bg-indigo-50" : "bg-white hover:bg-slate-50"}`}>
                <b>{i.title}</b>
                <br />
                <span className="text-xs text-slate-500">{i.status.replace("_", " ")} · v{i.versions} · {i.errors} blocking</span>
              </button>
            </li>
          ))}
          {!items.length && <li className="text-sm text-slate-500">No reviews yet.</li>}
        </ul>
      </aside>
      <section>{sel ? <Detail key={sel} rid={sel} onChange={load} /> : <p className="text-sm text-slate-500">Submit content or pick a review to see its proof trail.</p>}</section>
    </div>
  );
}

function Detail({ rid, onChange }: { rid: string; onChange: () => void }) {
  const [d, setD] = useState<any>(null);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const { busy, err, run } = useRun();
  const load = useCallback(
    () =>
      api(`/reviews/${rid}`).then((j) => {
        setD(j);
        setText(j.review.versions[j.review.versions.length - 1].text);
        setNote("");
      }),
    [rid],
  );
  useEffect(() => {
    load().catch(() => {});
  }, [load]);
  if (!d) return <p className="text-sm text-slate-500">Loading…</p>;
  const { review: r, role } = d;
  const v = r.versions[r.versions.length - 1];
  const canEdit = role !== "approver";
  const editable = canEdit && ["draft", "changes_requested", "approved"].includes(r.status);
  const deciding = role !== "editor" && r.status === "in_review" && !d.stale;
  const blocking = v.findings.filter((f: any) => f.severity === "error").length;
  const act = (path: string, body?: object) =>
    run(async () => {
      await api(`/reviews/${rid}/${path}`, "POST", body ?? {});
      await load();
      onChange();
    });
  return (
    <div className={`${card} space-y-4`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{r.title}</h2>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold">{d.effectiveStatus.replace("_", " ")}</span>
        <span className="text-xs text-slate-500">version {v.n} of {r.versions.length} · checked against ruleset v{v.rulesetVersion}</span>
      </div>
      <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm">{v.text}</p>
      <p className="text-xs text-slate-500">Claude: {v.ai.note || v.ai.status}</p>
      {v.ai.rejected?.length > 0 && (
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer">Why {v.ai.rejected.length} Claude suggestion(s) were rejected</summary>
          <ul className="mt-1 list-disc pl-5">{v.ai.rejected.map((x: any, i: number) => <li key={i}>“{x.quote}” — {x.reason}</li>)}</ul>
        </details>
      )}
      {d.stale && r.status !== "approved" && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          The brand rules changed after this version was checked, so these findings may be out of date.
          {canEdit && <button className={`${ghost} ml-2`} disabled={busy} onClick={() => act("recheck")}>Re-check against current rules</button>}
        </div>
      )}
      <Findings list={v.findings} />
      {d.effectiveStatus === "reapproval_required" && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {d.approvalState === "ruleset_changed" ? "The brand ruleset changed after this was approved." : "The content changed after approval."} It must be approved again.
          {canEdit && <button className={`${btn} ml-2`} disabled={busy} onClick={() => act("request-approval")}>Request reapproval</button>}
        </div>
      )}
      {editable && (
        <div className="space-y-2 border-t border-slate-200 pt-3">
          <Label t={r.status === "approved" ? "Revise content (this withdraws the current approval)" : "Revise content"}>
            <textarea className={`${inp} h-28`} value={text} onChange={(e) => setText(e.target.value)} />
          </Label>
          <div className="flex flex-wrap gap-2">
            <button className={ghost} disabled={busy || !text.trim() || text.trim() === v.text} onClick={() => act("revise", { text })}>Save revision &amp; re-check</button>
            {r.status !== "approved" && <button className={btn} disabled={busy} onClick={() => act("request-approval")}>Request approval</button>}
          </div>
        </div>
      )}
      {deciding && (
        <div className="space-y-2 border-t border-slate-200 pt-3">
          <Label t={blocking ? "Note: override reason to approve despite blocking findings, or what to change" : "Note (required when requesting changes)"}>
            <input className={inp} value={note} onChange={(e) => setNote(e.target.value)} />
          </Label>
          <div className="flex flex-wrap gap-2">
            <button className={btn} disabled={busy} onClick={() => act("approve", { note })}>Approve</button>
            <button className={ghost} disabled={busy} onClick={() => act("request-changes", { note })}>Request changes</button>
          </div>
        </div>
      )}
      {r.approval && (
        <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          Approved by {r.approval.reviewer} on {new Date(r.approval.at).toLocaleString()}. Bound to text hash {r.approval.contentHash.slice(0, 12)} and ruleset v{r.approval.rulesetVersion}.{" "}
          {d.approvalState === "current" ? "Both still match." : "No longer valid: reapproval required."}
          {r.approval.overrideReason && ` Override reason: ${r.approval.overrideReason}`}
        </p>
      )}
      {r.approvalHistory?.length > 0 && <p className="text-xs text-slate-500">{r.approvalHistory.length} earlier approval(s) superseded.</p>}
      <Err m={err} />
      <div>
        <h3 className="text-sm font-semibold">Review history {d.chainValid ? "(audit chain verified)" : "(AUDIT CHAIN BROKEN)"}</h3>
        <ol className="mt-1 space-y-1 text-xs text-slate-600">
          {r.events.map((e: any) => (
            <li key={e.seq}>
              #{e.seq} {e.type.replace("_", " ")} by {e.actor} · {new Date(e.at).toLocaleString()}
              {e.data?.comment ? ` — “${e.data.comment}”` : ""}
              {e.data?.override ? ` — override: “${e.data.override}”` : ""}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

const blank = { id: "", kind: "banned_term", pattern: "", replacement: "", severity: "warning", rationale: "", sourceQuote: "", source: "" };

function Rules({ bid, role, onSaved }: { bid: string; role: string; onSaved: () => void }) {
  const [b, setB] = useState<any>(null);
  const [guide, setGuide] = useState("");
  const [rules, setRules] = useState<any[]>([]);
  const [claims, setClaims] = useState<any[]>([]);
  const [f, setF] = useState<any>(blank);
  const [claim, setClaim] = useState("");
  const [mEmail, setMEmail] = useState("");
  const [mRole, setMRole] = useState("approver");
  const [msg, setMsg] = useState("");
  const { busy, err, run } = useRun();
  const load = useCallback(
    () =>
      api(`/brands/${bid}`).then((j) => {
        setB(j.brand);
        setGuide(j.brand.guide);
        setRules(j.brand.rules);
        setClaims(j.brand.claims);
      }),
    [bid],
  );
  useEffect(() => {
    load().catch(() => {});
  }, [load]);
  if (!b) return <p className="text-sm text-slate-500">Loading…</p>;
  const canEdit = role !== "approver";
  const problem = f.sourceQuote.trim() && f.pattern.trim() ? ruleEvidenceProblem({ kind: f.kind, pattern: f.pattern, replacement: f.replacement, sourceQuote: f.sourceQuote }, guide) : null;
  const addRule = () =>
    run(async () => {
      if (!f.pattern.trim() || !f.rationale.trim() || !f.sourceQuote.trim()) throw new Error("Pattern, explanation and source quote are required.");
      if (f.kind !== "banned_term" && !f.replacement.trim()) throw new Error("This rule type needs a replacement or required phrase.");
      if (problem) throw new Error(`Evidence check failed: ${problem}.`);
      const r = { ...f, id: f.id || Math.random().toString(36).slice(2, 8), source: f.source || "Brand guidelines", replacement: f.replacement.trim() || undefined };
      setRules((cur) => [...cur.filter((x) => x.id !== r.id), r]);
      setF(blank);
      setMsg("Rule staged. Press “Save guidelines” to store it.");
    });
  const save = () =>
    run(async () => {
      await api(`/brands/${bid}`, "PUT", { guide, rules, claims });
      await load();
      onSaved();
      setMsg("Saved.");
    });
  const addMember = () =>
    run(async () => {
      await api(`/brands/${bid}/members`, "POST", { email: mEmail, role: mRole });
      setMEmail("");
      await load();
    });
  return (
    <div className="space-y-4">
      <section className={card}>
        <Label t={`Brand guidelines text (ruleset v${b.version}; every rule quote must come from this text and mention the rule's terms)`}>
          <textarea className={`${inp} h-40`} disabled={!canEdit} value={guide} onChange={(e) => setGuide(e.target.value)} />
        </Label>
      </section>
      <section className={`${card} space-y-3`}>
        <h2 className="font-semibold">Rules ({rules.length})</h2>
        <ul className="space-y-2">
          {rules.map((r) => (
            <li key={r.id} className="rounded-lg bg-slate-50 p-3 text-sm">
              <b>{r.kind.replace("_", " ")}: “{r.pattern}”</b>{r.replacement && <> → “{r.replacement}”</>} · {r.severity}
              <div>{r.rationale}</div>
              <div className="text-xs text-slate-500">Source: “{r.sourceQuote}”</div>
              {canEdit && (
                <div className="mt-1 flex gap-2">
                  <button className="text-xs text-indigo-700 underline" onClick={() => setF({ ...blank, ...r, replacement: r.replacement ?? "" })}>Edit</button>
                  <button className="text-xs text-red-700 underline" onClick={() => setRules(rules.filter((x) => x.id !== r.id))}>Remove</button>
                </div>
              )}
            </li>
          ))}
          {!rules.length && <li className="text-sm text-slate-500">No rules yet. Add one below.</li>}
        </ul>
        {canEdit && (
          <div className="grid gap-2 rounded-lg border border-dashed border-slate-300 p-3 sm:grid-cols-2">
            <Label t="Type">
              <select className={inp} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                <option value="banned_term">Banned term</option>
                <option value="preferred_term">Preferred term</option>
                <option value="required_with">Required phrase when term appears</option>
              </select>
            </Label>
            <Label t="Severity">
              <select className={inp} value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}>
                <option value="warning">Warning</option>
                <option value="error">Blocking error</option>
              </select>
            </Label>
            <Label t={f.kind === "required_with" ? "Trigger term" : "Term to find"}>
              <input className={inp} value={f.pattern} onChange={(e) => setF({ ...f, pattern: e.target.value })} />
            </Label>
            <Label t={f.kind === "required_with" ? "Required phrase" : "Replacement / suggestion"}>
              <input className={inp} value={f.replacement} onChange={(e) => setF({ ...f, replacement: e.target.value })} />
            </Label>
            <div className="sm:col-span-2">
              <Label t="Explanation shown to writers">
                <input className={inp} value={f.rationale} onChange={(e) => setF({ ...f, rationale: e.target.value })} />
              </Label>
            </div>
            <div className="sm:col-span-2">
              <Label t="Source quote (exact sentence from the guidelines text)">
                <input className={inp} value={f.sourceQuote} onChange={(e) => setF({ ...f, sourceQuote: e.target.value })} />
              </Label>
              {problem && <p className="mt-1 text-xs text-red-700">Evidence check: {problem}.</p>}
            </div>
            <button className={ghost} disabled={busy} onClick={addRule}>{f.id ? "Update rule" : "Add rule"}</button>
          </div>
        )}
      </section>
      <section className={`${card} space-y-2`}>
        <h2 className="font-semibold">Approved claims ({claims.length})</h2>
        <ul className="space-y-1 text-sm">
          {claims.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 rounded bg-slate-50 px-3 py-2">
              <span>{c.text}</span>
              {canEdit && <button className="text-xs text-red-700 underline" onClick={() => setClaims(claims.filter((x) => x.id !== c.id))}>Remove</button>}
            </li>
          ))}
        </ul>
        {canEdit && (
          <div className="flex gap-2">
            <input className={inp} placeholder="e.g. Reduces onboarding time by up to 30%" value={claim} onChange={(e) => setClaim(e.target.value)} />
            <button
              className={ghost}
              onClick={() => {
                if (claim.trim()) setClaims([...claims, { id: Math.random().toString(36).slice(2, 8), text: claim.trim() }]);
                setClaim("");
              }}
            >
              Add
            </button>
          </div>
        )}
      </section>
      {canEdit ? (
        <div>
          <button className={btn} disabled={busy} onClick={save}>{busy ? "Saving…" : "Save guidelines"}</button>
          {msg && !err && <span className="ml-3 text-sm text-emerald-700">{msg}</span>}
          <Err m={err} />
        </div>
      ) : (
        <p className="text-sm text-slate-500">Approvers have read-only access to brand rules.</p>
      )}
      {role === "owner" && (
        <section className={`${card} space-y-2`}>
          <h2 className="font-semibold">Team</h2>
          <ul className="text-sm">{b.members.map((m: any) => <li key={m.userId}>{m.email} · {m.role}</li>)}</ul>
          <div className="flex flex-wrap gap-2">
            <input className={`${inp} max-w-xs`} type="email" placeholder="Teammate's registered email" value={mEmail} onChange={(e) => setMEmail(e.target.value)} />
            <select className={`${inp} w-auto`} value={mRole} onChange={(e) => setMRole(e.target.value)}>
              <option value="approver">Approver</option>
              <option value="editor">Editor</option>
            </select>
            <button className={ghost} disabled={busy || !mEmail} onClick={addMember}>Add member</button>
          </div>
        </section>
      )}
    </div>
  );
}

function Radar({ bid }: { bid: string }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api(`/brands/${bid}/radar`).then(setD).catch((e) => setErr(e.message));
  }, [bid]);
  if (err) return <Err m={err} />;
  if (!d) return <p className="text-sm text-slate-500">Loading…</p>;
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">Computed from {d.reviews} saved review(s) and {d.versions} version(s). Nothing on this page is sample data.</p>
      <section className={card}>
        <h2 className="font-semibold">Recurring violations</h2>
        {d.rows.length ? (
          <div className="overflow-x-auto">
            <table className="mt-2 w-full text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr><th className="py-1">Rule</th><th>Severity</th><th>Reviews</th><th>Hits</th></tr>
              </thead>
              <tbody>
                {d.rows.map((r: any) => (
                  <tr key={r.ruleId} className="border-t">
                    <td className="py-1">{r.label}{r.recurring && <span className="ml-2 rounded bg-red-100 px-1 text-xs text-red-700">recurring</span>}</td>
                    <td>{r.severity}</td><td>{r.reviews}</td><td>{r.hits}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-1 text-sm text-slate-500">No findings saved yet. Submit content to build this view.</p>
        )}
      </section>
      <section className={card}>
        <h2 className="font-semibold">Possible rule conflicts</h2>
        {d.conflicts.length ? (
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{d.conflicts.map((c: any, i: number) => <li key={i}>{c.message}</li>)}</ul>
        ) : (
          <p className="mt-1 text-sm text-slate-500">None detected in the current rules and approved claims.</p>
        )}
      </section>
    </div>
  );
}
