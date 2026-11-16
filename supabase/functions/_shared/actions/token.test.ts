import assert from "node:assert/strict";
import { AppError } from "../errors.ts";
import { b64url, msToken, NOW, OBJECT_ID, TENANT } from "./test_rig.ts";
import { assertTokenBelongsToBinding } from "./token.ts";

const binding = { tenantId: TENANT, objectId: OBJECT_ID };
const verdict = (token: string, b: typeof binding | null = binding, now = NOW): string => {
  try { assertTokenBelongsToBinding(token, b, now); } catch (e) { return e instanceof AppError ? e.code : `autre:${(e as Error).message}`; }
  return "accepté";
};

Deno.test("jeton Microsoft : accepté seulement s'il est celui du compte que CE technicien a lié, dans le bon locataire, non expiré", () => {
  assert.equal(verdict(msToken()), "accepté");
  assert.equal(verdict(msToken({ oid: "object-autre-compte" })), "forbidden", "compte d'une autre personne");
  assert.equal(verdict(msToken({ tid: "tenant-autre-client" })), "forbidden", "autre locataire");
  assert.equal(verdict(msToken({ exp: NOW - 1 })), "forbidden", "expiré");
  assert.equal(verdict(msToken({ exp: NOW })), "forbidden", "expire à l'instant");
  assert.equal(verdict(msToken({ exp: undefined })), "forbidden", "sans expiration");
  assert.equal(verdict(msToken({ oid: undefined })), "forbidden");
});

Deno.test("jeton Microsoft : aucun compte lié, jeton mal formé ou charge illisible = refusé", () => {
  assert.equal(verdict(msToken(), null), "forbidden", "le technicien n'a pas lié son compte");
  for (const bad of ["", "pas-un-jeton", "a.b", "a.b.c.d", `${b64url({})}.%%%.sig`, `${b64url({})}.${btoa("[1,2]")}.sig`, `${b64url({})}.${btoa("texte")}.sig`]) {
    assert.equal(verdict(bad), "forbidden", bad);
  }
});
