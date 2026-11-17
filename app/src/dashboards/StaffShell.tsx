// Cadre commun des écrans du personnel hors console (ESN, administrateur du client) : connexion avec second facteur obligatoire,
// barre du haut, et nouvelle vérification du second facteur avant une opération sensible (moins de 10 minutes, côté serveur).
import { Moon, SignOut, Sun } from "@phosphor-icons/react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Badge } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";
import { Field, Input } from "../ui/Field.tsx";
import { Logo, LogoMark } from "../ui/Logo.tsx";
import { Dialog, Tooltip } from "../ui/Overlay.tsx";
import { dashboardApi } from "../lib/api/index.tsx";
import type { DashboardApi } from "../lib/api/dashboard-types.ts";
import { ApiError } from "../lib/api/supabase.ts";
import { useT } from "../lib/i18n/index.tsx";
import { useTheme } from "../lib/theme.tsx";
import { StaffSignIn, type SignInTexts } from "../console/StaffSignIn.tsx";

export function StaffShell({ title, signIn, children }: { title: string; signIn: SignInTexts; children: (api: DashboardApi, signOut: () => void) => ReactNode }) {
  const t = useT();
  const [api, setApi] = useState<DashboardApi | null>(null);
  const [auth, setAuth] = useState<"checking" | "out" | "in">("checking");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    document.title = `${title} · Relève`;
  }, [title]);

  useEffect(() => {
    let alive = true;
    dashboardApi().then(
      async (a) => {
        if (!alive) return;
        setApi(a);
        const ok = await a.resume().catch(() => false);
        if (alive) setAuth(ok ? "in" : "out");
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, []);

  if (failed) return <main className="mx-auto flex min-h-dvh max-w-md items-center px-5"><p role="alert" className="text-text">{t("console.unavailable")}</p></main>;
  if (!api || auth === "checking") return <div role="status" className="min-h-dvh bg-bg"><span className="sr-only">{t("common.loading")}</span></div>;
  if (auth === "out") return <StaffSignIn api={api} texts={signIn} onSignedIn={() => setAuth("in")} />;
  const signOut = () => void api.signOut().finally(() => setAuth("out"));
  return <>{children(api, signOut)}</>;
}

export function TopBar({ title, synthetic, onSignOut, children }: { title: string; synthetic?: boolean; onSignOut: () => void; children?: ReactNode }) {
  const t = useT();
  const { theme, toggle } = useTheme();
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-3 sm:px-4 print:hidden">
      {/* Sur téléphone, le symbole seul : la place va au nom de l'organisation, tronqué plutôt que replié sur trois lignes. */}
      <LogoMark title="Relève" className="size-6 sm:hidden" />
      <Logo size="sm" className="hidden sm:inline-flex" />
      <span className="min-w-0 truncate border-l border-border pl-3 text-sm text-soft">{title}</span>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {children}
        {synthetic && <Badge tone="outline">{t("common.synthetic")}</Badge>}
        <Tooltip label={t("common.theme.toggle")}>
          <Button variant="quiet" size="icon" aria-label={t("common.theme.toggle")} onClick={toggle}>
            {theme === "dark" ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
          </Button>
        </Tooltip>
        <Tooltip label={t("common.signOut")}>
          <Button variant="quiet" size="icon" aria-label={t("common.signOut")} onClick={onSignOut}>
            <SignOut size={20} aria-hidden="true" />
          </Button>
        </Tooltip>
      </div>
    </header>
  );
}

/**
 * Exécute une opération sensible : si le serveur répond « mfa_required », demande le code du second facteur, le revérifie, puis
 * rejoue l'opération une fois. Renvoie [lancer, boîte de dialogue à afficher, erreur].
 */
export function useSensitive(api: DashboardApi) {
  const t = useT();
  const [pending, setPending] = useState<(() => Promise<void>) | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (op: () => Promise<void>): Promise<boolean> => {
    try {
      await op();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === "mfa_required") {
        setPending(() => op);
        return false;
      }
      throw e;
    }
  };
  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      if (!(await api.stepUp(code))) {
        setError(t("console.signin.badCode"));
        return;
      }
      await pending();
      setPending(null);
      setCode("");
    } catch {
      setError(t("common.error"));
    } finally {
      setBusy(false);
    }
  };
  const dialog = (
    <Dialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)} title={t("dash.stepup.title")} description={t("dash.stepup.body")}>
      <form onSubmit={confirm} className="flex flex-col gap-4" noValidate>
        <Field label={t("console.signin.code")} error={error}>
          {(p) => (
            <Input {...p} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(ev) => setCode(ev.target.value.replace(/\D/g, ""))} className="font-mono text-xl tracking-[0.4em]" autoFocus />
          )}
        </Field>
        <Button type="submit" variant="primary" busy={busy} disabled={code.length !== 6} className="justify-center">{t("dash.stepup.confirm")}</Button>
      </form>
    </Dialog>
  );
  return { run, dialog };
}
