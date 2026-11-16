// Widget du salarié (page hébergée /w/<organisation>, thème clair par défaut). Écran prioritaire de la démo.
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router";
import { Button } from "../ui/Button.tsx";
import { Skeleton } from "../ui/Skeleton.tsx";
import { widgetApi } from "../lib/api/index.tsx";
import type { EmployeeAuthApi, RequestSummary, WidgetApi, WidgetContext } from "../lib/api/types.ts";
import { useT } from "../lib/i18n/index.tsx";
import { ConversationView } from "./ConversationView.tsx";
import { Home } from "./Home.tsx";
import { WidgetHeader } from "./parts.tsx";
import { SignIn } from "./SignIn.tsx";

type View = { name: "home" } | { name: "conversation"; id: string | null; talk?: boolean; text?: string };

export default function WidgetApp() {
  const t = useT();
  const [api, setApi] = useState<(WidgetApi & EmployeeAuthApi) | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [ctx, setCtx] = useState<WidgetContext | null>(null);
  const [requests, setRequests] = useState<readonly RequestSummary[] | null>(null);
  const [view, setView] = useState<View>({ name: "home" });
  const [failed, setFailed] = useState(false);
  const { org = "" } = useParams();
  const [orgName, setOrgName] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    widgetApi().then(setApi, () => setFailed(true));
  }, []);

  useEffect(() => {
    if (!api) return;
    api.publicOrg(org).then((o) => setOrgName(o?.name ?? null), () => setOrgName(null));
  }, [api, org]);

  const load = useCallback(async () => {
    if (!api) return;
    setFailed(false);
    try {
      const [c, r] = await Promise.all([api.context(), api.listRequests()]);
      setCtx(c);
      setRequests(r);
    } catch {
      setFailed(true);
    }
  }, [api]);

  if ((!api && !failed) || (api && orgName === undefined)) return <FullSkeleton />;
  if (orgName === null) return <UnknownOrg />;
  if (api && orgName && !signedIn) return <SignIn api={api} orgName={orgName} onSignedIn={() => { setSignedIn(true); void load(); }} />;

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <WidgetHeader ctx={ctx} />
      {failed ? (
        <main className="mx-auto flex max-w-md flex-1 flex-col items-start justify-center gap-4 px-5">
          <p className="text-[0.9375rem] text-text" role="alert">
            {t("common.error")}
          </p>
          <Button variant="secondary" onClick={() => void load()}>
            {t("common.retry")}
          </Button>
        </main>
      ) : !ctx || !api ? (
        <FullSkeleton embedded />
      ) : view.name === "home" ? (
        <main className="flex flex-1 flex-col">
          <Home
            ctx={ctx}
            requests={requests}
            onOpen={(id) => setView({ name: "conversation", id })}
            onStart={(text) => setView({ name: "conversation", id: null, text })}
            onTalk={() => setView({ name: "conversation", id: null, talk: true })}
          />
        </main>
      ) : (
        <main className="flex flex-1 flex-col">
          <ConversationView
            key={view.id ?? "nouvelle"}
            api={api}
            ctx={ctx}
            conversationId={view.id}
            escalateOnOpen={view.talk}
            initialText={view.text}
            onCreated={() => {}}
            onBack={() => {
              setView({ name: "home" });
              void api.listRequests().then(setRequests);
            }}
          />
        </main>
      )}
    </div>
  );
}

function FullSkeleton({ embedded }: { embedded?: boolean }) {
  const t = useT();
  return (
    <div role="status" className={embedded ? "mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 pt-8" : "mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-5"}>
      <span className="sr-only">{t("common.loading")}</span>
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

/** Adresse de widget inconnue : un message neutre, sans dire quelles organisations existent. */
function UnknownOrg() {
  const t = useT();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-5">
      <h1 className="text-xl font-semibold text-text">{t("widget.unknown.title")}</h1>
      <p className="text-[0.9375rem] leading-relaxed text-soft">{t("widget.unknown.body")}</p>
    </main>
  );
}
