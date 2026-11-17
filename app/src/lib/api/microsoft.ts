// Jeton Microsoft DÉLÉGUÉ du technicien qui valide (docs/permissions-graph.md § 3, histoire T12, SEC-32). Demandé au moment de
// valider, dans une fenêtre Microsoft (code d'autorisation avec PKCE, état vérifié par MSAL), pour le tenant DU CLIENT seulement,
// avec la permission la moins large de l'action ; gardé en mémoire de la page (jamais dans le stockage du navigateur), envoyé
// dans la requête de validation, jamais stocké par Relève.
import { createStandardPublicClientApplication, type AccountInfo, type IPublicClientApplication } from "@azure/msal-browser";

const GRAPH = "https://graph.microsoft.com/";

/** Permission déléguée la moins large de chaque action (docs/permissions-graph.md § 3). */
export const DELEGATED_SCOPES: Readonly<Record<string, readonly string[]>> = {
  "user.reset_password": [`${GRAPH}UserAuthenticationMethod.ReadWrite.All`],
  "user.mfa_reregister": [`${GRAPH}UserAuthenticationMethod.ReadWrite.All`],
  "user.unlock": [`${GRAPH}User.EnableDisableAccount.All`, `${GRAPH}User.Read.All`],
  "user.revoke_sessions": [`${GRAPH}User.RevokeSessions.All`],
  link: [`${GRAPH}User.Read`],
};

/** Les opérations sur les méthodes d'authentification exigent un second facteur récent chez Microsoft (depuis janvier 2026). */
const MFA_CLAIMS = JSON.stringify({ access_token: { amr: { essential: true, values: ["ngcmfa"] } } });
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const apps = new Map<string, IPublicClientApplication>();

async function appFor(tenantId: string, clientId: string): Promise<IPublicClientApplication> {
  const known = apps.get(tenantId);
  if (known) return known;
  const app = await createStandardPublicClientApplication({
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      redirectUri: `${window.location.origin}/msal-redirect.html`,
    },
    // Mémoire de la page seulement : rien dans localStorage ni sessionStorage (SEC-23).
    cache: { cacheLocation: "memoryStorage" },
  });
  apps.set(tenantId, app);
  return app;
}

export async function microsoftToken(a: { tenantId: string; capability: string; loginHint?: string }): Promise<string> {
  const clientId = import.meta.env.VITE_MS_CLIENT_ID as string | undefined;
  if (!clientId || !GUID.test(clientId)) throw new Error("Application Microsoft de Relève non configurée (VITE_MS_CLIENT_ID)");
  if (!GUID.test(a.tenantId)) throw new Error("Tenant Microsoft du client inconnu");
  const scopes = DELEGATED_SCOPES[a.capability];
  if (!scopes) throw new Error("Action sans permission déléguée connue");
  const app = await appFor(a.tenantId, clientId);
  const needsMfa = a.capability === "user.reset_password" || a.capability === "user.mfa_reregister";
  const account: AccountInfo | undefined = app.getAllAccounts()[0];
  const request = { scopes: [...scopes], ...(needsMfa ? { claims: MFA_CLAIMS } : {}), ...(a.loginHint ? { loginHint: a.loginHint } : {}) };
  if (account && !needsMfa) {
    try {
      return (await app.acquireTokenSilent({ ...request, account })).accessToken;
    } catch {
      // jeton expiré ou consentement à renouveler : fenêtre Microsoft ci-dessous
    }
  }
  return (await app.acquireTokenPopup({ ...request, prompt: needsMfa ? "login" : "select_account" })).accessToken;
}
