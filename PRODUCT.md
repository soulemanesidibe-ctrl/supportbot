# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Salariés des clients (`end_user`)** : employés de PME, collectivités ou ETI, non techniciens, bloqués par un problème informatique (mot de passe, double authentification, VPN, imprimante, Outlook, Teams, OneDrive, poste lent). Ils écrivent depuis le navigateur, parfois sur téléphone, souvent quand leur équipe informatique est absente (nuit, congés, astreinte). Leur travail : être débloqués vite, sans jargon, et savoir à quoi s'attendre. **Écran prioritaire de la démo** (confirmé le 16 novembre 2026).
- **Techniciens (`partner_technician`, ESN ou DSI)** : traitent les demandes de plusieurs clients, valident ou refusent les actions préparées par l'IA, notent ses réponses, reprennent les conversations escaladées, se relaient en suppléance. Souvent sur plusieurs écrans, parfois d'astreinte sur téléphone. Leur question : « Quoi faire maintenant, et sur quel client ? ».
- **Administrateur de l'ESN (`partner_admin`)** : pilote tous ses clients, crée et prépare les clients, assigne ses techniciens, fixe son prix, envoie un rapport mensuel à sa marque. Sa question : « Lequel de mes clients a besoin de moi, et est-ce que je gagne de l'argent ? ».
- **Administrateur du client (`org_admin`, DSI)** : garde la main sur son SI : relation avec l'ESN, qui a accès à quoi et jusqu'à quand, valideurs et suppléances, niveau d'autonomie, connecteurs, qualité de Relève. Sa question : « Mon support tient-il, et qui a accès à quoi ? ».
- Le super administrateur de la plateforme n'a pas d'écran dans la démo (script).

## Product Purpose

Relève est un agent IA de support informatique de niveau 1 qui **prend la garde** quand les techniciens d'une ESN ou d'une DSI sont absents : il répond aux demandes simples à partir de la base de connaissance du client, prépare des tickets qualifiés pour le reste, propose des actions sur les comptes Microsoft 365 qu'un humain valide, regroupe une panne en un seul incident, et **rend la main** avec un rapport de passation. Il ne remplace pas les techniciens. Mission : qu'aucun salarié ne reste bloqué parce qu'un technicien est absent. Le succès se mesure en production : délai de première réponse, tickets réellement évités, qualité des passations, actions validées.

## Positioning

- **Acheteur : l'ESN, qui revend Relève** à ses clients (prix libre, client qui lui reste rattaché, rapport mensuel à sa marque, tableau d'opportunités).
- **Fiabilité mesurée avant étendue** : mode ombre, notation de chaque réponse par les techniciens, barres de passage chiffrées publiées avec leurs effectifs ; une catégorie ne s'ouvre au salarié qu'après avoir franchi la barre.
- **L'IA n'agit jamais avec ses propres droits** : toute action sur un compte est validée par un technicien nommé et s'exécute avec son identité ; vérification d'identité hors bande ; suppléance nominative, limitée et tracée.
- **Souveraineté** : données dans l'Union européenne, modèle Mistral, hébergement européen.

## Operating Context

- Le salarié ouvre le **widget** (page hébergée par Relève, lien depuis l'intranet du client) ; les réponses arrivent en continu ; une demande d'action sur un compte part toujours vers un technicien ; un incident en cours lui est annoncé par un message fixe.
- Le technicien travaille dans la **console** : file unifiée de ses clients assignés, boîte de validation, vue incident (alertes et demandes sur une ligne de temps), écran « Pendant votre absence », palette de commandes au clavier.
- Les outils voisins : **GLPI** (ticketing), **Microsoft 365 / Entra ID** (comptes), outils de supervision par **webhook** (Zabbix, Centreon, PRTG…).
- Les décisions passent par des rituels réels : validation d'une action avec vérification d'identité, délégation avant une absence, revue des accès, rapport mensuel ESN au client.

## Capabilities and Constraints

- Pile imposée : React, Vite, TypeScript, Tailwind CSS v4, primitives accessibles (Radix via shadcn/ui personnalisé), Motion, cmdk, icônes Phosphor ; back-end Supabase (UE) et Edge Functions déjà écrits (J0 à J4).
- Rôles actifs dans la démo : `partner_admin`, `partner_technician`, `org_admin`, `end_user` (+ `super_admin` par script).
- Autonomie 0 (conseille) ou 1 (agit après validation humaine). **Le niveau 2 n'existe pas** et n'apparaît dans aucune interface.
- **Aucun jeton dans `localStorage`** ; CSP stricte ; aucun secret (mot de passe, jeton, clé) affiché dans un fil, même partiellement.
- Isolation stricte : un technicien ne voit que les clients assignés ; le client ne voit jamais le prix partenaire ni la marge de l'ESN.
- Marque blanche : logo et couleurs de l'ESN par variables, contraste recalculé.
- Textes en **français d'abord**, anglais ensuite. Vouvoiement.
- Undecided : intégration du widget en iframe (P1), Adaptive Cards Teams (hors démo), domaine d'envoi des e-mails des ESN.

## Brand Commitments

- Nom : **Relève** (« Relève IA » en nom commercial). Slogan : « La relève est assurée. » Logotype « relève. » en minuscules, point final vert.
- Direction visuelle **B « Signal »**, retenue le 5 novembre 2026 : tokens, polices (Geist, Geist Mono) et thèmes fixés dans `docs/04-marque-et-DA.md` (console et back-office en sombre par défaut, widget salarié en clair par défaut, les deux thèmes partout).
- Personnalité : un collègue calme et compétent qui prend la garde de nuit : sobre, précis, rassurant ; pas un robot rigolo. Ton : vouvoiement, phrases courtes, voix active ; simple côté salarié, technique et factuel côté technicien.
- Obligations visibles partout dans le chat : badge **« Assistant IA »**, bouton **« Parler à un technicien »** à un clic, badge **« Relève active »** quand l'équipe est absente (avec l'heure de retour d'un humain).
- Pas de clichés IA : pas de robot, pas d'étincelles, pas de dégradés violets ; pas de vocabulaire magique (« un outil de production, pas un projet IA »).

## Evidence on Hand

- Données de démonstration **synthétiques** uniquement (`supabase/seed/`) : une ESN « Nord Numérique », deux clients « Cabinet Alpha » et « Atelier Bêta », 20 fiches de base de connaissance. **Aucune donnée réelle** de pilote dans le dépôt.
- Aucun client payant, aucun témoignage, aucun chiffre de qualité réel à ce jour : les indicateurs de qualité s'affichent avec leur effectif, et rien n'est inventé.
- Planche d'identité : `docs/identite-visuelle/` (directions A, B, C ; maquettes de cockpits).

## Product Principles

1. **On préfère escalader que se tromper** : dire « je transmets à un technicien » vaut mieux qu'une réponse douteuse.
2. **Un humain valide toute action** ; ce que le valideur voit est exactement ce qui s'exécute.
3. **Chaque écran sert une tâche précise d'un rôle** et dit ce que ce rôle voit, peut faire et ne peut pas faire.
4. **Les chiffres sont vrais et sourcés** : jamais un pourcentage sans son effectif, une estimation est présentée comme telle.
5. **Transparence** : on dit toujours qu'on est une IA.

## Accessibility & Inclusion

RGAA et WCAG 2.2 AA (exigence du secteur public, clients cibles) : contraste ≥ 4.5:1, focus visible, cibles tactiles ≥ 44 px, information jamais portée par la couleur seule, `prefers-reduced-motion` respecté, utilisable au clavier et au lecteur d'écran.
