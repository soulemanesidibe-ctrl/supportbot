// Rapport mensuel par client, à la marque de l'ESN (docs/10 § 5.2, docs/11 § 3) : ce que Relève et l'équipe ont traité, avec un
// bloc « Prochaine étape ». Page imprimable (Imprimer, puis « Enregistrer en PDF »), en thème clair. Chiffres réels avec leur
// effectif ; aucune estimation de « temps gagné ». Aucun contenu de conversation (SEC-26) ; le prix et la marge n'y figurent jamais.
import { ArrowLeft, Printer } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { Button } from "../ui/Button.tsx";
import { Skeleton } from "../ui/Skeleton.tsx";
import type { DashboardApi, OrgSummary, PartnerClientRow, PartnerContext } from "../lib/api/dashboard-types.ts";
import { useLang, useT, type MessageKey } from "../lib/i18n/index.tsx";
import { pct, SegmentedBar } from "./charts.tsx";
import { opportunities } from "./EsnApp.tsx";
import { MIN_RATINGS } from "./QualityPanel.tsx";
import { StaffShell } from "./StaffShell.tsx";
import { useDurationLabel } from "./SupportSummary.tsx";

const dec = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

export default function MonthlyReportPage() {
  const t = useT();
  return <StaffShell title={t("dash.report.title")} signIn={{ title: t("dash.esn.signin.title"), lede: t("dash.esn.signin.lede"), verify: t("dash.report.signin.verify") }}>{(api) => <Report api={api} />}</StaffShell>;
}

function Report({ api }: { api: DashboardApi }) {
  const t = useT();
  const [lang] = useLang();
  const duration = useDurationLabel();
  const { org = "" } = useParams();
  const [data, setData] = useState<{ p: PartnerContext; c: PartnerClientRow; s: OrgSummary } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const p = await api.partner();
        if (!p) throw new Error("pas une ESN");
        const c = (await api.partnerClients(p.partnerId)).find((x) => x.orgId === org);
        if (!c) throw new Error("client inconnu");
        const s = await api.orgSummary(org, 30);
        if (alive) setData({ p, c, s });
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [api, org]);

  const fmt = (d: Date) => new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(d);

  return (
    <div data-theme="light" className="min-h-dvh bg-bg text-text">
      <header className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-6 py-4 print:hidden">
        <Button asChild variant="quiet" size="sm">
          <Link to="/esn">
            <ArrowLeft size={18} aria-hidden="true" />
            <span className="whitespace-nowrap">{t("dash.report.back")}</span>
          </Link>
        </Button>
        <Button variant="primary" size="sm" onClick={() => window.print()} disabled={!data}>
          <Printer size={18} aria-hidden="true" />
          <span className="sm:hidden">{t("dash.report.printShort")}</span>
          <span className="hidden sm:inline">{t("dash.report.print")}</span>
        </Button>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-10 bg-surface px-6 py-10 sm:px-10 print:max-w-none print:bg-white print:p-0">
        {failed ? (
          <p role="alert">{t("dash.report.unavailable")}</p>
        ) : !data ? (
          <div role="status" className="flex flex-col gap-4"><span className="sr-only">{t("common.loading")}</span><Skeleton className="h-10 w-2/3" /><Skeleton className="h-40 w-full" /></div>
        ) : (
          <ReportBody data={data} fmt={fmt} duration={duration} />
        )}
      </main>
    </div>
  );
}

function ReportBody({ data, fmt, duration }: { data: { p: PartnerContext; c: PartnerClientRow; s: OrgSummary }; fmt: (d: Date) => string; duration: (s: number | null) => string }) {
  const t = useT();
  const { p, c, s } = data;
  const sup = s.support;
  const end = new Date();
  const start = new Date(end.getTime() - s.days * 86_400_000);
  const open = s.categories.filter((x) => x.gate === "direct");
  const close = s.categories.filter((x) => x.gate !== "direct" && x.answers >= MIN_RATINGS * 0.6 && x.dangerous === 0);
  // Les mauvais chiffres aussi (docs/11 § 2) : une réponse jugée dangereuse se dit au client, avec ce qui a été fait.
  const danger = s.categories.filter((x) => x.dangerous > 0);
  const names = (xs: readonly { category: string }[]) => xs.map((x) => t(`category.${x.category}` as MessageKey)).join(", ");
  const next = opportunities([c])[0];
  const inProgress = Math.max(0, sup.conversations - sup.resolvedByReleve - sup.resolvedByTeam);

  return (
    <article className="flex flex-col gap-10" aria-labelledby="rapport-titre">
      <header className="flex flex-col gap-3 border-b border-border pb-8">
        <p className="text-sm font-semibold text-text">{p.partnerName}</p>
        <h1 id="rapport-titre" className="text-3xl font-semibold leading-tight tracking-[-0.03em]">{t("dash.report.heading", { client: c.name })}</h1>
        <p className="text-[0.9375rem] text-soft">{t("dash.report.period", { from: fmt(start), to: fmt(end) })}</p>
      </header>

      <section aria-labelledby="r-traite" className="flex flex-col gap-4">
        <h2 id="r-traite" className="text-lg font-semibold tracking-[-0.02em]">{t("dash.report.handled")}</h2>
        <ul className="flex flex-col gap-2 text-[0.9375rem] leading-relaxed">
          <li>{t("dash.report.l.requests", { n: sup.conversations })}</li>
          <li>{t("dash.report.l.releve", { n: sup.resolvedByReleve, p: pct(sup.resolvedByReleve, sup.conversations) })}</li>
          <li>{t("dash.report.l.team", { n: sup.resolvedByTeam, esn: p.partnerName })}</li>
          <li>{t("dash.report.l.relief", { n: sup.duringRelief })}</li>
          <li>{t("dash.report.l.firstAnswer", { d: duration(sup.firstAnswerMedianSeconds), n: sup.firstAnswerN })}</li>
          {sup.satisfactionAvg !== null && <li>{t("dash.report.l.satisfaction", { s: dec.format(sup.satisfactionAvg), n: sup.satisfactionN })}</li>}
        </ul>
        <SegmentedBar
          label={t("dash.split.title")}
          parts={[
            { key: "releve", label: t("dash.split.releve"), value: sup.resolvedByReleve, tone: "accent" },
            { key: "team", label: t("dash.split.team"), value: sup.resolvedByTeam, tone: "mid" },
            { key: "open", label: t("dash.split.open"), value: inProgress, tone: "low" },
          ]}
        />
      </section>

      <section aria-labelledby="r-qualite" className="flex flex-col gap-3">
        <h2 id="r-qualite" className="text-lg font-semibold tracking-[-0.02em]">{t("dash.quality.title")}</h2>
        <p className="text-[0.9375rem] leading-relaxed">
          {open.length > 0 ? t("dash.report.q.open", { list: names(open) }) : t("dash.report.q.none")}
          {" "}
          {t("dash.report.q.rule", { min: MIN_RATINGS })}
        </p>
        {danger.length > 0 && (
          <p className="text-[0.9375rem] leading-relaxed">{t("dash.report.q.danger", { list: names(danger), n: danger.length })}</p>
        )}
      </section>

      <section aria-labelledby="r-suite" className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-signal-soft p-5">
        <h2 id="r-suite" className="text-lg font-semibold tracking-[-0.02em]">{t("dash.report.next")}</h2>
        <p className="text-[0.9375rem] leading-relaxed">
          {next?.kind === "relief"
            ? t("dash.report.next.relief", { n: c.absences90d })
            : next?.kind === "pilot"
              ? t("dash.report.next.pilot")
              : close.length > 0
                ? t("dash.report.next.open", { list: names(close) })
                : t("dash.report.next.default")}
        </p>
      </section>

      <footer className="border-t border-border pt-6 text-[0.8125rem] leading-relaxed text-soft">{t("dash.report.footer", { esn: p.partnerName })}</footer>
    </article>
  );
}
