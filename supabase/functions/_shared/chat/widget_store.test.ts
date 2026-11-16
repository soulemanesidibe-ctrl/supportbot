import assert from "node:assert/strict";
import { AppError } from "../errors.ts";
import { fakeSupabase as fake, makeAuth, Op, TEST_ORG, TEST_USER } from "../testing.ts";
import { supabaseChatStore } from "./store.ts";
import { supabaseWidgetStore } from "./widget_store.ts";

const CONV = "cccccccc-0000-4000-8000-000000000001";
const employee = () => makeAuth({ org_role: "end_user", via: "member" });
const has = (op: Op, kind: string, col: string, val: unknown) => op.filters.some(([k, c, v]) => k === kind && c === col && JSON.stringify(v) === JSON.stringify(val));
async function code(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { return e instanceof AppError ? e.code : `autre:${(e as Error).message}`; }
  return "aucune erreur";
}

Deno.test("widget store : organisation et demandeur viennent du CONTEXTE vérifié, jamais d'ailleurs ; fonctions SQL de la migration 17", async () => {
  const { deps, ops } = fake((op) =>
    op.fn === "widget_context" ? { data: { org_name: "A", accent: null, first_name: "C", relief_until: null, incidents: [] } }
    : op.fn === "widget_requests" ? { data: [] }
    : { data: { id: CONV, state: "open", category: null, satisfaction: null, resolution: null, messages: [] } });
  const s = supabaseWidgetStore(deps);
  const auth = await employee();
  await s.context(auth);
  await s.requests(auth, 30);
  await s.conversation(auth, CONV);
  assert.deepEqual(ops.map((o) => [o.fn, o.args]), [
    ["widget_context", { p_org: TEST_ORG, p_user: TEST_USER }],
    ["widget_requests", { p_org: TEST_ORG, p_user: TEST_USER, p_limit: 30 }],
    ["widget_conversation", { p_org: TEST_ORG, p_user: TEST_USER, p_conversation: CONV }],
  ]);
});

Deno.test("widget store : réservé au rôle salarié ; identifiant de conversation invalide refusé SANS requête", async () => {
  const { deps, ops } = fake(() => ({ data: null }));
  const s = supabaseWidgetStore(deps);
  const tech = await makeAuth({ org_role: "partner_technician", via: "partner" });
  assert.equal(await code(s.context(tech)), "forbidden");
  assert.equal(await code(s.requests(tech, 30)), "forbidden");
  assert.equal(await code(s.conversation(await employee(), "1; drop table messages")), "bad_request");
  assert.equal(await code(s.resolve(await employee(), "x", "ai_confirmed")), "bad_request");
  assert.equal(ops.length, 0);
});

Deno.test("widget store : la liste est bornée (1 à 50) quelle que soit la demande", async () => {
  const { deps, ops } = fake(() => ({ data: [] }));
  const s = supabaseWidgetStore(deps);
  await s.requests(await employee(), 10_000);
  await s.requests(await employee(), -3);
  assert.deepEqual(ops.map((o) => (o.args as Record<string, unknown>).p_limit), [50, 1]);
});

Deno.test("widget store : forme inattendue ou erreur de la base = panne (503), jamais un résultat deviné ; lignes mal formées écartées", async () => {
  assert.equal(await code(supabaseWidgetStore(fake(() => ({ error: { message: "boom" } })).deps).context(await employee())), "service_unavailable");
  assert.equal(await code(supabaseWidgetStore(fake(() => ({ data: { org_name: 42 } })).deps).context(await employee())), "service_unavailable");
  const c = await supabaseWidgetStore(fake(() => ({
    data: {
      id: CONV, state: "open", category: null, satisfaction: "5", resolution: null,
      messages: [
        { id: "a", role: "user", content: "ok", at: "t" },
        { id: "b", role: "root", content: "rôle inconnu", at: "t" },
        { id: "c", role: "assistant", content: 12, at: "t" },
        { id: "d", role: "user", content: "auteur ignoré hors technicien", at: "t", author: "Pirate" },
        { id: "e", role: "technician", content: "ok", at: "t", author: "Inès" },
      ],
    },
  })).deps).conversation(await employee(), CONV);
  assert.deepEqual(c?.messages.map((m) => [m.id, m.author]), [["a", null], ["d", null], ["e", "Inès"]]);
  assert.equal(c?.satisfaction, null, "une note non numérique n'est pas reprise");
  assert.equal(await supabaseWidgetStore(fake(() => ({ data: null })).deps).conversation(await employee(), CONV), null);
});

Deno.test("widget store : clôture et note sont CONDITIONNELLES (demandeur, organisation, état attendu) ; aucune ligne changée = faux", async () => {
  const { deps, ops } = fake(() => ({ data: [{ id: CONV }] }));
  const s = supabaseWidgetStore(deps);
  assert.equal(await s.resolve(await employee(), CONV, "ai_confirmed"), true);
  assert.equal(await s.rate(await employee(), CONV, 4), true);
  const [resolve, rate] = ops;
  assert.equal(resolve.method, "update");
  assert.equal((resolve.payload as Record<string, unknown>).state, "resolved");
  assert.equal((resolve.payload as Record<string, unknown>).resolution, "ai_confirmed");
  assert.ok(has(resolve, "eq", "id", CONV) && has(resolve, "eq", "org_id", TEST_ORG) && has(resolve, "eq", "requester_user_id", TEST_USER) && has(resolve, "eq", "state", "waiting_user"));
  assert.deepEqual(rate.payload, { satisfaction: 4 });
  assert.ok(has(rate, "eq", "org_id", TEST_ORG) && has(rate, "eq", "requester_user_id", TEST_USER) && has(rate, "in", "state", ["resolved", "closed"]));
  const none = supabaseWidgetStore(fake(() => ({ data: [] })).deps);
  assert.equal(await none.resolve(await employee(), CONV, "human"), false);
  assert.equal(await none.rate(await employee(), CONV, 3), false);
  assert.equal(await code(none.rate(await employee(), CONV, 9 as 5)), "bad_request");
});

Deno.test("store : rouvrir une demande efface sa résolution et sa date (elle ne compte plus comme « résolue par Relève »)", async () => {
  const { deps, ops } = fake(() => ({ data: null }));
  await supabaseChatStore(deps).updateConversation(await employee(), CONV, { state: "waiting_technician", escalate: true, reopen: true });
  const p = ops[0].payload as Record<string, unknown>;
  assert.equal(p.state, "waiting_technician");
  assert.equal(p.resolution, null);
  assert.equal(p.resolved_at, null);
  assert.ok(typeof p.escalated_at === "string");
  await supabaseChatStore(deps).updateConversation(await employee(), CONV, { state: "waiting_technician", reopen: false });
  assert.equal("resolution" in (ops[1].payload as Record<string, unknown>), false);
});
