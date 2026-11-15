import assert from "node:assert/strict";
import { MASK, redact, redactText } from "./redact.ts";

Deno.test("redact : une clé qui ressemble à un secret est masquée, quelle que soit sa valeur", () => {
  const out = redact({
    password: "x", apiKey: "y", Authorization: "Bearer abc", refresh_token: "z", client_secret: "s",
    mot_de_passe: "m", cookie: "c", otp: "123456", private_key: "k", signature: "sig", ok: "visible",
  }) as Record<string, unknown>;
  for (const k of Object.keys(out)) if (k !== "ok") assert.equal(out[k], MASK, k);
  assert.equal(out.ok, "visible");
});

Deno.test("redact : les compteurs de jetons du modèle ne sont PAS des secrets", () => {
  const out = redact({ tokens_in: 120, tokens_out: 80, completion_tokens: 5, access_token: "abc" }) as Record<string, unknown>;
  assert.equal(out.tokens_in, 120);
  assert.equal(out.tokens_out, 80);
  assert.equal(out.completion_tokens, 5);
  assert.equal(out.access_token, MASK);
});

Deno.test("redactText : JWT, Bearer, clés Supabase et clés privées", () => {
  const jwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV"].join(".");
  assert.ok(!redactText(`jeton ${jwt} fin`).includes("eyJ"));
  assert.equal(redactText("Authorization: Bearer abcdefghijklmnop"), `Authorization: Bearer ${MASK}`);
  assert.ok(!redactText("clé " + "sb_" + "secret_" + "AbCdEf123456789").includes("AbCdEf"));
  const pem = ["-----BEGIN RSA PRIV", "ATE KEY-----\nMIIEow\n-----END RSA PRIV", "ATE KEY-----"].join("");
  assert.ok(!redactText(pem).includes("MIIEow"));
});

Deno.test("redactText : mots de passe dits en clair par un salarié (règle n° 2)", () => {
  assert.ok(!redactText("Mon mot de passe est Azerty123 merci").includes("Azerty123"));
  assert.ok(!redactText("my password is hunter2").includes("hunter2"));
  assert.ok(!redactText("mdp: Soleil2026!").includes("Soleil2026"));
  assert.ok(!redactText("https://exemple.test/api?token=abc123def&x=1").includes("abc123def"));
  assert.ok(!redactText("postgres://admin:" + "P4ssw0rd" + "@db.exemple.test/x").includes("P4ssw0rd"));
});

Deno.test("redactText : code à usage unique masqué, code d'erreur conservé", () => {
  assert.ok(!redactText("mon code de vérification est 482 913").includes("482"));
  assert.ok(!redactText("verification code: 123456").includes("123456"));
  assert.equal(redactText("Erreur code: 0x80070005 sur le poste"), "Erreur code: 0x80070005 sur le poste");
});

Deno.test("redactText : adresses e-mail et téléphones français minimisés", () => {
  assert.equal(redactText("écrire à marie.durand@exemple.test svp"), "écrire à m***@exemple.test svp");
  for (const t of ["06 12 34 56 78", "+33 6 12 34 56 78", "0612345678", "06.12.34.56.78"]) {
    assert.equal(redactText(`appelle le ${t} vite`), "appelle le [TÉLÉPHONE] vite", t);
  }
});

Deno.test("redactText : ne masque pas ce qui est utile au diagnostic", () => {
  const hash = "a".repeat(64);
  const text = `Imprimante hors ligne, ticket 4521, empreinte ${hash}, id 123e4567-e89b-12d3-a456-426614174000`;
  assert.equal(redactText(text), text);
});

Deno.test("redact : borné en profondeur, en taille, et sans boucle infinie sur une référence circulaire", () => {
  const a: Record<string, unknown> = { nom: "a" };
  a.moi = a;
  assert.equal((redact(a) as Record<string, unknown>).moi, "[référence circulaire]");
  let deep: unknown = "fin";
  for (let i = 0; i < 20; i++) deep = { n: deep };
  assert.ok(JSON.stringify(redact(deep)).includes("profondeur maximale"));
  assert.ok((redact("x".repeat(50_000)) as string).length < 2100);
  assert.equal((redact(Array.from({ length: 200 }, (_, i) => i)) as unknown[]).length, 51);
});

Deno.test("redact : une erreur est réduite à son nom et son message masqué, sans trace", () => {
  const out = redact(new Error("échec avec token" + "=abcdef123456 chez moi")) as Record<string, unknown>;
  assert.deepEqual(Object.keys(out).sort(), ["message", "name"]);
  assert.ok(!(out.message as string).includes("abcdef123456"));
});
