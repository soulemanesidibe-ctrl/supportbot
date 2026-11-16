import assert from "node:assert/strict";
import type { UserDiagnosis } from "../capabilities/types.ts";
import { evaluateRisk, RISK } from "./risk.ts";

const NOW = new Date("2026-11-16T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const clean = (over: Partial<UserDiagnosis> = {}): UserDiagnosis => ({
  accountEnabled: true, locked: false, mfaMethods: [{ type: "totp", createdAt: hoursAgo(24 * 90) }], lastPasswordChangeAt: hoursAgo(24 * 60),
  recentFailedSignIns: 0, hasPrivilegedRole: false, ...over,
});

Deno.test("risque : un compte ordinaire sans signal est admis", () => {
  assert.deepEqual(evaluateRisk({ diagnosis: clean(), priorRequests24h: 0, now: NOW }), { decision: "allow", flags: [] });
});

Deno.test("X1 : un compte à privilèges n'obtient JAMAIS d'action préparée, quels que soient les autres signaux", () => {
  assert.deepEqual(evaluateRisk({ diagnosis: clean({ hasPrivilegedRole: true }), priorRequests24h: 0, now: NOW }), { decision: "privileged", flags: ["X1"] });
  assert.equal(evaluateRisk({ diagnosis: clean({ hasPrivilegedRole: true, recentFailedSignIns: 50 }), priorRequests24h: 5, now: NOW }).decision, "privileged");
});

Deno.test("X2 : méthode d'authentification ajoutée ou mot de passe changé depuis moins de 24 h = suspecte ; à 25 h non", () => {
  assert.deepEqual(evaluateRisk({ diagnosis: clean({ mfaMethods: [{ type: "phone", createdAt: hoursAgo(2) }] }), priorRequests24h: 0, now: NOW }), { decision: "suspicious", flags: ["X2"] });
  assert.equal(evaluateRisk({ diagnosis: clean({ lastPasswordChangeAt: hoursAgo(23) }), priorRequests24h: 0, now: NOW }).decision, "suspicious");
  assert.equal(evaluateRisk({ diagnosis: clean({ lastPasswordChangeAt: hoursAgo(25), mfaMethods: [{ type: "totp", createdAt: hoursAgo(25) }] }), priorRequests24h: 0, now: NOW }).decision, "allow");
  assert.equal(evaluateRisk({ diagnosis: clean({ mfaMethods: [{ type: "x", createdAt: "pas une date" }], lastPasswordChangeAt: undefined }), priorRequests24h: 0, now: NOW }).decision, "allow", "date illisible : non comptée");
});

Deno.test("X3 : dix échecs de connexion ou plus = suspecte ; neuf non", () => {
  // Valeurs en dur : un test qui lirait RISK suivrait n'importe quel seuil relevé et ne protégerait plus rien.
  assert.equal(evaluateRisk({ diagnosis: clean({ recentFailedSignIns: 9 }), priorRequests24h: 0, now: NOW }).decision, "allow");
  assert.deepEqual(evaluateRisk({ diagnosis: clean({ recentFailedSignIns: 10 }), priorRequests24h: 0, now: NOW }), { decision: "suspicious", flags: ["X3"] });
  assert.deepEqual(evaluateRisk({ diagnosis: clean({ recentFailedSignIns: 11 }), priorRequests24h: 0, now: NOW }), { decision: "suspicious", flags: ["X3"] });
});

Deno.test("seuils X2 à X4 : figés (les relever affaiblit la protection, cela se décide en relecture)", () => {
  assert.deepEqual({ ...RISK }, { recentChangeHours: 24, failedSignInsThreshold: 10, repeatedRequestsThreshold: 1 });
});

Deno.test("X4 : une demande déjà faite sur la même cible dans les 24 h = suspecte ; les règles se cumulent", () => {
  assert.equal(evaluateRisk({ diagnosis: clean(), priorRequests24h: 0, now: NOW }).decision, "allow");
  assert.deepEqual(evaluateRisk({ diagnosis: clean(), priorRequests24h: 1, now: NOW }), { decision: "suspicious", flags: ["X4"] });
  assert.deepEqual(
    evaluateRisk({ diagnosis: clean({ recentFailedSignIns: 12, mfaMethods: [{ type: "phone", createdAt: hoursAgo(1) }] }), priorRequests24h: 3, now: NOW }).flags,
    ["X2", "X3", "X4"],
  );
});
