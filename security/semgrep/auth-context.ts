// Fixtures de auth-context.yml. `ruleid:` = la ligne suivante DOIT être signalée, `ok:` = non.
// Rien ici ne s'exécute : ce fichier n'est ni compilé ni déployé.
// @ts-nocheck
// ruleid: releve-mint-context-outside-auth
import { mintContext } from "./context.ts";
// ruleid: releve-mint-context-outside-auth
import { createAccessResolver } from "./db.ts";
// ok: releve-mint-context-outside-auth
import { requireOrgMember, serviceClient } from "./auth.ts";

declare const fields: any;
declare const user: any;

// ruleid: releve-mint-context-outside-auth
const forged = mintContext({ kind: "user", userId: "x" });
// ruleid: releve-mint-context-outside-auth
const resolver = createAccessResolver();

// ruleid: releve-auth-context-cast
const a1 = { userId: "x", orgId: "y" } as AuthContext;
// ruleid: releve-auth-context-cast
const a2 = user as unknown as AuthContext;
// ok: releve-auth-context-cast
const a4 = user as Record<string, unknown>;
// ok: releve-auth-context-cast
const a5: AuthContext = await requireOrgMember(req, org);
