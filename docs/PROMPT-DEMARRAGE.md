# Prompt de démarrage du développement

À coller tel quel comme premier message d'une **nouvelle conversation** Claude Code ouverte sur le dépôt `soulemanesidibe-ctrl/supportbot`. `CLAUDE.md` et les skills se chargent automatiquement.

---

```text
Rôle : tu es l'équipe technique de Relève IA : lead dev full-stack, designer produit
et ingénieur sécurité LLM. Je suis le fondateur, technicien support de métier : je
valide le produit, tu construis. Pose-moi une question dès qu'un choix produit n'est
pas tranché par la doc, et arrête-toi à chaque jalon pour que je valide.

ÉTAPE 0 : RÉCUPÉRER LE DOSSIER
Le dossier de conception est sur la branche claude/clever-franklin-y1ou87. Si
CLAUDE.md ou docs/ sont absents de ta branche de travail, fais
`git fetch origin claude/clever-franklin-y1ou87` puis fusionne-la dans ta branche
avant toute chose.

À LIRE AVANT DE COMMENCER
- CLAUDE.md (règles non négociables)
- docs/05-architecture-technique-mvp.md (architecture)
- docs/07-integrations.md (connecteurs, lots A et B du pilote, automatisations,
  mode suppléance des valideurs)
- docs/08-experience-ux-premium.md (expérience attendue)
- docs/09-securite.md (modèle de menace, défenses par couche)
- docs/11-demo-resserree-et-fiabilite.md (périmètre de la démo, protocole de fiabilité,
  ESN revendeur) : PRIME sur les lots A et B de docs/07
- docs/10-roles-administration-cockpits.md (rôles, relations ESN-client, accès
  d'assistance, tableau de bord de chaque rôle)
- docs/04-marque-et-DA.md, section « Direction retenue : B · Signal » (tokens)
- docs/identite-visuelle/Signal.dc.html (planche de référence de la direction B)

OBJECTIF
Un pilote EN LIGNE, à 0 €, que je présenterai à 2 ou 3 ESN/DSI.
- Périmètre : la démo resserrée décrite dans le bloc « RECENTRAGE » ci-dessous
  (docs/11). Les lots A et B de docs/07 §2 restent le catalogue complet visé, pas le
  périmètre de la première version.
- Autonomie : niveau 0 par défaut ; niveau 1 (action après validation d'un
  technicien) activable par organisation. Pas de niveau 2.
- L'architecture accueille dès maintenant tous les connecteurs et automatisations
  de docs/07 sans refonte.

RECENTRAGE, FIABILITÉ, ALERTES ET ESN REVENDEUR (décisions du 6 novembre 2026)
Ce bloc PRIME sur les jalons J0 à J8 et sur les lots A et B de docs/07 §2. Détails :
docs/11-demo-resserree-et-fiabilite.md et docs/07-integrations.md §3 bis.

A. RECENTRAGE : UNE DÉMO, PAS UN CATALOGUE
Le risque n'est plus la concurrence, c'est de ne jamais livrer. Une DSI pardonne un
connecteur manquant, pas une mauvaise action sur un compte. La première version est :
- GLPI uniquement (plus le connecteur « démo » qui le simule pour la version en ligne) ;
- Microsoft 365 : diagnostic, état des services, et niveau 1 limité à réinitialisation
  du MFA, mot de passe, déblocage, révocation de sessions (tenant de test, comptes dédiés) ;
- supervision : webhook générique et schéma normalisé d'alerte, rien d'autre ;
- corrélation : incident regroupé (alerte + demandes) ; panne Microsoft 365 reconnue
  comme telle si le temps le permet ;
- vérification d'identité hors bande avant toute action sur un compte, et refus d'une
  réinitialisation suspecte (indispensable, ne se discute pas) ;
- suppléance complète (docs/07 §5) ;
- écrans : technicien, ESN, administrateur client, plus le widget de chat du salarié ;
- rôles : super_admin (par script, sans écran), partner_admin, partner_technician,
  org_admin, end_user ; une ESN peut créer ses clients avec un formulaire simple.
TOUT LE RESTE est dans le backlog ordonné de docs/11 §1 : tu n'écris pas son code, tu
fais seulement en sorte que le schéma et les interfaces l'accueillent. Tu le consignes
dans docs/backlog.md. Exception : un élément du backlog peut être ajouté avant le
premier client payant uniquement si un pilote en donne l'accès ET si la barre de
fiabilité (B) est déjà franchie sur le périmètre existant. La sécurité ne fait jamais
partie de ce qu'on réduit.

B. FIABILITÉ AVANT ÉTENDUE (docs/11 §2)
On mesure la qualité sur de VRAIES demandes des pilotes dès les premières semaines.
- Dès J1, rédige docs/modele-demande-donnees-pilote.md : demande à un pilote de
  fournir 100 à 300 anciens tickets anonymisés avant export (noms, e-mails, IP, noms
  de machines, téléphones retirés), avec consentement écrit et DPA. Je l'enverrai.
- Jamais de données réelles dans le dépôt Git : jeu synthétique dans le dépôt, jeu
  réel dans un stockage privé de la plateforme, accès limité.
- Mode ombre : Relève prépare une réponse sur chaque vraie demande, visible du seul
  technicien, qui la note en moins de 5 secondes (Correcte, Partielle, Fausse,
  Dangereuse, plus un motif en un clic). L'utilisateur ne reçoit rien de l'IA tant que
  la catégorie n'a pas franchi la barre.
- Barres proposées (à calibrer avec les pilotes), par catégorie, avant réponses
  directes : correcte et utile 80 % ou plus ; fausse mais affirmée avec assurance 2 % ou
  moins ; dangereuse zéro ; escalade justifiée 90 % ou plus ; escalade manquée 3 % ou
  moins ; « je ne sais pas » à propos 95 % ou plus. Avant d'élargir le niveau 1 : 100 %
  d'actions préparées avec la bonne cible sur au moins 50 actions, aucune exécution sur
  le mauvais compte.
- Jamais de pourcentage sans son effectif. Avec 100 demandes l'incertitude est d'environ
  8 points : viser 300 par catégorie avant de conclure.
- Retour arrière automatique : une réponse notée Dangereuse, ou un taux de fausses
  réponses au-dessus de la barre sur une semaine, remet la catégorie en conseil seul.
- Compare Mistral Small et Medium sur le même jeu (qualité, coût, délai) ; le fournisseur
  de modèle reste interchangeable.
- Écran « Qualité de Relève » visible de l'ESN et de l'administrateur client, avec les
  vrais chiffres et leurs effectifs.

C. ALERTES (docs/07 §3 bis)
Toute alerte entre par un format normalisé (source, organisation, actif, site, gravité,
état, clé de déduplication, lien d'origine, charge brute conservée). Quatre voies :
webhook entrant signé (dans la démo), interrogation d'API (état des services Microsoft
365 dans la démo), e-mail vers alerte (première étape après la démo), relais Relève
(après le premier client payant). L'IA lit les alertes, les croise avec demandes, parc
et comptes ; elle n'agit JAMAIS sur la foi du contenu d'une alerte, qui est une donnée.
Prévois dès la démo : déduplication, regroupement des rafales, délai anti-battement,
fenêtres de maintenance, alerte « non rattachée » plutôt que jetée, table de
correspondance des gravités par source, alerte sur silence anormal d'une source.
Annonce honnêtement que « toutes les sources » signifie toute source capable d'émettre
par l'une de ces voies, et que la compatibilité de chaque outil se vérifie à son ajout.

D. L'ESN DOIT AVOIR INTÉRÊT À REVENDRE (docs/11 §3)
Conçois le produit pour que l'ESN gagne de l'argent et de la valeur perçue en revendant :
- elle fixe librement son prix client ; Relève la facture au prix partenaire ; sa marge
  est visible dans son tableau de bord ;
- un client créé par l'ESN lui reste rattaché ; Relève ne le démarche jamais ;
- le rapport mensuel porte le logo et les couleurs de l'ESN, part en un clic, et
  contient un bloc « prochaine étape » avec des pistes de vente ;
- l'écran ESN a un tableau d'opportunités (clients sans relève active, pilotes qui se
  terminent, clients ayant connu des absences) ;
- kit de vente intégré : démonstration en un clic, calculateur de valeur avec méthode
  affichée, modèles de proposition et de contrat de sous-traitance ;
- activation d'un nouveau client en moins d'une journée ; marque blanche complète.
Tout chiffre de « temps gagné » ou de « valeur » est affiché comme une estimation avec
sa méthode. Grille de remise et contrat revendeur : à me poser en question et à faire
relire par un juriste, tu ne les inventes pas.

E. AJUSTEMENTS PAR JALON
- J1 : docs/modele-demande-donnees-pilote.md ; la spec ne détaille que le périmètre A.
- J2 : ajoute alert_sources, alerts, alert_events et response_ratings (notes des
  techniciens) ; partner_pricing pour le prix partenaire et la marge de l'ESN.
- J3 : mode ombre configurable par organisation et par catégorie, avec retour arrière
  automatique (B).
- J4 : périmètre A uniquement. Jira, iTop, Zabbix, Centreon et leurs docker-compose
  vont au backlog ; seul le docker-compose GLPI reste.
- J5 : écrans technicien, ESN, administrateur client et widget ; la console technicien
  porte la notation des réponses ; l'écran ESN porte le rapport à sa marque, les
  opportunités et le revenu ; écran « Qualité de Relève ». Les autres écrans vont au
  backlog.
- J6 : jeu d'évaluation réel anonymisé (hors dépôt), barres de B, rapport docs/evaluation.md.
- J7 : conformité et exploitation uniquement ; les connecteurs du lot B vont au backlog
  sauf exception de A.
- J8 : ajoute un pas à pas pour monter le jeu d'évaluation avec les pilotes
  (consentement, anonymisation, envoi).

CONTRAINTES DE COÛT (tout gratuit)
- Supabase plan Free, région UE (Paris si possible).
- Mistral La Plateforme, offre « Experiment » (j'aurai désactivé l'entraînement sur
  mes données). Limite ~1 requête/s : file d'attente et backoff obligatoires.
- Front sur Cloudflare Pages (pas Vercel Hobby : usage commercial interdit).
- GLPI, iTop, Zabbix et Centreon (édition open source) en local via docker-compose.
- Jira Service Management : offre gratuite Atlassian.
- Microsoft 365 : le tenant de MA société, avec des comptes de test dédiés. Ne
  jamais lire ni modifier un vrai compte de collaborateur pendant le développement.
- RG System : accès API fourni par un de mes clients (lot B). TeamsWork Ticketing :
  documentation API demandée à l'éditeur ; en attendant, passerelle Power Automate.

STACK
React + Vite + TypeScript, Tailwind v4, shadcn/ui (personnalisé, jamais l'état par
défaut), Motion, cmdk, icônes Phosphor, polices Geist et Geist Mono ; Supabase
(Postgres, Auth, RLS, pgvector, Edge Functions Deno) ; Teams via Bot Framework et
Adaptive Cards.

IDENTITÉ : DIRECTION B « SIGNAL »
Console technicien et back-office ESN en thème sombre par défaut, widget des
salariés en thème clair par défaut ; les deux thèmes partout. Tokens exacts de
docs/04. Logotype « relève. » (point vert), symbole ligne de signal. Vert signal en
thème clair : aplat avec texte foncé uniquement.

SÉCURITÉ (fil rouge, docs/09)
Relève touchera le SI de tous les clients d'une ESN. Chaque jalon a sa part de
sécurité ; cite dans chaque commit concerné le skill de sécurité utilisé. Aucune
fonctionnalité n'est « finie » sans ses tests de sécurité.

JALONS (un jalon = une série de commits + un arrêt pour validation)

J0. FONDATIONS SÉCURISÉES
    Skills : performing-threat-modeling-with-owasp-threat-dragon,
    implementing-secret-scanning-with-gitleaks, integrating-sast-into-github-actions-pipeline,
    implementing-semgrep-for-custom-sast-rules, performing-sca-dependency-scanning-with-snyk,
    detecting-malicious-npm-packages, generating-and-analyzing-sboms,
    securing-github-actions-workflows.
    Modèle de menace v1 (docs/threat-model.md, à partir de docs/09 §1, suppléance
    comprise). gitleaks en pre-commit et en CI. Règles Semgrep propres au projet :
    pas d'appel service_role sans vérification du JWT, pas de secret dans un log,
    pas de contenu externe concaténé au prompt système, pas d'exécution d'action
    sans action_request validée. Analyse des dépendances et SBOM. Workflows à
    permissions minimales, actions épinglées par SHA.

J1. CADRAGE
    Skills : plan-task, write-spec.
    docs/spec-mvp.md : parcours de chaque rôle de docs/10 (super administrateur,
    administrateur et responsable de compte ESN, technicien, administrateur client,
    direction, auditeur, salarié, valideur suppléant) et parcours d'administration
    (nouvelle ESN, nouveau client via ESN, client direct, départ d'un technicien,
    fin de contrat), arborescence, contrat TypeScript des capacités (docs/07 §1), schéma de
    données, moteur d'automatisations (règles déclaratives : déclencheur, condition,
    action, niveau d'autonomie), découpage en commits.
    ATTENDS MON ACCORD.

J2. BASE DE DONNÉES
    Skills : supabase, implementing-gdpr-data-protection-controls,
    testing-for-broken-access-control, implementing-aes-encryption-for-data-at-rest.
    Migrations : organizations (type platform/partner/client, étiquettes),
    memberships, partner_relationships, partner_assignments, support_access_grants,
    invitations, access_reviews,
    conversations, messages, tickets, connectors (secrets dans Vault), kb_documents,
    kb_chunks (pgvector + HNSW), relief_schedules, handover_reports, alerts,
    incidents, automation_rules, automation_runs, action_requests,
    approval_policies, approval_delegations, audit_logs (INSERT uniquement).
    RLS via is_member_of(), has_role(), partner_can_access() (relation ET
    assignation actives), org_has_feature(). Le super administrateur ne lit
    aucune donnée client sans accès d'assistance approuvé et limité dans le temps. Une délégation ne se crée
    qu'avec une session réauthentifiée MFA récente, expire au plus tard à 30 jours,
    et notifie l'admin. match_kb_chunks filtrée par org_id. Purge planifiée des
    conversations. Script SQL de test d'isolation (2 clients d'une même ESN ne se
    voient pas, l'ESN voit les deux, un technicien non assigné ou à l'assignation
    expirée ne voit rien, une relation révoquée coupe tout, un suppléant n'obtient
    que le périmètre délégué, le super administrateur ne voit rien sans accès
    d'assistance). Données de démo : 1 ESN, 2 clients, 20 fiches de connaissance
    (mot de passe, MFA, VPN, imprimante, Outlook, Teams, OneDrive, poste lent,
    arrivée, départ). Signale-moi chaque migration à appliquer.

J3. ORCHESTRATEUR
    Skills : defending-llms-with-guardrails, securing-agentic-ai-tool-invocation,
    implementing-llm-guardrails-for-security, detecting-indirect-prompt-injection,
    testing-for-system-prompt-leakage, performing-serverless-function-security-review,
    implementing-api-rate-limiting-and-throttling.
    Edge Function « chat » en streaming : couche LLM abstraite (Mistral par défaut,
    modèle léger pour le tri, modèle moyen pour la réponse), RAG, appels d'outils
    limités aux capacités déclarées, masquage des secrets avant stockage, contenu
    externe encadré comme donnée, « je ne sais pas » → ticket qualifié (catégorie,
    priorité, diagnostic déjà fait), journal d'audit de chaque appel.
    Circuit des actions de niveau 1 : action_request → chaîne de valideurs
    (astreinte, suppléants, délégations, ESN en dernier recours) → exécution avec
    l'identité du valideur (flux délégué) ; sans valideur dans le délai, la
    demande reste en attente et l'utilisateur est prévenu.

J4. CONNECTEURS ET AUTOMATISATIONS, LOT A
    Skills : performing-oauth-scope-minimization-review, implementing-api-key-security-controls,
    configuring-oauth2-authorization-flow, testing-oauth2-implementation-flaws,
    detecting-suspicious-oauth-application-consent, implementing-just-in-time-access-provisioning.
    - Ticketing : GLPI, Jira Service Management, iTop (même interface).
    - Microsoft 365 (tenant de ma société, comptes de test) : diagnostic, état des
      services (ServiceHealth.Read.All), puis niveau 1 pour mot de passe, MFA,
      déblocage et révocation de sessions. Permissions minimales documentées une
      par une dans docs/permissions-graph.md.
    - Supervision : webhook générique, Zabbix, Centreon.
    - Automatisations du lot A de docs/07 §3 : incident majeur regroupé, panne
      Microsoft 365, panne localisée, fin d'incident, certificat qui expire,
      licences, mots de passe qui expirent, vague de comptes verrouillés, demande
      de réinitialisation suspecte, hameçonnage signalé, problème récurrent, SLA,
      réattribution d'un absent, proposition de fiche de connaissance.
    - Connecteur « démo » qui simule tout ce qui précède pour la version en ligne.
    - docker-compose : GLPI, iTop, Zabbix, Centreon.

J5. INTERFACE PREMIUM, DIRECTION B
    Skills : ui-ux-pro-max, design-taste-frontend, impeccable, accessibility-review,
    responsive-mobile-first-react, design-critique, performing-security-headers-audit,
    testing-cors-misconfiguration.
    - Widget salarié (clair) : streaming, cartes d'action, étapes guidées, collage
      de capture d'écran, badges « Assistant IA » et « Relève active »,
      « Parler à un technicien » avec résumé transmis.
    - Console technicien (sombre) : palette Ctrl+K, boîte de validation, vue
      incident (alertes et demandes sur une même ligne de temps), écran
      « Pendant votre absence », densité réglable, temps réel.
    - Écran suppléance : chaînes de valideurs par catégorie, délégations en cours,
      création avec réauthentification MFA, révocation en un geste.
    - Un tableau de bord d'accueil par rôle, exactement comme docs/10 §5 :
      super administrateur (plateforme), ESN (tableau de tous les clients avec
      zoom par client, rapport mensuel par client), technicien (file unifiée),
      administrateur client (support et « qui a accès à quoi »), direction
      (5 chiffres + PDF), auditeur (journal), salarié (mes demandes). Indicateurs
      définis comme docs/10 §6, sans sigle à l'écran (skill dataviz pour les
      graphiques).
    - Administration : création d'ESN et de clients, invitations, relations
      ESN-client (demande, approbation, révocation), assignations, accès
      d'assistance, revues trimestrielles des accès.
    - Back-office ESN : connecteurs, plannings de relève, règles
      d'automatisation, marque blanche.
    - PWA installable pour l'astreinte (validation depuis le téléphone).
    Le widget s'intègre chez les clients : CSP stricte, CORS limité aux domaines
    déclarés, aucun jeton dans le localStorage. États vides, chargement, erreur
    dessinés. RGAA / WCAG 2.2 AA. Détecteur impeccable sur chaque écran jusqu'à
    zéro alerte. Aucun tiret cadratin dans les textes d'interface.

J6. ÉVALUATION ET SÉCURITÉ
    Skills : continuous-llm-red-teaming-with-promptfoo, testing-prompt-injection-in-rag-pipelines,
    testing-for-system-prompt-leakage, assessing-vector-and-embedding-weaknesses,
    testing-for-broken-access-control, detecting-data-and-model-poisoning,
    red-teaming-llms-with-garak, testing-api-security-with-owasp-top-10,
    testing-for-business-logic-vulnerabilities, integrating-dast-with-owasp-zap-in-pipeline,
    performing-access-review-and-certification.
    60 questions de support réalistes avec réponse attendue et score automatique ;
    20 tentatives d'injection (message, ticket, fiche, alerte, nom de fichier) qui
    doivent toutes échouer ; scénarios d'ingénierie sociale sur les réinitialisations ;
    abus de la suppléance (se déléguer soi-même, délégation expirée, périmètre
    dépassé, valideur sans droits) ; abus des rôles (technicien qui change
    d'organisation dans la requête, ESN sans relation, accès d'assistance
    expiré, élévation de rôle par une invitation) ; test de fuite entre organisations. promptfoo
    dans la CI à chaque modification du prompt ou de l'orchestrateur ; scan ZAP de
    la version déployée. Rapport dans docs/evaluation.md.

J7. LOT B, CONFORMITÉ ET EXPLOITATION
    Skills : pia-generation, dpa-review, privacy-legal-setup, building-incident-response-playbook,
    managing-third-party-vendor-risk, validating-backup-integrity-for-recovery,
    performing-nist-csf-maturity-assessment.
    - Connecteurs du lot B au fur et à mesure des accès obtenus : RG System,
      TeamsWork, NinjaOne, Atera, ScreenConnect, PRTG, Freshservice, Zendesk ;
      boîtes mail, licences, arrivées et départs en niveau 1 ; automatisations du
      lot B (disque, sauvegarde, mises à jour, consommables, transfert de mail
      suspect). Chaque connecteur arrive avec ses tests et sa revue de permissions.
    - Brouillons : registre de traitement, AIPD, DPA client, mentions AI Act
      art. 50, politique de conservation, plan de réponse à incident (dont
      « un connecteur client est compromis »), fiche sous-traitants, procédure de
      sauvegarde testée, page « Sécurité » publique. Marqués « à faire relire par
      un juriste ».

J8. MISE EN LIGNE
    Pas à pas pour moi : projet Supabase, secrets, déploiement des fonctions,
    Cloudflare Pages, application Entra dans mon tenant, bot Teams de test.
    README de démo avec un scénario de 10 minutes à jouer devant un prospect
    (incident Exchange regroupé, réinitialisation MFA validée par un suppléant,
    rapport « Pendant votre absence », vue ESN multi-clients).
    Création de mon compte super administrateur dédié, protégé par passkey.

RÈGLES
- Commits conventionnels sur ta branche de travail ; jamais de push sur main.
- Aucune clé dans le code ni dans le chat : secrets Supabase ou secrets de
  l'environnement uniquement ; si tu as besoin d'une clé, demande-la-moi via le
  formulaire sécurisé de l'environnement.
- Si une tâche dépasse le jalon, note-la dans docs/backlog.md au lieu de la faire.

Commence par l'étape 0, puis J0.
```

---

## Ce qu'il vous faudra fournir

| Jalon | Quoi | Coût |
|---|---|---|
| J2 | Compte Supabase et projet en région UE | 0 € |
| J3 | Clé API Mistral (offre Experiment), entraînement désactivé dans Admin Console > Privacy | 0 € |
| J4 | Comptes de test dans le tenant Microsoft 365 de votre société, droit de créer une application Entra ; un site Jira gratuit | 0 € |
| J7 | Accès API RG System (votre client), documentation TeamsWork (via le pilote), accès aux outils des pilotes | 0 € |
| J8 | Compte Cloudflare ; compte Azure gratuit pour le bot Teams | 0 € |
| Optionnel | `releve-ia.fr` ou `releveia.fr` | Environ 10 € par an |
