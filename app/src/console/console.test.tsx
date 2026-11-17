import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createDemoConsoleApi } from "../lib/api/console-demo.ts";
import type { ApprovalDetail, ConsoleApi, ConsoleContext, QueueItem } from "../lib/api/console-types.ts";
import { TooltipProvider } from "../ui/Overlay.tsx";
import { ApprovalPane } from "./ApprovalPane.tsx";
import { ConversationPane } from "./ConversationPane.tsx";
import { filterQueue, sortQueue } from "./Queue.tsx";

const client = { id: "c1", name: "Client" };
const at = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const item = (key: string, over: Partial<QueueItem>): QueueItem => ({
  key, kind: "escalation", client, title: key, detail: "", priority: "normal", since: at(10), target: { type: "conversation", id: key }, ...over,
});

describe("file unifiée", () => {
  it("ordre : priorité, puis échéance la plus proche, puis nature, puis ancienneté", () => {
    const sorted = sortQueue([
      item("ancienne", { since: at(90) }),
      item("recente", { since: at(5) }),
      item("sla-loin", { kind: "sla", priority: "high", slaDueAt: new Date(Date.now() + 120 * 60_000).toISOString() }),
      item("sla-proche", { kind: "sla", priority: "high", slaDueAt: new Date(Date.now() + 10 * 60_000).toISOString() }),
      item("incident", { kind: "incident", priority: "urgent" }),
      item("validation", { kind: "approval", priority: "normal", since: at(1) }),
      item("prevention", { kind: "prevention", priority: "low" }),
    ]);
    expect(sorted.map((i) => i.key)).toEqual(["incident", "sla-proche", "sla-loin", "validation", "ancienne", "recente", "prevention"]);
  });

  it("filtres : chaque élément est dans « Tout » et dans exactement un autre filtre", () => {
    const all = [item("a", { kind: "approval" }), item("i", { kind: "incident" }), item("p", { kind: "prevention" }), item("e", { kind: "escalation" }), item("s", { kind: "sla" })];
    expect(filterQueue(all, "all")).toHaveLength(5);
    const others = (["approval", "incident", "request"] as const).map((f) => filterQueue(all, f).map((x) => x.key));
    expect(others).toEqual([["a"], ["i", "p"], ["e", "s"]]);
  });
});

function withProviders(ui: React.ReactNode) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe("demande vue du technicien", () => {
  it("le brouillon du mode ombre est signalé « non envoyé » et se note ; la note interne est marquée et n'est pas une réponse", async () => {
    const api = createDemoConsoleApi({ latencyMs: 1 });
    const user = userEvent.setup();
    withProviders(<ConversationPane api={api} clientId="c-morel" id="v-morel-imprimante" onChanged={() => {}} />);
    await screen.findByRole("heading", { name: /Imprimante quai B/ });
    expect(screen.getByText("Brouillon de Relève, non envoyé")).toBeTruthy();
    expect(screen.getAllByText("Visible des techniciens seulement").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Correcte" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Correcte" }).getAttribute("aria-pressed")).toBe("true"));
    expect(screen.getByRole("button", { name: "Dangereuse" }).hasAttribute("disabled")).toBe(true);

    await user.click(screen.getByRole("checkbox", { name: /Note interne/ }));
    await user.type(screen.getByRole("textbox"), "Rouleau à changer jeudi");
    await user.click(screen.getByRole("button", { name: "Ajouter la note" }));
    await screen.findByText(/Note ajoutée/);
    const thread = screen.getByRole("list", { name: "Fil de la conversation" });
    const note = within(thread).getByText("Rouleau à changer jeudi").closest("li") as HTMLElement;
    expect(within(note).getByText("Visible des techniciens seulement")).toBeTruthy();
  });
});

describe("validation d'une action", () => {
  const ctx: ConsoleContext = { me: { firstName: "Inès" }, clients: [client], actingFor: [], synthetic: true };
  const action: ApprovalDetail = {
    id: "a1", client, capability: "user.reset_password", target: "j.martin@client.test", requestedAt: at(5),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(), paramsHash: "f".repeat(64), context: ["Mot de passe expiré"], riskFlags: ["Deuxième demande en 7 jours"],
    identityRequired: true,
  };
  const fakeApi = (over: Partial<ConsoleApi> = {}) =>
    ({ approval: vi.fn().mockResolvedValue(action), approve: vi.fn().mockResolvedValue({ outcome: "succeeded" }), reject: vi.fn().mockResolvedValue(undefined), ...over }) as unknown as ConsoleApi;

  it("impossible de valider avant d'avoir dit comment l'identité a été vérifiée ; puis validation avec cette méthode", async () => {
    const api = fakeApi();
    const onDone = vi.fn();
    const user = userEvent.setup();
    withProviders(<ApprovalPane api={api} ctx={ctx} clientId="c1" id="a1" onDone={onDone} />);
    const approve = await screen.findByRole("button", { name: /Valider et exécuter/ });
    expect(approve.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Deuxième demande en 7 jours")).toBeTruthy();
    expect(screen.getByText(/jamais avec ceux de Relève/)).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: "Rappel au numéro de l'annuaire" }));
    expect(approve.hasAttribute("disabled")).toBe(false);
    await user.click(approve);
    await waitFor(() => expect(api.approve).toHaveBeenCalledWith("c1", action, "callback", undefined));
    expect(onDone).toHaveBeenCalledWith("Fait : Réinitialiser le mot de passe de j.martin.");
  });

  it("refus : motif choisi dans une liste fermée ; une action expirée ne se valide pas", async () => {
    const api = fakeApi();
    const user = userEvent.setup();
    withProviders(<ApprovalPane api={api} ctx={ctx} clientId="c1" id="a1" onDone={() => {}} />);
    await user.click(await screen.findByRole("button", { name: "Refuser" }));
    await user.selectOptions(screen.getByLabelText("Motif du refus"), "mauvaise_cible");
    await user.click(screen.getByRole("button", { name: /Confirmer le refus/ }));
    await waitFor(() => expect(api.reject).toHaveBeenCalledWith("c1", "a1", "mauvaise_cible"));

    const expired = fakeApi({ approval: vi.fn().mockResolvedValue({ ...action, expiresAt: at(1) }) });
    withProviders(<ApprovalPane api={expired} ctx={ctx} clientId="c1" id="a1" onDone={() => {}} />);
    const buttons = await screen.findAllByRole("button", { name: /Valider et exécuter/ });
    await user.click(screen.getAllByRole("radio", { name: "En personne" }).at(-1) as HTMLElement);
    expect((buttons.at(-1) as HTMLElement).hasAttribute("disabled")).toBe(true);
  });

  it("validation refusée par Microsoft ou par le serveur : message clair, rien n'est annoncé comme fait", async () => {
    const api = fakeApi({ approve: vi.fn().mockRejectedValue(new Error("refus")) });
    const onDone = vi.fn();
    const user = userEvent.setup();
    withProviders(<ApprovalPane api={api} ctx={ctx} clientId="c1" id="a1" onDone={onDone} />);
    await user.click(await screen.findByRole("radio", { name: "En personne" }));
    await user.click(screen.getByRole("button", { name: /Valider et exécuter/ }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/rien n'a été exécuté/);
    expect(onDone).not.toHaveBeenCalled();
  });
});
