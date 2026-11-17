// Textes de l'interface : français d'abord, anglais ensuite. Une clé absente en anglais retombe sur le français (jamais une clé
// brute à l'écran). Les variables {nom} sont remplacées par du TEXTE : React l'échappe, aucun HTML n'est interprété.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { readPref, writePref } from "../prefs.ts";
import { en } from "./en.ts";
import { fr, type MessageKey } from "./fr.ts";

export type Lang = "fr" | "en";
type Vars = Record<string, string | number>;

const DICTS: Record<Lang, Partial<Record<MessageKey, string>>> = { fr, en };

/** Singulier selon la langue : en français 0 et 1 sont au singulier, en anglais seulement 1. */
const singular = (lang: Lang, n: number) => (lang === "fr" ? Math.abs(n) < 2 : Math.abs(n) === 1);

/**
 * {nom} insère la variable ; {nom|singulier|pluriel} choisit la forme accordée au nombre « nom » (« 1 incident ouvert »,
 * « 3 incidents ouverts »), sans l'insérer.
 */
export function translate(lang: Lang, key: MessageKey, vars?: Vars): string {
  const raw = DICTS[lang][key] ?? fr[key];
  if (!vars) return raw;
  return raw.replace(/\{(\w+)(?:\|([^|{}]*)\|([^|{}]*))?\}/g, (m, name: string, one?: string, many?: string) => {
    if (!Object.hasOwn(vars, name)) return m;
    if (one === undefined || many === undefined) return String(vars[name]);
    return singular(lang, Number(vars[name])) ? one : many;
  });
}

/** Français par défaut (clients français) ; l'anglais seulement sur choix explicite de la personne, retenu dans ce navigateur. */
function initialLang(): Lang {
  return readPref("lang") === "en" ? "en" : "fr";
}

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: MessageKey, vars?: Vars) => string;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children, lang: forced }: { children: ReactNode; lang?: Lang }) {
  const [lang, setLangState] = useState<Lang>(forced ?? initialLang);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    writePref("lang", l);
    document.documentElement.lang = l;
  }, []);
  const value = useMemo<I18n>(() => ({ lang, setLang, t: (k, v) => translate(lang, k, v) }), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function useI18n(): I18n {
  const v = useContext(Ctx);
  // Hors fournisseur (tests unitaires d'un composant) : français.
  return v ?? { lang: "fr", setLang: () => {}, t: (k, vars) => translate("fr", k, vars) };
}

export function useT(): I18n["t"] {
  return useI18n().t;
}

export function useLang(): [Lang, (l: Lang) => void] {
  const { lang, setLang } = useI18n();
  return [lang, setLang];
}

export type { MessageKey };
