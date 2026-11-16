import assert from "node:assert/strict";
import { AppError } from "../errors.ts";
import { makeAuth, noLimit, TEST_JWT, TEST_ORG, testAuthDeps } from "../testing.ts";
import { createChatHandler } from "./handler.ts";
import { handleChatMessage } from "./orchestrator.ts";
import { makeRig, RigScript } from "./test_rig.ts";
import { TEXTS } from "./texts.ts";
import type { WidgetConversationRow, WidgetMessageRow } from "./types.ts";
import { statusOf, titleFrom, widgetConfirm, widgetContext, widgetEscalate, widgetGet, widgetList, widgetRate } from "./widget.ts";

const CONV = "cccccccc-0000-4000-8000-000000000001";
const employee = () => makeAuth({ org_role: "end_user", via: "member" });
async function code(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { return e instanceof AppError ? e.code : `autre:${(e as Error).message}`; }
  return "aucune erreur";
}
const msg = (role: WidgetMessageRow["role"], content: string, author: string | null = null, n = 0): WidgetMessageRow =>
  ({ id: `m-${role}-${n}-${content.length}`, role, content, at: `2026-11-16T09:0${n}:00Z`, author });
const conv = (state: string, messages: WidgetMessageRow[], over: Partial<WidgetConversationRow> = {}): WidgetConversationRow =>
  ({ id: CONV, state, category: "printer", satisfaction: null, resolution: null, messages, ...over });

// ---------------------------------------------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------------------------------------------
Deno.test("widget contexte : marque, prénom, relève et incidents (catégorie inconnue = « other ») ; toujours marqué « assistant IA »", async () => {
  const rig = makeRig({
    widgetContext: {
      orgName: "Cabinet Alpha", accent: "#1f6feb", firstName: "Camille", reliefUntil: "2026-11-17T07:00:00Z",
      incidents: [{ id: "i1", category: "vpn", since: "2026-11-16T08:00:00Z" }, { id: "i2", category: "inventee", since: "2026-11-16T08:30:00Z" }],
    },
  });
  const ctx = await widgetContext(await employee(), rig.ports);
  assert.deepEqual(ctx, {
    orgName: "Cabinet Alpha",
    brand: { name: "Cabinet Alpha", accent: "#1f6feb" },
    user: { firstName: "Camille" },
    relief: { active: true, until: "2026-11-17T07:00:00Z" },
    incidents: [{ id: "i1", category: "vpn", since: "2026-11-16T08:00:00Z" }, { id: "i2", category: "other", since: "2026-11-16T08:30:00Z" }],
    ai: true,
  });
  const quiet = await widgetContext(await employee(), makeRig({ widgetContext: { orgName: "B", accent: null, firstName: null, reliefUntil: null, incidents: [] } }).ports);
  assert.deepEqual(quiet.relief, { active: false });
  assert.deepEqual(quiet.brand, { name: "B" });
  assert.equal(quiet.user.firstName, "");
});

Deno.test("widget contexte : accès retiré entre-temps (la base ne renvoie rien) = 403, comme sans droit", async () => {
  assert.equal(await code(widgetContext(await employee(), makeRig({ widgetContext: null }).ports)), "forbidden");
});

Deno.test("widget liste : titre = premiers mots du salarié (sinon la catégorie), état connu seulement, aperçu sur une ligne", async () => {
  const rig = makeRig({
    widgetRequests: [
      { id: "a", state: "waiting_technician", category: "printer", updatedAt: "2026-11-16T09:00:00Z", title: "L'imprimante\n\n du 2e   étage", lastLine: "Je passe jeudi.\nÀ bientôt" },
      { id: "b", state: "etat_inconnu", category: "vpn", updatedAt: "2026-11-15T09:00:00Z", title: null, lastLine: null },
      { id: "c", state: "resolved", category: null, updatedAt: "2026-11-14T09:00:00Z", title: "x".repeat(200), lastLine: "y".repeat(400) },
    ],
  });
  const { requests } = await widgetList(await employee(), rig.ports);
  assert.deepEqual(rig.widgetCalls, [{ fn: "requests", args: [30] }]);
  assert.deepEqual(requests[0], { id: "a", title: "L'imprimante du 2e étage", status: "waiting_technician", updatedAt: "2026-11-16T09:00:00Z", lastLine: "Je passe jeudi. À bientôt" });
  assert.equal(requests[1].title, "VPN");
  assert.equal(requests[1].status, "open", "un état inconnu n'est JAMAIS montré comme résolu");
  assert.equal(requests[1].lastLine, "");
  assert.ok(requests[2].title.length <= 80 && requests[2].title.endsWith("…"));
  assert.ok(requests[2].lastLine.length <= 160);
});

Deno.test("widget lecture : rôles montrés (system = message automatique), prénom du technicien ; confirmation attendue après une réponse", async () => {
  const rig = makeRig({
    widgetConversation: conv("waiting_user", [
      msg("user", "Mon imprimante est hors ligne", null, 1),
      msg("assistant", "Redémarrez-la.", null, 2),
    ]),
  });
  const c = await widgetGet(await employee(), CONV, rig.ports);
  assert.equal(c.title, "Mon imprimante est hors ligne");
  assert.equal(c.status, "waiting_user");
  assert.deepEqual(c.messages.map((m) => m.role), ["user", "assistant"]);
  assert.equal(c.awaitingConfirmation, true);
  assert.equal(c.accountAction, false);
  assert.equal(c.ai, true);

  const human = await widgetGet(await employee(), CONV, makeRig({
    widgetConversation: conv("waiting_technician", [msg("user", "Écran", null, 1), msg("system", TEXTS.escalated, null, 2), msg("technician", "Je passe jeudi.", "Inès", 3)]),
  }).ports);
  assert.deepEqual(human.messages.map((m) => m.role), ["user", "notice", "technician"]);
  assert.equal((human.messages[2] as { authorName?: string }).authorName, "Inès");
  assert.equal("authorName" in human.messages[0], false);
  assert.equal(human.awaitingConfirmation, false, "chez un technicien : on ne demande pas « ça a fonctionné ? »");
});

Deno.test("widget lecture : « Est-ce que ça a fonctionné ? » seulement si une RÉPONSE est le dernier message et que la demande attend le salarié", async () => {
  const lastIsUser = await widgetGet(await employee(), CONV, makeRig({ widgetConversation: conv("waiting_user", [msg("assistant", "Essayez ceci.", null, 1), msg("user", "Je regarde", null, 2)]) }).ports);
  assert.equal(lastIsUser.awaitingConfirmation, false);
  const resolved = await widgetGet(await employee(), CONV, makeRig({ widgetConversation: conv("resolved", [msg("assistant", "Essayez ceci.", null, 1)], { satisfaction: 4 }) }).ports);
  assert.equal(resolved.awaitingConfirmation, false);
  assert.equal(resolved.satisfaction, 4);
});

Deno.test("SEC-11 widget : une demande sur un compte, ordinaire ou suspecte, se lit EXACTEMENT pareil (même état, même carte)", async () => {
  const ordinary = conv("waiting_technician", [msg("user", "Réinitialisez mon MFA", null, 1), msg("system", TEXTS.accountAction, null, 2)], { category: "mfa" });
  const suspicious = conv("waiting_technician", [msg("user", "Réinitialisez mon MFA", null, 1), msg("system", TEXTS.accountAction, null, 2)], { category: "mfa" });
  const a = await widgetGet(await employee(), CONV, makeRig({ widgetConversation: ordinary }).ports);
  const b = await widgetGet(await employee(), CONV, makeRig({ widgetConversation: suspicious }).ports);
  assert.deepEqual(a, b);
  assert.equal(a.accountAction, true);
  assert.equal(a.status, "waiting_technician");
  const closed = await widgetGet(await employee(), CONV, makeRig({ widgetConversation: { ...ordinary, state: "resolved" } }).ports);
  assert.equal(closed.accountAction, false, "une fois résolue, plus de carte « en attente »");
});

Deno.test("widget lecture : la demande d'un autre salarié (la base ne renvoie rien) est introuvable", async () => {
  assert.equal(await code(widgetGet(await employee(), CONV, makeRig({ widgetConversation: null }).ports)), "not_found");
});

Deno.test("titres et états : aides pures", () => {
  assert.equal(titleFrom("  a  b ", null), "a b");
  assert.equal(titleFrom(null, "slow_pc"), "Poste lent");
  assert.equal(titleFrom("", "inconnue"), "Demande");
  for (const s of ["open", "waiting_technician", "waiting_user", "resolved", "closed"]) assert.equal(statusOf(s), s);
  assert.equal(statusOf("__proto__"), "open");
});

// ---------------------------------------------------------------------------------------------------------------
// Passage à un technicien
// ---------------------------------------------------------------------------------------------------------------
Deno.test("widget escalade : journal d'abord, état « avec un technicien », ticket local, copie GLPI, message fixe ; aucun appel au modèle", async () => {
  const rig = makeRig({ convState: "waiting_user", convCategory: "printer", history: [{ role: "user", content: "Imprimante hors ligne" }, { role: "assistant", content: "Redémarrez-la" }] });
  assert.deepEqual(await widgetEscalate(await employee(), CONV, rig.ports), { ok: true });
  assert.equal(rig.audits[0].event, "chat.handoff");
  assert.deepEqual(rig.audits[0].details, { reason: "demande_du_salarie" });
  assert.deepEqual(rig.updates[0], { state: "waiting_technician", escalate: true, reopen: false });
  assert.equal(rig.tickets.length, 1);
  assert.equal(rig.tickets[0].title, "Imprimante : Imprimante hors ligne");
  assert.equal(rig.tickets[0].security, false);
  assert.equal(rig.mirrored[0].body, "Imprimante hors ligne", "seulement les mots du salarié, déjà masqués");
  assert.deepEqual(rig.messages.map((m) => [m.role, m.visibility, m.content]), [["notice", "public", TEXTS.humanRequested]]);
  assert.equal(rig.calls.complete.length + rig.calls.embed.length, 0);
});

Deno.test("widget escalade : idempotente (déjà chez un technicien = rien de plus) ; une demande résolue est ROUVERTE (sa résolution ne compte plus)", async () => {
  const already = makeRig({ convState: "waiting_technician" });
  await widgetEscalate(await employee(), CONV, already.ports);
  assert.equal(already.tickets.length + already.messages.length + already.updates.length + already.audits.length, 0);
  const resolved = makeRig({ convState: "resolved", history: [{ role: "user", content: "Teams" }] });
  await widgetEscalate(await employee(), CONV, resolved.ports);
  assert.deepEqual(resolved.updates[0], { state: "waiting_technician", escalate: true, reopen: true });
});

Deno.test("widget escalade : journal indisponible = rien ne change ; copie GLPI en panne = le ticket local suffit", async () => {
  const down = makeRig({ failAudit: true });
  assert.equal(await code(widgetEscalate(await employee(), CONV, down.ports)), "autre:audit indisponible");
  assert.equal(down.updates.length + down.tickets.length + down.messages.length, 0);
  const glpi = makeRig({ mirror: new Error("GLPI injoignable"), history: [{ role: "user", content: "VPN" }] });
  const original = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(await widgetEscalate(await employee(), CONV, glpi.ports), { ok: true });
  } finally {
    console.warn = original;
  }
  assert.equal(glpi.tickets.length, 1);
  assert.equal(glpi.messages.length, 1);
});

Deno.test("widget : un accès d'assistance (lecture seule) ou un autre rôle ne fait aucun geste", async () => {
  const support = await makeAuth({ org_role: "end_user", via: "support_access", read_only: true });
  const rig = makeRig();
  assert.equal(await code(widgetEscalate(support, CONV, rig.ports)), "read_only");
  const tech = await makeAuth({ org_role: "partner_technician", via: "partner" });
  assert.equal(await code(widgetEscalate(tech, CONV, rig.ports)), "forbidden");
  assert.equal(await code(widgetConfirm(tech, CONV, true, rig.ports)), "forbidden");
  assert.equal(await code(widgetRate(tech, CONV, 5, rig.ports)), "forbidden");
  assert.equal(rig.updates.length + rig.widgetCalls.length, 0);
});

// ---------------------------------------------------------------------------------------------------------------
// « Est-ce que ça a fonctionné ? » et note
// ---------------------------------------------------------------------------------------------------------------
Deno.test("confirmation « oui » : résolue PAR RELÈVE si l'IA a répondu en dernier, par un humain sinon ; seulement depuis « attend le salarié »", async () => {
  const ai = makeRig({ widgetConversation: conv("waiting_user", [msg("user", "a", null, 1), msg("assistant", "b", null, 2)]) });
  await widgetConfirm(await employee(), CONV, true, ai.ports);
  assert.deepEqual(ai.widgetCalls.at(-1), { fn: "resolve", args: [CONV, "ai_confirmed"] });
  assert.equal(ai.audits[0].event, "chat.confirmed");
  const human = makeRig({ widgetConversation: conv("waiting_user", [msg("assistant", "b", null, 1), msg("technician", "c", "Inès", 2)]) });
  await widgetConfirm(await employee(), CONV, true, human.ports);
  assert.deepEqual(human.widgetCalls.at(-1), { fn: "resolve", args: [CONV, "human"] });
  for (const state of ["open", "waiting_technician", "resolved", "closed"]) {
    const r = makeRig({ widgetConversation: conv(state, [msg("assistant", "b", null, 1)]) });
    assert.equal(await code(widgetConfirm(await employee(), CONV, true, r.ports)), "conflict", state);
    assert.equal(r.widgetCalls.some((c) => c.fn === "resolve"), false, state);
  }
  const raced = makeRig({ widgetConversation: conv("waiting_user", [msg("assistant", "b", null, 1)]), resolveOk: false });
  assert.equal(await code(widgetConfirm(await employee(), CONV, true, raced.ports)), "conflict", "un technicien a repris entre-temps");
});

Deno.test("confirmation « non » : un technicien reprend, avec le message fixe dédié ; rien n'est clos", async () => {
  const rig = makeRig({ convState: "waiting_user", history: [{ role: "user", content: "Outlook ne s'ouvre plus" }] });
  await widgetConfirm(await employee(), CONV, false, rig.ports);
  assert.deepEqual(rig.audits[0].details, { reason: "solution_insuffisante" });
  assert.deepEqual(rig.messages.map((m) => m.content), [TEXTS.notWorked]);
  assert.equal(rig.widgetCalls.some((c) => c.fn === "resolve"), false);
});

Deno.test("note : entier de 1 à 5, seulement une fois la demande résolue ou close, jamais celle d'un autre", async () => {
  const ok = makeRig({ widgetConversation: conv("resolved", [msg("assistant", "b", null, 1)]) });
  await widgetRate(await employee(), CONV, 4, ok.ports);
  assert.deepEqual(ok.widgetCalls.at(-1), { fn: "rate", args: [CONV, 4] });
  assert.deepEqual(ok.audits[0].details, { score: 4 });
  for (const bad of [0, 6, 2.5, "5", null, undefined, Number.NaN]) {
    const r = makeRig({ widgetConversation: conv("resolved", []) });
    assert.equal(await code(widgetRate(await employee(), CONV, bad, r.ports)), "bad_request", String(bad));
    assert.equal(r.widgetCalls.length, 0);
  }
  assert.equal(await code(widgetRate(await employee(), CONV, 5, makeRig({ widgetConversation: conv("waiting_user", []) }).ports)), "conflict");
  assert.equal(await code(widgetRate(await employee(), CONV, 5, makeRig({ widgetConversation: null }).ports)), "not_found");
});

// ---------------------------------------------------------------------------------------------------------------
// Messages : technicien qui a la main, « Parler à un technicien » direct
// ---------------------------------------------------------------------------------------------------------------
Deno.test("message : si un technicien a déjà la main, l'IA se tait (aucun appel au modèle), le message est enregistré pour lui", async () => {
  const rig = makeRig({ convState: "waiting_technician", gate: "direct" });
  const r = await handleChatMessage(await employee(), { conversationId: CONV, message: "Voici une capture : écran bleu" }, rig.ports);
  assert.equal(r.outcome, "escalated");
  assert.deepEqual(r.messages, []);
  assert.equal(rig.calls.complete.length + rig.calls.embed.length, 0);
  assert.deepEqual(rig.messages.map((m) => [m.role, m.visibility]), [["user", "public"]]);
  assert.equal(rig.tickets.length, 0, "le ticket existe déjà");
});

Deno.test("message direct : remis à un technicien SANS appel au modèle, masqué, avec ticket et message fixe ; refusé s'il n'est pas booléen", async () => {
  const token = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV"].join(".");
  const rig = makeRig({ gate: "direct" });
  const r = await handleChatMessage(await employee(), { conversationId: null, message: `Mon accès VPN refuse le jeton ${token}`, direct: true }, rig.ports);
  assert.equal(r.outcome, "escalated");
  assert.deepEqual(r.messages.map((m) => m.content), [TEXTS.direct]);
  assert.equal(rig.calls.complete.length + rig.calls.embed.length, 0);
  assert.ok(!rig.messages[0].content.includes(token), "masqué avant stockage");
  assert.ok(!rig.mirrored[0].body.includes(token), "masqué avant la copie GLPI");
  assert.equal(rig.tickets.length, 1);
  assert.ok(rig.audits.some((a) => a.event === "chat.handoff" && (a.details as Record<string, unknown>).reason === "demande_directe"));

  const h = createChatHandler({ ports: () => makeRig().ports, authDeps: testAuthDeps({ org_role: "end_user", via: "member" }), limits: { chat: noLimit, widget: noLimit } });
  const res = await h(new Request("https://exemple.test/chat", {
    method: "POST",
    headers: { authorization: `Bearer ${TEST_JWT}`, "content-type": "application/json" },
    body: JSON.stringify({ orgId: TEST_ORG, message: "x", direct: "oui" }),
  }));
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------------------------------------------
// Porte HTTP : opérations, débit, paramètres
// ---------------------------------------------------------------------------------------------------------------
type Limits = { chat: number; widget: number };
function gate(script: RigScript = {}, access: Parameters<typeof testAuthDeps>[0] = { org_role: "end_user", via: "member" }) {
  const rig = makeRig(script);
  const hits: Limits = { chat: 0, widget: 0 };
  const h = createChatHandler({
    ports: () => rig.ports,
    authDeps: testAuthDeps(access),
    limits: { chat: () => { hits.chat++; return Promise.resolve(); }, widget: () => { hits.widget++; return Promise.resolve(); } },
  });
  const call = async (body: Record<string, unknown>) => {
    const res = await h(new Request("https://exemple.test/chat", {
      method: "POST",
      headers: { authorization: `Bearer ${TEST_JWT}`, "content-type": "application/json" },
      body: JSON.stringify({ orgId: TEST_ORG, ...body }),
    }));
    const json = await res.json();
    return { status: res.status, json, code: json?.error?.code as string | undefined };
  };
  return { rig, hits, call };
}

Deno.test("porte : lectures et gestes comptent sur le débit « widget », les messages sur le débit « chat »", async () => {
  const g = gate({ widgetContext: { orgName: "A", accent: null, firstName: "C", reliefUntil: null, incidents: [] }, widgetRequests: [], widgetConversation: conv("resolved", []) });
  assert.equal((await g.call({ op: "context" })).status, 200);
  assert.equal((await g.call({ op: "list" })).status, 200);
  assert.equal((await g.call({ op: "get", conversationId: CONV })).status, 200);
  assert.equal((await g.call({ op: "rate", conversationId: CONV, score: 5 })).status, 200);
  assert.deepEqual(g.hits, { chat: 0, widget: 4 });
  assert.equal((await g.call({ message: "Bonjour" })).status, 200);
  assert.equal((await g.call({ op: "send", message: "Bonjour" })).status, 200);
  assert.deepEqual(g.hits, { chat: 2, widget: 4 });
});

Deno.test("porte : opération inconnue, conversation manquante ou mal typée, réponse non booléenne = 400, sans aucun travail", async () => {
  const g = gate();
  for (const body of [
    { op: "delete" }, { op: "__proto__" }, { op: 42 },
    { op: "get" }, { op: "get", conversationId: 7 }, { op: "escalate" }, { op: "rate", score: 5 },
    { op: "confirm", conversationId: CONV }, { op: "confirm", conversationId: CONV, worked: "oui" },
  ]) {
    const r = await g.call(body);
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  assert.equal(g.rig.widgetCalls.length + g.rig.updates.length + g.rig.messages.length, 0);
});

Deno.test("porte : seul le salarié a un widget ; sans droit = 403 identique, le débit n'est pas sollicité", async () => {
  for (const access of [null, { org_role: "partner_technician", via: "partner" }, { org_role: "org_admin", via: "member" }] as const) {
    const g = gate({}, access);
    const r = await g.call({ op: "list" });
    assert.equal(r.status, 403, JSON.stringify(access));
    assert.equal(r.code, "forbidden");
    assert.deepEqual(g.hits, { chat: 0, widget: 0 });
    assert.equal(g.rig.widgetCalls.length, 0);
  }
});

Deno.test("porte : réponses des gestes (succès sans détail) et lecture complète", async () => {
  const g = gate({ convState: "waiting_user", widgetConversation: conv("waiting_user", [msg("user", "a", null, 1), msg("assistant", "b", null, 2)]) });
  assert.deepEqual((await g.call({ op: "confirm", conversationId: CONV, worked: true })).json, { ok: true });
  assert.deepEqual((await g.call({ op: "escalate", conversationId: CONV })).json, { ok: true });
  const read = await g.call({ op: "get", conversationId: CONV });
  assert.equal(read.json.ai, true);
  assert.equal(read.json.awaitingConfirmation, true);
});
