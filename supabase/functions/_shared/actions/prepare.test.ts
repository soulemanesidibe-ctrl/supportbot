import assert from "node:assert/strict";
import type { UserDiagnosis } from "../capabilities/types.ts";
import { AppError } from "../errors.ts";
import { fakeDb, makeAuth } from "../testing.ts";
import { prepareAction, PrepareDeps } from "./prepare.ts";
import { makeActionRig } from "./test_rig.ts";
import type { ActionStore } from "./types.ts";

const clean: UserDiagnosis = { accountEnabled: true, locked: false, mfaMethods: [{ type: "totp", createdAt: "2026-01-01T00:00:00Z" }], recentFailedSignIns: 0, hasPrivilegedRole: false };

function setup(over: { store?: Partial<ActionStore>; diagnose?: PrepareDeps["diagnose"] } = {}) {
  const base = makeActionRig().deps.store;
  const inserts: unknown[] = [];
  const store: ActionStore = {
    ...base,
    insert: (_a, row) => { inserts.push(row); return Promise.resolve({ id: "act-1" }); },
    ...over.store,
  };
  const db = fakeDb();
  const deps: PrepareDeps = { store, diagnose: over.diagnose ?? (() => Promise.resolve(clean)), db: db.deps };
  return { deps, inserts, audits: db.inserts };
}
const input = { conversationId: "conv-1", requested: "reset_password" as const };

Deno.test("préparation : compte ordinaire = demande créée, cible et capacité fixées par le CODE, tracée", async () => {
  const s = setup();
  const r = await prepareAction(await makeAuth(), input, s.deps);
  assert.deepEqual(r, { status: "prepared", actionId: "act-1", flags: [] });
  assert.deepEqual(s.inserts, [{ conversationId: "conv-1", capability: "user.reset_password", directoryUserId: "dir-1", riskFlags: [] }]);
  assert.equal(s.audits.find((a) => a.table === "audit_logs")?.row.event, "action.prepared");
});

Deno.test("préparation : chaque action demandée correspond à UNE capacité privilégiée de la liste fermée", async () => {
  for (const [requested, capability] of [["reset_password", "user.reset_password"], ["unlock", "user.unlock"], ["revoke_sessions", "user.revoke_sessions"], ["mfa_reregister", "user.mfa_reregister"]] as const) {
    const s = setup();
    await prepareAction(await makeAuth(), { conversationId: "conv-1", requested }, s.deps);
    assert.equal((s.inserts[0] as { capability: string }).capability, capability);
  }
  const s = setup();
  const r = await prepareAction(await makeAuth(), { conversationId: "conv-1", requested: "delete_account" as never }, s.deps);
  assert.deepEqual(r, { status: "not_prepared", reason: "action_inconnue" });
  assert.equal(s.inserts.length, 0);
});

Deno.test("préparation : niveau 0, client non activé, salarié absent de l'annuaire = aucune demande, raison nommée", async () => {
  const lvl0 = setup({ store: { autonomyLevel: () => Promise.resolve(0) } });
  assert.deepEqual(await prepareAction(await makeAuth(), input, lvl0.deps), { status: "not_prepared", reason: "niveau_0" });
  const inactive = setup();
  assert.deepEqual(await prepareAction(await makeAuth({ is_activated: false }), input, inactive.deps), { status: "not_prepared", reason: "client_non_active" });
  const noDir = setup({ store: { directoryUserFor: () => Promise.resolve(null) } });
  assert.deepEqual(await prepareAction(await makeAuth(), input, noDir.deps), { status: "not_prepared", reason: "identite_non_resolue" });
  for (const s of [lvl0, inactive, noDir]) assert.equal(s.inserts.length, 0);
});

Deno.test("préparation : organisation gelée = erreur, rien n'est préparé", async () => {
  const s = setup();
  await assert.rejects(prepareAction(await makeAuth({ is_frozen: true }), input, s.deps), (e: unknown) => (e as AppError).code === "org_frozen");
  assert.equal(s.inserts.length, 0);
});

Deno.test("préparation : sans diagnostic du compte, pas de préparation (échec fermé)", async () => {
  const s = setup({ diagnose: () => Promise.reject(new Error("connecteur injoignable")) });
  assert.deepEqual(await prepareAction(await makeAuth(), input, s.deps), { status: "not_prepared", reason: "diagnostic_indisponible" });
  assert.equal(s.inserts.length, 0);
});

Deno.test("préparation : X1 (compte à privilèges) = rien de préparé ; X2 à X4 = « suspecte » ; aucune demande dans les deux cas", async () => {
  const priv = setup({ diagnose: () => Promise.resolve({ ...clean, hasPrivilegedRole: true }) });
  assert.deepEqual(await prepareAction(await makeAuth(), input, priv.deps), { status: "not_prepared", reason: "compte_a_privileges", flags: ["X1"] });
  const x3 = setup({ diagnose: () => Promise.resolve({ ...clean, recentFailedSignIns: 25 }) });
  assert.deepEqual(await prepareAction(await makeAuth(), input, x3.deps), { status: "suspicious", flags: ["X3"] });
  const x4 = setup({ store: { recentRequestsOnTarget: () => Promise.resolve(1) } });
  assert.deepEqual(await prepareAction(await makeAuth(), input, x4.deps), { status: "suspicious", flags: ["X4"] });
  for (const s of [priv, x3, x4]) assert.equal(s.inserts.length, 0);
});

Deno.test("préparation : la base refuse l'insertion = « refus_base » ; une autre erreur remonte", async () => {
  const refused = setup({ store: { insert: () => Promise.reject(new AppError(503, "service_unavailable", "x")) } });
  assert.deepEqual(await prepareAction(await makeAuth(), input, refused.deps), { status: "not_prepared", reason: "refus_base" });
  const boom = setup({ store: { insert: () => Promise.reject(new AppError(500, "internal", "x")) } });
  await assert.rejects(prepareAction(await makeAuth(), input, boom.deps), (e: unknown) => (e as AppError).code === "internal");
});
