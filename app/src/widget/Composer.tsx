// Zone de saisie du salarié : grandit avec le texte, Entrée envoie, Maj + Entrée va à la ligne. Rappelle en permanence qu'on
// n'écrit jamais son mot de passe (règle n° 2) ; le serveur masque de toute façon un secret avant stockage.
import { LockSimple, PaperPlaneRight } from "@phosphor-icons/react";
import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "../ui/Button.tsx";
import { cn } from "../ui/cn.ts";
import { MAX_MESSAGE_LENGTH } from "../lib/api/types.ts";
import { useT } from "../lib/i18n/index.tsx";

export function Composer({
  onSend,
  disabled,
  autoFocus,
  placeholder,
  id = "releve-composer",
  labelledBy,
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  id?: string;
  /** Titre visible qui sert d'étiquette (accueil) ; sinon une étiquette invisible. */
  labelledBy?: string;
}) {
  const t = useT();
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const tooLong = text.length > MAX_MESSAGE_LENGTH;
  const canSend = text.trim().length > 0 && !tooLong && !disabled;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!canSend) return;
    onSend(text.trim());
    setText("");
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      {!labelledBy && (
        <label htmlFor={id} className="sr-only">
          {t("chat.composer.label")}
        </label>
      )}
      <div
        className={cn(
          "flex items-end gap-2 rounded-2xl border border-border-strong bg-surface p-1.5 pl-4 transition-[border-color,box-shadow] duration-150",
          "focus-within:border-focus focus-within:ring-2 focus-within:ring-focus/50",
          tooLong && "border-danger",
        )}
      >
        <textarea
          id={id}
          ref={ref}
          aria-labelledby={labelledBy}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder={placeholder ?? t("chat.placeholder")}
          aria-describedby={`${id}-aide`}
          aria-invalid={tooLong || undefined}
          autoFocus={autoFocus}
          className="max-h-[200px] min-h-11 flex-1 resize-none bg-transparent py-2.5 text-[0.9375rem] leading-relaxed text-text placeholder:text-soft focus:outline-none"
        />
        <Button type="submit" variant="primary" size="icon" disabled={!canSend} aria-label={t("common.send")} className="rounded-xl">
          <PaperPlaneRight size={20} weight="fill" aria-hidden="true" />
        </Button>
      </div>
      <p id={`${id}-aide`} className="flex items-center gap-1.5 px-1 text-[0.8125rem] text-soft">
        {tooLong ? (
          <span className="font-medium text-danger-ink" role="alert">
            {t("chat.composer.tooLong", { n: MAX_MESSAGE_LENGTH })}
          </span>
        ) : (
          <>
            <LockSimple size={14} aria-hidden="true" className="shrink-0" />
            <span>{t("chat.composer.noSecret")}</span>
            <span className="sr-only">{t("chat.composer.hint")}</span>
          </>
        )}
      </p>
    </form>
  );
}
