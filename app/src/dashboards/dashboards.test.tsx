import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CategoryQuality, PartnerClientRow, SupportSummary as Summary } from "../lib/api/dashboard-types.ts";
import { TooltipProvider } from "../ui/Overlay.tsx";
import { opportunities, urgency } from "./EsnApp.tsx";
import { QualityPanel } from "./QualityPanel.tsx";
import { SupportSummary } from "./SupportSummary.tsx";

// L'écran administrateur se branche sur l'API de démonstration (aucun réseau), déjà connectée.
vi.mock("../lib/api/index.tsx", async () => {
  const { createDemoDashboardApi } = await import("../lib/api/dashboard-demo.ts");
  // Une API neuve à chaque écran monté : chaque test part sans vérification récente du second facteur.
  return { dashboardApi: () => Promise.resolve({ ...createDemoDashboardApi({ latencyMs: 1 }), resume: () => Promise.resolve(true) }) };
});
const { default: AdminApp } = await import("./AdminApp.tsx");

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const client = (name: string, over: Partial<PartnerClientRow> = {}): PartnerClientRow => ({
  orgId: name, name, slug: name, labels: [], orgState: "active", frozen: false, activated: true, relationshipStatus: "active",
  relationshipExpiresAt: inDays(365), reliefActive: true, reliefUntil: null, absences90d: 0, openIncidents: 0, majorIncidents: 0,
  pendingActions: 0, waitingTechnician: 0, slaAtRisk: 0, connectorsInError: 0, conversations30d: 0, resolvedByReleve30d: 0,
  satisfactionAvg30d: null, satisfactionN30d: 0, assignedTechnicians: 1, clientPriceCents: null, partnerPriceCents: null, ...over,
});
const quality = (category: CategoryQuality["category"], over: Partial<CategoryQuality>): CategoryQuality => ({
  category, gate: "shadow", conversations: 1, answers: 0, correct: 0, partial: 0, wrong: 0, dangerous: 0, escalations: 0,
  escalationsJustified: 0, missedEscalations: 0, barsMet: false, ...over,
});

describe("écran ESN : lequel de mes clients a besoin de moi maintenant", () => {
  it("ordre d'urgence : incident majeur, puis SLA en danger, connecteur en erreur, action à valider, attente d'un technicien", () => {
    const rows = [
      client("attente", { waitingTechnician: 4 }),
      client("valider", { pendingActions: 1 }),
      client("connecteur", { connectorsInError: 1 }),
      client("sla", { slaAtRisk: 1 }),
      client("majeur", { majorIncidents: 1, openIncidents: 1 }),
      client("calme"),
    ];
    expect([...rows].sort((a, b) => urgency(b) - urgency(a)).map((c) => c.name)).toEqual(["majeur", "sla", "connecteur", "valider", "attente", "calme"]);
  });

  it("opportunités : règles simples et explicables, jamais devinées", () => {
    const found = opportunities([
      client("absences", { reliefActive: false, absences90d: 3 }),
      client("une-absence", { reliefActive: false, absences90d: 1 }),
      client("pilote", { orgState: "pilot", relationshipExpiresAt: inDays(20) }),
      client("pilote-loin", { orgState: "pilot", relationshipExpiresAt: inDays(200) }),
      client("preuve", { conversations30d: 120, resolvedByReleve30d: 40, satisfactionAvg30d: 4.6, satisfactionN30d: 30 }),
      client("peu-de-notes", { conversations30d: 120, resolvedByReleve30d: 40, satisfactionAvg30d: 4.9, satisfactionN30d: 3 }),
    ]);
    expect(found.map((o) => `${o.client.name}:${o.kind}`)).toEqual(["absences:relief", "pilote:pilot", "preuve:proof"]);
  });
});

describe("Qualité de Relève : les vrais chiffres, y compris les mauvais", () => {
  it("chaque catégorie dit où elle en est, avec son effectif ; une réponse dangereuse se voit en premier", () => {
    render(
      <QualityPanel
        categories={[
          quality("password", { gate: "direct", answers: 320, correct: 290, barsMet: true }),
          quality("vpn", { answers: 120, correct: 110 }),
          quality("printer", { answers: 310, correct: 200 }),
          quality("outlook", { gate: "advice_only", answers: 300, correct: 280, dangerous: 1 }),
          quality("other", { conversations: 0 }),
        ]}
      />,
    );
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(within(rows[0] as HTMLElement).getByText("Barres atteintes")).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText("Réponse directe")).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText("Encore 180 notes à recueillir")).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText("Sous la barre")).toBeTruthy();
    expect(within(rows[3] as HTMLElement).getByText("1 réponse dangereuse : retour au conseil seul")).toBeTruthy();
    expect(screen.getByText("1 autre catégorie sans demande ni note sur la période.")).toBeTruthy();
    const meter = screen.getByRole("meter", { name: "120 notes sur les 300 nécessaires" });
    expect(meter.getAttribute("aria-valuenow")).toBe("120");
    expect(meter.getAttribute("aria-valuemax")).toBe("300");
  });
});

describe("état du support", () => {
  it("chaque chiffre porte son effectif ; une médiane absente s'affiche « – », jamais 0", () => {
    const s: Summary = {
      conversations: 40, resolvedByReleve: 10, resolvedByTeam: 25, waitingTechnician: 3, waitingUser: 2, escalated: 22, duringRelief: 1,
      firstAnswerMedianSeconds: 42, firstAnswerN: 38, resolutionMedianMinutes: null, resolutionN: 0, satisfactionAvg: 4.25, satisfactionN: 1,
    };
    render(<SupportSummary s={s} days={30} />);
    expect(screen.getByText("42 s")).toBeTruthy();
    expect(screen.getByText("médiane, sur 38 demandes")).toBeTruthy();
    expect(screen.getByText("médiane, sur 0 demande")).toBeTruthy();
    expect(screen.getByText("–")).toBeTruthy();
    expect(screen.getByText("sur 1 note")).toBeTruthy();
    expect(screen.getByText(/1 demande est arrivée pendant la relève ; 22 ont été transmises/)).toBeTruthy();
    expect(screen.getByRole("img", { name: /Comment les demandes ont été traitées/ })).toBeTruthy();
  });
});

describe("écran de l'administrateur du client", () => {
  it("élargir l'autonomie demande le second facteur puis rejoue l'opération ; restreindre ne le demande jamais", async () => {
    const user = userEvent.setup();
    render(<TooltipProvider><AdminApp /></TooltipProvider>);
    await screen.findByRole("heading", { name: "Bonjour Paul" });
    const tickets = screen.getByRole("radiogroup", { name: "Tickets" });
    await user.click(within(tickets).getByRole("radio", { name: "Agit après validation" }));

    const dialog = await screen.findByRole("dialog", { name: "Vérification du second facteur" });
    await user.type(within(dialog).getByLabelText(/Code/), "123456");
    await user.click(within(dialog).getByRole("button", { name: "Vérifier et continuer" }));
    await waitFor(() => expect(within(tickets).getByRole("radio", { name: "Agit après validation" }).getAttribute("aria-checked")).toBe("true"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Niveau enregistré.")).toBeTruthy();

    await user.click(within(tickets).getByRole("radio", { name: "Conseille seulement" }));
    await waitFor(() => expect(within(tickets).getByRole("radio", { name: "Conseille seulement" }).getAttribute("aria-checked")).toBe("true"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("ouvrir une catégorie aux réponses directes : seulement si les barres sont atteintes, expliqué, confirmé, second facteur ; refermer est immédiat", async () => {
    const user = userEvent.setup();
    render(<TooltipProvider><AdminApp /></TooltipProvider>);
    await screen.findByRole("heading", { name: "Bonjour Paul" });
    // Mots de passe : barres atteintes, encore en mode ombre. Outlook : pas assez de notes, aucun bouton.
    expect(screen.getAllByRole("button", { name: "Ouvrir aux réponses directes" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Ouvrir aux réponses directes" }));
    const confirm = await screen.findByRole("dialog", { name: "Ouvrir « Mots de passe » aux réponses directes" });
    expect(within(confirm).getByText(/une seule réponse jugée dangereuse/)).toBeTruthy();
    await user.click(within(confirm).getByRole("button", { name: "Ouvrir aux réponses directes" }));
    const stepUp = await screen.findByRole("dialog", { name: "Vérification du second facteur" });
    await user.type(within(stepUp).getByLabelText(/Code/), "123456");
    await user.click(within(stepUp).getByRole("button", { name: "Vérifier et continuer" }));
    await screen.findByText("Catégorie ouverte aux réponses directes.");
    expect(screen.queryByRole("button", { name: "Ouvrir aux réponses directes" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Revenir au mode ombre" })).toHaveLength(2);

    await user.click(screen.getAllByRole("button", { name: "Revenir au mode ombre" })[0] as HTMLElement);
    await screen.findByText(/Catégorie revenue au mode ombre/);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("arrêt d'urgence : confirmé en un geste, sans nouvelle vérification ; l'autonomie ne se règle plus tant qu'il dure", async () => {
    const user = userEvent.setup();
    render(<TooltipProvider><AdminApp /></TooltipProvider>);
    await screen.findByRole("heading", { name: "Bonjour Paul" });
    await user.click(screen.getByRole("button", { name: "Déclencher l'arrêt d'urgence" }));
    const dialog = await screen.findByRole("dialog", { name: "Arrêt d'urgence" });
    await user.click(within(dialog).getByRole("button", { name: "Déclencher l'arrêt d'urgence" }));
    await screen.findByText(/Arrêt d'urgence en cours/);
    expect(screen.getByText(/Arrêt d'urgence déclenché/)).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Vérification du second facteur" })).toBeNull();
    for (const r of screen.getAllByRole("radio")) expect(r.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Lever l'arrêt d'urgence" })).toBeTruthy();
  });
});
