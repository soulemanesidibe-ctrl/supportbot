// Fixtures de llm-prompt.yml. `ruleid:` = la ligne suivante DOIT être signalée, `ok:` = non.
// Rien ici ne s'exécute : ce fichier n'est ni compilé ni déployé.
// @ts-nocheck
declare const ticketBody: string, userMessage: string;
declare function load(): string;

// --- releve-define-prompt-outside-prompts (ce fichier n'est pas llm/prompts.ts)
// ruleid: releve-define-prompt-outside-prompts
import { definePrompt } from "./prompt_registry.ts";
// ruleid: releve-define-prompt-outside-prompts
const p1 = definePrompt("support.chat", "v1", "Texte statique du prompt.");

// --- releve-define-prompt-dynamic-text (chaque appel est aussi signalé par la règle « outside » : ce fichier n'est pas llm/prompts.ts ;
// les lignes d5 et d6 prouvent que la règle « dynamic-text » laisse passer un littéral)
// ruleid: releve-define-prompt-outside-prompts, releve-define-prompt-dynamic-text
const d1 = definePrompt("support.chat", "v2", userMessage);
// ruleid: releve-define-prompt-outside-prompts, releve-define-prompt-dynamic-text
const d2 = definePrompt("support.chat", "v2", `Contexte : ${ticketBody}`);
// ruleid: releve-define-prompt-outside-prompts, releve-define-prompt-dynamic-text
const d3 = definePrompt("support.chat", "v2", "Début " + ticketBody);
// ruleid: releve-define-prompt-outside-prompts, releve-define-prompt-dynamic-text
const d4 = definePrompt("support.chat", "v2", load());
// ruleid: releve-define-prompt-outside-prompts
const d5 = definePrompt("support.chat", "v2", "Texte littéral.");
// ruleid: releve-define-prompt-outside-prompts
const d6 = definePrompt("support.chat", "v2", `Texte littéral en gabarit, sans interpolation.`);
