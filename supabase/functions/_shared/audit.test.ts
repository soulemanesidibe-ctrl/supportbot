import assert from "node:assert/strict";
import { auditEvent } from "./audit.ts";
import { AuthDeps, requireOrgMember } from "./auth.ts";
import { DbDeps } from "./db.ts";
import { AppError } from "./errors.ts";
import { estimateCostMicroEur, recordLlmCall, recordLlmFailure } from "./llm/usage.ts";
import { definePrompt } from "./llm/prompt_registry.ts";

const USER = "123e4567-e89b-12d3-a456-426614174000";
const ORG = "223e4567-e89b-12d3-a456-426614174000";
const authDeps: AuthDeps = {
  verifyToken: () => Promise.resolve({ userId: USER, aal: "aal2", amr: [] }),
  resolveAccess: () => Promise.resolve({ org_role: "end_user", via: "member", org_type: "client", org_state: "pilot", is_frozen: false, is_activated: true, read_only: false }),
  cronSecret: () => undefined,
  nowSeconds: () => 1_800_000_000,
};
const ctx = () => requireOrgMember(new Request("https://exemple.test", { headers: { authorization: "Bearer aaaaaaaa.bbbbbbbb.cccccccc" } }), ORG, undefined, authDeps);

function fakeDb(failTables: string[] = []) {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const deps: DbDeps = {
    createClient: (() => ({
      from: (table: string) => ({
        insert: (row: Record<string, unknown>) => {
          inserts.push({ table, row });
          return Promise.resolve({ error: failTables.includes(table) ? { message: "boom" } : null });
        },
      }),
    })) as never,
    url: () => "https://projet.exemple.test",
    serviceKey: () => "cle-de-service-factice",
  };
  return { deps, inserts };
}

Deno.test("auditEvent : une ligne d'audit avec l'organisation, la requête et l'acteur ; l'IA agit « pour le compte de » la personne", async () => {
  const { deps, inserts } = fakeDb();
  const auth = await ctx();
  await auditEvent(auth, { event: "chat.escalated", actorKind: "agent", subjectType: "conversation", subjectId: "c1", details: { raison: "inconnu" } }, deps);
  const row = inserts[0].row;
  assert.equal(inserts[0].table, "audit_logs");
  assert.deepEqual({ org: row.org_id, kind: row.actor_kind, actor: row.actor_id, onBehalf: row.on_behalf_of, req: row.request_id },
    { org: ORG, kind: "agent", actor: null, onBehalf: USER, req: auth.requestId });
  await auditEvent(auth, { event: "chat.message" }, deps);
  assert.equal(inserts[1].row.actor_kind, "user");
  assert.equal(inserts[1].row.actor_id, USER);
});

Deno.test("auditEvent : les secrets des détails sont masqués, un détail énorme est écarté, un nom d'événement invalide est refusé", async () => {
  const { deps, inserts } = fakeDb();
  const auth = await ctx();
  await auditEvent(auth, { event: "test.secret", details: { password: "hunter2", note: "mon mot de passe est Azerty123", ok: 1 } }, deps);
  const d = inserts[0].row.details as Record<string, unknown>;
  assert.equal(d.password, "[MASQUÉ]");
  assert.ok(!JSON.stringify(d).includes("Azerty123"));
  assert.equal(d.ok, 1);
  await auditEvent(auth, { event: "test.gros", details: { x: "y".repeat(1900), z: Array(10).fill("y".repeat(1900)) } }, deps);
  assert.deepEqual(inserts[1].row.details, { tronque: true });
  await assert.rejects(auditEvent(auth, { event: "Événement Invalide!" }, deps), (e: unknown) => e instanceof AppError);
});

Deno.test("auditEvent : si l'écriture échoue, l'opération échoue (on n'agit pas sans trace)", async () => {
  const { deps } = fakeDb(["audit_logs"]);
  await assert.rejects(auditEvent(await ctx(), { event: "test.echec" }, deps), (e: unknown) => (e as AppError).code === "service_unavailable");
});

Deno.test("recordLlmCall : comptabilité et audit sans AUCUN contenu de message ; la version du prompt est tracée", async () => {
  const { deps, inserts } = fakeDb();
  const sys = definePrompt("test.usage", "v3", "Prompt de test pour la comptabilité des appels.");
  await recordLlmCall(await ctx(), { purpose: "answer", system: sys, conversationId: "conv-1", attempts: 2,
    result: { model: "mistral-medium-2026", tokensIn: 1000, tokensOut: 500, latencyMs: 812.6 },
    prices: { "mistral-medium-2026": { inPerMTok: 0.4, outPerMTok: 2 } } }, deps);
  const usage = inserts.find((i) => i.table === "llm_usage")!.row;
  assert.deepEqual(usage, { org_id: ORG, model: "mistral-medium-2026", purpose: "answer", tokens_in: 1000, tokens_out: 500, latency_ms: 813, cost_micro_eur: 1400 });
  const audit = inserts.find((i) => i.table === "audit_logs")!.row;
  assert.equal(audit.event, "llm.call");
  assert.equal(audit.actor_kind, "agent");
  assert.deepEqual(audit.details, { purpose: "answer", model: "mistral-medium-2026", prompt_id: "test.usage", prompt_version: "v3", tokens_in: 1000, tokens_out: 500, latency_ms: 813, attempts: 2 });
});

Deno.test("recordLlmCall : une panne de la table d'usage ne bloque pas, une panne de l'audit si", async () => {
  const sys = definePrompt("test.usage2", "v1", "Autre prompt de test pour la comptabilité des appels.");
  const rec = { purpose: "triage" as const, system: sys, result: { model: "m", tokensIn: 1, tokensOut: 1, latencyMs: 5 } };
  await recordLlmCall(await ctx(), rec, fakeDb(["llm_usage"]).deps);
  await assert.rejects(recordLlmCall(await ctx(), rec, fakeDb(["audit_logs"]).deps));
});

Deno.test("estimateCostMicroEur : tarif inconnu = 0, jamais un coût inventé", () => {
  assert.equal(estimateCostMicroEur("inconnu", 1_000_000, 1_000_000), 0);
  assert.equal(estimateCostMicroEur("m", 1_000_000, 0, { m: { inPerMTok: 0.4, outPerMTok: 2 } }), 400_000);
});

Deno.test("recordLlmFailure : on note la nature de l'échec, sans contenu", async () => {
  const { deps, inserts } = fakeDb();
  await recordLlmFailure(await ctx(), "answer", "rate_limited", deps);
  assert.deepEqual(inserts[0].row.details, { purpose: "answer", kind: "rate_limited" });
  assert.equal(inserts[0].row.event, "llm.failure");
});
