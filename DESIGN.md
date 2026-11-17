---
name: Relève
description: Système de design « Signal » de Relève, l'agent de support informatique de niveau 1 qui prend la garde quand l'équipe est absente.
colors:
  signal-dark: "#3ddc97"
  signal-light: "#138a5a"
  signal-ink-light: "#0d6b45"
  relief: "#f2b33d"
  relief-ink-light: "#7a5208"
  danger-dark: "#f0605a"
  danger-ink-dark: "#f48a85"
  danger-light: "#c93b36"
  danger-ink-light: "#a52e2a"
  carbon-bg: "#0e0f11"
  carbon-surface: "#17181b"
  carbon-surface-2: "#1f2125"
  carbon-surface-3: "#26282d"
  carbon-border-strong: "#34373d"
  carbon-text: "#edeef0"
  carbon-text-soft: "#9a9ea6"
  paper-bg: "#f4f5f6"
  paper-surface: "#ffffff"
  paper-surface-2: "#eceef0"
  paper-border: "#dcdfe3"
  paper-border-strong: "#c3c8cf"
  paper-text-soft: "#4a4f57"
  chart-mid-dark: "#7a808a"
  chart-low-dark: "#4a4e56"
  chart-mid-light: "#8a9099"
  chart-low-light: "#c9cdd3"
typography:
  headline:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.3
  mono:
    fontFamily: "Geist Mono, ui-monospace, Menlo, Consolas, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  badge: "6px"
  control: "10px"
  card: "12px"
  bubble: "16px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "48px"
components:
  button-primary-dark:
    backgroundColor: "{colors.signal-dark}"
    textColor: "{colors.carbon-bg}"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "0 16px"
  button-primary-light:
    backgroundColor: "{colors.carbon-bg}"
    textColor: "{colors.paper-surface}"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "0 16px"
  button-secondary-dark:
    backgroundColor: "{colors.carbon-surface}"
    textColor: "{colors.carbon-text}"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "0 16px"
  button-quiet-dark:
    textColor: "{colors.carbon-text-soft}"
    rounded: "{rounded.control}"
    size: "44px"
  badge-relief:
    backgroundColor: "{colors.relief}"
    textColor: "{colors.carbon-bg}"
    rounded: "{rounded.badge}"
    height: "24px"
    padding: "0 8px"
  card-dark:
    backgroundColor: "{colors.carbon-surface}"
    rounded: "{rounded.card}"
    padding: "20px"
  input-light:
    backgroundColor: "{colors.paper-surface}"
    textColor: "{colors.carbon-bg}"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "0 14px"
---

# Design System: Relève

## Overview

**Creative North Star : « Le tableau de garde »**

Relève est un outil de production, pas un « projet IA ». L'interface ressemble à un tableau de garde bien tenu : sobre, dense là où le technicien travaille, calme là où le salarié demande de l'aide. Le carbone porte la console et les écrans du personnel (thème sombre par défaut). Le papier porte le widget du salarié et le rapport mensuel (thème clair par défaut). Les deux thèmes existent partout. Le vert signal est le seul accent : il marque l'action principale, ce qui va bien et la part que Relève a réellement résolue. L'ambre de la relève signale que l'équipe est absente et que Relève tient la garde. Le rouge est réservé aux incidents, aux réponses dangereuses et aux gestes destructifs.

La valeur se lit dans les chiffres, jamais dans le décor. Chaque nombre porte son effectif (« sur 58 notes »), une médiane absente s'affiche « – », jamais 0, et les mauvais chiffres sont montrés comme les bons. Il n'y a ni dégradé, ni étincelle, ni robot, ni texte « magique ». La transparence IA est permanente, et « Parler à un technicien » est toujours à un clic.

**Key Characteristics :**
- Deux matières, carbone et papier, avec un seul accent vert signal.
- Couleur jamais seule : tout état est doublé d'une icône Phosphor et d'un libellé.
- Chiffres en Geist Mono ou en chiffres tabulaires, toujours avec leur effectif.
- Cibles de 44 px partout et anneau de focus de 2 px en vert signal.
- Surfaces plates séparées par des bordures fines ; l'ombre est réservée aux couches flottantes.

## Colors

Une palette froide et neutre (carbone, papier), un accent vert, un ambre d'état et un rouge d'alerte, définis comme jetons `--c-*` dans `app/src/ui/signal.css`, qui fait foi.

### Primary
- **Vert signal** (`signal-dark` en sombre ; `signal-light`, et `signal-ink-light` pour le texte, en clair) : action principale en sombre (aplat avec texte carbone), états « barres atteintes », « connecté », part « résolues par Relève », anneau de focus et point final du logotype. En clair, le vert vif ne sert qu'en aplat sous du texte foncé ; le texte vert utilise la version encre.

### Secondary
- **Ambre de relève** (`relief`, et `relief-ink-light` pour le texte en clair) : badge « Relève active jusqu'à… », actions à valider, jauges sous la barre. Toujours avec du texte carbone dessus.

### Tertiary
- **Rouge d'alerte** (`danger-*`) : incident majeur, SLA en danger, connecteur en erreur, réponse dangereuse, bouton d'arrêt d'urgence ou de révocation. Jamais pour une simple information.

### Neutral
- **Carbone** (`carbon-bg`, `carbon-surface`, `carbon-surface-2`, `carbon-surface-3`) : fond, panneaux, survols et bulles de l'IA en thème sombre.
- **Texte carbone** (`carbon-text`, `carbon-text-soft`) : texte principal et secondaire en sombre ; le texte secondaire tient 4,5:1 sur toutes les surfaces.
- **Papier** (`paper-bg`, `paper-surface`, `paper-surface-2`, `paper-border`, `paper-text-soft`) : les mêmes rôles en thème clair.
- **Gris de graphique** (`chart-mid-*`, `chart-low-*`) : les parts non mises en avant d'une barre segmentée, validées pour le daltonisme contre l'accent.

### Named Rules
**La règle de la voix unique.** Un seul accent par écran : le vert signal. L'ambre et le rouge sont des états, pas des décorations.

**La règle du double codage.** Aucune couleur ne porte seule une information : chaque statut a une icône et un libellé.

**La règle de l'emphase.** Dans un graphique, une seule part est en vert (celle qui compte : résolue par Relève et confirmée par le salarié) ; le reste est en deux gris.

## Typography

**Police d'affichage et de texte :** Geist (avec ui-sans-serif, system-ui)
**Police des identifiants et chiffres :** Geist Mono (avec ui-monospace, Menlo)

**Character :** une grotesque d'ingénieur, nette et légèrement resserrée dans les titres. Le mono apporte la précision d'un journal technique aux numéros de ticket, aux heures et aux codes. Les deux polices sont auto-hébergées, sans aucune requête vers un tiers.

### Hierarchy
- **Headline** (600, 1,75 rem, interlignage 1,2, approche -0,03 em) : titre de page (« Bonjour Claire, vos clients », titre du rapport mensuel).
- **Title** (600, 1,25 rem, interlignage 1,25, approche -0,02 em) : titre d'un panneau, d'une demande, d'une action à valider.
- **Body** (400, 0,9375 rem, interlignage 1,6) : texte courant, limité à 72 caractères par ligne pour les paragraphes d'explication.
- **Label** (500, 0,8125 rem) : libellés de chiffres, badges, effectifs, légendes.
- **Mono** (400, 0,8125 rem) : numéros de ticket, horodatages, codes de vérification (ces derniers en 1,25 rem avec un espacement large).

### Named Rules
**La règle des chiffres tabulaires.** Tout nombre affiché dans un tableau, une jauge ou un compteur utilise des chiffres tabulaires, pour que les colonnes s'alignent.

## Layout

Les écrans du personnel ont une barre supérieure collante de 56 px (logo, organisation, données fictives, thème, déconnexion), puis un contenu centré : jusqu'à 80 rem pour l'écran ESN et 64 rem pour l'administrateur, avec des marges de 16 px sur téléphone et 24 px au-delà. Les sections sont espacées de 48 px, les blocs internes de 16 à 24 px. La console occupe toute la hauteur : file à gauche, détail à droite ; sur téléphone, un seul panneau à la fois avec « Retour à la file ». Le widget du salarié est une colonne de lecture étroite, avec la zone de saisie fixée en bas. Sur téléphone, les tableaux larges deviennent des listes qui ne montrent que les signaux non nuls ; aucun écran ne défile horizontalement.

## Elevation & Depth

Le système est plat par défaut et procède par couches tonales : fond, surface, surface 2, séparées par des bordures d'un pixel. Une seule ombre existe, réservée à ce qui flotte au-dessus de la page.

### Shadow Vocabulary
- **Levée** (`0 1px 2px rgb(0 0 0 / 0.4), 0 8px 24px rgb(0 0 0 / 0.35)` en sombre ; `0 1px 2px rgb(14 15 17 / 0.06), 0 8px 24px rgb(14 15 17 / 0.08)` en clair) : boîtes de dialogue, palette de commandes, infobulles.

### Named Rules
**La règle du plat au repos.** Une carte n'a jamais d'ombre ; elle se distingue par sa surface et sa bordure.

## Shapes

Les angles sont doucement arrondis et cohérents : 6 px pour les badges, 10 px pour les boutons et champs, 12 px pour les cartes et panneaux, 16 px pour les bulles de conversation et la zone de saisie du widget, pilule pour les filtres d'étiquettes. Les bordures sont pleines et fines. Il n'y a jamais de bordure d'accent latérale : un état se marque par un fond teinté, une icône ou un badge. Les jauges sont des rails de 8 px aux bouts ronds, avec un repère vertical pour le seuil à atteindre.

## Components

### Buttons
- **Shape :** angles doux (10 px), hauteur minimale de 44 px, y compris en petite taille.
- **Primary :** en sombre, aplat vert signal et texte carbone ; en clair, aplat carbone et texte blanc.
- **Secondary :** surface et bordure renforcée, texte principal.
- **Ghost / Quiet :** sans fond ; « quiet » en texte secondaire pour les icônes de la barre.
- **Danger :** fond rouge teinté, bordure rouge à 50 %, encre rouge ; il passe en aplat rouge au survol. Réservé à révoquer, geler, refuser.
- **Hover / Focus :** changement de fond en 150 ms ; anneau de focus de 2 px vert signal, décalé de 2 px. Un bouton occupé reste lisible, devient inactif et l'annonce.

### Chips
- **Badges :** 24 px de haut, angles de 6 px, libellé court avec icône facultative. Tons : neutre, contour, signal, relève (ambre plein, texte carbone), danger plein.
- **Filtres d'étiquettes :** pilules de 44 px, état pressé annoncé (`aria-pressed`) et marqué par un fond plus clair.

### Cards / Containers
- **Corner Style :** 12 px.
- **Background :** surface sur fond de page.
- **Shadow Strategy :** aucune (voir Elevation & Depth).
- **Border :** 1 px, bordure standard.
- **Internal Padding :** 16 à 24 px.

### Inputs / Fields
- **Style :** surface, bordure renforcée de 1 px, angles de 10 px, hauteur de 44 px, libellé toujours visible au-dessus et aide en dessous.
- **Focus :** la bordure passe au vert et un halo vert de 2 px apparaît. Pour la saisie du widget, le halo est porté par le conteneur.
- **Error / Disabled :** bordure rouge et message en encre rouge relié au champ ; inactif à 60 % d'opacité.

### Navigation
- **Barre du haut :** 56 px, logo puis nom de l'écran ou de l'organisation (tronqué sur téléphone, avec le symbole seul), commandes à droite en icônes de 44 px avec infobulle.
- **Console :** palette de commandes `Ctrl K`, navigation au clavier dans la file (flèches ou j/k, Entrée).

### Signature : barre segmentée et jauge de qualité
La barre segmentée (28 px de haut) montre comment les demandes ont été traitées. Seule la part « résolues par Relève, confirmées par le salarié » est en vert, avec son pourcentage imprimé si elle dépasse 12 %. Le reste est en deux gris, avec une légende chiffrée et une vue tableau. La jauge de qualité (8 px) compare les notes aux 300 nécessaires et la part correcte au repère des 80 % ; elle est verte quand la barre est atteinte, ambre en dessous, rouge en cas de réponse dangereuse, et toujours accompagnée de son chiffre et de son effectif.

## Do's and Don'ts

### Do:
- **Do** passer par les jetons `--c-*` (classes `bg-surface`, `text-soft`, `border-border`…) ; aucun hex brut dans un composant.
- **Do** afficher chaque chiffre avec son effectif, et « – » quand il n'y a pas de donnée.
- **Do** doubler tout état d'une icône Phosphor et d'un libellé.
- **Do** garder les cibles à 44 px minimum et l'anneau de focus de 2 px visible partout.
- **Do** limiter les animations à 150-300 ms sur `transform` et `opacity`, et respecter `prefers-reduced-motion`.
- **Do** ouvrir la console et les écrans du personnel en sombre, le widget et le rapport en clair.

### Don't:
- **Don't** mettre de bordure d'accent latérale sur une carte, une alerte ou une ligne de liste.
- **Don't** utiliser de dégradé, d'étincelle, de robot ou de vocabulaire « magique » pour parler de l'IA.
- **Don't** écrire du texte en vert vif (#3ddc97) sur fond clair.
- **Don't** employer le rouge pour autre chose qu'un incident, une réponse dangereuse ou un geste destructif.
- **Don't** afficher un prix, une marge ou un contenu de conversation dans un écran ou un rapport destiné au client.
- **Don't** utiliser de tiret cadratin dans un texte d'interface.
