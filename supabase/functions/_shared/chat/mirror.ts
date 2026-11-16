// Copie d'un ticket local vers le connecteur de ticketing de l'organisation (GLPI). Règles :
//   - idempotente : un ticket déjà copié (référence externe connue) n'est jamais recopié ;
//   - sans connecteur de ticketing actif, rien à faire (le ticket local suffit) ;
//   - passe par callCapability (classe « autonomous » de ticket.create, audit, organisation gelée refusée) ;
//   - seul le message DÉJÀ MASQUÉ du salarié et un résumé borné du diagnostic sortent : jamais la conversation, jamais un secret.
import { CallDeps, callCapability } from "../capabilities/call.ts";
import { AuthContext } from "../context.ts";
import { DbDeps, serviceClient } from "../db.ts";
import { Errors } from "../errors.ts";
import { Connector } from "../capabilities/types.ts";
import type { MirrorTicket } from "./types.ts";

export interface MirrorDeps {
  connectorFor(auth: AuthContext): Promise<Connector | null>;
  /** E-mail du salarié de la conversation (annuaire), ou null. */
  requesterOf(auth: AuthContext, conversationId: string): Promise<string | null>;
  call?: Omit<CallDeps, "connectorFor">;
  db?: DbDeps;
}

const SUMMARY_KEYS = ["reason", "intent", "step", "gate", "prepared", "requested_action", "not_prepared_reason", "flags"] as const;

/** Résumé court et sans contenu libre des constats de Relève : uniquement des motifs et des états fixes. */
export function diagnosticSummary(d: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const k of SUMMARY_KEYS) {
    const v = d[k];
    if (v === undefined || v === null) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") lines.push(`${k} : ${String(v).slice(0, 80)}`);
    else if (Array.isArray(v) && v.every((x) => typeof x === "string")) lines.push(`${k} : ${v.slice(0, 8).map((x) => String(x).slice(0, 20)).join(", ")}`);
  }
  return lines.join("\n").slice(0, 1500);
}

export async function mirrorTicket(auth: AuthContext, t: MirrorTicket, deps: MirrorDeps): Promise<void> {
  if (auth.orgId === null) throw Errors.forbidden();
  const db = serviceClient(auth, deps.db);
  const current = await db.from("tickets").select("external_ref").eq("id", t.ticketId).eq("org_id", auth.orgId).maybeSingle();
  if (current.error) throw Errors.unavailable();
  const row = current.data as { external_ref: string | null } | null;
  if (!row || row.external_ref) return; // introuvable ici, ou déjà copié

  const connector = await deps.connectorFor(auth);
  if (!connector) return;
  const requesterRef = (await deps.requesterOf(auth, t.conversationId)) ?? "inconnu";
  const created = await callCapability(auth, "ticket.create", {
    title: t.title, body: t.body, category: t.category, priority: t.priority, requesterRef, diagnosticSummary: diagnosticSummary(t.diagnostic),
  }, { conversationId: t.conversationId, requesterRef }, { connectorFor: () => Promise.resolve(connector), ...deps.call });

  // Écriture conditionnelle : seulement si le ticket n'a toujours pas de référence (deux copies simultanées : la seconde est sans effet).
  const { error } = await serviceClient(auth, deps.db).from("tickets")
    .update({ external_ref: created.ref, external_url: created.url, connector_id: connector.id })
    .eq("id", t.ticketId).eq("org_id", auth.orgId).is("external_ref", null);
  if (error) throw Errors.unavailable();
}
