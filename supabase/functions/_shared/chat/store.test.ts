import assert from "node:assert/strict";
import { AppError } from "../errors.ts";
import { fakeSupabase as fake, makeAuth, Op, TEST_ORG, TEST_USER } from "../testing.ts";
import { supabaseChatStore } from "./store.ts";

const has = (op: Op, kind: string, col: string, val: unknown) => op.filters.some(([k, c, v]) => k === kind && c === col && JSON.stringify(v) === JSON.stringify(val));
async function code(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { return e instanceof AppError ? e.code : `autre:${(e as Error).message}`; }
  return "aucune erreur";
}
const CONV = "cccccccc-0000-4000-8000-000000000001";

Deno.test("openConversation : création pour L'utilisateur de l'AuthContext, dans SON organisation", async () => {
  const { deps, ops } = fake(() => ({ data: { id: CONV, state: "open", category: null } }));
  const row = await supabaseChatStore(deps).openConversation(await makeAuth(), null);
  assert.deepEqual(row, { id: CONV, state: "open", category: null, messageCount: 0 });
  assert.deepEqual(ops[0].payload, { org_id: TEST_ORG, requester_user_id: TEST_USER, channel: "widget" });
});

Deno.test("openConversation : la conversation d'un autre salarié ou d'une autre organisation est « introuvable » ; identifiant invalide refusé sans requête", async () => {
  const { deps, ops } = fake((op) => (op.table === "conversations" ? { data: null } : { count: 0 }));
  const store = supabaseChatStore(deps);
  assert.equal(await code(store.openConversation(await makeAuth(), CONV)), "not_found");
  const q = ops[0];
  assert.ok(has(q, "eq", "id", CONV) && has(q, "eq", "org_id", TEST_ORG) && has(q, "eq", "requester_user_id", TEST_USER), "filtré par id, organisation ET demandeur");
  const before = ops.length;
  assert.equal(await code(store.openConversation(await makeAuth(), "1; drop table messages")), "bad_request");
  assert.equal(ops.length, before, "aucune requête");
});

Deno.test("openConversation : charge la conversation et compte ses messages dans l'organisation", async () => {
  const { deps, ops } = fake((op) => (op.table === "conversations" ? { data: { id: CONV, state: "waiting_user", category: "vpn" } } : { count: 7 }));
  const row = await supabaseChatStore(deps).openConversation(await makeAuth(), CONV);
  assert.deepEqual(row, { id: CONV, state: "waiting_user", category: "vpn", messageCount: 7 });
  assert.ok(has(ops[1], "eq", "org_id", TEST_ORG));
});

Deno.test("history : seulement les messages PUBLICS du salarié et de l'IA de cette organisation, dans l'ordre chronologique", async () => {
  const { deps, ops } = fake(() => ({ data: [{ role: "assistant", content: "B" }, { role: "user", content: "A" }] }));
  const h = await supabaseChatStore(deps).history(await makeAuth(), CONV, 6);
  assert.deepEqual(h, [{ role: "user", content: "A" }, { role: "assistant", content: "B" }]);
  assert.ok(has(ops[0], "eq", "visibility", "public") && has(ops[0], "eq", "org_id", TEST_ORG) && has(ops[0], "in", "role", ["user", "assistant"]));
});

Deno.test("addMessage : l'organisation vient de l'AuthContext, un message de l'IA n'a jamais d'auteur, une erreur = indisponible", async () => {
  const ok = fake(() => ({ data: { id: "m1" } }));
  const r = await supabaseChatStore(ok.deps).addMessage(await makeAuth(), CONV, { role: "assistant", visibility: "technician", content: "brouillon", model: "m", promptVersion: "reponse@v1", latencyMs: 12.7 });
  assert.equal(r.id, "m1");
  assert.deepEqual(ok.ops[0].payload, { conversation_id: CONV, org_id: TEST_ORG, role: "assistant", visibility: "technician", content: "brouillon", redactions: 0, author_id: null, model: "m", prompt_version: "reponse@v1", latency_ms: 13 });
  const ko = fake(() => ({ error: { message: "SEC-19 Mode ombre" } }));
  assert.equal(await code(supabaseChatStore(ko.deps).addMessage(await makeAuth(), CONV, { role: "assistant", visibility: "public", content: "x" })), "service_unavailable");
});

Deno.test("gateState : absent, inconnu ou illisible = mode ombre (ou erreur), jamais « direct » par défaut", async () => {
  const auth = await makeAuth();
  assert.equal(await supabaseChatStore(fake(() => ({ data: null })).deps).gateState(auth, "vpn"), "shadow");
  assert.equal(await supabaseChatStore(fake(() => ({ data: { state: "ouvert-a-tous" } })).deps).gateState(auth, "vpn"), "shadow");
  assert.equal(await supabaseChatStore(fake(() => ({ data: { state: "direct" } })).deps).gateState(auth, "vpn"), "direct");
  assert.equal(await code(supabaseChatStore(fake(() => ({ error: { message: "x" } })).deps).gateState(auth, "vpn")), "service_unavailable");
});

Deno.test("searchKb : appelle match_kb_chunks avec l'organisation de l'AuthContext ; vecteur de mauvaise taille refusé sans appel", async () => {
  const { deps, ops } = fake(() => ({ data: [{ document_id: "d1", title: "T", content: "C", score: 0.8 }] }));
  const store = supabaseChatStore(deps);
  const hits = await store.searchKb(await makeAuth(), Array(1024).fill(0.5), 4, 0.5);
  assert.deepEqual(hits, [{ documentId: "d1", title: "T", text: "C", score: 0.8 }]);
  assert.equal(ops[0].fn, "match_kb_chunks");
  const args = ops[0].args as Record<string, unknown>;
  assert.equal(args.p_org, TEST_ORG);
  assert.equal(args.p_limit, 4);
  assert.equal(typeof args.p_query, "string");
  assert.equal((JSON.parse(args.p_query as string) as number[]).length, 1024);
  const before = ops.length;
  assert.equal(await code(store.searchKb(await makeAuth(), Array(768).fill(0.5), 4, 0.5)), "internal");
  assert.equal(await code(store.searchKb(await makeAuth(), [...Array(1023).fill(0.5), NaN], 4, 0.5)), "internal");
  assert.equal(ops.length, before);
});

Deno.test("createTicket : un seul ticket ouvert par conversation ; sinon création marquée « par l'IA » dans l'organisation", async () => {
  const dup = fake(() => ({ data: [{ id: "t-existant" }] }));
  assert.equal((await supabaseChatStore(dup.deps).createTicket(await makeAuth(), { conversationId: CONV, title: "x".repeat(400), category: "vpn", priority: "normal", diagnostic: {}, security: false })).id, "t-existant");
  assert.ok(!dup.ops.some((o) => o.method === "insert"), "aucune insertion");
  const fresh = fake((op) => (op.method === "insert" ? { data: { id: "t-nouveau" } } : { data: [] }));
  const r = await supabaseChatStore(fresh.deps).createTicket(await makeAuth(), { conversationId: CONV, title: "x".repeat(400), category: "vpn", priority: "high", diagnostic: { reason: "manipulation" }, security: true });
  assert.equal(r.id, "t-nouveau");
  const ins = fresh.ops.find((o) => o.method === "insert")!.payload as Record<string, unknown>;
  assert.deepEqual({ org: ins.org_id, ai: ins.created_by_ai, sec: ins.security, len: (ins.title as string).length }, { org: TEST_ORG, ai: true, sec: true, len: 300 });
});

Deno.test("updateConversation : filtré par conversation, organisation ET demandeur ; patch vide = aucune requête", async () => {
  const { deps, ops } = fake(() => ({}));
  const store = supabaseChatStore(deps);
  await store.updateConversation(await makeAuth(), CONV, {});
  assert.equal(ops.length, 0);
  await store.updateConversation(await makeAuth(), CONV, { state: "waiting_technician", escalate: true, category: "vpn" });
  const op = ops[0];
  assert.ok(has(op, "eq", "id", CONV) && has(op, "eq", "org_id", TEST_ORG) && has(op, "eq", "requester_user_id", TEST_USER));
  const p = op.payload as Record<string, unknown>;
  assert.deepEqual({ state: p.state, category: p.category, esc: typeof p.escalated_at }, { state: "waiting_technician", category: "vpn", esc: "string" });
});
