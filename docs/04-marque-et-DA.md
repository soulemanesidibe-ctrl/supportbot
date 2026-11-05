# 04 · Marque et direction artistique

> « SupportBot » est un nom de travail. Il est trop générique pour être déposé et ne différencie pas. Voici une proposition de marque à valider.

## 1. Le nom

### Proposition principale : **Relève**

- Évoque **la relève de la garde** : on prend le relais quand l'équipe n'est pas là, puis on rend la main. C'est exactement le positionnement.
- Français, court, prononçable partout, connotation positive (« prendre la relève », « la relève est assurée »).
- Slogan : **« La relève est assurée. »**

### Alternatives

| Nom | Idée | Point faible |
|---|---|---|
| **Binôme** | L'IA fait équipe avec le technicien, elle ne le remplace pas | Moins évocateur de la continuité |
| **Astreinte** | Le vocabulaire exact des équipes IT | Connotation de contrainte |
| **Veilleur** | Celui qui veille la nuit | Plus poétique, moins business |

**Nom retenu par le fondateur le 5 novembre 2026.**

**Domaines** (vérifiés le 5 novembre 2026) :

| Pris | Libres |
|---|---|
| releve.fr, releve.ai, releve.io, releve.app, releve.eu, getreleve.com | **releve-ia.fr**, **releveia.fr**, releve-ia.com, releveia.com, releve.tech, relevesupport.fr, releve-support.fr |

Recommandation : réserver **releve-ia.fr** et **releveia.com** (environ 10 € par an chacun), puis utiliser « Relève IA » comme nom commercial complet.

**Marque INPI : à vérifier par vous.** Le site data.inpi.fr bloque les recherches automatiques. Chercher « RELEVE » et « RELEVE IA » dans les classes **9** (logiciels), **38** (télécommunications) et **42** (SaaS, services informatiques). « Relève » étant un mot courant, des marques proches existent probablement : un dépôt semi-figuratif (nom et logo) de « Relève IA » est le plus sûr. Coût d'un dépôt INPI : à partir de 190 € pour une classe, plus 40 € par classe supplémentaire (à confirmer sur [inpi.fr](https://www.inpi.fr)).

## 2. Plateforme de marque

| Élément | Contenu |
|---|---|
| **Mission** | Garantir qu'aucun utilisateur ne reste bloqué parce qu'un technicien est absent. |
| **Promesse** | Le support continue, vos techniciens respirent. |
| **Valeurs** | Fiabilité (on préfère escalader que se tromper) · Transparence (on dit toujours qu'on est une IA) · Respect du métier (on aide les techniciens, on ne les remplace pas) · Souveraineté |
| **Personnalité** | Un collègue calme et compétent qui prend la garde de nuit : sobre, précis, rassurant. Pas un robot rigolo. |
| **Ton** | Vouvoiement, phrases courtes, voix active. Côté utilisateur : simple et sans jargon. Côté technicien : technique et factuel. |

## 3. Identité visuelle

### Trois directions à choisir

Planche visuelle en ligne : **[Relève IA · Identité visuelle](https://claude.ai/artifact/R9f1Z9Bnw4mZ4p2HymWNmT)** (logos clair et sombre, palette, typographie, widget de chat et console pour chaque direction).

| | A · Garde de nuit | B · Signal | C · Atelier |
|---|---|---|---|
| **Idée** | Le veilleur qui prend la garde de nuit | L'outil d'ingénieur, précis et rapide | Le collègue de terrain, le passage de témoin |
| **Symbole** | Deux chevrons qui se passent le relais | Une ligne de signal qui se stabilise | Deux témoins qui se chevauchent |
| **Couleurs** | Bleu nuit `#12233F` et ambre `#F2A93B` | Carbone `#0E0F11` et vert signal `#3DDC97` | Bleu de travail `#1F45D1` et jaune signalétique `#FFC83D` |
| **Polices** | Manrope, Inter, JetBrains Mono | Geist, Geist Mono | Bricolage Grotesque, Instrument Sans, IBM Plex Mono |
| **Parle d'abord à** | DSI, secteur public, ETI | Techniciens, ESN exigeantes | PME, ESN de proximité |
| **Risque** | Classique, peut sembler sage | Plus froid pour un utilisateur non technicien | Moins « grand compte » |

Toutes les polices sont gratuites (Google Fonts). Chaque direction garde ses obligations : badge « Assistant IA », badge « Relève active », bouton « Parler à un technicien ».

### Direction retenue : **B · Signal** (décision du 5 novembre 2026)

- **Console technicien et back-office ESN** : thème sombre par défaut (outil d'ingénieur), thème clair disponible.
- **Widget des salariés** : thème clair par défaut (public non technicien), thème sombre disponible.
- **Symbole** : ligne de signal qui se stabilise, point vert en bout de ligne. **Logotype** : « relève. » en minuscules, Geist 600, point final vert.
- **Polices** : Geist (titres et texte), Geist Mono (identifiants, journaux, chiffres).

#### Tokens

| Token | Sombre | Clair | Usage |
|---|---|---|---|
| `--c-bg` | `#0E0F11` | `#F4F5F6` | Fond de page |
| `--c-surface` | `#17181B` | `#FFFFFF` | Cartes, panneaux |
| `--c-surface-2` | `#1F2125` | `#ECEEF0` | Survols, bulles de l'IA |
| `--c-border` | `#26282D` | `#DCDFE3` | Bordures |
| `--c-text` | `#EDEEF0` | `#0E0F11` | Texte principal |
| `--c-text-soft` | `#9A9EA6` | `#4A4F57` | Texte secondaire (≥ 4.5:1) |
| `--c-signal` | `#3DDC97` | `#138A5A` | Accent : remplissage des boutons en sombre ; texte et liens en clair |
| `--c-on-signal` | `#0E0F11` | `#FFFFFF` | Texte posé sur l'accent |
| `--c-relief` | `#F2B33D` | `#F2B33D` | Badge « Relève active » (texte `#0E0F11` dessus) |
| `--c-danger` | `#F0605A` | `#C93B36` | Incidents et erreurs critiques uniquement |

En thème clair, le vert `#3DDC97` ne sert qu'en **aplat avec du texte foncé dessus**, jamais en texte sur fond blanc (contraste insuffisant).

Le détail ci-dessous (concept, palette) correspond à la direction A, proposée au départ ; il est conservé pour mémoire.

### Concept (direction A)

**Le passage de témoin** : deux formes qui se transmettent un relais, ou un symbole de veille (lampe de garde). Pas de robot, pas de casque de téléopérateur, pas de cerveau électronique : ces images sont vues partout et contredisent le message « on ne remplace pas l'humain ».

### Palette

| Token | Rôle | Hex | Usage |
|---|---|---|---|
| `--c-nuit` | Primaire | `#12233F` | Fonds sombres, titres, logo. Évoque la garde de nuit |
| `--c-nuit-2` | Primaire secondaire | `#24406B` | Survols, aplats |
| `--c-veille` | Accent | `#F2A93B` | Appels à l'action, indicateur « relève active ». Évoque la lampe de garde |
| `--c-resolu` | Succès | `#1E9E6A` | Ticket résolu, statut OK |
| `--c-alerte` | Erreur | `#D64545` | Uniquement pour les alertes critiques |
| `--c-fond` | Fond clair | `#F6F7F9` | Fond de page |
| `--c-texte` | Texte | `#1A1F2B` | Texte courant |
| `--c-texte-doux` | Texte secondaire | `#4A5468` | Libellés (contraste ≥ 4.5:1 sur fond clair) |

L'ambre sur bleu nuit doit être vérifié en contraste pour chaque usage de texte ; en bouton, utiliser du texte `--c-nuit` sur fond `--c-veille`.

### Typographie (gratuites, hébergeables en France)

- **Titres** : Manrope (700 à 800)
- **Corps** : Inter (400 à 500)
- **Console technicien et extraits techniques** : JetBrains Mono

### Règles d'interface

Celles du skill `.claude/skills/ui-ux-pro-max` s'appliquent, en particulier :

- un **indicateur « Assistant IA »** visible en permanence dans le chat (AI Act) ;
- un bouton **« Parler à un technicien »** toujours accessible ;
- un **badge « Relève active »** (ambre) quand l'équipe est absente, pour que l'utilisateur sache à quoi s'attendre.

## 4. Lien avec EchoBridge

Deux options, à trancher (voir [06](06-synergies-echobridge.md)) :

1. **Marques indépendantes** (recommandé au départ) : cibles différentes (RH ou DSI), messages différents.
2. **Famille de marques** : signature commune du type « une solution du groupe EchoBridge » pour rassurer, sans mélanger les identités visuelles.
