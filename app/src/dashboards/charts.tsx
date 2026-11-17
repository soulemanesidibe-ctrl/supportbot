// Pièces de graphique des tableaux de bord (skill dataviz) : chiffre avec son effectif, barre segmentée haute (une part mise en
// avant, le reste en gris, part et légende), jauge fine avec repère de seuil. Chaque valeur reste lisible sans la couleur (texte,
// légende, tableau) ; les couleurs viennent des jetons --c-chart-* validés par le script de la palette.
import type { ReactNode } from "react";
import { cn } from "../ui/cn.ts";

const percentFmt = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 0 });
export const pct = (n: number, total: number) => (total > 0 ? percentFmt.format(n / total) : "–");

/** Un chiffre : libellé, valeur (chiffres proportionnels), et ce sur quoi il repose (effectif, fenêtre). */
export function Figure({ label, value, basis, tone }: { label: string; value: ReactNode; basis?: ReactNode; tone?: "default" | "warning" }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-[0.8125rem] text-soft">{label}</dt>
      <dd className={cn("text-[1.625rem] font-semibold leading-none tracking-[-0.02em]", tone === "warning" ? "text-relief-ink" : "text-text")}>{value}</dd>
      {basis && <dd className="text-xs text-soft">{basis}</dd>}
    </div>
  );
}

export interface Part {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly tone: "accent" | "mid" | "low";
}

const PART_BG: Record<Part["tone"], string> = { accent: "bg-chart-accent", mid: "bg-chart-mid", low: "bg-chart-low" };

/** Barre segmentée haute (28 px) : une part par bloc, sa part imprimée si elle tient, légende des noms et des effectifs. */
export function SegmentedBar({ parts, label }: { parts: readonly Part[]; label: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const summary = parts.map((p) => `${p.label} : ${p.value} (${pct(p.value, total)})`).join(", ");
  return (
    <figure className="flex flex-col gap-3">
      <div role="img" aria-label={`${label}. ${summary}.`} className="flex h-7 w-full gap-0.5 overflow-hidden rounded">
        {total === 0 ? (
          <div className="h-full w-full rounded bg-chart-track" />
        ) : (
          parts.filter((p) => p.value > 0).map((p) => (
            <div
              key={p.key}
              title={`${p.label} : ${p.value} (${pct(p.value, total)})`}
              className={cn("flex h-full min-w-0 items-center rounded px-2", PART_BG[p.tone])}
              style={{ flexGrow: p.value, flexBasis: 0 }}
            >
              {/* La part n'est imprimée que sur le bloc mis en avant, et seulement s'il est assez large (≥ 12 %). */}
              {p.tone === "accent" && p.value / total >= 0.12 && (
                <span className="text-xs font-semibold text-chart-on-accent">{pct(p.value, total)}</span>
              )}
            </div>
          ))
        )}
      </div>
      <figcaption>
        <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
          {parts.map((p) => (
            <li key={p.key} className="flex items-center gap-2 text-[0.8125rem] text-soft">
              <span className={cn("size-2.5 rounded-sm", PART_BG[p.tone])} aria-hidden="true" />
              <span className="text-text">{p.label}</span>
              <span className="num">{p.value}</span>
              {p.tone !== "accent" && <span className="num">({pct(p.value, total)})</span>}
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}

/** Jauge fine (8 px) : remplissage selon l'état, rail du même ton, repère du seuil à atteindre. */
export function Meter({ value, max, threshold, state, label }: { value: number; max: number; threshold?: number; state: "met" | "below" | "danger"; label: string }) {
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  const fill = state === "met" ? "bg-signal" : state === "danger" ? "bg-danger" : "bg-relief";
  const track = state === "met" ? "bg-signal-soft" : state === "danger" ? "bg-danger-soft" : "bg-relief-soft";
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.round(value * 100) / 100} className={cn("relative h-2 w-full rounded-full", track)}>
      <div className={cn("h-full rounded-full", fill)} style={{ width: `${ratio * 100}%` }} />
      {threshold !== undefined && max > 0 && (
        <span aria-hidden="true" className="absolute -top-1 h-4 w-0.5 rounded-full bg-text" style={{ left: `calc(${Math.min(1, threshold / max) * 100}% - 1px)` }} />
      )}
    </div>
  );
}
