# 08 · Expérience et design premium

> Demande du fondateur : un design et une expérience **premium**, les plus actuels possibles, pour notre cible. Ce document complète la charte de [04](04-marque-et-DA.md) et s'applique via les skills `ui-ux-pro-max`, `design-taste-frontend` et `impeccable`.

## 1. Deux publics, deux expériences

| | Utilisateur final (salarié du client) | Technicien et ESN |
|---|---|---|
| **Ce qu'il veut** | Être débloqué vite, sans jargon | Aller vite, garder le contrôle, ne rien rater |
| **Où il est** | Dans Teams, sur le web, parfois sur mobile | Dans sa console, souvent avec plusieurs écrans, ou d'astreinte sur son téléphone |
| **Référence de qualité** | La simplicité d'une messagerie moderne | La rapidité des meilleurs outils pour développeurs (Linear, Raycast, Vercel) |

## 2. Utilisateur final : le chat

- **Réponses en streaming** : le texte s'affiche au fil de l'eau, jamais un écran figé.
- **Cartes d'action plutôt que des pavés de texte** : « Votre compte est bloqué. [Recevoir une notification de déblocage] », avec un état clair (en cours, fait, en attente d'un technicien).
- **Étapes guidées** pour les manipulations : une étape à la fois, avec « ça a marché » et « ça ne marche pas ».
- **Transparence permanente** : badge « Assistant IA », badge ambre « Relève active » quand l'équipe est absente, avec l'heure de retour prévue d'un humain.
- **« Parler à un technicien »** toujours à un clic, avec le résumé déjà transmis : l'utilisateur ne répète jamais son problème.
- **Pièces jointes** : capture d'écran collée directement, analysée pour lire le message d'erreur.
- **Adaptive Cards** dans Teams pour garder la même qualité que sur le web.

## 3. Technicien : la console

- **Palette de commandes** (`Ctrl+K` ou `Cmd+K`) : chercher un utilisateur, un poste, un ticket, lancer une action. Tout au clavier.
- **Boîte de validation** : les actions préparées par l'IA arrivent comme des demandes à valider ou refuser en un geste, avec le contexte (qui, quoi, pourquoi, diagnostic déjà fait).
- **Vue incident** : alertes de supervision et demandes utilisateurs regroupées sur une même ligne de temps.
- **Passation de garde** : un écran « pendant votre absence » à la manière d'un briefing : résolu, en attente, escaladé, à surveiller.
- **Mobile d'astreinte** : valider une action ou prendre une conversation depuis le téléphone (PWA installable, notifications).
- **Densité réglable** (confortable ou compacte) et **mode sombre** soigné, pas une simple inversion de couleurs.
- **Temps réel** : nouvelles conversations et alertes sans recharger la page.

## 4. Qualité perçue : les détails qui font « premium »

- **Réactivité** : objectif d'affichage de la première réponse en moins de 300 ms côté interface (indicateur de frappe immédiat, réponse optimiste), et premier mot de l'IA en moins de 2 s.
- **Mouvements** de 150 à 300 ms, uniquement `transform` et `opacity`, respect de `prefers-reduced-motion`.
- **États vides, de chargement et d'erreur** dessinés avec autant de soin que l'état normal (squelettes, messages utiles).
- **Typographie** : Manrope et Inter avec chiffres tabulaires dans les tableaux ; JetBrains Mono pour les identifiants et les journaux.
- **Accessibilité** RGAA et WCAG 2.2 AA : c'est une exigence du secteur public et un signe de qualité.
- **Marque blanche élégante** : l'ESN met son logo et sa couleur, et le contraste est recalculé automatiquement.
- **Pas de clichés IA** : pas de robot, pas de dégradés violets génériques, pas d'étincelles partout. Le skill `design-taste-frontend` sert de garde-fou.

## 5. Pile UI recommandée

React, Vite et TypeScript ; **Tailwind CSS** avec des primitives accessibles (**Radix UI** via **shadcn/ui**) pour aller vite sans sacrifier la qualité ; **Motion** pour les animations ; **cmdk** pour la palette de commandes ; Teams via **Adaptive Cards**. Tous gratuits et open source.
