// Routes de l'application. Chaque surface est chargée à la demande : le widget du salarié n'embarque pas le code de la console.
import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { I18nProvider } from "./lib/i18n/index.tsx";
import { ThemeProvider, type Theme } from "./lib/theme.tsx";
import { TooltipProvider } from "./ui/Overlay.tsx";

const WidgetApp = lazy(() => import("./widget/WidgetApp.tsx"));
const ConsoleApp = lazy(() => import("./console/ConsoleApp.tsx"));
const EsnApp = lazy(() => import("./dashboards/EsnApp.tsx"));
const MonthlyReport = lazy(() => import("./dashboards/MonthlyReport.tsx"));
const AdminApp = lazy(() => import("./dashboards/AdminApp.tsx"));
// Le sommaire de démonstration n'existe qu'en mode démo : absent du paquet de production.
// Expression écrite ici (pas importée) pour que la construction la remplace par une constante et retire le code mort.
const DevIndex = import.meta.env.VITE_RELEVE_DEMO === "1" ? lazy(() => import("./dev/DevIndex.tsx")) : null;

function Surface({ theme, children }: { theme: Theme; children: ReactNode }) {
  return (
    <ThemeProvider defaultTheme={theme}>
      <TooltipProvider>
        <Suspense fallback={null}>{children}</Suspense>
      </TooltipProvider>
    </ThemeProvider>
  );
}

const router = createBrowserRouter([
  { path: "/w/:org", element: <Surface theme="light"><WidgetApp /></Surface> },
  { path: "/console", element: <Surface theme="dark"><ConsoleApp /></Surface> },
  { path: "/esn", element: <Surface theme="dark"><EsnApp /></Surface> },
  { path: "/esn/rapport/:org", element: <Surface theme="light"><MonthlyReport /></Surface> },
  { path: "/admin", element: <Surface theme="dark"><AdminApp /></Surface> },
  { path: "/", element: DevIndex ? <Surface theme="dark"><DevIndex /></Surface> : <Navigate to="/console" replace /> },
  { path: "*", element: <Navigate to="/" replace /> },
]);

export function App() {
  return (
    <I18nProvider>
      <RouterProvider router={router} />
    </I18nProvider>
  );
}
