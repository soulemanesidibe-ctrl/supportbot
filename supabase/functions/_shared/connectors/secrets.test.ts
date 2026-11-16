import assert from "node:assert/strict";
import { AppError } from "../errors.ts";
import { fakeSupabase, makeAuth, Op, Reply, TEST_ORG } from "../testing.ts";
import { ConnectorHttpError } from "./http.ts";
import { supabaseSecretPort } from "./secrets.ts";

function port(respond: (op: Op) => Reply) {
  const f = fakeSupabase(respond);
  return { p: supabaseSecretPort(f.deps), ops: f.ops };
}

Deno.test("secrets : lecture et écriture passent par les fonctions SQL, avec l'organisation du CONTEXTE (jamais d'un paramètre)", async () => {
  const auth = await makeAuth({ org_role: "org_admin" });
  const { p, ops } = port((op) => (op.fn === "connector_secret_get" ? { data: "le-secret", error: null } : { data: true, error: null }));
  assert.equal(await p.get(auth, "00000000-0000-4000-8000-0000000000c1"), "le-secret");
  await p.set(auth, "00000000-0000-4000-8000-0000000000c1", "un-nouveau-secret");
  assert.deepEqual(ops.map((o) => [o.fn, o.args]), [
    ["connector_secret_get", { p_org: TEST_ORG, p_connector: "00000000-0000-4000-8000-0000000000c1" }],
    ["connector_secret_set", { p_org: TEST_ORG, p_connector: "00000000-0000-4000-8000-0000000000c1", p_secret: "un-nouveau-secret" }],
  ]);
});

Deno.test("secrets : erreur de base = « indisponible » ; réponse vide ou non texte = « config » ; jamais le texte de la base", async () => {
  const auth = await makeAuth({ org_role: "org_admin" });
  const err = await port(() => ({ data: null, error: { message: "Connecteur introuvable /var/secret" } })).p.get(auth, "c").catch((e: ConnectorHttpError) => e);
  assert.equal((err as ConnectorHttpError).kind, "unavailable");
  assert.ok(!(err as Error).message.includes("introuvable") && !(err as Error).message.includes("/var"));
  for (const data of [null, "", 42, { a: 1 }]) {
    const e = await port(() => ({ data, error: null })).p.get(auth, "c").catch((x: ConnectorHttpError) => x);
    assert.equal((e as ConnectorHttpError).kind, "config", JSON.stringify(data));
  }
  const w = await port(() => ({ data: null, error: { message: "x" } })).p.set(auth, "c", "secret-long-enough").catch((x: ConnectorHttpError) => x);
  assert.equal((w as ConnectorHttpError).kind, "unavailable");
});

Deno.test("secrets : un contexte sans organisation ne lit ni n'écrit rien (aucun appel)", async () => {
  const { requireUser } = await import("../auth.ts");
  const { testAuthDeps, testRequest } = await import("../testing.ts");
  const bare = await requireUser(testRequest(), testAuthDeps());
  const { p, ops } = port(() => ({ data: "x", error: null }));
  for (const f of [() => p.get(bare, "c"), () => p.set(bare, "c", "secret-long-enough")]) {
    const e = await f().catch((x: AppError) => x);
    assert.equal((e as AppError).code, "forbidden");
  }
  assert.equal(ops.length, 0);
});
