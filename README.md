# Proofmark AI

Evidence-backed brand review with human approval. Writers submit copy; the app checks it against a brand's own guidelines and shows every issue with its source rule, a verified quote, an explanation, a severity and a suggested fix. Content then goes through an approval workflow whose approvals are bound to the exact text **and** the exact brand ruleset.

Stack: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, MongoDB (Atlas), Anthropic Claude API. Deploys to Vercel. Node 20.9+ (developed on Node 22).

## Setup
    npm install
    cp .env.example .env.local     # fill in values (see below)
    npm run dev                    # http://localhost:3000

No credentials? It still runs. Without `MONGODB_URI` it starts in **DEMO MODE** (data in server memory, lost on restart, labelled in the UI). Without `ANTHROPIC_API_KEY`, Claude analysis shows as **off**; rule checks still work and no AI result is ever faked.

## Environment variables
| Name | Needed | Purpose |
|---|---|---|
| `MONGODB_URI` | production | Atlas connection string. Unset = demo mode. Non-TLS URIs are refused in production. |
| `MONGODB_DB` | no | Database name (default `proofmark`). |
| `SESSION_SECRET` | production | 16+ random chars (`openssl rand -hex 32`). The app refuses to sign sessions in production without it. |
| `ANTHROPIC_API_KEY` | for AI | Enables Claude analysis. |
| `ANTHROPIC_MODEL` | no | Default `claude-sonnet-5-5`. |
| `ANTHROPIC_BASE_URL` | no | Override the API base URL (tests, proxies). |
| `ALLOW_INSECURE_COOKIES` | local only | `1` lets `next start` work over plain http (drops `Secure` and the `__Host-` prefix). Never in production. |
| `ALLOW_INSECURE_DB` | local only | `1` allows a non-TLS `mongodb://` URI in production mode. Never against Atlas. |
| `E2E_MONGODB_URI` | tests only | Adds a MongoDB-backed phase to `npm run test:integration`. |

Never commit `.env*` files (they are in `.gitignore`).

## How it works
- **Brands**: create brands; edit the guidelines text; add/edit/remove rules and approved claims. Roles: owner, editor, approver. Data is isolated by membership (non-members get 404).
- **Proof trail**: each finding shows the exact excerpt, the rule, explanation, severity, suggestion and the evidence quote. Evidence must be genuine (verbatim in the guidelines) **and relevant** (the quote must mention the rule's own term, and its replacement for preferred/required rules). Rules failing this are rejected on save, and never produce findings. The server fixes each rule's source label, so a rule cannot cite a document that does not exist.
- **Claude analysis**: tone/terminology/messaging suggestions, schema-validated. A suggestion is kept only if its excerpt is really in the content and it either cites a real rule (with valid evidence, and an excerpt that concerns that rule) or quotes a sentence that really exists in the guidelines or approved claims and shares meaningful words with the excerpt. Everything else is rejected with a visible reason. AI findings are warnings only and can never approve or block.
- **Review workflow**: submit, revise (each revision is re-checked), request approval, approve or request changes. Blocking findings need a written override reason; the server recomputes them at approval time. History is a hash-chained audit log.
- **Approval integrity**: an approval records the SHA-256 of the text, the ruleset version and the ruleset hash (guidelines + rules + approved claims). If either changes, the approval stops being valid: the review shows "reapproval required" and must be re-checked and approved again. Editing approved content withdraws the approval. A version checked under an old ruleset cannot be approved until it is re-checked. The ruleset version only increases when the ruleset really changes.
- **Guideline health radar**: recurring violations counted from saved review versions, plus potential rule conflicts (a suggestion another rule bans, two rules on one term, swap loops, approved claims containing banned terms).

## Production hardening
### MongoDB Atlas (configure in Atlas; the app cannot do this for you)
1. **Least-privilege user**: Atlas, Database Access, new user with only `readWrite` on database `proofmark` (Specific Privileges). Never `atlasAdmin`, `readWriteAnyDatabase` or `dbAdmin`. Stricter option: a custom role with `find`, `insert`, `update` on `proofmark.users`, `proofmark.brands`, `proofmark.reviews` (create those three collections first). The app never deletes documents or administers anything.
2. **Network access**: Atlas, Network Access: delete `0.0.0.0/0` and allow only the outbound IPs of where the app runs. Vercel's outbound IPs are dynamic unless you use a plan feature with static egress IPs (see Vercel docs on Static IPs / Secure Compute) or Atlas private networking. If you must keep `0.0.0.0/0` for a short demo, use the least-privilege user and a long random password, and delete the entry afterwards.
3. **TLS**: use `mongodb+srv://`. In production the app refuses URIs that are not TLS.
4. **Verify the user**: `MONGODB_URI=... npm run db:check` lists the user's roles and probes that writes outside the app database are denied (exit code 1 if not). It cannot read the IP access list: check that in the Atlas UI.

### Sessions and headers
- Cookie: `__Host-pm_session`, `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, no `Domain`, 24 h lifetime, HMAC-signed.
- Sessions carry a server-side version: signing out revokes every issued cookie, so a copied cookie stops working.
- Login does the same work for unknown users, so response and timing do not reveal which emails exist. Passwords use scrypt.
- All API calls are authorised server-side; JSON bodies only; oversized requests get 413.
- Headers: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, HSTS (production), `Cache-Control: no-store` on `/api`. No Content-Security-Policy is set yet.

## Verify
    npm run verify              # typecheck, lint, unit tests, production build, integration test
    npm run test:integration    # needs `npm run build` first
The integration test starts the production build and drives the whole workflow over HTTP: sign-up, cookie flags, brand isolation, evidence rules, review, approval, ruleset and content changes, reapproval, radar, session revocation. It runs once without a Claude key (AI must be skipped) and once against a local stand-in for the Claude API. To also exercise the MongoDB code path, run any MongoDB-protocol server and set `E2E_MONGODB_URI=mongodb://127.0.0.1:27017`.

## Deploy to Vercel
1. Push to GitHub and import the repo in Vercel (framework: Next.js).
2. Set `MONGODB_URI`, `SESSION_SECRET`, `ANTHROPIC_API_KEY` (optionally `MONGODB_DB`, `ANTHROPIC_MODEL`) as environment variables.
3. Apply the Atlas hardening above, then deploy.
4. Open the site, register, create a brand with "Load sample guidelines", submit the sample copy.

## Dependency notes
Next.js 16.4.3 (16.4.0 had critical advisories, fixed in 16.4.3), React 19.3, Zod 4.6, MongoDB driver 7.7, Tailwind 4.3, ESLint 10 (flat config), TypeScript 5.9, Vitest 5.0.5. `npm audit` reported 0 vulnerabilities when this was released.
- Vitest 5 needs `vite` declared explicitly (it is in `devDependencies`); without it npm 10.9 crashes while resolving peers.
- TypeScript stays on 5.9 because Next and typescript-eslint rely on the JS compiler API; TS 6/7 are available but untested here.
- `@typescript-eslint/no-explicit-any` is off: Mongo documents and JSON payloads are loosely typed on purpose.

## Known limitations
- Not run against a live Atlas cluster. The MongoDB code path passed the full integration test against FerretDB 1.24.2, a MongoDB-compatible server, not real MongoDB.
- The real Anthropic API has not been called (no key during development). Request/response handling and the evidence gating are tested against a local stand-in and unit tests.
- Atlas network restriction and the least-privilege database user are documented and checkable (`npm run db:check`) but were not applied or verified (no Atlas access).
- No browser or UI automation: the UI is type-checked, linted, built and its assets are served, but buttons were verified through the API calls behind them, not by clicking.
- Relevance checking is lexical: a legitimate tone suggestion with no shared words with any guideline sentence is rejected (the reason is shown).
- No email verification, password reset, rate limiting or account lockout; signing out ends all of a user's sessions. No Content-Security-Policy.
- Members cannot be removed or have their role changed; an approver can approve their own submission when they are the only member. Radar counts include re-checked versions.
- Text only (no file/URL ingestion); no auto-publishing, SSO or billing.

## Disclosure
Built with AI assistance (Claude).
