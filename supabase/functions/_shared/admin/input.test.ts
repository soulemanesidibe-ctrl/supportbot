import assert from "node:assert/strict";
import { AppError } from "../errors.ts";
import { bool, email, int, listOf, oneOf, optionalText, slug, text, uuid } from "./input.ts";
import { hashToken, isTokenShape, newInvitationToken } from "./token.ts";

function bad(f: () => unknown): boolean {
  try { f(); } catch (e) { return e instanceof AppError && e.code === "bad_request"; }
  return false;
}

Deno.test("text : borné, espaces de bord retirés, jamais de caractère de contrôle ni de séparateur de ligne Unicode", () => {
  assert.equal(text({ a: "  Bonjour  " }, "a", 2, 20), "Bonjour");
  for (const v of ["a", "x".repeat(21), "ligne\nsuivante", "tab\there", "nul\u0000", "sep aration", "sep aration", "del\u007f", 42, null, undefined, ["ab"], { a: "ab" }]) {
    assert.ok(bad(() => text({ a: v }, "a", 2, 20)), String(v));
  }
  assert.ok(bad(() => text({}, "a", 2, 20)));
});

Deno.test("optionalText : absent, nul ou vide = null ; sinon les mêmes règles", () => {
  assert.equal(optionalText({}, "a", 5, 10), null);
  assert.equal(optionalText({ a: null }, "a", 5, 10), null);
  assert.equal(optionalText({ a: "" }, "a", 5, 10), null);
  assert.equal(optionalText({ a: "assez long" }, "a", 5, 10), "assez long");
  assert.ok(bad(() => optionalText({ a: "bref" }, "a", 5, 10)));
});

Deno.test("slug, uuid, email : formats stricts (identiques à ceux de la base)", () => {
  assert.equal(slug({ s: "client-gamma" }, "s"), "client-gamma");
  for (const v of ["", "a", "-client", "Client", "client_gamma", "client gamma", "a".repeat(64), "client\n", "é-client"]) assert.ok(bad(() => slug({ s: v }, "s")), v);
  assert.equal(uuid({ u: "123E4567-E89B-12D3-A456-426614174000" }, "u"), "123e4567-e89b-12d3-a456-426614174000");
  for (const v of ["", "123", "123e4567-e89b-12d3-a456-42661417400", "123e4567-e89b-12d3-a456-426614174000x", " 123e4567-e89b-12d3-a456-426614174000", 1]) assert.ok(bad(() => uuid({ u: v }, "u")), String(v));
  assert.equal(email({ e: "  Admin@Client.TEST \n" }, "e"), "admin@client.test", "espaces et fin de ligne de bord retirés");
  for (const v of ["", "pas-un-mail", "a@b", "a b@c.d", "@c.d", "a@c.d\u0000", "a@@c.d", `${"a".repeat(320)}@b.cd`, 1]) assert.ok(bad(() => email({ e: v }, "e")), String(v));
});

Deno.test("oneOf, listOf, int, bool : liste fermée, sans doublon, entiers bornés, booléens stricts", () => {
  const L = ["a", "b", "c"] as const;
  assert.equal(oneOf({ k: "b" }, "k", L), "b");
  for (const v of ["", "B", "b ", "d", "__proto__", "constructor", 1, null]) assert.ok(bad(() => oneOf({ k: v }, "k", L)), String(v));
  assert.deepEqual(listOf({ k: ["a", "c"] }, "k", L, 1, 3), ["a", "c"]);
  for (const v of [[], ["a", "a"], ["d"], "a", ["a", 1], ["a", "b", "c", "a"], null]) assert.ok(bad(() => listOf({ k: v }, "k", L, 1, 3)), JSON.stringify(v));
  assert.equal(int({ n: 5 }, "n", 1, 10), 5);
  assert.equal(int({}, "n", 1, 10, 7), 7);
  for (const v of [0, 11, 1.5, "5", NaN, Infinity, null, true]) assert.ok(bad(() => int({ n: v }, "n", 1, 10)), String(v));
  assert.ok(bad(() => int({}, "n", 1, 10)));
  assert.equal(bool({}, "b"), false);
  assert.equal(bool({ b: true }, "b"), true);
  for (const v of ["true", 1, 0, null]) assert.ok(bad(() => bool({ b: v }, "b")), String(v));
});

Deno.test("jeton d'invitation : 256 bits, base64url de 43 caractères, empreinte SHA-256 ; deux jetons ne se ressemblent jamais", async () => {
  const a = await newInvitationToken();
  const b = await newInvitationToken();
  assert.ok(isTokenShape(a.token) && isTokenShape(b.token));
  assert.notEqual(a.token, b.token);
  assert.match(a.hash, /^[0-9a-f]{64}$/);
  assert.equal(a.hash, await hashToken(a.token));
  assert.notEqual(a.hash, a.token);
  const fixed = await newInvitationToken(() => new Uint8Array(32));
  assert.equal(fixed.token, "A".repeat(43));
  assert.equal(await hashToken("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "SHA-256 de référence (FIPS 180-4)");
  for (const v of ["", "A".repeat(42), "A".repeat(44), "A".repeat(42) + "=", "A".repeat(42) + "+", `${"A".repeat(42)}\n`, 42, null, undefined]) assert.equal(isTokenShape(v), false, String(v));
});
