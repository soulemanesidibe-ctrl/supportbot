// Préférences d'affichage de CE navigateur (thème, langue, densité). Jamais une donnée personnelle, jamais un jeton (SEC-23) :
// c'est le seul fichier autorisé à écrire dans localStorage (règle ESLint). Toute lecture ou écriture peut échouer
// (navigation privée, stockage bloqué) : l'interface fonctionne sans.
export type Pref = "theme" | "lang" | "density";
const PREFIX = "releve.pref.";
const ALLOWED: Record<Pref, readonly string[]> = {
  theme: ["dark", "light", "system"],
  lang: ["fr", "en"],
  density: ["comfortable", "compact"],
};

export function readPref(name: Pref): string | null {
  try {
    const v = window.localStorage.getItem(PREFIX + name);
    return v !== null && ALLOWED[name].includes(v) ? v : null;
  } catch {
    return null;
  }
}

export function writePref(name: Pref, value: string): void {
  if (!ALLOWED[name].includes(value)) return;
  try {
    window.localStorage.setItem(PREFIX + name, value);
  } catch {
    // stockage indisponible : la préférence vaut pour cette page seulement
  }
}
