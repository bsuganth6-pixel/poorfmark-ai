// Starts the production build twice and runs scripts/e2e.mjs against each:
//   1) no Claude key (AI must be skipped, nothing faked)  2) Claude path via a local stand-in API
//   3) optional: a real MongoDB-protocol server when E2E_MONGODB_URI is set (e.g. a local mongod/FerretDB).
// Run `npm run build` first. Phases 1-2 use the in-memory demo store (MONGODB_URI is blanked).
// ONLY=<regex> runs just the phases whose name matches.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";

const phases = [
  { name: "no Claude key", port: 3101, env: { ANTHROPIC_API_KEY: "" }, mock: false },
  { name: "Claude path via local stand-in API", port: 3102, env: { ANTHROPIC_API_KEY: "test", ANTHROPIC_BASE_URL: "http://127.0.0.1:4010" }, mock: true },
];
const uri = process.env.E2E_MONGODB_URI;
if (uri) {
  phases.push({
    name: "MongoDB store + Claude stand-in API",
    port: 3103,
    env: {
      MONGODB_URI: uri,
      MONGODB_DB: `proofmark_e2e_${Date.now()}`,
      ALLOW_INSECURE_DB: uri.startsWith("mongodb://") ? "1" : "",
      ANTHROPIC_API_KEY: "test",
      ANTHROPIC_BASE_URL: "http://127.0.0.1:4010",
    },
    mock: true,
  });
}
let failed = 0;
for (const p of phases.filter((x) => !process.env.ONLY || new RegExp(process.env.ONLY, "i").test(x.name))) {
  console.log(`\n=== ${p.name}`);
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(p.port)], {
    env: { ...process.env, NODE_ENV: "production", SESSION_SECRET: randomBytes(32).toString("hex"), MONGODB_URI: "", ...p.env },
    stdio: ["ignore", "ignore", "inherit"],
  });
  const base = `http://localhost:${p.port}`;
  let up = false;
  for (let i = 0; i < 80 && !up; i++) {
    try {
      await fetch(`${base}/api/me`);
      up = true;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  if (!up) {
    console.log("FAIL  server did not start");
    failed++;
  } else {
    const r = spawnSync(process.execPath, ["scripts/e2e.mjs"], { env: { ...process.env, BASE: base, ...(p.mock ? { MOCK_AI: "1" } : {}) }, stdio: "inherit" });
    if (r.status !== 0) failed++;
  }
  if (server.exitCode === null) {
    server.kill();
    await once(server, "exit");
  }
}
console.log(failed ? `\n${failed} phase(s) FAILED` : "\nAll integration phases passed.");
process.exit(failed ? 1 : 0);
