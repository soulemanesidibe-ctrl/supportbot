---
name: ui-ux-pro-max
description: Design UI/UX avancé pour SupportBot — charte graphique, design system, accessibilité RGAA/WCAG, anti-patterns bannis. Utiliser pour toute tâche visuelle (nouvel écran, widget de chat, console technicien, refonte, polish) avant d'écrire du style. Complète le skill impeccable avec les contraintes propres au projet.
---

# SupportBot — UI/UX Pro Max

Ce skill capture les contraintes de design **propres à SupportBot**. Pour l'exécution méthodique (audit, critique, polish, craft…), utiliser le skill générique `impeccable` en complément : il lit `PRODUCT.md` et `DESIGN.md` à la racine du dépôt.

## Avant tout travail visuel

1. Lire `docs/04-marque-et-DA.md` (identité, ton, palette, typographie) et, s'ils existent, `PRODUCT.md` / `DESIGN.md` à la racine.
2. Réutiliser les composants et tokens existants du design system : ne jamais réinventer un bouton, une carte ou un champ déjà présent.
3. Si l'écran est visible côté client final (widget intégré chez une ESN ou une DSI), prévoir le marquage blanc : couleurs et logo du client passent par des variables CSS, jamais par des valeurs en dur.

## Charte graphique : direction B « Signal »

Source de vérité : `docs/04-marque-et-DA.md`, section « Direction retenue ». Aucun hex brut hors de ces tokens dans un composant : passer par des variables CSS (`var(--c-*)`).

```
Sombre (console par défaut) : bg #0E0F11 · surface #17181B · surface-2 #1F2125 · border #26282D
                              text #EDEEF0 · text-soft #9A9EA6 · signal #3DDC97 · relief #F2B33D · danger #F0605A
Clair (widget par défaut)   : bg #F4F5F6 · surface #FFFFFF · surface-2 #ECEEF0 · border #DCDFE3
                              text #0E0F11 · text-soft #4A4F57 · signal #138A5A · relief #F2B33D · danger #C93B36
```

Polices : **Geist** (titres 600 à 700, texte 400 à 500), **Geist Mono** (identifiants de tickets, journaux, chiffres des tableaux). Rayons : 12px pour les cartes, 10px pour les boutons et champs. Icônes : Phosphor, épaisseur unique.

- Vert signal en thème clair : aplat avec texte foncé uniquement, jamais en texte sur fond blanc.
- La console s'ouvre en sombre, le widget salarié en clair ; les deux thèmes existent partout.

## Contraintes non négociables

- **Contraste** : texte ≥ 4.5:1, texte large (≥ 18px ou ≥ 14px gras) ≥ 3:1.
- **Focus visible** : jamais retiré, anneau de 2 à 3px via `:focus-visible`.
- **Cibles tactiles** : ≥ 44px partout.
- **Couleur jamais seule** : toute info d'état (priorité, statut du ticket, SLA, niveau de confiance de l'IA) est doublée d'un libellé ou d'une icône.
- **Transparence IA** (AI Act, art. 50) : l'utilisateur doit toujours voir qu'il parle à une IA. Indicateur permanent dans l'en-tête du chat, pas seulement au premier message.
- **Escalade humaine toujours visible** : un bouton « Parler à un technicien » accessible en un clic depuis toute conversation.
- **Pas de bordure d'accent latérale** (`border-left`/`border-right` coloré sur une carte, une alerte ou une liste) : anti-pattern banni par `impeccable`. Utiliser une bordure pleine, un fond teinté, une icône ou un badge.
- **Motion** : 150 à 300ms, `transform`/`opacity` uniquement (jamais `width`/`height`/`padding` en transition), `prefers-reduced-motion` toujours respecté.
- **Données sensibles** : ne jamais afficher en clair un mot de passe, un jeton ou une clé dans le fil de conversation, même partiellement.

## Textes UI

Voix active, forme positive, concis. Français en langue primaire, anglais en second. Pas de jargon non expliqué côté utilisateur final ; le jargon technique est réservé à la console technicien.

## Après toute modification d'écran

```bash
node .agents/skills/impeccable/scripts/detect.mjs --json <fichiers modifiés>
```

Corriger jusqu'à `[]` (hors avertissements préexistants sans rapport avec le changement), puis lancer le build et les tests avant tout push.
