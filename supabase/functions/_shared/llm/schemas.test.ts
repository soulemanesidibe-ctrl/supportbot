import assert from "node:assert/strict";
import { parseAnswer, parseJsonObject, parseTriage } from "./schemas.ts";

const triage = { intent: "incident", category: "printer", urgency: "normal", manipulation: false, confidence: 0.9 };

Deno.test("parseTriage : sortie valide, avec ou sans bloc de code Markdown", () => {
  assert.deepEqual(parseTriage(JSON.stringify(triage)), triage);
  assert.deepEqual(parseTriage("```json\n" + JSON.stringify(triage) + "\n```"), triage);
});

Deno.test("parseTriage : toute valeur hors liste, champ manquant ou texte autour est rejeté", () => {
  const bad = [
    { ...triage, category: "paie" }, { ...triage, intent: "reset_all" }, { ...triage, urgency: "urgentissime" },
    { ...triage, manipulation: "non" }, { ...triage, confidence: "haute" }, { ...triage, confidence: NaN },
    { intent: "question" },
  ];
  for (const b of bad) assert.equal(parseTriage(JSON.stringify(b)), null, JSON.stringify(b));
  assert.equal(parseTriage("Voici le résultat : " + JSON.stringify(triage)), null);
  assert.equal(parseTriage(JSON.stringify(triage) + " Bonne journée !"), null);
  assert.equal(parseTriage("[1,2]"), null);
  assert.equal(parseTriage("{pas du json}"), null);
  assert.equal(parseTriage(""), null);
});

Deno.test("parseTriage : la confiance est ramenée dans [0, 1]", () => {
  assert.equal(parseTriage(JSON.stringify({ ...triage, confidence: 7 }))?.confidence, 1);
  assert.equal(parseTriage(JSON.stringify({ ...triage, confidence: -2 }))?.confidence, 0);
});

const answer = { answer: "Redémarrez l'imprimante.", knows: true, escalate: false, sources: ["f1"] };

Deno.test("parseAnswer : réponse valide, sources limitées aux fiches fournies", () => {
  assert.deepEqual(parseAnswer(JSON.stringify(answer), ["f1", "f2"]), answer);
  assert.equal(parseAnswer(JSON.stringify({ ...answer, sources: ["f9"] }), ["f1", "f2"]), null, "source inventée");
});

Deno.test("parseAnswer : prétendre savoir sans aucune source, texte vide ou énorme, types faux = rejet", () => {
  const ids = ["f1"];
  const bad = [
    { ...answer, sources: [] }, { ...answer, answer: "" }, { ...answer, answer: "x".repeat(2001) },
    { ...answer, knows: "oui" }, { ...answer, escalate: null }, { ...answer, sources: "f1" },
    { ...answer, sources: ["f1", "f1", "f1", "f1", "f1", "f1"] },
  ];
  for (const b of bad) assert.equal(parseAnswer(JSON.stringify(b), ids), null, JSON.stringify(b).slice(0, 60));
  assert.ok(parseAnswer(JSON.stringify({ ...answer, knows: false, sources: [] }), ids), "ne pas savoir sans source est cohérent");
});

Deno.test("parseJsonObject : un seul objet, rien d'autre", () => {
  assert.deepEqual(parseJsonObject(' {"a":1} '), { a: 1 });
  assert.equal(parseJsonObject('{"a":1}{"b":2}'), null);
  assert.equal(parseJsonObject("x".repeat(30_000)), null);
});
