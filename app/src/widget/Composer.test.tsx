import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MAX_MESSAGE_LENGTH } from "../lib/api/types.ts";
import { Composer } from "./Composer.tsx";

describe("zone de saisie du salarié", () => {
  it("Entrée envoie le texte nettoyé ; Maj + Entrée va à la ligne", async () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const box = screen.getByRole("textbox", { name: "Votre message" });
    await userEvent.type(box, "  Outlook plante{Shift>}{Enter}{/Shift}au démarrage  ");
    expect(onSend).not.toHaveBeenCalled();
    await userEvent.keyboard("{Enter}");
    expect(onSend).toHaveBeenCalledWith("Outlook plante\nau démarrage");
    expect(box).toHaveProperty("value", "");
  });

  it("un message vide ou trop long n'est pas envoyé, et la raison est dite", async () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const box = screen.getByRole("textbox", { name: "Votre message" });
    await userEvent.type(box, "   {Enter}");
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: "x".repeat(MAX_MESSAGE_LENGTH + 1) } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain(String(MAX_MESSAGE_LENGTH));
    expect(screen.getByRole("button", { name: "Envoyer" })).toHaveProperty("disabled", true);
  });

  it("rappelle en permanence de ne jamais écrire son mot de passe", () => {
    render(<Composer onSend={() => {}} />);
    expect(screen.getByText(/N'écrivez jamais votre mot de passe/)).toBeTruthy();
  });
});
