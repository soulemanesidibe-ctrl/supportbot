// « Qualité de Relève » (docs/11 § 2) : les vrais chiffres de fiabilité, catégorie par catégorie, avec leur effectif, y compris les
// mauvais. Une catégorie ne passe en réponse directe qu'avec 300 notes, 80 % de réponses correctes et aucune dangereuse ; la base le
// calcule (bars_met), l'écran l'affiche sans le recalculer autrement.
import { ArrowCounterClockwise, ChatCircleText, CheckCircle, EyeSlash, Warning, WarningOctagon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";
import type { CategoryQuality, Gate } from "../lib/api/dashboard-types.ts";
import { useT, type MessageKey } from "../lib/i18n/index.tsx";
import { Meter, pct } from "./charts.tsx";

export const MIN_RATINGS = 300;
export const MIN_CORRECT = 0.8;

const GATE: Record<Gate, { tone: BadgeTone; icon: ReactNode }> = {
  shadow: { tone: "outline", icon: <EyeSlash size={14} aria-hidden="true" /> },
  direct: { tone: "signal", icon: <ChatCircleText size={14} aria-hidden="true" /> },
  advice_only: { tone: "relief", icon: <ArrowCounterClockwise size={14} aria-hidden="true" /> },
};

/** onGate : réservé à l'administrateur du client, qui seul décide d'ouvrir une catégorie aux réponses directes ou de la refermer. */
type OnGate = (c: CategoryQuality, state: "direct" | "shadow") => void;

export function QualityPanel({ categories, onGate, busy }: { categories: readonly CategoryQuality[]; onGate?: OnGate; busy?: boolean }) {
  const t = useT();
  const shown = categories.filter((c) => c.answers > 0 || c.conversations > 0 || c.gate !== "shadow");
  const hidden = categories.length - shown.length;
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[72ch] text-[0.9375rem] leading-relaxed text-soft">{t("dash.quality.intro")}</p>
      <ul className="flex flex-col divide-y divide-border border-y border-border">
        {shown.map((c) => <Row key={c.category} c={c} onGate={onGate} busy={busy} />)}
      </ul>
      {hidden > 0 && <p className="text-[0.8125rem] text-soft">{t("dash.quality.hidden", { n: hidden })}</p>}
    </div>
  );
}

function Row({ c, onGate, busy }: { c: CategoryQuality; onGate?: OnGate; busy?: boolean }) {
  const t = useT();
  const correctRate = c.answers > 0 ? c.correct / c.answers : 0;
  const enough = c.answers >= MIN_RATINGS;
  const status = c.dangerous > 0 ? "danger" : c.barsMet ? "met" : !enough ? "insufficient" : "below";
  return (
    <li className="grid grid-cols-1 gap-x-6 gap-y-3 py-4 md:grid-cols-[minmax(11rem,1.1fr)_1fr_1fr_15rem] md:items-center">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-text">{t(`category.${c.category}` as MessageKey)}</span>
        <Badge tone={GATE[c.gate].tone} icon={GATE[c.gate].icon}>{t(`dash.gate.${c.gate}` as MessageKey)}</Badge>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="flex justify-between gap-2 text-[0.8125rem] text-soft">
          <span>{t("dash.quality.ratings")}</span>
          <span className="num text-text">{t("dash.quality.ratingsOf", { n: c.answers, min: MIN_RATINGS })}</span>
        </span>
        <Meter value={c.answers} max={MIN_RATINGS} state={enough ? "met" : "below"} label={t("dash.quality.ratingsLabel", { n: c.answers, min: MIN_RATINGS })} />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="flex justify-between gap-2 text-[0.8125rem] text-soft">
          <span>{t("dash.quality.correct")}</span>
          <span className="num text-text">{c.answers > 0 ? t("dash.quality.correctOf", { p: pct(c.correct, c.answers), n: c.correct, total: c.answers }) : "–"}</span>
        </span>
        <Meter
          value={correctRate}
          max={1}
          threshold={MIN_CORRECT}
          state={c.dangerous > 0 ? "danger" : correctRate >= MIN_CORRECT ? "met" : "below"}
          label={t("dash.quality.correctLabel", { p: pct(c.correct, c.answers || 1), min: pct(MIN_CORRECT, 1) })}
        />
      </div>
      <div className="flex flex-col gap-2 md:items-end">
      <div className="flex items-start gap-2 text-[0.8125rem] md:justify-end md:text-right">
        {status === "danger" ? (
          <><WarningOctagon size={18} weight="fill" className="shrink-0 text-danger-ink" aria-hidden="true" /><span className="font-medium text-danger-ink">{t("dash.quality.dangerous", { n: c.dangerous })}</span></>
        ) : status === "met" ? (
          <><CheckCircle size={18} weight="fill" className="shrink-0 text-signal" aria-hidden="true" /><span className="text-text">{t("dash.quality.met")}</span></>
        ) : status === "below" ? (
          <><Warning size={18} weight="fill" className="shrink-0 text-relief-ink" aria-hidden="true" /><span className="text-text">{t("dash.quality.below")}</span></>
        ) : (
          <span className="text-soft">{t("dash.quality.insufficient", { n: MIN_RATINGS - c.answers })}</span>
        )}
      </div>
      {onGate && c.gate === "shadow" && c.barsMet && (
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => onGate(c, "direct")}>{t("dash.gate.open")}</Button>
      )}
      {onGate && c.gate === "direct" && (
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => onGate(c, "shadow")}>{t("dash.gate.close")}</Button>
      )}
      </div>
    </li>
  );
}
