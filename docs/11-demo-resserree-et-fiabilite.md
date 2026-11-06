# 11 · Démo resserrée, fiabilité avant étendue, ESN revendeur

> Décisions du fondateur (6 novembre 2026), après l'avis du produit :
> 1. Recentrer la première version sur une démo qui convainc, le reste venant après le premier client payant.
> 2. Mesurer la qualité des réponses sur de vraies demandes des pilotes dès les premières semaines.
> 3. Faire en sorte que l'ESN ait un intérêt direct à revendre Relève.
> 4. Brancher l'IA sur les systèmes d'alerte des outils (voir `docs/07` § 3 bis).

## 1. Le recentrage : une démo, pas un catalogue

### Pourquoi

Le périmètre dessiné jusqu'ici (plus de 15 connecteurs, 18 automatisations, 10 rôles, la suppléance, 7 tableaux de bord) représente plusieurs années de travail pour une équipe. Le premier risque n'est pas la concurrence, c'est de ne jamais livrer. **Une DSI pardonne un connecteur manquant, pas une mauvaise action sur un compte.**

### Dans la démo (et nulle part ailleurs)

| Domaine | Inclus dans la démo |
|---|---|
| Ticketing | **GLPI** uniquement, plus le connecteur « démo » qui simule un GLPI pour la version en ligne |
| Microsoft 365 | Diagnostic (compte, MFA, licences, connexions), **état des services** (`ServiceHealth.Read.All`), et actions de **niveau 1** limitées à : réinitialisation du MFA, mot de passe, déblocage, révocation de sessions. Tenant de test de la société du fondateur, comptes dédiés |
| Supervision | **Webhook générique** + schéma normalisé d'alerte (`docs/07` § 3 bis) |
| Corrélation | **Incident regroupé** (alerte + demandes). Si le temps le permet : panne Microsoft 365 reconnue comme telle |
| Sécurité de l'agent | Vérification d'identité hors bande avant toute action sur un compte, refus d'une réinitialisation suspecte (non négociable : c'est ce qui rend les actions de niveau 1 acceptables) |
| Suppléance | Chaîne de valideurs, délégation temporaire nominative et limitée, réauthentification MFA, notification, révocation |
| Écrans | **Technicien**, **ESN** (tous les clients + zoom + rapport mensuel), **administrateur client** (accès et suppléance) ; plus le **widget de chat** du salarié |
| Rôles | `super_admin` (par script, sans écran), `partner_admin`, `partner_technician`, `org_admin`, `end_user` |
| Administration | Création d'une ESN par script ; création d'un client par l'ESN avec un formulaire simple ; relation ESN-client approuvable et révocable |
| Qualité | Mode ombre, jeu d'évaluation et notation par les techniciens (§ 2) |

### Hors démo : le backlog, rangé par ordre

On n'y touche pas avant le premier client payant, sauf exception ci-dessous. L'architecture (schéma, interfaces de connecteurs, moteur de règles) **les accueille déjà**, mais on n'écrit pas leur code.

| Ordre | Contenu |
|---|---|
| 1 | Ce que le **premier client payant** utilise : son outil de ticketing, son RMM, sa supervision, passent en premier |
| 2 | Adaptateurs Zabbix et Centreon, Jira Service Management |
| 3 | **E-mail vers alerte** (couvre les outils qui ne savent qu'envoyer un mail) |
| 4 | RG System, NinjaOne, Atera, ScreenConnect, iTop, TeamsWork, PRTG, Freshservice, Zendesk |
| 5 | Écrans plateforme, direction, auditeur complet, salarié complet ; rôles restants |
| 6 | Automatisations de prévention et d'organisation du support (`docs/07` § 3.2 et 3.4) |
| 7 | Boîtes mail, licences, arrivées et départs ; relais Relève pour l'AD local ; EasyVista et les autres RMM |

**Exception** : un connecteur du backlog peut être ajouté avant le premier client payant uniquement si **un pilote donne l'accès** et si **la barre de fiabilité du § 2 est déjà franchie** sur le périmètre existant. Sinon, il attend.

**Ce qui ne se réduit jamais** : la sécurité (isolation entre organisations, garde-fous de l'agent, journal d'audit, tests d'abus). Le recentrage porte sur les fonctionnalités, pas sur la protection.

## 2. La fiabilité : mesurer sur de vraies demandes dès les premières semaines

### Principe

Ce qui compte pour une DSI, ce n'est pas le nombre de connecteurs, c'est que l'agent ne se trompe pas, ou le dise quand il ne sait pas. On mesure donc **avant** d'élargir.

### Les quatre étapes

| Étape | Ce qui se passe | Durée indicative |
|---|---|---|
| **1. Jeu d'évaluation réel** | Chaque pilote fournit 100 à 300 anciens tickets, anonymisés **avant** de quitter son environnement. On y associe la bonne réponse validée par un technicien | Semaines 1 à 2 |
| **2. Mode ombre** | Relève prépare une réponse sur chaque vraie demande, **visible du seul technicien**, qui la note. Les salariés ne reçoivent rien de l'IA | 2 semaines minimum par pilote |
| **3. Réponses directes en niveau 0**, par catégories | On n'ouvre que les catégories qui ont passé la barre. Les autres restent en mode ombre | Ensuite |
| **4. Actions de niveau 1** | Uniquement après la barre d'actions ci-dessous | Ensuite |

### Notation par les techniciens

Dans la console, sur chaque réponse préparée : **Correcte**, **Partielle**, **Fausse**, **Dangereuse**, avec un motif en un clic (source manquante, mauvaise version, hors périmètre, sur-confiance, autre). La note prend moins de 5 secondes, sinon elle ne sera pas faite.

### Indicateurs et barres de passage

Ces seuils sont des **propositions de départ**, à calibrer avec les pilotes.

| Indicateur | Définition | Barre pour passer en réponses directes |
|---|---|---|
| Réponse correcte et utile | Notée Correcte, sur les demandes dans le périmètre | **80 % ou plus** |
| Fausse mais affirmée avec assurance | Notée Fausse, sans que l'IA ait signalé son doute | **2 % ou moins** |
| Dangereuse | Conseil pouvant causer une perte de données ou une faille | **Aucune** sur l'échantillon. Un cas dangereux bloque la catégorie et déclenche une analyse |
| Escalade justifiée | L'IA passe la main et le technicien juge que c'était juste | **90 % ou plus** |
| Escalade manquée | L'IA répond alors qu'elle aurait dû passer la main | **3 % ou moins** |
| « Je ne sais pas » à propos | Hors base de connaissance, l'IA le dit au lieu d'inventer | **95 % ou plus** |

| Indicateur d'actions (niveau 1) | Barre avant d'élargir |
|---|---|
| Actions préparées avec la bonne cible et le bon périmètre | **100 %** sur au moins 50 actions réelles ou de test |
| Exécution sur le mauvais compte | **Aucune** |

**Attention à la taille des échantillons.** Avec 100 demandes, un taux mesuré de 80 % a une incertitude d'environ plus ou moins 8 points. On vise **300 demandes par catégorie** avant de conclure, et on n'affiche jamais un pourcentage sans son effectif.

### Retour arrière automatique

Si un technicien note une réponse **Dangereuse**, ou si le taux de réponses fausses dépasse la barre sur une semaine, la catégorie repasse en **conseil seul** (niveau 0 avec validation) jusqu'à analyse. Aucune montée de niveau sans avoir franchi la barre.

### Comparer les modèles

Le même jeu d'évaluation sert à comparer Mistral Small et Mistral Medium (qualité contre coût et délai), et à tester tout nouveau modèle avant de le brancher. Le fournisseur de modèle reste interchangeable.

### Données réelles : règles

- Consentement écrit du pilote et DPA signé avant tout export de tickets.
- **Anonymisation avant export** : noms, e-mails, adresses IP, noms de machines, numéros de téléphone retirés ou remplacés.
- **Jamais de données réelles dans le dépôt Git.** Le dépôt ne contient que des données synthétiques. Le jeu réel reste dans un stockage privé de la plateforme, accès limité, supprimé à la fin du pilote si le client le demande.
- Le jeu synthétique tourne dans la CI à chaque changement de prompt ou de modèle ; le jeu réel est rejoué manuellement avant chaque ouverture d'une nouvelle catégorie.

### Transparence

Un écran « Qualité de Relève » visible de l'ESN et de l'administrateur client montre ces indicateurs réels, avec leur effectif. Publier ses vrais chiffres, y compris les mauvais, est un argument de confiance face à un marché qui annonce surtout des taux flatteurs.

## 3. Faire de l'ESN un revendeur

L'ESN est votre canal principal. Elle revendra Relève si elle **y gagne de l'argent, de la valeur perçue par ses clients, et si c'est simple**. Le produit doit donc la servir autant que le client final.

### Ce que le produit fait pour que l'ESN ait intérêt à revendre

| Levier | Concrètement |
|---|---|
| **Elle fixe son prix** | Relève facture l'ESN au prix partenaire (remise de 25 à 35 % prévue dans `docs/02`) ; l'ESN fixe librement le prix à son client et garde la différence. La marge est visible dans son tableau de bord |
| **Le client reste le sien** | Un client créé par l'ESN lui reste rattaché. Relève ne démarche jamais directement les clients d'une ESN pour leur vendre, sauf accord écrit |
| **Un rapport qui la valorise** | Le rapport mensuel porte **le logo et les couleurs de l'ESN**, prêt à envoyer en un clic. Il montre ce que l'équipe et Relève ont traité, sans effacer la contribution de l'ESN |
| **Un bloc « prochaine étape » dans chaque rapport** | Par exemple : étendre la relève à d'autres périodes, activer le niveau 1 pour les mots de passe, ajouter un connecteur. Des pistes de vente prêtes à proposer |
| **Un tableau d'opportunités** | Dans l'écran ESN : clients sans relève active, pilotes qui se terminent, clients qui ont connu des absences ce trimestre (« Clinique des Tilleuls : 3 absences, proposer la relève permanente ») |
| **Un kit de vente intégré** | Démonstration en un clic sur un client fictif, calculateur de valeur avec méthode affichée, modèle de proposition commerciale, modèle de contrat de sous-traitance, page « Sécurité » à joindre aux appels d'offres |
| **Mise en route en moins d'une journée** | Assistant d'activation d'un nouveau client : relation, connecteurs, salariés, plannings de relève |
| **Marque blanche complète** | Logo, couleurs, nom de domaine et expéditeur des e-mails au nom de l'ESN |
| **Moins de charge pour elle** | Les gains qu'elle voit : moins d'astreintes, moins de tickets de niveau 1, techniciens moins sollicités |

### Garde-fous

- Les chiffres de « temps gagné » et de « valeur » sont toujours **affichés comme des estimations**, avec leur méthode. Pas de promesse chiffrée dans un rapport commercial que le client ne pourrait pas vérifier.
- Les grilles de remise et le contrat revendeur sont à décider et à **faire relire par un juriste** avant le premier partenaire.

### À décider par le fondateur (questions ouvertes)

1. Remise revendeur : 25 %, 30 % ou 35 % selon le volume ?
2. Engagement minimal du partenaire (nombre de clients, durée) ?
3. L'ESN peut-elle revendre sous son seul nom, sans mention « propulsé par Relève » ?
