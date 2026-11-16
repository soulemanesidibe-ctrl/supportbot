// Porte HTTP de la fonction `admin`. Ordre fixe, jamais modifié par la requête :
//   méthode → corps borné → opération CONNUE (liste fermée) → authentification et rôle → lecture stricte des champs
//   → écriture permise (pas de lecture seule, pas d'arrêt d'urgence sauf opération qui RESTREINT) → second facteur récent
//   → trace d'audit (avant d'agir) → opération.
import { AuthDeps, requireOrgMember, requireRecentMfa, requestIdFrom, requireUserWithEmail } from "../auth.ts";
import { AuthContext } from "../context.ts";
import { auditEvent } from "../audit.ts";
import { errorResponse, Errors } from "../errors.ts";
import { jsonResponse, readJsonBody } from "../http.ts";
import { ADMIN_OPS } from "./ops.ts";
import { AdminDeps } from "./types.ts";

const MAX_BODY_BYTES = 20_000;
const MFA_MAX_AGE_SECONDS = 600;

export function createAdminHandler(opts: { deps: () => AdminDeps; authDeps?: AuthDeps }): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const requestId = requestIdFrom(req);
    try {
      if (req.method !== "POST") throw Errors.methodNotAllowed();
      const body = await readJsonBody(req, MAX_BODY_BYTES);
      const name = typeof body.op === "string" ? body.op : "";
      const op = ADMIN_OPS.get(name);
      if (!op) throw Errors.badRequest("Opération inconnue.");

      let auth: AuthContext;
      let verifiedEmail: string | null = null;
      if (op.scope === "user") {
        const who = await requireUserWithEmail(req, opts.authDeps);
        auth = who.auth;
        verifiedEmail = who.email;
      } else {
        // L'organisation du corps n'est qu'une DEMANDE : la base décide du rôle et de la voie d'accès.
        auth = await requireOrgMember(req, typeof body.orgId === "string" ? body.orgId : "", op.roles, opts.authDeps);
        if (op.via === "member" && auth.via !== "member") throw Errors.forbidden();
      }

      const input = op.parse(body);

      if (auth.readOnly) throw Errors.readOnly();
      if (auth.frozen && !op.allowWhenFrozen) throw Errors.orgFrozen();
      const needsMfa = typeof op.mfa === "function" ? op.mfa(input) : op.mfa;
      if (needsMfa) requireRecentMfa(auth, MFA_MAX_AGE_SECONDS, opts.authDeps);

      // Pas d'action sans trace : si le journal ne répond pas, rien n'est fait. Aucun paramètre n'y est copié (un jeton, une adresse e-mail).
      const deps = opts.deps();
      // Une personne qui accepte une invitation n'a pas encore d'organisation : pas d'écriture d'audit applicative possible ici. La base
      // journalise elle-même l'appartenance créée et l'invitation consommée (déclencheurs d'audit, acteur posé par la porte étroite).
      if (op.scope === "org") await auditEvent(auth, { event: `admin.${name}`, subjectType: "admin_op" }, deps.db);
      const result = await op.run(auth, input, deps, verifiedEmail);
      return jsonResponse(200, result, auth.requestId);
    } catch (e) {
      return errorResponse(e, requestId);
    }
  };
}
