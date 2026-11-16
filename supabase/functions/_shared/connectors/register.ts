// Enregistrement des connecteurs auprès du registre. Appelé une fois, au démarrage de chaque fonction qui en a besoin.
//  - « glpi » : toujours disponible ; l'adresse du serveur est validée (https public) à chaque construction ;
//  - « demo » : INERTE en production (aucune fabrique) sauf si RELEVE_ALLOW_DEMO_CONNECTOR=1 : un connecteur de démonstration ne doit
//    jamais avaler silencieusement les tickets d'un vrai client.
// La variable CONNECTOR_ALLOWED_HOST_SUFFIXES (liste séparée par des virgules, par exemple « .glpi-network.cloud ») limite les domaines
// acceptés pour les serveurs de connecteurs : à renseigner pour le pilote (voir docs/revue-securite-j3.md, R3-11).
import { registerConnectorFactory } from "../capabilities/registry.ts";
import { DemoConnector } from "./demo.ts";
import { GlpiConnector } from "./glpi.ts";
import { supabaseSecretPort, SecretPort } from "./secrets.ts";

export interface RegisterOptions {
  fetch?: typeof fetch;
  secrets?: SecretPort;
  allowedSuffixes?: readonly string[];
  allowDemo?: boolean;
}

/** « .a.fr, B.cloud » → [".a.fr", "b.cloud"] ; tout ce qui n'a pas la forme d'un domaine est ignoré. */
export function parseSuffixes(raw: string | undefined | null): string[] {
  return (raw ?? "").split(",").map((x) => x.trim().toLowerCase()).filter((x) => x.length <= 80 && /^\.?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(x));
}

export function registerConnectors(opts: RegisterOptions = {}): void {
  const secrets = opts.secrets ?? supabaseSecretPort();
  const allowedSuffixes = opts.allowedSuffixes ?? parseSuffixes(Deno.env.get("CONNECTOR_ALLOWED_HOST_SUFFIXES"));
  registerConnectorFactory("glpi", (row, auth) =>
    new GlpiConnector(row, { secret: () => secrets.get(auth, row.id), http: { fetch: opts.fetch, allowedSuffixes } }));
  const allowDemo = opts.allowDemo ?? Deno.env.get("RELEVE_ALLOW_DEMO_CONNECTOR") === "1";
  if (allowDemo) registerConnectorFactory("demo", (row) => new DemoConnector(row.id));
}
