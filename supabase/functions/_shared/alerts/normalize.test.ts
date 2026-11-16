import assert from "node:assert/strict";
import { AppError } from "../errors.ts";
import { MASK } from "../redact.ts";
import { cleanText, getPath, NATIVE_MAPPING, normalizeAlert, parseSourceConfig, SourceConfigError } from "./normalize.ts";

const NOW = Date.parse("2026-11-16T10:00:00Z");
const native = parseSourceConfig({}, {});
// Correspondance de type Zabbix (exemple) : chemins imbriqués, tables des gravités et des états.
const zabbix = parseSourceConfig(
  { Disaster: "critical", High: "major", Average: "warning", Information: "information" },
  {
    dedup: ["event.host", "event.trigger_id"],
    asset: "event.host",
    asset_kind: "event.kind",
    severity: "event.severity",
    state: "event.status",
    state_map: { PROBLEM: "open", RESOLVED: "resolved", ACK: "acknowledged" },
    summary: "event.name",
    occurred_at: "event.clock",
    site: "event.site",
    origin_url: "event.url",
  },
);

async function bad(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof AppError ? `${e.status} ${e.message}` : `autre:${(e as Error).message}`;
  }
  return "aucune erreur";
}

Deno.test("format natif : une correspondance vide lit l'alerte déjà normalisée", async () => {
  assert.equal(native.mapping, NATIVE_MAPPING);
  const { alert, warnings } = await normalizeAlert({
    dedup_key: "vpn/paris/ping", asset_kind: "host", asset_name: "vpn-paris", site: "Paris", severity: "critical", state: "open",
    summary: "Ping perdu", occurred_at: "2026-11-16T09:58:00Z", origin_url: "https://supervision.exemple.fr/a/1",
  }, native, NOW);
  assert.deepEqual(warnings, []);
  assert.equal(alert.dedup_key, "vpn/paris/ping");
  assert.equal(alert.asset_kind, "host");
  assert.equal(alert.asset_name, "vpn-paris");
  assert.equal(alert.site, "Paris");
  assert.equal(alert.severity, "critical");
  assert.equal(alert.state, "open");
  assert.equal(alert.summary, "Ping perdu");
  assert.equal(alert.occurred_at, "2026-11-16T09:58:00.000Z");
  assert.equal(alert.origin_url, "https://supervision.exemple.fr/a/1");
});

Deno.test("correspondance : chemins imbriqués, gravité et état par table (casse indifférente), date en secondes", async () => {
  const { alert, warnings } = await normalizeAlert({
    event: { host: "srv-db1", trigger_id: 4242, kind: "HOST", severity: "disaster", status: "problem", name: "Disque plein", clock: NOW / 1000 - 60, site: "Lyon", url: "https://zabbix.exemple.fr/tr/4242" },
  }, zabbix, NOW);
  assert.deepEqual(warnings, []);
  assert.equal(alert.dedup_key, "srv-db1|4242");
  assert.equal(alert.asset_kind, "host");
  assert.equal(alert.severity, "critical");
  assert.equal(alert.state, "open");
  assert.equal(alert.occurred_at, new Date(NOW - 60_000).toISOString());
  const resolved = await normalizeAlert({ event: { host: "srv-db1", trigger_id: 4242, severity: "Disaster", status: "RESOLVED" } }, zabbix, NOW);
  assert.equal(resolved.alert.state, "resolved");
  assert.equal(resolved.alert.dedup_key, "srv-db1|4242", "la même clé ferme la même alerte");
});

Deno.test("écarts tolérés : gravité ou état inconnus, date illisible ou hors limites, adresse non https : avertissements codés", async () => {
  const { alert, warnings } = await normalizeAlert({
    event: { host: "srv-db1", trigger_id: 1, severity: "Apocalypse", status: "BIZARRE", clock: NOW / 1000 + 3600, url: "http://zabbix.exemple.fr/x" },
  }, zabbix, NOW);
  assert.equal(alert.severity, "warning");
  assert.equal(alert.state, "open");
  assert.equal(alert.occurred_at, new Date(NOW).toISOString());
  assert.equal(alert.origin_url, null);
  assert.deepEqual(warnings, ["gravite_inconnue", "etat_inconnu", "date_hors_limites", "adresse_ignoree"]);
  const old = await normalizeAlert({ event: { host: "h", severity: "High", clock: NOW / 1000 - 40 * 86400 } }, zabbix, NOW);
  assert.deepEqual(old.warnings, ["date_hors_limites"]);
  const missing = await normalizeAlert({ event: { host: "h", severity: "High" } }, zabbix, NOW);
  assert.deepEqual(missing.warnings, [], "date absente : l'heure de réception fait foi, sans avertissement");
  assert.equal(missing.alert.occurred_at, new Date(NOW).toISOString());
  const ms = await normalizeAlert({ event: { host: "h", severity: "High", clock: NOW - 1000 } }, zabbix, NOW);
  assert.equal(ms.alert.occurred_at, new Date(NOW - 1000).toISOString());
  const words = await normalizeAlert({ asset_name: "h", severity: "major", occurred_at: "now" }, native, NOW);
  assert.deepEqual(words.warnings, ["date_hors_limites"], "les mots spéciaux de date ne sont pas acceptés");
});

Deno.test("adresse d'origine : identifiants dans l'adresse, espaces ou trop longue = ignorée", async () => {
  for (const url of ["https://u:p@zabbix.exemple.fr/x", "https://zabbix.exemple.fr/a b", "https://zabbix.exemple.fr/" + "a".repeat(500), "javascript:alert(1)"]) {
    const { alert, warnings } = await normalizeAlert({ asset_name: "h", severity: "major", origin_url: url }, native, NOW);
    assert.equal(alert.origin_url, null, url);
    assert.deepEqual(warnings, ["adresse_ignoree"]);
  }
});

Deno.test("refus : actif ou gravité absents (correspondance à revoir) ; clé réservée « releve: »", async () => {
  assert.equal(await bad(normalizeAlert({ severity: "major" }, native, NOW)), "400 Actif absent : vérifiez la correspondance des champs de cette source.");
  assert.equal(await bad(normalizeAlert({ asset_name: " \u0000 ‮ ", severity: "major" }, native, NOW)), "400 Actif absent : vérifiez la correspondance des champs de cette source.");
  assert.equal(await bad(normalizeAlert({ asset_name: { objet: 1 }, severity: "major" }, native, NOW)), "400 Actif absent : vérifiez la correspondance des champs de cette source.");
  assert.equal(await bad(normalizeAlert({ asset_name: "h" }, native, NOW)), "400 Gravité absente : vérifiez la correspondance des champs de cette source.");
  assert.equal(await bad(normalizeAlert({ asset_name: "h", severity: "major", dedup_key: "releve:silence" }, native, NOW)), "400 Clé de déduplication réservée.");
});

Deno.test("masquage : un secret dans le résumé, l'actif ou la charge brute n'est jamais stocké", async () => {
  const { alert } = await normalizeAlert({
    asset_name: "srv password=Hunter2!", severity: "major", summary: "Échec de connexion : password=Sup3rS3cret! pour la sauvegarde",
    // Faux secrets assemblés à l'exécution : aucun secret littéral dans le dépôt (gitleaks).
    password: "Sup3rS3cret!", details: { api_key: ["cle", "tres", "secrete", "123"].join("-"), note: "tok" + "en=" + ["abc", "def", "123", "456"].join("") },
  }, native, NOW);
  const all = JSON.stringify(alert);
  assert.ok(!all.includes("Sup3rS3cret!") && !all.includes("Hunter2!") && !all.includes("cle-tres-secrete-123") && !all.includes("abcdef123456"), all);
  assert.ok(alert.summary.includes(MASK));
  assert.equal((alert.raw as Record<string, unknown>).password, MASK);
});

Deno.test("clé de déduplication : trop longue ou porteuse d'un secret, remplacée par son empreinte stable ; sinon l'actif", async () => {
  const long = await normalizeAlert({ asset_name: "h", severity: "major", dedup_key: "x".repeat(400) }, native, NOW);
  assert.match(long.alert.dedup_key, /^h:[0-9a-f]{64}$/);
  const again = await normalizeAlert({ asset_name: "h", severity: "major", dedup_key: "x".repeat(400) }, native, NOW);
  assert.equal(long.alert.dedup_key, again.alert.dedup_key);
  const otherLong = await normalizeAlert({ asset_name: "h", severity: "major", dedup_key: "x".repeat(300) + "y".repeat(100) }, native, NOW);
  assert.notEqual(long.alert.dedup_key, otherLong.alert.dedup_key, "deux clés longues qui ne diffèrent qu'après 300 caractères restent distinctes");
  const secret = await normalizeAlert({ asset_name: "h", severity: "major", dedup_key: "job|password=Hunter2!" }, native, NOW);
  assert.match(secret.alert.dedup_key, /^h:[0-9a-f]{64}$/);
  const none = await normalizeAlert({ asset_name: "srv-1", severity: "major" }, native, NOW);
  assert.equal(none.alert.dedup_key, "srv-1");
});

Deno.test("texte : caractères de contrôle et d'inversion de sens retirés, blancs réduits, bornes en caractères", async () => {
  assert.equal(cleanText("a\u0000b‮c⁦d​e\tf\n\ng", 50), "a bcde f g");
  assert.equal(cleanText("é".repeat(600), 500).length, 500);
  assert.equal(cleanText("😀".repeat(10), 3), "😀😀😀", "on ne coupe pas un caractère en deux");
  const { alert } = await normalizeAlert({ asset_name: "a".repeat(300), severity: "major", summary: "b".repeat(900), site: "c".repeat(200) }, native, NOW);
  assert.equal(alert.asset_name.length, 200);
  assert.equal(alert.summary.length, 500);
  assert.equal(alert.site?.length, 100);
});

Deno.test("chemins : seulement les propriétés propres d'objets ordinaires ; jamais le prototype", () => {
  const o = JSON.parse('{"a":{"b":[{"c":"ok"}]},"__proto__":{"x":"pollué"}}');
  assert.equal(getPath(o, "a.b.0.c"), "ok");
  assert.equal(getPath(o, "a.b.1.c"), undefined);
  assert.equal(getPath(o, "toString"), undefined);
  assert.equal(getPath(o, "a.constructor"), undefined);
  assert.equal(getPath(new Map([["a", 1]]), "a"), undefined);
});

Deno.test("configuration : champ inconnu, chemin vers le prototype, valeurs hors liste, tables trop grandes = refusée", () => {
  const cases: Array<[unknown, unknown]> = [
    [{}, { asset: "h", severity: "s", script: "x" }],
    [{}, { asset: "__proto__.x", severity: "s" }],
    [{}, { asset: "a.constructor", severity: "s" }],
    [{}, { asset: "h" }],
    [{}, { asset: "h", severity: "s", dedup: [] }],
    [{}, { asset: "h", severity: "s", dedup: ["a", "b", "c", "d", "e", "f"] }],
    [{}, { asset: "a.b.c.d.e.f.g.h.i", severity: "s" }],
    [{}, { asset: "h", severity: "s", state_map: { OK: "closed" } }],
    [{ HIGH: "urgent" }, {}],
    [Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, "major"])), {}],
    [[], {}],
    [{}, "asset"],
  ];
  for (const [sev, map] of cases) assert.throws(() => parseSourceConfig(sev, map), SourceConfigError, JSON.stringify(map));
  // Une clé « __proto__ » dans une table ne pollue rien : refusée.
  assert.throws(() => parseSourceConfig(JSON.parse('{"__proto__":"critical"}'), {}), SourceConfigError);
  // dedup absent : l'actif sert de clé.
  assert.deepEqual(parseSourceConfig({}, { asset: "h", severity: "s" }).mapping.dedup, ["h"]);
});
