// Thème clair ou sombre. Chaque écran a son défaut (console : sombre ; widget : clair, docs/04) ; le choix de la personne
// l'emporte et se retient dans CE navigateur (préférence d'affichage, jamais une donnée personnelle).
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { readPref, writePref } from "./prefs.ts";

export type Theme = "dark" | "light";
const Ctx = createContext<{ theme: Theme; toggle: () => void } | null>(null);

export function ThemeProvider({ defaultTheme, children }: { defaultTheme: Theme; children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = readPref("theme");
    return saved === "dark" || saved === "light" ? saved : defaultTheme;
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next: Theme = t === "dark" ? "light" : "dark";
      writePref("theme", next);
      return next;
    });
  }, []);
  const value = useMemo(() => ({ theme, toggle }), [theme, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  return useContext(Ctx) ?? { theme: "dark", toggle: () => {} };
}
