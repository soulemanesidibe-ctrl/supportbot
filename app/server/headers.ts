// En-têtes de sécurité des écrans (SEC-23, menace M15), une seule définition pour les deux hébergements possibles :
// fichier `_headers` de Cloudflare Pages (scripts/write-headers.mjs) ou petit serveur Node (server/node.ts).
//
// Politique de sécurité du contenu stricte : aucun script en ligne ni venu d'ailleurs, aucune page ne peut nous afficher dans un
// cadre, connexions limitées à notre origine, au projet Supabase (fonctions, temps réel) et à Microsoft (« Connecter mon compte »,
// console). Les styles posés par les bibliothèques passent par le DOM (CSSOM), que la politique n'empêche pas ; seul un élément
// <style> de la boîte de dialogue demande « style-src-elem » (vérifié dans un vrai navigateur, J5.2).

const SUPABASE = /^https:\/\/[a-z0-9-]+\.supabase\.co$/;

export function contentSecurityPolicy(supabaseUrl: string | undefined): string {
  const project = supabaseUrl && SUPABASE.test(supabaseUrl) ? supabaseUrl : null;
  const connect = ["'self'", ...(project ? [project, project.replace(/^https:/, "wss:")] : []), "https://login.microsoftonline.com"];
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    // Seule exception : un élément <style> posé par la boîte de dialogue accessible (verrou du défilement, Radix). Les attributs
    // style en ligne restent interdits ; les scripts restent strictement limités à notre origine. Amélioration prévue : nonce.
    "style-src-elem 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connect.join(" ")}`,
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function securityHeaders(supabaseUrl: string | undefined): Record<string, string> {
  return {
    "Content-Security-Policy": contentSecurityPolicy(supabaseUrl),
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
}

/** Fichier `_headers` de Cloudflare Pages : en-têtes sur toutes les pages, cache long seulement pour les fichiers à empreinte. */
export function headersFile(supabaseUrl: string | undefined): string {
  const lines = ["/*", ...Object.entries(securityHeaders(supabaseUrl)).map(([k, v]) => `  ${k}: ${v}`)];
  lines.push("", "/assets/*", "  Cache-Control: public, max-age=31536000, immutable", "", "/index.html", "  Cache-Control: no-cache", "");
  return lines.join("\n");
}
