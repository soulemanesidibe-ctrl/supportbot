// Connexion du personnel : adresse et mot de passe, puis second facteur TOTP OBLIGATOIRE (inscription à la première connexion).
// Sans second facteur, la base ne montre rien (migration 16) et les fonctions refusent tout (SEC-33).
import { ArrowLeft, LockKey } from "@phosphor-icons/react";
import { useState, type FormEvent } from "react";
import { Button } from "../ui/Button.tsx";
import { Field, Input } from "../ui/Field.tsx";
import { Logo } from "../ui/Logo.tsx";
import type { StaffAuthApi } from "../lib/api/console-types.ts";
import { useT } from "../lib/i18n/index.tsx";

type Step = { name: "password" } | { name: "enroll"; factorId: string; qrSvg: string; secret: string } | { name: "verify" };

export function StaffSignIn({ api, onSignedIn }: { api: StaffAuthApi; onSignedIn: () => void }) {
  const t = useT();
  const [step, setStep] = useState<Step>({ name: "password" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signIn = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api.password(email.trim().toLowerCase(), password);
      setPassword("");
      if (!r.ok) setError(t("console.signin.bad"));
      else if (r.next === "mfa_enroll") setStep({ name: "enroll", ...(await api.enroll()) });
      else setStep({ name: "verify" });
    } catch {
      setError(t("common.error"));
    } finally {
      setBusy(false);
    }
  };
  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (await api.verify(step.name === "enroll" ? step.factorId : null, code)) onSignedIn();
      else setError(t("console.signin.badCode"));
    } catch {
      setError(t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-10 px-5 py-12">
      <div className="flex flex-col gap-6">
        <Logo size="lg" />
        <div className="flex flex-col gap-2">
          <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.03em] text-text">{t("console.signin.title")}</h1>
          <p className="text-[0.9375rem] leading-relaxed text-soft">{t("console.signin.lede")}</p>
        </div>
      </div>

      {step.name === "password" ? (
        <form onSubmit={signIn} className="flex flex-col gap-4" noValidate>
          <Field label={t("console.signin.email")}>
            {(p) => <Input {...p} type="email" autoComplete="username" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />}
          </Field>
          <Field label={t("console.signin.password")} error={error}>
            {(p) => <Input {...p} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
          <Button type="submit" variant="primary" size="lg" busy={busy} disabled={!email || !password} className="justify-center">
            <LockKey size={18} aria-hidden="true" />
            {t("console.signin.submit")}
          </Button>
        </form>
      ) : (
        <form onSubmit={verify} className="flex flex-col gap-4" noValidate>
          {step.name === "enroll" && (
            <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
              <p className="text-sm leading-relaxed text-text">{t("console.signin.enroll")}</p>
              {step.qrSvg && (
                <img src={step.qrSvg} alt={t("console.signin.qrAlt")} width={176} height={176} className="size-44 self-center rounded-lg bg-white p-2" />
              )}
              <p className="text-[0.8125rem] text-soft">
                {t("console.signin.secret")} <code className="select-all break-all font-mono text-text">{step.secret}</code>
              </p>
            </div>
          )}
          <Field label={t("console.signin.code")} hint={t("console.signin.codeHint")} error={error}>
            {(p) => (
              <Input
                {...p}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="font-mono text-xl tracking-[0.4em]"
                autoFocus
              />
            )}
          </Field>
          <Button type="submit" variant="primary" size="lg" busy={busy} disabled={code.length !== 6} className="justify-center">
            {t("console.signin.verify")}
          </Button>
          <Button
            variant="quiet"
            className="self-start"
            onClick={() => {
              void api.signOut();
              setStep({ name: "password" });
              setCode("");
              setError(null);
            }}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            {t("console.signin.back")}
          </Button>
        </form>
      )}
    </main>
  );
}
