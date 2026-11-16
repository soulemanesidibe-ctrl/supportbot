import assert from "node:assert/strict";
import { AppError } from "../errors.ts";
import { DbDeps } from "../db.ts";
import { makeAuth, makeCronAuth } from "../testing.ts";
import { indexPendingChunks } from "./index.ts";

interface Rec { updates: Array<{ id: string; org: string; payload: Record<string, unknown>; onlyIfNull: boolean }>; selected: boolean }
function fakeDb(rows: Array<Record<string, unknown>>, failUpdateIds: string[] = []): { deps: DbDeps; rec: Rec } {
  const rec: Rec = { updates: [], selected: false };
  const deps: DbDeps = {
    createClient: (() => ({
      from: () => {
        let payload: Record<string, unknown> | null = null;
        const eqs: Record<string, unknown> = {};
        let nullCol = false;
        const q: Record<string, unknown> = {};
        q.select = () => q;
        q.is = (col: string) => { if (col === "embedding") nullCol = true; return q; };
        q.order = () => q;
        q.limit = () => { rec.selected = true; return Promise.resolve({ data: rows, error: null }); };
        q.update = (p: Record<string, unknown>) => { payload = p; return q; };
        q.eq = (c: string, v: unknown) => { eqs[c] = v; return q; };
        q.then = (res: (r: unknown) => unknown) => {
          rec.updates.push({ id: String(eqs.id), org: String(eqs.org_id), payload: payload as Record<string, unknown>, onlyIfNull: nullCol });
          return Promise.resolve({ error: failUpdateIds.includes(String(eqs.id)) ? { message: "x" } : null }).then(res);
        };
        return q;
      },
    })) as never,
    url: () => "https://projet.exemple.test",
    serviceKey: () => "cle-de-service-factice",
  };
  return { deps, rec };
}
const llm = (seen: string[][]) => ({
  embed: (texts: readonly string[]) => { seen.push([...texts]); return Promise.resolve({ vectors: texts.map((_, i) => Array(1024).fill(i / 10)), model: "e", tokensIn: 1, latencyMs: 1 }); },
});
const rows = [{ id: "c1", org_id: "o1", content: "Écrire à marie@exemple.test" }, { id: "c2", org_id: "o2", content: "Autre fiche" }];

Deno.test("indexPendingChunks : réservée à la tâche planifiée (ni un salarié, ni un administrateur)", async () => {
  const { deps } = fakeDb(rows);
  const bad = await makeAuth();
  await assert.rejects(indexPendingChunks(bad, llm([]), 16, deps), (e: unknown) => (e as AppError).code === "forbidden");
});

Deno.test("indexPendingChunks : calcule les vecteurs, contenu masqué avant envoi, chaque mise à jour bornée à SON morceau et SON organisation", async () => {
  const seen: string[][] = [];
  const { deps, rec } = fakeDb(rows);
  const r = await indexPendingChunks(await makeCronAuth(), llm(seen), 16, deps);
  assert.equal(r.indexed, 2);
  assert.ok(!JSON.stringify(seen).includes("marie@exemple"), "e-mail masqué avant l'envoi au modèle");
  assert.deepEqual(rec.updates.map((u) => [u.id, u.org, u.onlyIfNull]), [["c1", "o1", true], ["c2", "o2", true]]);
  const v = JSON.parse(rec.updates[1].payload.embedding as string) as number[];
  assert.equal(v.length, 1024);
  assert.equal(typeof rec.updates[0].payload.embedded_at, "string");
});

Deno.test("indexPendingChunks : rien à faire = 0 appel au modèle ; mauvais nombre de vecteurs = erreur ; une mise à jour qui échoue n'est pas comptée", async () => {
  const none = fakeDb([]);
  const seen: string[][] = [];
  assert.deepEqual(await indexPendingChunks(await makeCronAuth(), llm(seen), 16, none.deps), { indexed: 0 });
  assert.equal(seen.length, 0);
  const short = { embed: () => Promise.resolve({ vectors: [Array(1024).fill(0)], model: "e", tokensIn: 1, latencyMs: 1 }) };
  await assert.rejects(indexPendingChunks(await makeCronAuth(), short, 16, fakeDb(rows).deps), (e: unknown) => (e as AppError).code === "service_unavailable");
  const partial = fakeDb(rows, ["c2"]);
  assert.equal((await indexPendingChunks(await makeCronAuth(), llm([]), 16, partial.deps)).indexed, 1);
});
