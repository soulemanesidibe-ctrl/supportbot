import { afterEach, describe, expect, it, vi } from "vitest";
import { readPref, writePref } from "./prefs.ts";

describe("préférences d'affichage", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("seules les valeurs prévues sont écrites et relues", () => {
    writePref("theme", "light");
    expect(readPref("theme")).toBe("light");
    writePref("theme", "<script>");
    expect(readPref("theme")).toBe("light");
    localStorage.setItem("releve.pref.lang", "jeton-ou-autre-chose");
    expect(readPref("lang")).toBeNull();
  });

  it("un stockage indisponible (navigation privée) ne casse rien", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqué");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqué");
    });
    expect(() => writePref("theme", "dark")).not.toThrow();
    expect(readPref("theme")).toBeNull();
  });
});
