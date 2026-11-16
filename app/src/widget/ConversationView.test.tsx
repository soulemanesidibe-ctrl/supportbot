import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createDemoWidgetApi } from "../lib/api/demo.ts";
import type { WidgetContext } from "../lib/api/types.ts";
import { TooltipProvider } from "../ui/Overlay.tsx";
import { ConversationView } from "./ConversationView.tsx";

const ctx: WidgetContext = {
  orgName: "Cabinet Alpha",
  brand: { name: "Nord Numérique" },
  user: { firstName: "Camille" },
  relief: { active: false },
  incidents: [],
  synthetic: true,
};

function setup(initialText?: string) {
  const api = createDemoWidgetApi({ latencyMs: 5 });
  render(
    <TooltipProvider>
      <ConversationView api={api} ctx={ctx} conversationId={null} onBack={() => {}} onCreated={() => {}} initialText={initialText} />
    </TooltipProvider>,
  );
  return api;
}

describe("fil d'une demande", () => {
  it("le premier message écrit depuis l'accueil part une seule fois, puis la réponse validée s'affiche avec sa question de suivi", async () => {
    setup("L'imprimante n'imprime plus");
    await screen.findByText("Est-ce que ça a fonctionné ?");
    const thread = screen.getByRole("log");
    expect(within(thread).getAllByText("L'imprimante n'imprime plus")).toHaveLength(1);
    expect(screen.getByText(/Relève · Assistant IA/)).toBeTruthy();
  });

  it("une demande sur un compte n'est jamais traitée dans le chat : message fixe et état « en attente d'un technicien »", async () => {
    setup("Mon mot de passe a expiré");
    await screen.findByText("Action sur votre compte");
    expect(screen.getByText(/un technicien doit d'abord vérifier votre identité/)).toBeTruthy();
    expect(screen.getByText("En attente d'un technicien")).toBeTruthy();
  });

  it("« Parler à un technicien » reste disponible et demande confirmation avant de transmettre", async () => {
    setup("Teams ne démarre pas");
    await screen.findByText("Est-ce que ça a fonctionné ?");
    await userEvent.click(screen.getAllByRole("button", { name: "Parler à un technicien" })[0]!);
    const confirm = await screen.findByRole("button", { name: "Transmettre à un technicien" });
    await userEvent.click(confirm);
    await waitFor(() => expect(screen.getByText(/C'est transmis/)).toBeTruthy());
  });
});
