import { describe, expect, it } from "vitest";
import { en } from "./en.ts";
import { fr } from "./fr.ts";
import { translate } from "./index.tsx";

describe("textes de l'interface", () => {
  it("chaque clé anglaise existe en français, et l'anglais couvre toutes les clés françaises", () => {
    for (const k of Object.keys(en)) expect(Object.hasOwn(fr, k), k).toBe(true);
    const missing = Object.keys(fr).filter((k) => !Object.hasOwn(en, k));
    expect(missing).toEqual([]);
  });

  it("aucun tiret cadratin dans un texte d'interface", () => {
    for (const [k, v] of [...Object.entries(fr), ...Object.entries(en)]) expect(v.includes("—"), k).toBe(false);
  });

  it("les mêmes variables {nom} en français et en anglais", () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const [k, v] of Object.entries(en)) expect(vars(v ?? ""), k).toEqual(vars(fr[k as keyof typeof fr]));
  });

  it("une variable est insérée comme texte ; une variable inconnue reste visible au lieu d'être inventée", () => {
    expect(translate("fr", "widget.home.greeting", { prenom: "<b>Camille</b>" })).toBe("Bonjour <b>Camille</b>");
    expect(translate("fr", "widget.home.greeting", {})).toBe("Bonjour {prenom}");
    expect(translate("en", "widget.home.greeting", { prenom: "Sam" })).toBe("Hello Sam");
  });

  it("la transparence IA est dite dans les deux langues", () => {
    expect(fr["common.ai.explain"]).toMatch(/intelligence artificielle/);
    expect(en["common.ai.explain"]).toMatch(/artificial intelligence/);
  });
});
