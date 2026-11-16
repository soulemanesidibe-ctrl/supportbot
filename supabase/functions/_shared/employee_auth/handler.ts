// Fonction « employee-auth » : connexion du salarié au widget (docs/spec-mvp.md § 5.3). Trois opérations, rien d'autre :
//   org          (sans connexion) : nom et couleur d'un client activé désigné par l'adresse du widget, ou « introuvable » ;
//   request_code (sans connexion) : un code part SI l'adresse est active dans la liste des salariés. La réponse est la MÊME dans
//                 tous les cas, et elle part AVANT tout travail (vérification, débit, envoi faits ensuite) : ni le contenu ni la
//                 durée de la réponse ne disent si l'adresse est connue (aucune énumération des salariés) ;
//   link         (après le code)  : rattache la personne du jeton à sa ligne d'annuaire et donne l'organisation au widget.
// Le code lui-même est vérifié par la passerelle de session (app/server/session.ts), qui garde le jeton de rafraîchissement dans un
// cookie HttpOnly : il n'arrive jamais ici ni dans le navigateur.
import { AuthDeps, requestIdFrom, requireUser } from "../auth.ts";
import type { AuthContext } from "../context.ts";
import { employeeLinkRpc, sendEmployeeCode, signInRateRpc, widgetSignInRpc } from "../db.ts";
import { errorResponse, Errors } from "../errors.ts";
import { jsonResponse, readJsonBody } from "../http.ts";
import { log } from "../log.ts";
import type { Limiter } from "../ratelimit.ts";

const MAX_BODY_BYTES = 2_000;
const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Codes demandés : 5 par adresse et par quart d'heure, 60 par organisation et par minute (provisoire, à calibrer au pilote). */
export const CODE_LIMITS = { email: { windowSeconds: 900, limit: 5 }, org: { windowSeconds: 60, limit: 60 } } as const;

export interface EmployeeAuthDeps {
  publicOrg(requestId: string, slug: string): Promise<{ name: string; accent: string | null } | null>;
  codeAllowed(requestId: string, slug: string, email: string): Promise<boolean>;
  /** Vrai si la demande passe sous la limite. */
  hit(requestId: string, key: string, rule: { windowSeconds: number; limit: number }): Promise<boolean>;
  sendCode(requestId: string, email: string): Promise<void>;
  link(auth: AuthContext, slug: string): Promise<string | null>;
  /** Travail fait APRÈS la réponse (EdgeRuntime.waitUntil en production ; attendu tout de suite dans les tests). */
  defer(work: Promise<unknown>): void;
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

function slugOf(v: unknown): string {
  if (typeof v !== "string") throw Errors.badRequest("Adresse de support invalide.");
  return v.trim().toLowerCase();
}

/** Ce qui se passe après la réponse : débit, vérification dans l'annuaire, envoi. Aucune issue n'est visible de l'appelant. */
export async function codeWork(deps: EmployeeAuthDeps, requestId: string, slug: string, email: string): Promise<"sent" | "limited" | "refused"> {
  if (!SLUG.test(slug) || !EMAIL.test(email)) return "refused";
  const emailKey = `otp:e:${(await sha256Hex(email)).slice(0, 48)}`;
  if (!(await deps.hit(requestId, `otp:o:${slug}`, CODE_LIMITS.org))) return "limited";
  if (!(await deps.hit(requestId, emailKey, CODE_LIMITS.email))) return "limited";
  if (!(await deps.codeAllowed(requestId, slug, email))) return "refused";
  await deps.sendCode(requestId, email);
  return "sent";
}

export function createEmployeeAuthHandler(opts: { deps: () => EmployeeAuthDeps; authDeps?: AuthDeps; limit: Limiter }): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const requestId = requestIdFrom(req);
    try {
      if (req.method !== "POST") throw Errors.methodNotAllowed();
      const body = await readJsonBody(req, MAX_BODY_BYTES);
      const deps = opts.deps();
      switch (body.op) {
        case "org": {
          const slug = slugOf(body.slug);
          const org = SLUG.test(slug) ? await deps.publicOrg(requestId, slug) : null;
          if (!org) throw Errors.notFound(); // inconnu, ESN, client non activé ou suspendu : la même réponse
          return jsonResponse(200, { name: org.name, brand: org.accent ? { name: org.name, accent: org.accent } : { name: org.name } }, requestId);
        }
        case "request_code": {
          const slug = slugOf(body.slug);
          if (typeof body.email !== "string" || body.email.length > 320) throw Errors.badRequest("Adresse invalide.");
          const email = body.email.trim().toLowerCase();
          // La réponse ne dépend de RIEN de ce qui suit : elle part tout de suite, le travail continue après.
          deps.defer(codeWork(deps, requestId, slug, email).then(
            (outcome) => log.info("code_salarie", { outcome, requestId }),
            (e) => log.warn("code_salarie_en_echec", { erreur: e, requestId }),
          ));
          return jsonResponse(200, { ok: true }, requestId);
        }
        case "link": {
          const auth = await requireUser(req, opts.authDeps); // le code vient d'être vérifié : session sans second facteur, c'est attendu
          await opts.limit(auth);
          const slug = slugOf(body.slug);
          if (!SLUG.test(slug)) throw Errors.forbidden();
          const orgId = await deps.link(auth, slug);
          if (orgId === null || !UUID.test(orgId)) throw Errors.forbidden(); // absent de l'annuaire, personnel, accès retiré : même refus
          return jsonResponse(200, { orgId }, auth.requestId);
        }
        default:
          throw Errors.badRequest("Opération inconnue.");
      }
    } catch (e) {
      return errorResponse(e, requestId);
    }
  };
}

/** Branchement de production sur les portes étroites de db.ts. */
export function defaultEmployeeAuthDeps(): EmployeeAuthDeps {
  return {
    publicOrg: async (requestId, slug) => {
      const { data, error } = await widgetSignInRpc(requestId, { fn: "widget_public_org", slug });
      if (error) throw Errors.unavailable();
      if (data === null || typeof data !== "object" || typeof (data as Record<string, unknown>).name !== "string") return null;
      const d = data as Record<string, unknown>;
      return { name: d.name as string, accent: typeof d.accent === "string" ? d.accent : null };
    },
    codeAllowed: async (requestId, slug, email) => {
      const { data, error } = await widgetSignInRpc(requestId, { fn: "widget_code_allowed", slug, email });
      if (error) throw Errors.unavailable();
      return typeof data === "string" && UUID.test(data);
    },
    hit: async (requestId, key, rule) => {
      const { data, error } = await signInRateRpc(requestId, { key, ...rule });
      if (error) throw Errors.unavailable(); // échec fermé : sans compteur, pas d'envoi
      return data === true;
    },
    sendCode: (requestId, email) => sendEmployeeCode(requestId, email),
    link: async (auth, slug) => {
      const { data, error } = await employeeLinkRpc(auth, slug);
      if (error) throw Errors.unavailable();
      return typeof data === "string" ? data : null;
    },
    defer: (work) => {
      const rt = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
      if (rt) rt.waitUntil(work);
      else void work;
    },
  };
}
