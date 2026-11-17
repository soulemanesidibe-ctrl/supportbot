import assert from "node:assert/strict";
import type { AuditEvent } from "../audit.ts";
import { AppError } from "../errors.ts";
import { fakeSupabase, makeAuth, noLimit, Op, TEST_JWT, TEST_ORG, TEST_USER, testAuthDeps } from "../testing.ts";
import { ConsoleConversation, ConsoleDeps, createConsoleHandler, reply, resolve, supabaseConsoleStore, take } from "./handler.ts";

const CONV = "cccccccc-0000-4000-8000-000000000001";
const OTHER = "dddddddd-0000-4000-8000-000000000009";
const tech = () => makeAuth({ org_role: "partner_technician", via: "partner" });
async function code(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { return e instanceof AppError ? e.code : `autre:${(e as Error).message}`; }
  return "aucune erreur";
}

function rig(conv: ConsoleConversation | null = { id: CONV, state: "waiting_technician", assignedTo: null }, opts: { failAudit?: boolean; updateOk?: boolean } = {}) {
  const messages: Array<{ content: string; visibility: string; redactions: number }> = [];
  const updates: Array<{ patch: Record<string, unknown>; from: readonly string[] }> = [];
  const audits: AuditEvent[] = [];
  const deps: ConsoleDeps = {
    store: {
      conversation: () => Promise.resolve(conv),
      addMessage: (_a, _id, m) => { messages.push(m); return Promise.resolve({ id: "m-1" }); },
      update: (_a, _id, patch, from) => { updates.push({ patch, from }); return Promise.resolve(opts.updateOk ?? true); },
    },
    audit: (_a, ev) => (opts.failAudit ? Promise.reject(new Error("audit indisponible")) : (audits.push(ev), Promise.resolve())),
  };
  return { deps, messages, updates, audits };
}

Deno.test("console réponse : journal d'abord, message du technicien MASQUÉ, la demande attend le salarié et revient à qui a répondu", async () => {
  const r = rig();
  const jwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV"].join(".");
  const out = await reply(await tech(), r.deps, { conversationId: CONV, text: `  Voici votre accès : ${jwt}  `, internal: false });
  assert.equal(out.masked, true);
  assert.equal(r.audits[0].event, "console.reply");
  assert.deepEqual(r.audits[0].details, { internal: false, masked: true });
  assert.equal(r.messages[0].visibility, "public");
  assert.ok(!r.messages[0].content.includes(jwt), "aucun secret enregistré");
  assert.deepEqual(r.updates[0].patch, { state: "waiting_user", assignedTo: TEST_USER });
});

Deno.test("console note interne : visible des seuls techniciens, sans changer l'état ; demande déjà assignée : pas réassignée", async () => {
  const r = rig({ id: CONV, state: "waiting_technician", assignedTo: "quelqu-un" });
  await reply(await tech(), r.deps, { conversationId: CONV, text: "Vérifier le câble jeudi", internal: true });
  assert.equal(r.messages[0].visibility, "technician");
  assert.equal(r.updates.length, 0);
  await reply(await tech(), r.deps, { conversationId: CONV, text: "Je passe jeudi", internal: false });
  assert.deepEqual(r.updates[0].patch, { state: "waiting_user" });
});

Deno.test("console réponse : texte vide, trop long, mal typé ; conversation invalide ou d'une autre organisation", async () => {
  const r = rig();
  for (const text of ["", "   ", "x".repeat(4001), 42, null]) {
    assert.equal(await code(reply(await tech(), r.deps, { conversationId: CONV, text, internal: false })), "bad_request", String(text));
  }
  assert.equal(await code(reply(await tech(), r.deps, { conversationId: CONV, text: "ok", internal: "oui" })), "bad_request");
  assert.equal(await code(reply(await tech(), r.deps, { conversationId: "1; drop", text: "ok", internal: false })), "bad_request");
  assert.equal(await code(reply(await tech(), rig(null).deps, { conversationId: OTHER, text: "ok", internal: false })), "not_found");
  assert.equal(r.messages.length + r.audits.length, 0);
});

Deno.test("console : journal indisponible = rien n'est écrit ; accès d'assistance (lecture seule) = aucun geste", async () => {
  const down = rig(undefined, { failAudit: true });
  assert.equal(await code(reply(await tech(), down.deps, { conversationId: CONV, text: "ok", internal: false })), "autre:audit indisponible");
  assert.equal(down.messages.length + down.updates.length, 0);
  const support = await makeAuth({ org_role: "partner_technician", via: "support_access", read_only: true });
  const r = rig();
  assert.equal(await code(reply(support, r.deps, { conversationId: CONV, text: "ok", internal: false })), "read_only");
  assert.equal(await code(take(support, r.deps, { conversationId: CONV })), "read_only");
  assert.equal(await code(resolve(support, r.deps, { conversationId: CONV })), "read_only");
});

Deno.test("console prendre : assigne à soi (idempotent) ; clore : seulement une demande ouverte, résolution « par un humain »", async () => {
  const mine = rig({ id: CONV, state: "open", assignedTo: TEST_USER });
  await take(await tech(), mine.deps, { conversationId: CONV });
  assert.equal(mine.audits.length + mine.updates.length, 0, "déjà à moi : rien");
  const other = rig({ id: CONV, state: "open", assignedTo: "quelqu-un" });
  await take(await tech(), other.deps, { conversationId: CONV });
  assert.deepEqual(other.audits[0].details, { from_other: true });
  assert.deepEqual(other.updates[0].patch, { assignedTo: TEST_USER });

  const r = rig({ id: CONV, state: "waiting_user", assignedTo: null });
  await resolve(await tech(), r.deps, { conversationId: CONV });
  assert.deepEqual(r.updates[0].patch, { state: "resolved", resolution: "human" });
  assert.deepEqual([...r.updates[0].from].sort(), ["open", "waiting_technician", "waiting_user"]);
  for (const state of ["resolved", "closed"]) {
    const done = rig({ id: CONV, state, assignedTo: null });
    assert.equal(await code(resolve(await tech(), done.deps, { conversationId: CONV })), "conflict", state);
    assert.equal(done.audits.length, 0);
  }
  assert.equal(await code(resolve(await tech(), rig(undefined, { updateOk: false }).deps, { conversationId: CONV })), "conflict", "changée entre-temps");
});

Deno.test("porte console : seuls les rôles qui traitent les demandes ; salarié et ESN admin = 403 ; opération inconnue = 400", async () => {
  const call = async (access: Parameters<typeof testAuthDeps>[0], body: Record<string, unknown>) => {
    const r = rig();
    const h = createConsoleHandler({ deps: () => r.deps, authDeps: testAuthDeps(access), limit: noLimit });
    const res = await h(new Request("https://f.test/console", {
      method: "POST",
      headers: { authorization: `Bearer ${TEST_JWT}`, "content-type": "application/json" },
      body: JSON.stringify({ orgId: TEST_ORG, ...body }),
    }));
    return { status: res.status, r };
  };
  for (const access of [{ org_role: "partner_technician", via: "partner" }, { org_role: "org_technician", via: "member" }, { org_role: "org_admin", via: "member" }] as const) {
    assert.equal((await call(access, { op: "take", conversationId: CONV })).status, 200, access.org_role);
  }
  for (const access of [{ org_role: "end_user", via: "member" }, { org_role: "partner_admin", via: "partner" }, { org_role: "org_viewer", via: "member" }, null] as const) {
    const res = await call(access, { op: "take", conversationId: CONV });
    assert.equal(res.status, 403, JSON.stringify(access));
    assert.equal(res.r.updates.length, 0);
  }
  assert.equal((await call({ org_role: "partner_technician", via: "partner" }, { op: "delete" })).status, 400);
});

Deno.test("store console : tout est borné à l'organisation du contexte ; message de technicien avec SON identifiant ; écriture conditionnelle", async () => {
  const has = (op: Op, kind: string, col: string, val: unknown) => op.filters.some(([k, c, v]) => k === kind && c === col && JSON.stringify(v) === JSON.stringify(val));
  const { deps, ops } = fakeSupabase((op) => (op.method === "update" ? { data: [{ id: CONV }] } : { data: { id: CONV, state: "open", assigned_to: null } }));
  const s = supabaseConsoleStore(deps);
  const auth = await tech();
  await s.conversation(auth, CONV);
  await s.addMessage(auth, CONV, { content: "ok", visibility: "public", redactions: 0 });
  assert.equal(await s.update(auth, CONV, { state: "resolved", resolution: "human" }, ["open"]), true);
  assert.ok(has(ops[0], "eq", "org_id", TEST_ORG));
  assert.deepEqual(ops[1].payload, { conversation_id: CONV, org_id: TEST_ORG, role: "technician", visibility: "public", content: "ok", redactions: 0, author_id: TEST_USER });
  assert.ok(has(ops[2], "eq", "org_id", TEST_ORG) && has(ops[2], "in", "state", ["open"]));
  assert.equal((ops[2].payload as Record<string, unknown>).resolution, "human");
});
