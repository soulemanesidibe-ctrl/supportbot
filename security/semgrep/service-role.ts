// Fixtures de service-role.yml. `ruleid:` = la ligne suivante DOIT être signalée, `ok:` = non.
// Rien ici ne s'exécute : ce fichier n'est ni compilé ni déployé.
// @ts-nocheck
declare const name: string;
declare function requireUser(r: any): Promise<any>;
declare function requireOrgMember(r: any, o?: any): Promise<any>;
declare function verifyWebhookSignature(r: any): Promise<any>;
declare function somethingElse(r: any): Promise<any>;
declare function serviceClient(a: any): any;
type AuthContext = any;

// --- releve-service-role-key-direct-use
// ruleid: releve-service-role-key-direct-use
const k1 = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
// ruleid: releve-service-role-key-direct-use
const k2 = Deno.env.get("SERVICE_ROLE_KEY")!;
// ruleid: releve-service-role-key-direct-use
const k3 = process.env["SUPABASE_SERVICE_ROLE_KEY"];
// ruleid: releve-service-role-key-direct-use
const k5 = Deno.env.get("SUPABASE_" + "SERVICE_ROLE_KEY");
// ok: releve-service-role-key-direct-use
const url = Deno.env.get("SUPABASE_URL");
// ok: releve-service-role-key-direct-use
const mistral = Deno.env.get("MISTRAL_BASE_URL");

// --- releve-service-role-env-property
// ruleid: releve-service-role-env-property
const k4 = process.env.SUPABASE_SERVICE_ROLE_KEY;
// ok: releve-service-role-env-property
const mode = process.env.NODE_ENV;

// --- releve-env-dynamic-key
// ruleid: releve-env-dynamic-key
const d1 = Deno.env.get(name);
// ruleid: releve-env-dynamic-key
const d2 = process.env[name];
// ruleid: releve-env-dynamic-key
const d3 = Deno.env.get(`SUPABASE_${name}`);
const KEYNAME = "SUPABASE_SERVICE_ROLE_KEY";
// ruleid: releve-env-dynamic-key
const d6 = Deno.env.get(KEYNAME);
// ok: releve-env-dynamic-key
const d4 = Deno.env.get("SUPABASE_URL");
// ok: releve-env-dynamic-key
const d5 = process.env["NODE_ENV"];

// --- releve-env-bulk-read
// ruleid: releve-env-bulk-read
const b1 = Deno.env.toObject();
// ruleid: releve-env-bulk-read
const { SUPABASE_SERVICE_ROLE_KEY } = process.env;
// ruleid: releve-env-bulk-read
const b3 = { ...process.env };
// ruleid: releve-env-bulk-read
const b4 = Object.keys(process.env);
// ok: releve-env-bulk-read
const b5 = Deno.env.get("SUPABASE_URL");

// --- releve-service-client-without-auth
Deno.serve(async (r) => {
  // ruleid: releve-service-client-without-auth
  const bad = serviceClient(null);
  return new Response("x");
});

Deno.serve(async (r) => {
  const a = await requireUser(r);
  // ok: releve-service-client-without-auth
  const good = serviceClient(a);
  return new Response("x");
});

Deno.serve(async (r) => {
  const a = await requireOrgMember(r, "org");
  if (!a) return new Response("no", { status: 403 });
  // ok: releve-service-client-without-auth
  const good = serviceClient(a);
  return new Response("x");
});

Deno.serve(async (r) => {
  const a = await verifyWebhookSignature(r);
  // ok: releve-service-client-without-auth
  const good = serviceClient(a);
  return new Response("x");
});

async function loadTicket(a: AuthContext, id: string) {
  // ok: releve-service-client-without-auth
  const d = serviceClient(a);
  return d;
}

async function loadTicketBad(id: string) {
  // ruleid: releve-service-client-without-auth
  const d = serviceClient(id);
  return d;
}

async function wrongGuard(r: any) {
  const a = await somethingElse(r);
  // ruleid: releve-service-client-without-auth
  const d = serviceClient(a);
  return d;
}
