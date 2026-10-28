import { MongoClient } from "mongodb";

export type Doc = { _id: string; [k: string]: any };
type Filter = Record<string, unknown>;

export interface Col {
  find(f?: Filter): Promise<Doc[]>;
  findOne(f: Filter): Promise<Doc | null>;
  insert(d: Doc): Promise<void>;
  update(id: string, set: Filter): Promise<void>;
}

// No MONGODB_URI => DEMO MODE: data lives in server memory and is lost on restart.
export const demoMode = !process.env.MONGODB_URI;

const g = globalThis as unknown as { __mem?: Record<string, Map<string, Doc>>; __mongo?: Promise<MongoClient> };
const hit = (d: Doc, f: Filter) =>
  Object.entries(f).every(([k, v]) => (Array.isArray(d[k]) ? d[k].includes(v) : d[k] === v));

function memory(name: string): Col {
  const m = ((g.__mem ??= {})[name] ??= new Map<string, Doc>());
  return {
    find: async (f = {}) => [...m.values()].filter((d) => hit(d, f)).map((d) => structuredClone(d)),
    findOne: async (f) => {
      const d = [...m.values()].find((x) => hit(x, f));
      return d ? structuredClone(d) : null;
    },
    insert: async (d) => {
      if (m.has(d._id)) throw new Error("duplicate _id");
      m.set(d._id, structuredClone(d));
    },
    update: async (id, set) => {
      const d = m.get(id);
      if (d) m.set(id, { ...d, ...structuredClone(set) });
    },
  };
}

// Production connections must be encrypted (mongodb+srv:// implies TLS).
export function assertSecureUri(uri: string, env: Record<string, string | undefined> = process.env) {
  if (env.NODE_ENV !== "production" || env.ALLOW_INSECURE_DB === "1") return;
  if (!(uri.startsWith("mongodb+srv://") || /[?&](tls|ssl)=true/i.test(uri)))
    throw new Error("MONGODB_URI must use mongodb+srv:// or tls=true in production.");
}

async function mongo(name: string): Promise<Col> {
  const uri = process.env.MONGODB_URI as string;
  assertSecureUri(uri);
  const client = await (g.__mongo ??= new MongoClient(uri, { ignoreUndefined: true, serverSelectionTimeoutMS: 10000, appName: "proofmark-ai" }).connect());
  const c = client.db(process.env.MONGODB_DB || "proofmark").collection<Doc>(name);
  return {
    find: (f = {}) => c.find(f as never).toArray() as unknown as Promise<Doc[]>,
    findOne: (f) => c.findOne(f as never) as unknown as Promise<Doc | null>,
    insert: async (d) => {
      await c.insertOne(d as never);
    },
    update: async (id, set) => {
      await c.updateOne({ _id: id } as never, { $set: set } as never);
    },
  };
}

export const col = async (name: string): Promise<Col> => (demoMode ? memory(name) : mongo(name));
