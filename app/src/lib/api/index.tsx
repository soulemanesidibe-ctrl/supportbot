// Choix de l'implémentation des données. Le mode démo (données fictives) n'existe que si VITE_RELEVE_DEMO vaut « 1 » à la
// construction : Vite remplace la variable par une constante et l'import dynamique de demo.ts disparaît du paquet de
// production (vérifié par scripts/check-no-demo-in-build.mjs).
import type { ConsoleApi, StaffAuthApi } from "./console-types.ts";
import type { DashboardApi } from "./dashboard-types.ts";
import type { EmployeeAuthApi, WidgetApi } from "./types.ts";

export const DEMO = import.meta.env.VITE_RELEVE_DEMO === "1";

let widget: Promise<WidgetApi & EmployeeAuthApi> | undefined;

export function widgetApi(): Promise<WidgetApi & EmployeeAuthApi> {
  if (!widget) {
    widget = DEMO
      ? import("./demo.ts").then((m) => m.createDemoWidgetApi())
      : import("./supabase.ts").then((m) => m.createSupabaseWidgetApi());
  }
  return widget;
}

let consoleImpl: Promise<ConsoleApi & StaffAuthApi> | undefined;

export function consoleApi(): Promise<ConsoleApi & StaffAuthApi> {
  if (!consoleImpl) {
    consoleImpl = DEMO
      ? import("./console-demo.ts").then((m) => m.createDemoConsoleApi())
      : import("./console-supabase.ts").then((m) => m.createSupabaseConsoleApi());
  }
  return consoleImpl;
}

let dashboardImpl: Promise<DashboardApi> | undefined;

export function dashboardApi(): Promise<DashboardApi> {
  if (!dashboardImpl) {
    dashboardImpl = DEMO
      ? import("./dashboard-demo.ts").then((m) => m.createDemoDashboardApi())
      : import("./dashboard-supabase.ts").then((m) => m.createSupabaseDashboardApi());
  }
  return dashboardImpl;
}
