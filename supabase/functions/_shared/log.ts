// Journal applicatif : une ligne JSON par événement, TOUJOURS masquée (redact). Les logs des Edge Functions sont lisibles par
// quiconque a accès au projet : on n'y écrit ni secret, ni contenu de conversation, ni donnée personnelle superflue.
// Ce journal n'est PAS le journal d'audit (table audit_logs, insertion seule) : il sert au diagnostic et expire seul.
import { redact } from "./redact.ts";

export { MASK, redact, redactText } from "./redact.ts";

type Level = "info" | "warn" | "error";

function emit(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  const entry = { t: new Date().toISOString(), level, event: String(event).slice(0, 100), ...(redact(fields) as object) };
  const line = JSON.stringify(entry);
  // La ligne est déjà passée par redact() : c'est la seule sortie console autorisée du projet.
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export const log = {
  info: (event: string, fields?: Record<string, unknown>) => emit("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => emit("error", event, fields),
};
