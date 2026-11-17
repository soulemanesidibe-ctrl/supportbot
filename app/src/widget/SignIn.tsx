// Connexion du salarié par code à usage unique (docs/spec-mvp.md § 5.3). La réponse à « Recevoir un code » est la MÊME que
// l'adresse soit connue ou non (aucune énumération des salariés) ; aucun mot de passe n'est jamais demandé.
import { ArrowLeft, EnvelopeSimple } from "@phosphor-icons/react";
import { useState, type FormEvent } from "react";
import { Button } from "../ui/Button.tsx";
import { Field, Input } from "../ui/Field.tsx";
import { Logo } from "../ui/Logo.tsx";
import { SignalLine } from "../ui/SignalLine.tsx";
import type { EmployeeAuthApi } from "../lib/api/types.ts";
import { useT } from "../lib/i18n/index.tsx";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function SignIn({ api, slug, orgName, onSignedIn }: { api: EmployeeAuthApi; slug: string; orgName: string; onSignedIn: () => void }) {
  const t = useT();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sendCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!EMAIL.test(email.trim())) {
      setError(t("widget.signin.invalidEmail"));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.requestCode(slug, email.trim().toLowerCase());
      setStep("code");
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
      if (await api.verifyCode(slug, email.trim().toLowerCase(), code.trim())) onSignedIn();
      else setError(t("widget.signin.badCode"));
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
        <div className="flex flex-col gap-3">
          <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.03em] text-text">{t("widget.signin.title", { org: orgName })}</h1>
          <p className="text-[0.9375rem] leading-relaxed text-soft">{t("widget.signin.lede")}</p>
        </div>
      </div>

      {step === "email" ? (
        <form onSubmit={sendCode} className="flex flex-col gap-4" noValidate>
          <Field label={t("widget.signin.email")} hint={t("widget.signin.email.hint")} error={error}>
            {(p) => (
              <Input
                {...p}
                type="email"
                inputMode="email"
                autoComplete="email"
                spellCheck={false}
                placeholder={t("widget.signin.email.placeholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
            )}
          </Field>
          <Button type="submit" variant="primary" size="lg" busy={busy} className="justify-center">
            <EnvelopeSimple size={18} aria-hidden="true" />
            {t("widget.signin.sendCode")}
          </Button>
        </form>
      ) : (
        <form onSubmit={verify} className="flex flex-col gap-4" noValidate>
          <p role="status" className="flex gap-3 rounded-[var(--radius-card)] bg-signal-soft p-4 text-sm leading-relaxed text-text">
            <SignalLine state="settled" className="mt-0.5 text-signal-ink" />
            {t("widget.signin.sent")}
          </p>
          <Field label={t("widget.signin.code")} hint={t("widget.signin.code.hint")} error={error}>
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
            {t("widget.signin.verify")}
          </Button>
          <Button
            variant="quiet"
            onClick={() => {
              setStep("email");
              setCode("");
              setError(null);
            }}
            className="self-start"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            {t("widget.signin.otherEmail")}
          </Button>
        </form>
      )}

      <p className="text-[0.8125rem] leading-relaxed text-soft">{t("common.ai.explain")}</p>
    </main>
  );
}
