// Traitement d'UN message du salarié (docs/spec-mvp.md § 10.1). Ordre, et pourquoi :
//   1. contrôles de droits (déjà faits par requireOrgMember ; on revérifie le contexte) ;
//   2. message normalisé (caractères cachés retirés, taille bornée) puis MASQUÉ avant tout stockage ou envoi (règle n° 2) ;
//   3. le message du salarié est enregistré d'abord : même si tout le reste échoue, un technicien le verra ;
//   4. arrêt d'urgence : aucun appel au modèle ;
//   5. tri par le modèle léger : catégorie, intention, urgence, indicateur de manipulation ;
//   6. manipulation (modèle OU indices déterministes) : réponse neutre, ticket de sécurité, aucun appel de réponse ;
//   7. action sur un compte : jamais traitée ici, un technicien vérifie l'identité ;
//   8. recherche dans la base de connaissance de CETTE organisation, puis réponse du modèle moyen sur ces seules fiches ;
//   9. sortie validée (forme JSON stricte, sources fournies, garde-fous) : au moindre doute, le brouillon reste au technicien ;
//  10. porte de catégorie : le salarié ne reçoit un texte de l'IA que si la catégorie est OUVERTE ; sinon il reçoit un message fixe
//      et le technicien reçoit le brouillon à noter (mode ombre). La base l'impose aussi (déclencheur) : ici on ne tente même pas.
// Tout échec d'un maillon (modèle injoignable, sortie invalide, base) aboutit à « un technicien reprend », jamais à une réponse improvisée.
import { redactText } from "../redact.ts";
import { AuthContext } from "../context.ts";
import { Errors } from "../errors.ts";
import { log } from "../log.ts";
import { injectionSignals, checkOutput } from "../llm/guards.ts";
import { SYSTEM_ANSWER, SYSTEM_TRIAGE } from "../llm/prompts.ts";
import { promptInfo } from "../llm/prompt_registry.ts";
import { Answer, parseAnswer, parseTriage, Triage } from "../llm/schemas.ts";
import { CompletionResult, LlmError } from "../llm/types.ts";
import { sanitizeExternal, wrapExternal } from "../llm/wrap.ts";
import { CATEGORY_LABELS, TEXTS } from "./texts.ts";
import type { PrepareResult } from "../actions/prepare.ts";
import type { ChatInput, ChatOutcome, ChatPorts, ChatResult, GateState, KbHit, PublicMessage } from "./types.ts";

export const MAX_MESSAGE_CHARS = 4000;
export const MAX_CONVERSATION_MESSAGES = 200;
const HISTORY_TURNS = 6;
const KB_LIMIT = 4;
/** Seuil de similarité : PROVISOIRE, à calibrer sur le jeu réel (jalon J6). En dessous, aucune fiche n'est transmise au modèle. */
export const KB_MIN_SCORE = 0.5;
const KB_CHUNK_CHARS = 1500;

const URGENCY: Record<Triage["urgency"], "low" | "normal" | "high" | "urgent"> = { low: "low", normal: "normal", high: "high", critical: "urgent" };

function normalizeMessage(m: unknown): string {
  if (typeof m !== "string") throw Errors.badRequest("Message invalide.");
  const t = sanitizeExternal(m).trim();
  if (t.length === 0 || t.length > MAX_MESSAGE_CHARS) throw Errors.badRequest("Message vide ou trop long (4 000 caractères au plus).");
  return t;
}

async function bestEffort(f: () => Promise<unknown>): Promise<void> {
  try {
    await f();
  } catch (e) {
    log.warn("chat_best_effort_echec", { erreur: e });
  }
}

type ModelStep = { ok: true; result: CompletionResult } | { ok: false; kind: string };

export async function handleChatMessage(auth: AuthContext, input: ChatInput, ports: ChatPorts): Promise<ChatResult> {
  // L'IA répond à une personne authentifiée d'une organisation : jamais à un accès d'assistance, jamais sans organisation.
  if (auth.kind !== "user" || auth.orgId === null || auth.userId === null) throw Errors.forbidden();
  if (auth.readOnly) throw Errors.readOnly();
  const signals = injectionSignals(typeof input.message === "string" ? input.message : "");
  const raw = normalizeMessage(input.message);
  const clean = redactText(raw);

  const conv = await ports.store.openConversation(auth, input.conversationId);
  if (conv.messageCount >= MAX_CONVERSATION_MESSAGES) throw Errors.conflict("Cette conversation est trop longue : ouvrez-en une nouvelle.");
  // Enregistré AVANT tout le reste : quoi qu'il arrive ensuite, un technicien verra la demande.
  await ports.store.addMessage(auth, conv.id, { role: "user", visibility: "public", content: clean, redactions: clean === raw ? 0 : 1 });

  const out: PublicMessage[] = [];
  // Dernier appel au modèle : conservé dans un objet (et non une variable réaffectée dans une fermeture) pour que le typage le suive.
  const last: { model: CompletionResult | null; prompt?: string } = { model: null };
  const say = async (content: string): Promise<void> => {
    const { id } = await ports.store.addMessage(auth, conv.id, { role: "notice", visibility: "public", content });
    out.push({ id, role: "notice", content });
  };
  const finish = async (outcome: ChatOutcome, category: string | null, extra: Record<string, unknown> = {}): Promise<ChatResult> => {
    await ports.audit(auth, {
      event: "chat.outcome",
      actorKind: "agent",
      subjectType: "conversation",
      subjectId: conv.id,
      details: { outcome, category, ...extra },
    });
    return { conversationId: conv.id, outcome, category, messages: out, ai: true };
  };

  try {
    // ---- 4. arrêt d'urgence
    if (auth.frozen) {
      await say(TEXTS.frozen);
      await ports.store.updateConversation(auth, conv.id, { state: "waiting_technician", escalate: true });
      return await finish("frozen", null);
    }

    const handover = async (
      category: string,
      urgency: "low" | "normal" | "high" | "urgent",
      outcome: ChatOutcome,
      publicText: string,
      diagnostic: Record<string, unknown>,
      opts: { security?: boolean; draft?: string; technicianNote?: string } = {},
    ): Promise<ChatResult> => {
      if (opts.draft) {
        await ports.store.addMessage(auth, conv.id, {
          role: "assistant",
          visibility: "technician",
          content: redactText(opts.draft),
          model: last.model?.model,
          promptVersion: last.prompt,
          latencyMs: last.model?.latencyMs,
        });
      }
      if (opts.technicianNote) await ports.store.addMessage(auth, conv.id, { role: "notice", visibility: "technician", content: opts.technicianNote });
      const snippet = clean.replace(/\s+/g, " ").slice(0, 100);
      await ports.store.createTicket(auth, {
        conversationId: conv.id,
        title: `${CATEGORY_LABELS[category] ?? "Demande"} : ${snippet}`,
        category,
        priority: opts.security ? "high" : urgency,
        diagnostic,
        security: opts.security === true,
      });
      await ports.store.updateConversation(auth, conv.id, { state: "waiting_technician", escalate: true });
      await say(publicText);
      return await finish(outcome, category, { reason: diagnostic.reason });
    };


    const callModel = async (purpose: "triage" | "answer", system: typeof SYSTEM_TRIAGE, content: string, maxTokens: number, temperature: number): Promise<ModelStep> => {
      try {
        const result = await ports.llm.complete({ purpose, system, messages: [{ role: "user", content }], maxTokens, temperature, json: true, priority: "interactive" });
        await ports.usage.call(auth, { purpose, result, system, conversationId: conv.id, attempts: result.attempts });
        last.model = result;
        const p = promptInfo(system);
        last.prompt = p ? `${p.id}@${p.version}` : undefined;
        return { ok: true, result };
      } catch (e) {
        if (e instanceof LlmError) {
          await bestEffort(() => ports.usage.failure(auth, purpose, e.kind));
          return { ok: false, kind: e.kind };
        }
        throw e; // une erreur applicative (par exemple l'audit indisponible) remonte : on n'agit pas sans trace
      }
    };

    // ---- 5. tri
    const t = await callModel("triage", SYSTEM_TRIAGE, wrapExternal("message", clean), 150, 0);
    const triage = t.ok ? parseTriage(t.result.text) : null;
    if (!triage) {
      const reason = t.ok ? "reponse_invalide" : "modele_indisponible";
      return await handover("other", "normal", "escalated", TEXTS.escalated, { reason, step: "triage", signals }, { technicianNote: `Tri impossible (${reason}).` });
    }
    const category = triage.category;
    const urgency = URGENCY[triage.urgency];
    await ports.store.updateConversation(auth, conv.id, { category, urgency });

    // ---- 6. manipulation
    if (triage.manipulation || signals.length > 0) {
      return await handover(category, "high", "suspect", TEXTS.suspect, { reason: "manipulation", model_flag: triage.manipulation, signals, intent: triage.intent }, {
        security: true,
        technicianNote: "Demande signalée comme suspecte (tentative de manipulation). Aucune réponse de l'IA n'a été produite.",
      });
    }

    // ---- 7. action sur un compte : jamais EXÉCUTÉE ici. L'IA peut seulement PRÉPARER une demande que des humains valideront.
    if (triage.intent === "account_action") {
      let prepared: PrepareResult | null = null;
      if (triage.requestedAction !== "none") {
        try {
          prepared = await ports.actions.prepare(auth, { conversationId: conv.id, requested: triage.requestedAction });
        } catch (e) {
          // Toute panne de la préparation laisse la demande à un technicien, qui traite à la main après vérification d'identité.
          log.warn("chat_preparation_action_en_echec", { erreur: e });
        }
      }
      if (prepared?.status === "suspicious") {
        return await handover(category, "high", "suspect", TEXTS.suspect, { reason: "demande_suspecte", flags: prepared.flags, intent: triage.intent }, {
          security: true,
          technicianNote: `Demande d'action sur un compte jugée SUSPECTE par les règles de risque (${prepared.flags.join(", ")}). Aucune action préparée.`,
        });
      }
      const note = prepared?.status === "prepared"
        ? `Demande d'action PRÉPARÉE (n° ${prepared.actionId}) : vérifiez l'identité du salarié par un autre moyen, puis validez dans la boîte de validation.`
        : `Aucune action préparée (${prepared?.status === "not_prepared" ? prepared.reason : "non demandée ou préparation impossible"}) : traitez à la main après vérification d'identité.`;
      return await handover(category, urgency, "account_action", TEXTS.accountAction, {
        reason: "action_sur_compte",
        intent: triage.intent,
        confidence: triage.confidence,
        requested_action: triage.requestedAction,
        prepared: prepared?.status ?? "aucune",
        action_request: prepared?.status === "prepared" ? prepared.actionId : null,
        not_prepared_reason: prepared?.status === "not_prepared" ? prepared.reason : null,
      }, { technicianNote: note });
    }

    // ---- 8. recherche dans la base de connaissance de l'organisation, puis réponse
    let hits: readonly KbHit[] = [];
    try {
      const e = await ports.llm.embed([clean], "interactive");
      await ports.usage.call(auth, { purpose: "embedding", result: { model: e.model, latencyMs: e.latencyMs, tokensIn: e.tokensIn } });
      hits = await ports.store.searchKb(auth, e.vectors[0], KB_LIMIT, KB_MIN_SCORE);
    } catch (e) {
      if (!(e instanceof LlmError)) throw e;
      await bestEffort(() => ports.usage.failure(auth, "embedding", e.kind));
      return await handover(category, urgency, "escalated", TEXTS.escalated, { reason: "modele_indisponible", step: "embedding", triage }, { technicianNote: "Recherche impossible (modèle indisponible)." });
    }
    if (hits.length === 0) {
      return await handover(category, urgency, "escalated", TEXTS.escalated, { reason: "aucune_fiche", triage }, { technicianNote: "Aucune fiche de la base de connaissance ne correspond : l'IA n'a pas tenté de répondre." });
    }

    const history = await ports.store.history(auth, conv.id, HISTORY_TURNS);
    const blocks = hits.map((h) => wrapExternal("fiche", `identifiant: ${h.documentId}\ntitre: ${h.title}\n${h.text.slice(0, KB_CHUNK_CHARS)}`));
    if (history.length > 0) {
      blocks.push(wrapExternal("historique", history.map((m) => `${m.role === "user" ? "salarié" : "relève"} : ${m.content}`).join("\n")));
    }
    blocks.push(wrapExternal("message", clean));
    const a = await callModel("answer", SYSTEM_ANSWER, blocks.join("\n\n"), 700, 0.2);
    if (!a.ok) {
      return await handover(category, urgency, "escalated", TEXTS.escalated, { reason: "modele_indisponible", step: "reponse", triage }, { technicianNote: "Réponse impossible (modèle indisponible)." });
    }
    const answer: Answer | null = parseAnswer(a.result.text, hits.map((h) => h.documentId));
    if (!answer) {
      return await handover(category, urgency, "escalated", TEXTS.escalated, { reason: "reponse_invalide", step: "reponse", triage }, { technicianNote: "Sortie du modèle invalide (forme, source inventée ou incohérence) : écartée, non conservée." });
    }

    // ---- 9. contrôle de la sortie
    const check = checkOutput(answer.answer);
    if (!check.ok) {
      return await handover(category, urgency, "escalated", TEXTS.escalated, { reason: "sortie_bloquee", violations: check.violations, triage }, {
        draft: answer.answer,
        technicianNote: `Brouillon de l'IA BLOQUÉ par les garde-fous (${check.violations.join(", ")}). Il n'a pas été montré au salarié.`,
      });
    }
    if (!answer.knows || answer.escalate) {
      return await handover(category, urgency, "escalated", TEXTS.escalated, { reason: answer.escalate ? "escalade_demandee" : "ne_sait_pas", triage, sources: answer.sources }, { draft: answer.answer });
    }

    // ---- 10. porte de catégorie
    let gate: GateState = "shadow"; // échec fermé : sans réponse de la base, on reste en mode ombre
    try {
      gate = await ports.store.gateState(auth, category);
    } catch (e) {
      log.warn("chat_porte_illisible", { erreur: e });
    }
    if (gate === "direct") {
      try {
        const { id } = await ports.store.addMessage(auth, conv.id, {
          role: "assistant",
          visibility: "public",
          content: redactText(answer.answer),
          model: last.model?.model,
          promptVersion: last.prompt,
          latencyMs: last.model?.latencyMs,
        });
        out.push({ id, role: "assistant", content: redactText(answer.answer) });
        await ports.store.updateConversation(auth, conv.id, { state: "waiting_user" });
        return await finish("answered", category, { gate, sources: answer.sources, confidence: triage.confidence });
      } catch (e) {
        // La base a refusé (catégorie refermée entre-temps, organisation gelée) : on retombe en mode ombre, sans rien montrer.
        log.warn("chat_reponse_publique_refusee", { erreur: e });
        gate = "shadow";
      }
    }
    return await handover(category, urgency, "shadow", TEXTS.shadow, { reason: "mode_ombre", gate, triage, sources: answer.sources }, { draft: answer.answer });
  } catch (e) {
    // Quoi qu'il arrive, la conversation n'est pas laissée sans responsable : un technicien la verra.
    await bestEffort(() => ports.store.updateConversation(auth, conv.id, { state: "waiting_technician", escalate: true }));
    throw e;
  }
}
