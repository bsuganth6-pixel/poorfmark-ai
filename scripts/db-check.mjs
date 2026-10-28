// Verifies the MongoDB user is least-privilege. Usage: MONGODB_URI=... [MONGODB_DB=proofmark] npm run db:check
// It cannot see Atlas Network Access settings: check the IP access list in the Atlas UI.
import { MongoClient } from "mongodb";
import { pathToFileURL } from "node:url";

const BROAD = new Set(["root", "atlasAdmin", "readWriteAnyDatabase", "readAnyDatabase", "dbAdminAnyDatabase", "userAdminAnyDatabase", "clusterAdmin", "backup", "restore"]);
const BUILTIN = new Set(["read", "readWrite", "dbAdmin", "dbOwner", "userAdmin"]);

// roles: [{ role, db }] from connectionStatus. Custom roles (db "admin") can only be judged by the write probe.
export function assessRoles(roles, dbName) {
  const problems = [];
  const notes = [];
  for (const { role, db } of roles) {
    if (BROAD.has(role)) problems.push(`role "${role}" is far broader than this app needs`);
    else if (BUILTIN.has(role)) {
      if (db !== dbName) problems.push(`role "${role}" grants access to database "${db}"`);
      else if (role !== "readWrite" && role !== "read") problems.push(`role "${role}" on "${db}" is broader than readWrite`);
    } else notes.push(`custom role "${role}": confirm it only allows find/insert/update on ${dbName}`);
  }
  if (!roles.length) problems.push("no roles reported for this user");
  return { problems, notes };
}

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || "proofmark";
  if (!uri) {
    console.error("Set MONGODB_URI first.");
    process.exit(2);
  }
  const client = await new MongoClient(uri, { serverSelectionTimeoutMS: 10000 }).connect();
  const st = await client.db("admin").command({ connectionStatus: 1 });
  const { problems, notes } = assessRoles(st.authInfo?.authenticatedUserRoles ?? [], dbName);
  // Active probe: a least-privilege user must NOT be able to write outside its own database.
  const other = client.db(`${dbName}_probe_${Date.now()}`).collection("probe");
  try {
    const r = await other.insertOne({ probe: true });
    await other.deleteOne({ _id: r.insertedId }).catch(() => {});
    problems.push("user can write to databases other than " + dbName);
  } catch (e) {
    if (e?.code !== 13 && !/not authorized|unauthorized/i.test(String(e?.message))) problems.push(`write probe failed unexpectedly: ${e?.message}`);
  }
  await client.db(dbName).collection("users").estimatedDocumentCount().catch((e) => problems.push(`cannot read ${dbName}: ${e.message}`));
  await client.close();
  notes.forEach((n) => console.log("NOTE   ", n));
  problems.forEach((p) => console.log("PROBLEM", p));
  console.log(problems.length ? "\nNOT least-privilege." : `\nOK: least-privilege for ${dbName}. Also confirm the Atlas IP access list has no 0.0.0.0/0 entry.`);
  process.exit(problems.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error("db:check failed:", e.message);
    process.exit(2);
  });
}
