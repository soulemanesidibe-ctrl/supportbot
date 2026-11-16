// Jeton d'invitation : 32 octets aléatoires (256 bits), valeur renvoyée UNE fois à la personne qui invite ; seule l'empreinte SHA-256
// est stockée (le jeton ne peut pas être retrouvé dans la base, ni dans le journal d'audit).
function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashToken(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function newInvitationToken(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): Promise<{ token: string; hash: string }> {
  const token = toBase64Url(random(32));
  return { token, hash: await hashToken(token) };
}

/** Un jeton reçu d'un client : forme stricte avant tout calcul (43 caractères base64url pour 32 octets). */
export function isTokenShape(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}
