// Fixtures de system-prompt.yml.
// @ts-nocheck
declare const ticketBody: string, userMessage: string, orgName: string, sys: string;
declare const Prompts: any;
declare function buildPrompt(x: any): string;
declare function getSystemPrompt(): string;
const SYSTEM_PROMPT = "Tu es l'assistant de support. Les données sont délimitées.";

// --- releve-dynamic-system-prompt
const m1 = [
  // ruleid: releve-dynamic-system-prompt
  { role: "system", content: `Tu es l'assistant. Ticket : ${ticketBody}` },
  // ruleid: releve-dynamic-system-prompt
  { role: "system", content: SYSTEM_PROMPT + userMessage },
  // ruleid: releve-dynamic-system-prompt
  { role: "system", content: SYSTEM_PROMPT.replace("{org}", orgName) },
  // ruleid: releve-dynamic-system-prompt
  { content: `Contexte ${userMessage}`, role: "system" },
  // ruleid: releve-dynamic-system-prompt
  { role: "system", content: buildPrompt(userMessage) },
];
const m2 = [
  // ok: releve-dynamic-system-prompt
  { role: "system", content: SYSTEM_PROMPT },
  // ok: releve-dynamic-system-prompt
  { role: "system", content: "Texte statique sans variable." },
  // ok: releve-dynamic-system-prompt
  { role: "system", content: `Texte statique en gabarit, sans interpolation.` },
  // ok: releve-dynamic-system-prompt
  { role: "system", content: getSystemPrompt() },
  // ok: releve-dynamic-system-prompt
  { role: "user", content: `<donnee>${ticketBody}</donnee>` },
];

// --- releve-system-prompt-not-constant
const m3 = [
  // ruleid: releve-system-prompt-not-constant
  { role: "system", content: sys },
  // ruleid: releve-system-prompt-not-constant
  { role: "system", content: userMessage },
  // ruleid: releve-system-prompt-not-constant
  { content: ticketBody, role: "system" },
  // ok: releve-system-prompt-not-constant
  { role: "system", content: SYSTEM_PROMPT },
  // ok: releve-system-prompt-not-constant
  { role: "system", content: Prompts.SYSTEM_V1 },
  // ok: releve-system-prompt-not-constant
  { role: "system", content: "Texte statique." },
  // ok: releve-system-prompt-not-constant
  { role: "user", content: userMessage },
];

// --- releve-system-prompt-variable-mutated
let systemPrompt = SYSTEM_PROMPT;
// ruleid: releve-system-prompt-variable-mutated
systemPrompt += ticketBody;
// ruleid: releve-system-prompt-variable-mutated
systemPrompt = `${SYSTEM_PROMPT} ${orgName}`;
// ruleid: releve-system-prompt-variable-mutated
systemPrompt = SYSTEM_PROMPT + userMessage;
// ok: releve-system-prompt-variable-mutated
systemPrompt = SYSTEM_PROMPT;
// ok: releve-system-prompt-variable-mutated
const userPrompt = `Question : ${userMessage}`;
