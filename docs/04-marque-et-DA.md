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

**À faire avant tout** : recherche d'antériorité sur **[data.inpi.fr](https://data.inpi.fr)** (classes 9, 38 et 42) et disponibilité des domaines. « Relève » est un mot courant : il faudra probablement un dépôt semi-figuratif (nom et logo) ou une variante (« Relève IA », « Relevo »). Je ne l'ai pas vérifié.

## 2. Plateforme de marque

| Élément | Contenu |
|---|---|
| **Mission** | Garantir qu'aucun utilisateur ne reste bloqué parce qu'un technicien est absent. |
| **Promesse** | Le support continue, vos techniciens respirent. |
| **Valeurs** | Fiabilité (on préfère escalader que se tromper) · Transparence (on dit toujours qu'on est une IA) · Respect du métier (on aide les techniciens, on ne les remplace pas) · Souveraineté |
| **Personnalité** | Un collègue calme et compétent qui prend la garde de nuit : sobre, précis, rassurant. Pas un robot rigolo. |
| **Ton** | Vouvoiement, phrases courtes, voix active. Côté utilisateur : simple et sans jargon. Côté technicien : technique et factuel. |

## 3. Identité visuelle

### Concept

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
