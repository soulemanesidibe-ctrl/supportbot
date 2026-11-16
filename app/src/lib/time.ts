// Formats de date et d'heure, dans la langue de l'interface. Jamais d'heure inventée : on affiche ce que la base donne.
import type { Lang } from "./i18n/index.tsx";

const locale = (lang: Lang) => (lang === "en" ? "en-GB" : "fr-FR");

export function hourLabel(isoDate: string, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), { hour: "2-digit", minute: "2-digit" }).format(new Date(isoDate));
}

/** « à l'instant », « il y a 12 min », « 14:05 » aujourd'hui, sinon « mar. 12 nov. ». */
export function relativeLabel(isoDate: string, lang: Lang, nowMs = Date.now()): { text: string; key?: "justNow" | "minutesAgo"; n?: number } {
  const d = new Date(isoDate);
  const diffMin = Math.round((nowMs - d.getTime()) / 60_000);
  if (diffMin < 1) return { text: "", key: "justNow" };
  if (diffMin < 60) return { text: "", key: "minutesAgo", n: diffMin };
  const sameDay = new Date(nowMs).toDateString() === d.toDateString();
  if (sameDay) return { text: hourLabel(isoDate, lang) };
  return { text: new Intl.DateTimeFormat(locale(lang), { weekday: "short", day: "numeric", month: "short" }).format(d) };
}
