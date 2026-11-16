// Fil d'une demande. Le message du salarié s'affiche tout de suite (réponse optimiste), la ligne de signal annonce que Relève
// prépare la réponse, puis la réponse validée par le serveur arrive. Pas de texte de l'IA affiché avant validation : la fonction
// `chat` contrôle forme, sources et garde-fous AVANT de répondre (on n'affiche jamais un brouillon non vérifié).
import { ArrowLeft, CheckCircle, Headset, Star, WarningCircle } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button.tsx";
import { cn } from "../ui/cn.ts";
import { Dialog } from "../ui/Overlay.tsx";
import { Skeleton } from "../ui/Skeleton.tsx";
import type { ChatMessage, Conversation, WidgetApi, WidgetContext } from "../lib/api/types.ts";
import { useLang, useT } from "../lib/i18n/index.tsx";
import { hourLabel } from "../lib/time.ts";
import { Composer } from "./Composer.tsx";
import { AccountActionCard, MessageBubble, StatusBadge, TypingRow } from "./parts.tsx";

type Pending = { id: string; text: string; failed: boolean };

export function ConversationView({
  api,
  ctx,
  conversationId,
  onBack,
  onCreated,
  escalateOnOpen,
  initialText,
}: {
  api: WidgetApi;
  ctx: WidgetContext;
  conversationId: string | null;
  onBack: () => void;
  onCreated: (id: string) => void;
  escalateOnOpen?: boolean;
  /** Premier message écrit depuis l'accueil : envoyé dès l'ouverture, une seule fois. */
  initialText?: string;
}) {
  const t = useT();
  const [conv, setConv] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(conversationId !== null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [sending, setSending] = useState(false);
  // « Parler à un technicien » depuis l'accueil, sans demande ouverte : le premier message part directement à un humain.
  const directToTech = Boolean(escalateOnOpen) && conversationId === null;
  const [escalateOpen, setEscalateOpen] = useState(Boolean(escalateOnOpen) && conversationId !== null);
  const [thanks, setThanks] = useState<"worked" | "rated" | "escalated" | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const id = conv?.id ?? conversationId;

  const reload = useCallback(
    async (cid: string) => {
      const c = await api.conversation(cid);
      setConv(c);
      return c;
    },
    [api],
  );

  useEffect(() => {
    if (conversationId === null) return;
    let alive = true; // la vue est recréée pour chaque demande (clé) : l'état de chargement initial suffit
    api
      .conversation(conversationId)
      .then((c) => alive && setConv(c))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [api, conversationId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [conv?.messages.length, pending, sending]);

  const send = async (text: string) => {
    const p: Pending = { id: `p-${Date.now()}`, text, failed: false };
    setPending(p);
    setSending(true);
    setThanks(null);
    try {
      const r = await api.send(id ?? null, text);
      if (!id) onCreated(r.conversationId);
      if (directToTech && !id) {
        await api.escalate(r.conversationId);
        setThanks("escalated");
      }
      await reload(r.conversationId);
      setPending(null);
    } catch {
      setPending({ ...p, failed: true });
    } finally {
      setSending(false);
    }
  };

  const started = useRef(false);
  useEffect(() => {
    if (!initialText || started.current) return;
    started.current = true;
    void send(initialText);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- envoi unique du premier message, à l'ouverture
  }, [initialText]);

  const escalate = async () => {
    setEscalateOpen(false);
    if (!id) return;
    await api.escalate(id);
    await reload(id);
    setThanks("escalated");
  };

  const confirm = async (worked: boolean) => {
    if (!id) return;
    await api.confirm(id, worked);
    await reload(id);
    setThanks(worked ? "worked" : null);
  };

  const rate = async (score: 1 | 2 | 3 | 4 | 5) => {
    if (!id) return;
    await api.rate(id, score);
    await reload(id);
    setThanks("rated");
  };

  const title = conv?.title ?? t("chat.newTitle");
  const messages: readonly ChatMessage[] = conv?.messages ?? [];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
      <div className="sticky top-16 z-10 border-b border-border bg-bg">
        <div className="flex min-h-16 items-center gap-2 px-4 py-2 sm:px-6">
          <Button variant="quiet" size="icon" onClick={onBack} aria-label={t("common.back")} className="-ml-3">
            <ArrowLeft size={20} aria-hidden="true" />
          </Button>
          <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            <h1 className="truncate text-base font-semibold tracking-[-0.01em] text-text">{title}</h1>
            {conv && <StatusBadge status={conv.status} />}
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setEscalateOpen(true)}
            disabled={!id}
            aria-label={t("common.talkToTech")}
            className="shrink-0 max-sm:size-11 max-sm:justify-center max-sm:px-0"
          >
            <Headset size={18} aria-hidden="true" />
            <span className="hidden sm:inline" aria-hidden="true">
              {t("common.talkToTech")}
            </span>
          </Button>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 px-4 pb-48 pt-6 sm:px-6">
        {loading ? (
          <ThreadSkeleton />
        ) : (
          <ol aria-label={t("chat.history.label")} role="log" aria-live="polite" className="flex flex-col gap-5">
            {messages.length === 0 && !pending && <IntroLine ctx={ctx} direct={directToTech} />}
            {messages.map((m) => (
              <MessageBubble key={m.id} m={m} />
            ))}
            {pending && <PendingBubble p={pending} onRetry={() => send(pending.text)} />}
            {sending && <TypingRow />}
            {conv?.accountAction && conv.status !== "resolved" && !sending && <AccountActionCard />}
            {conv?.awaitingConfirmation && !sending && <ConfirmCard onAnswer={confirm} />}
            {conv?.status === "resolved" && !sending && <RateCard value={conv.satisfaction} onRate={rate} thanked={thanks === "rated"} />}
            {thanks === "worked" && <QuietLine icon="ok">{t("chat.worked.thanks")}</QuietLine>}
            {thanks === "escalated" && <QuietLine icon="ok">{t("chat.escalate.done")}</QuietLine>}
          </ol>
        )}
        <div ref={bottom} />
      </div>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-bg pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto w-full max-w-3xl px-4 pb-3 pt-3 sm:px-6">
          <Composer onSend={send} disabled={sending} autoFocus={conversationId === null && !initialText} />
        </div>
      </div>

      <EscalateDialog open={escalateOpen} onOpenChange={setEscalateOpen} ctx={ctx} onConfirm={escalate} />
    </div>
  );
}

function IntroLine({ ctx, direct }: { ctx: WidgetContext; direct: boolean }) {
  const t = useT();
  return (
    <li className="flex flex-col gap-2 rounded-[var(--radius-card)] bg-surface-2 p-4 text-[0.9375rem] leading-relaxed text-text">
      <p>{direct ? t("chat.direct.intro") : t("widget.signin.lede")}</p>
      <p className="text-sm text-soft">{t("chat.composer.noSecret")}</p>
      {ctx.synthetic && <p className="text-xs text-soft">{t("common.synthetic")}</p>}
    </li>
  );
}

function PendingBubble({ p, onRetry }: { p: Pending; onRetry: () => void }) {
  const t = useT();
  return (
    <li className="flex flex-col items-end gap-1 pl-10 sm:pl-24">
      <p className={cn("whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-text px-4 py-2.5 text-[0.9375rem] leading-relaxed text-bg", !p.failed && "opacity-80")}>
        {p.text}
      </p>
      {p.failed && (
        <span className="flex items-center gap-2 text-[0.8125rem] font-medium text-danger-ink" role="alert">
          <WarningCircle size={16} aria-hidden="true" />
          {t("chat.failed")}
          <Button variant="quiet" size="sm" onClick={onRetry} className="min-h-9 px-2 text-danger-ink">
            {t("common.retry")}
          </Button>
        </span>
      )}
    </li>
  );
}

function ConfirmCard({ onAnswer }: { onAnswer: (worked: boolean) => void }) {
  const t = useT();
  return (
    <li className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 sm:ml-11">
      <p className="font-medium text-text">{t("chat.worked.question")}</p>
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <Button variant="primary" onClick={() => onAnswer(true)} className="justify-center">
          {t("chat.worked.yes")}
        </Button>
        <Button variant="secondary" onClick={() => onAnswer(false)} className="justify-center">
          {t("chat.worked.no")}
        </Button>
      </div>
    </li>
  );
}

function RateCard({ value, onRate, thanked }: { value: number | null; onRate: (n: 1 | 2 | 3 | 4 | 5) => void; thanked: boolean }) {
  const t = useT();
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;
  return (
    <li className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4 sm:ml-11">
      <p id="releve-note" className="text-sm font-medium text-text">
        {t("chat.rate.question")}
      </p>
      <div role="radiogroup" aria-labelledby="releve-note" className="flex gap-1" onMouseLeave={() => setHover(null)}>
        {([1, 2, 3, 4, 5] as const).map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={t("chat.rate.label", { n })}
            onClick={() => onRate(n)}
            onMouseEnter={() => setHover(n)}
            className="inline-flex size-11 items-center justify-center rounded-[var(--radius-control)] text-soft transition-colors duration-150 hover:bg-surface-2"
          >
            <Star size={24} weight={n <= shown ? "fill" : "regular"} className={n <= shown ? "text-relief" : undefined} aria-hidden="true" />
          </button>
        ))}
      </div>
      {thanked && <p className="text-sm text-soft">{t("chat.rate.thanks")}</p>}
    </li>
  );
}

function QuietLine({ children }: { children: string; icon: "ok" }) {
  return (
    <li className="flex items-start gap-2 text-sm text-soft sm:ml-11">
      <CheckCircle size={18} weight="fill" className="mt-px shrink-0 text-signal" aria-hidden="true" />
      {children}
    </li>
  );
}

function ThreadSkeleton() {
  const t = useT();
  return (
    <div role="status" className="flex flex-col gap-5">
      <span className="sr-only">{t("common.loading")}</span>
      <Skeleton className="ml-auto h-12 w-2/3 rounded-2xl" />
      <div className="flex gap-3">
        <Skeleton className="size-8 rounded-full" />
        <Skeleton className="h-20 w-3/4 rounded-2xl" />
      </div>
    </div>
  );
}

function EscalateDialog({ open, onOpenChange, ctx, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; ctx: WidgetContext; onConfirm: () => void }) {
  const t = useT();
  const [lang] = useLang();
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("chat.escalate.title")}>
      <div className="flex flex-col gap-4">
        <p className="text-[0.9375rem] leading-relaxed text-text">{t("chat.escalate.body")}</p>
        {ctx.relief.active && ctx.relief.until && (
          <p className="rounded-[var(--radius-control)] bg-relief-soft p-3 text-sm leading-relaxed text-text">
            {t("chat.escalate.reliefBody", { heure: hourLabel(ctx.relief.until, lang) })}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="quiet" onClick={() => onOpenChange(false)} className="justify-center">
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={onConfirm} className="justify-center">
            <Headset size={18} aria-hidden="true" />
            {t("chat.escalate.confirm")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
