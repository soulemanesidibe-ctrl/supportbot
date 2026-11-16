// Sommaire du mode démo (jamais servi en production : la route n'existe que si DEMO). Données fictives uniquement.
import { Badge } from "../ui/Badge.tsx";
import { Logo } from "../ui/Logo.tsx";

const SURFACES = [
  { href: "/w/cabinet-alpha", title: "Widget salarié", body: "Ce que voit un salarié de Cabinet Alpha. Thème clair." },
];

export default function DevIndex() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-8 px-6 py-12">
      <div className="flex items-center gap-3">
        <Logo />
        <Badge tone="outline">Données fictives</Badge>
      </div>
      <h1 className="text-3xl font-semibold tracking-[-0.03em] text-text">Démonstration de Relève</h1>
      <ul className="flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
        {SURFACES.map((s, i) => (
          <li key={s.href} className={i ? "border-t border-border" : undefined}>
            <a href={s.href} className="flex flex-col gap-1 px-5 py-4 no-underline hover:bg-surface-2">
              <span className="font-medium text-text">{s.title}</span>
              <span className="text-sm text-soft">{s.body}</span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
