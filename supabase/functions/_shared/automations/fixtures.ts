// Données de test (jamais importées par du code de production).
import { RuleRow } from "./rules.ts";

// Les trois règles « alerte » livrées par la plateforme, telles que les migrations 8 et 15 les écrivent.
export const PLATFORM_ROWS: RuleRow[] = [
  {
    org_id: null, key: "incident-grouped", version: 1, enabled: true, dry_run: false, autonomy: 0, locked: false, trigger_kind: "alert.opened",
    definition: {
      all: [
        { field: "alert.severity", op: "in", value: ["major", "critical"] },
        { field: "alert.attachment", op: "eq", value: "attached" },
        { field: "conversations.same_category_15min", op: "gte", value: 2 },
      ],
      action: { kind: "group_into_incident", params: { notify_users: "template", notify_oncall: "yes" } },
      limits: { maxRunsPerHour: 20, maxItemsPerRun: 100, cooldownMinutes: 5 },
    },
  },
  {
    org_id: null, key: "incident-resolved", version: 2, enabled: true, dry_run: false, autonomy: 1, locked: false, trigger_kind: "alert.resolved",
    definition: {
      all: [{ field: "alert.incident", op: "exists" }, { field: "incident.resolved", op: "eq", value: true }],
      action: { kind: "propose_close_children", params: { notify_users: "template" } },
      limits: { maxRunsPerHour: 20, maxItemsPerRun: 200, cooldownMinutes: 0 },
    },
  },
  {
    org_id: null, key: "source-silent", version: 1, enabled: true, dry_run: false, autonomy: 0, locked: false, trigger_kind: "alert.source_silent",
    definition: { all: [], action: { kind: "notify_oncall", params: { create_alert: "yes" } }, limits: { maxRunsPerHour: 10, maxItemsPerRun: 10, cooldownMinutes: 60 } },
  },
];
