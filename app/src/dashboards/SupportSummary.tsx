// « État du support » d'un client : quatre chiffres avec leur effectif, puis comment les demandes ont été traitées (une part mise
// en avant : résolues par Relève ET confirmées par le salarié), avec la vue tableau des mêmes chiffres.
import type { SupportSummary as Summary } from "../lib/api/dashboard-types.ts";
import { useT } from "../lib/i18n/index.tsx";
import { Figure, pct, SegmentedBar } from "./charts.tsx";

const dec = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

export function useDurationLabel() {
  const t = useT();
  return (seconds: number | null): string => {
    if (seconds === null) return "–";
    if (seconds < 60) return t("dash.unit.s", { n: Math.round(seconds) });
    const m = Math.round(seconds / 60);
    if (m < 120) return t("dash.unit.min", { n: m });
    return t("dash.unit.h", { n: Math.round(m / 60) });
  };
}

export function SupportSummary({ s, days }: { s: Summary; days: number }) {
  const t = useT();
  const duration = useDurationLabel();
  const inProgress = Math.max(0, s.conversations - s.resolvedByReleve - s.resolvedByTeam);
  const rows = [
    [t("dash.split.releve"), s.resolvedByReleve],
    [t("dash.split.team"), s.resolvedByTeam],
    [t("dash.split.open"), inProgress],
  ] as const;
  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-4">
        <Figure label={t("dash.fig.requests")} value={s.conversations} basis={t("dash.basis.days", { n: days })} />
        <Figure label={t("dash.fig.firstAnswer")} value={duration(s.firstAnswerMedianSeconds)} basis={t("dash.basis.median", { n: s.firstAnswerN })} />
        <Figure label={t("dash.fig.resolution")} value={duration(s.resolutionMedianMinutes === null ? null : s.resolutionMedianMinutes * 60)} basis={t("dash.basis.median", { n: s.resolutionN })} />
        <Figure
          label={t("dash.fig.satisfaction")}
          value={s.satisfactionAvg === null ? "–" : t("dash.unit.outOf5", { n: dec.format(s.satisfactionAvg) })}
          basis={t("dash.basis.ratings", { n: s.satisfactionN })}
        />
      </dl>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-text">{t("dash.split.title")}</h3>
        <SegmentedBar
          label={t("dash.split.title")}
          parts={[
            { key: "releve", label: rows[0][0], value: rows[0][1], tone: "accent" },
            { key: "team", label: rows[1][0], value: rows[1][1], tone: "mid" },
            { key: "open", label: rows[2][0], value: rows[2][1], tone: "low" },
          ]}
        />
        <p className="text-[0.8125rem] text-soft">
          {t("dash.split.note", { relief: s.duringRelief, escalated: s.escalated })}
        </p>
        <details className="text-[0.8125rem] text-soft">
          <summary className="min-h-11 cursor-pointer content-center">{t("dash.table.show")}</summary>
          <table className="mt-2 w-full max-w-md text-left">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="py-1.5 font-medium">{t("dash.table.part")}</th>
                <th scope="col" className="py-1.5 text-right font-medium">{t("dash.table.count")}</th>
                <th scope="col" className="py-1.5 text-right font-medium">{t("dash.table.share")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, n]) => (
                <tr key={label} className="border-b border-border text-text">
                  <th scope="row" className="py-1.5 font-normal">{label}</th>
                  <td className="py-1.5 text-right">{n}</td>
                  <td className="py-1.5 text-right">{pct(n, s.conversations)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
    </div>
  );
}
