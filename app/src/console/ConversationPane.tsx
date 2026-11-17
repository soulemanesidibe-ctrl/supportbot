// Une demande, vue du technicien : tout le fil, y compris ce que le salarié ne voit pas (brouillon du mode ombre, notes internes),
// la notation des réponses de Relève (docs/11 § 2) et la réponse, publique ou interne. Le salarié ne voit jamais un brouillon.
import { CheckCircle, EyeSlash, HandGrabbing, PaperPlaneRight, UserCircle } from "@phosphor-icons/react";
import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { Badge } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";
import { cn } from "../ui/cn.ts";
import { Textarea } from "../ui/Field.tsx";
import { Skeleton } from "../ui/Skeleton.tsx";
import { SignalLine } from "../ui/SignalLine.tsx";
import type { ConsoleApi, ConsoleMessage, ConversationDetail, Rating } from "../lib/api/console-types.ts";
import { MAX_MESSAGE_LENGTH } from "../lib/api/types.ts";
import { useLang, useT, type MessageKey } from "../lib/i18n/index.tsx";
import { hourLabel } from "../lib/time.ts";
import { minutesUntil, Ref, useDuration } from "./parts.tsx";

const RATINGS: readonly Rating[] = ["correct", "partial", "wrong", "dangerous"];

export function ConversationPane({ api, clientId, id, onChanged }: { api: ConsoleApi; clientId: string; id: string; onChanged: () => void }) {
  const t = useT();
  const [lang] = useLang();
  const duration = useDuration();
  const [conv, setConv] = useState<ConversationDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState("");
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState<null | "send" | "take" | "resolve">(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.conversation(clientId, id).then((c) => alive && setConv(c), () => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [api, clientId, id]);

  const reload = async () => setConv(await api.conversation(clientId, id));

  const act = async (kind: "send" | "take" | "resolve", f: () => Promise<void>, done: MessageKey) => {
    setBusy(kind);
    setNote(null);
    try {
      await f();
      await reload();
      setNote(t(done));
      onChanged();
    } catch {
      setNote(t("common.error"));
    } finally {
      setBusy(null);
    }
  };

  const send = (e?: FormEvent) => {
    e?.preventDefault();
    const v = text.trim();
    if (!v || v.length > MAX_MESSAGE_LENGTH) return;
    void act("send", async () => {
      await api.reply(clientId, id, v, internal);
      setText("");
    }, internal ? "console.conv.noteAdded" : "console.conv.sent");
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send();
  };

  if (failed) return <p role="alert" className="p-6 text-text">{t("common.error")}</p>;
  if (!conv) return <PaneSkeleton />;

  const open = conv.state === "open" || conv.state === "waiting_technician" || conv.state === "waiting_user";
  const sla = conv.ticket?.slaDueAt ? minutesUntil(conv.ticket.slaDueAt) : null;

  return (
    <article aria-labelledby="demande-titre" className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
      <header className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-soft">
          <span className="font-medium text-text">{conv.client.name}</span>
          {conv.ticket && <Ref>{conv.ticket.ref}</Ref>}
          {sla !== null && (
            <Badge tone="danger">{sla >= 0 ? t("console.kind.slaIn", { duree: duration(sla) }) : t("console.kind.slaLate", { duree: duration(sla) })}</Badge>
          )}
          {conv.reliefActive && <Badge tone="relief">{t("console.conv.duringRelief")}</Badge>}
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id="demande-titre" className="text-xl font-semibold leading-tight tracking-[-0.02em] text-text">{conv.title}</h2>
            <p className="text-sm text-soft">
              {t("console.conv.meta", { qui: conv.requester, heure: hourLabel(conv.openedAt, lang) })}
              {" · "}
              {t(`console.state.${conv.state}` as MessageKey)}
              {conv.assignedToMe ? ` · ${t("console.conv.mine")}` : ""}
            </p>
          </div>
          {open && (
            <div className="flex gap-2">
              {!conv.assignedToMe && (
                <Button size="sm" busy={busy === "take"} onClick={() => void act("take", () => api.take(clientId, id), "console.conv.taken")}>
                  <HandGrabbing size={18} aria-hidden="true" />
                  {t("console.conv.take")}
                </Button>
              )}
              <Button size="sm" variant="ghost" busy={busy === "resolve"} onClick={() => void act("resolve", () => api.resolve(clientId, id), "console.conv.resolved")}>
                <CheckCircle size={18} aria-hidden="true" />
                {t("console.conv.resolve")}
              </Button>
            </div>
          )}
        </div>
      </header>

      <ol aria-label={t("chat.history.label")} className="flex flex-col gap-4 px-5 py-5 sm:px-6 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {conv.messages.map((m) => (
          <Message key={m.id} m={m} requester={conv.requester} onRate={(r) => api.rate(clientId, m.id, r).then(reload)} />
        ))}
      </ol>

      <form onSubmit={send} className="flex flex-col gap-2 border-t border-border px-5 py-4 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="reponse-technicien" className="text-sm font-medium text-text">
            {internal ? t("console.conv.noteLabel") : t("console.conv.replyLabel", { qui: conv.requester })}
          </label>
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-soft">
            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="size-4 accent-[var(--c-relief)]" />
            <EyeSlash size={16} aria-hidden="true" />
            {t("console.conv.internal")}
          </label>
        </div>
        <Textarea
          id="reponse-technicien"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          rows={3}
          maxLength={MAX_MESSAGE_LENGTH}
          aria-describedby="reponse-aide"
          className={cn(internal && "border-relief/60 bg-relief-soft")}
          placeholder={internal ? t("console.conv.notePlaceholder") : t("console.conv.replyPlaceholder")}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p id="reponse-aide" className="hidden text-[0.8125rem] text-soft sm:block">{t("console.conv.replyHint")}</p>
          <div className="flex items-center gap-3">
            {note && <span role="status" className="text-[0.8125rem] text-soft">{note}</span>}
            <Button type="submit" variant={internal ? "secondary" : "primary"} busy={busy === "send"} disabled={!text.trim()}>
              <PaperPlaneRight size={18} aria-hidden="true" />
              {internal ? t("console.conv.addNote") : t("console.conv.send")}
            </Button>
          </div>
        </div>
      </form>
    </article>
  );
}

function Message({ m, requester, onRate }: { m: ConsoleMessage; requester: string; onRate: (r: Rating) => Promise<void> }) {
  const t = useT();
  const [lang] = useLang();
  const hidden = m.visibility === "technician";
  const who =
    m.role === "user" ? requester
    : m.role === "assistant" ? `${t("chat.assistant")} · ${t("common.ai")}`
    : m.role === "technician" ? (m.authorName ?? t("console.conv.technician"))
    : t("chat.notice");
  return (
    <li className={cn("flex flex-col gap-1.5", m.role === "technician" && "items-end")}>
      <span className="flex flex-wrap items-center gap-2 text-xs text-soft">
        {m.role === "user" ? <UserCircle size={16} aria-hidden="true" /> : m.role === "assistant" ? <SignalLine state="settled" className="h-3 w-4 text-signal" /> : null}
        <span className="font-medium">{who}</span>
        <time dateTime={m.at} className="num">{hourLabel(m.at, lang)}</time>
        {hidden && (
          <Badge tone="relief" icon={<EyeSlash size={13} aria-hidden="true" />}>
            {m.role === "assistant" ? t("console.conv.draft") : t("console.conv.hidden")}
          </Badge>
        )}
      </span>
      <p
        className={cn(
          "max-w-[46rem] whitespace-pre-wrap break-words rounded-xl px-4 py-2.5 text-[0.9375rem] leading-relaxed text-text",
          m.role === "user" && "bg-surface-2",
          m.role === "assistant" && "border border-border bg-surface",
          m.role === "notice" && !hidden && "bg-transparent px-0 py-0 text-sm text-soft",
          m.role === "notice" && hidden && "px-3 py-2 text-sm",
          m.role === "technician" && "bg-signal-soft",
          hidden && "border border-dashed border-relief/60",
        )}
      >
        {m.content}
      </p>
      {m.rateable && <RateRow current={m.myRating} onRate={onRate} />}
    </li>
  );
}

function RateRow({ current, onRate }: { current?: Rating; onRate: (r: Rating) => Promise<void> }) {
  const t = useT();
  const [busy, setBusy] = useState<Rating | null>(null);
  const [failed, setFailed] = useState(false);
  return (
    <div role="group" aria-label={t("console.rate.label")} className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-soft">{t("console.rate.label")}</span>
      {RATINGS.map((r) => (
        <button
          key={r}
          type="button"
          aria-pressed={current === r}
          disabled={busy !== null || current !== undefined}
          onClick={() => {
            setBusy(r);
            setFailed(false);
            onRate(r).catch(() => setFailed(true)).finally(() => setBusy(null));
          }}
          className={cn(
            "inline-flex min-h-9 items-center rounded-md border border-border px-2.5 text-xs font-medium text-soft transition-colors duration-150",
            "enabled:hover:border-border-strong enabled:hover:text-text disabled:cursor-default",
            "aria-pressed:border-transparent aria-pressed:bg-surface-3 aria-pressed:text-text",
            r === "dangerous" && "aria-pressed:bg-danger aria-pressed:text-on-danger",
          )}
        >
          {t(`console.rate.${r}` as MessageKey)}
        </button>
      ))}
      {failed && <span role="alert" className="text-xs text-danger-ink">{t("common.error")}</span>}
    </div>
  );
}

export function PaneSkeleton() {
  const t = useT();
  return (
    <div role="status" className="flex flex-col gap-4 p-6">
      <span className="sr-only">{t("common.loading")}</span>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-7 w-2/3" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-16 w-4/5" />
    </div>
  );
}
