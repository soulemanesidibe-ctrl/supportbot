# Prompt de démarrage du développement

À coller tel quel dans une session Claude Code ouverte sur ce dépôt. `CLAUDE.md` et les skills se chargent automatiquement ; ce prompt fixe l'objectif, l'ordre de travail et les points de validation.

**Avant de le coller** : remplacez `[DIRECTION]` par la direction d'identité choisie (A Garde de nuit, B Signal ou C Atelier, voir `docs/04-marque-et-DA.md`).

---

```text
Rôle : tu es l'équipe technique de Relève IA (lead dev full-stack, designer produit
et ingénieur sécurité LLM). Je suis le fondateur, technicien support de métier :
je valide le produit, tu construis. Tu me poses une question dès qu'un choix produit
n'est pas tranché par la doc, et tu t'arrêtes à chaque jalon pour que je valide.

Contexte à lire avant toute chose :
- CLAUDE.md (règles non négociables)
- docs/05-architecture-technique-mvp.md (architecture, feuille de route)
- docs/07-integrations.md (connecteurs par capacité, sécurité des actions)
- docs/08-experience-ux-premium.md (expérience attendue)
- docs/09-securite.md (modèle de menace, défenses par couche)
- docs/04-marque-et-DA.md, direction d'identité retenue : [DIRECTION]

OBJECTIF DE CETTE PHASE
Une version de test EN LIGNE, à 0 €, que je montrerai à 2 ou 3 ESN/DSI pilotes.
Niveau d'autonomie 0 : l'agent diagnostique, conseille, crée et qualifie des
tickets, corrèle les alertes ; il n'exécute AUCUNE action sur le SI. Mais
l'architecture doit déjà accueillir les actions validées (niveau 1) et tous les
connecteurs de docs/07 sans refonte.

CONTRAINTES DE COÛT (tout gratuit)
- Supabase plan Free, région UE (Paris si possible).
- Mistral La Plateforme, offre « Experiment » (j'aurai désactivé l'entraînement
  sur mes données). Limite ~1 requête/s : file d'attente et backoff obligatoires.
- Front sur Cloudflare Pages (pas Vercel Hobby : usage commercial interdit).
- GLPI, iTop et Zabbix de test en local via docker-compose.
- Jira Service Management : offre gratuite Atlassian.
- Microsoft 365 : un tenant de test que je fournirai ; d'ici là, un faux Graph.

STACK
React + Vite + TypeScript, Tailwind v4, shadcn/ui (personnalisé, jamais l'état par
défaut), Motion, cmdk, icônes Phosphor ; Supabase (Postgres, Auth, RLS, pgvector,
Edge Functions Deno) ; Teams via Bot Framework et Adaptive Cards.

SÉCURITÉ (fil rouge, voir docs/09-securite.md)
Relève touchera le SI de tous les clients d'une ESN : chaque jalon inclut sa
part de sécurité, et tu cites le skill de sécurité utilisé dans chaque commit
concerné. Aucune fonctionnalité n'est « finie » sans ses tests de sécurité.

JALONS (un jalon = une série de commits + un arrêt pour validation)

J0. FONDATIONS SÉCURISÉES (skills : performing-threat-modeling-with-owasp-threat-dragon,
    implementing-secret-scanning-with-gitleaks, integrating-sast-into-github-actions-pipeline,
    implementing-semgrep-for-custom-sast-rules, performing-sca-dependency-scanning-with-snyk,
    detecting-malicious-npm-packages, securing-github-actions-workflows)
    Modèle de menace v1 (docs/threat-model.md, à partir de docs/09 §1).
    gitleaks en pre-commit et en CI ; Semgrep avec des règles propres au projet
    (pas d'appel service_role sans vérification du JWT, pas de secret dans un
    log, pas de contenu externe concaténé au prompt système) ; analyse des
    dépendances et SBOM ; workflows GitHub Actions à permissions minimales
    et actions épinglées par SHA.

J1. CADRAGE (skills : plan-task, write-spec)
    Spécification courte (docs/spec-mvp.md), arborescence du dépôt, contrat
    TypeScript des capacités de connecteurs (docs/07 §1), schéma de données,
    découpage en commits. ATTENDS MON ACCORD.

J2. BASE DE DONNÉES (skills : supabase, implementing-gdpr-data-protection-controls,
    testing-for-broken-access-control, implementing-aes-encryption-for-data-at-rest)
    Migrations : organizations (avec parent_org_id pour les ESN), memberships,
    conversations, messages, tickets, connectors (secrets dans Vault),
    kb_documents, kb_chunks (pgvector + HNSW), relief_schedules,
    handover_reports, alerts, incidents, action_requests, audit_logs
    (INSERT uniquement). RLS complète via is_member_of(), has_role(),
    org_has_feature(). Fonction match_kb_chunks filtrée par org_id. Purge
    planifiée des conversations. Script SQL de test d'isolation (2 clients
    d'une même ESN ne se voient pas ; l'ESN voit les deux). Données de démo :
    1 ESN, 2 clients, 20 fiches de connaissance réalistes (mot de passe, MFA,
    VPN, imprimante, Outlook, Teams, OneDrive, poste lent, arrivée/départ).
    Signale-moi chaque migration à appliquer.

J3. ORCHESTRATEUR (skills : defending-llms-with-guardrails,
    securing-agentic-ai-tool-invocation, implementing-llm-guardrails-for-security,
    detecting-indirect-prompt-injection, testing-for-system-prompt-leakage,
    performing-serverless-function-security-review, implementing-api-rate-limiting-and-throttling)
    Edge Function « chat » en streaming : couche LLM abstraite (Mistral par
    défaut, modèle léger pour le tri, modèle moyen pour la réponse), RAG,
    appel d'outils limité aux capacités déclarées (lecture seule en J3),
    masquage des secrets avant stockage, contenu externe encadré comme donnée,
    détection « je ne sais pas » → ticket qualifié (catégorie, priorité,
    diagnostic déjà fait), journal d'audit de chaque appel.

J4. CONNECTEURS, VAGUE 1 (skills : performing-oauth-scope-minimization-review,
    implementing-api-key-security-controls, configuring-oauth2-authorization-flow,
    testing-oauth2-implementation-flaws, detecting-suspicious-oauth-application-consent)
    - Ticketing : GLPI (API REST) et Jira Service Management, même interface.
    - Microsoft 365 en DIAGNOSTIC SEUL via Graph (compte bloqué, MFA, licences,
      échecs de connexion, état de la boîte mail), permissions minimales
      documentées une par une.
    - Supervision : webhook générique entrant + adaptateurs Zabbix et Centreon.
    - Corrélation : alertes et demandes utilisateurs regroupées en incident
      avec ticket parent (scénario de docs/07 §3).
    - Connecteur « démo » qui simule tout ce qui précède pour la version en ligne.
    - docker-compose : GLPI, iTop, Zabbix.

J5. INTERFACE PREMIUM (skills : ui-ux-pro-max, design-taste-frontend,
    impeccable, accessibility-review, responsive-mobile-first-react,
    performing-security-headers-audit, testing-cors-misconfiguration)
    Le widget s'intègre chez les clients : CSP stricte, CORS limité aux
    domaines déclarés par chaque organisation, aucun jeton dans le localStorage.
    Tokens issus de la direction [DIRECTION], modes clair et sombre.
    - Widget de chat intégrable : streaming, cartes d'action, étapes guidées,
      collage de capture d'écran, badges « Assistant IA » et « Relève active »,
      « Parler à un technicien » avec résumé transmis.
    - Console technicien : palette Ctrl+K, boîte de validation, vue incident,
      écran « Pendant votre absence », densité réglable, temps réel.
    - Back-office ESN : clients, connecteurs, plannings de relève, marque blanche.
    - PWA installable pour l'astreinte.
    États vides, chargement et erreur dessinés. RGAA / WCAG 2.2 AA.
    Lance le détecteur impeccable sur chaque écran jusqu'à zéro alerte.

J6. ÉVALUATION ET SÉCURITÉ (skills : continuous-llm-red-teaming-with-promptfoo,
    testing-prompt-injection-in-rag-pipelines, testing-for-system-prompt-leakage,
    assessing-vector-and-embedding-weaknesses, testing-for-broken-access-control,
    detecting-data-and-model-poisoning, red-teaming-llms-with-garak,
    testing-api-security-with-owasp-top-10, testing-for-business-logic-vulnerabilities,
    integrating-dast-with-owasp-zap-in-pipeline)
    promptfoo tourne dans la CI à chaque modification du prompt ou de l'orchestrateur ;
    scan ZAP sur la version déployée.
    60 questions de support réalistes avec réponse attendue, score automatique
    (bonnes réponses, escalades justifiées) ; 15 tentatives d'injection
    (dans un message, un ticket, une fiche, une alerte) qui doivent toutes
    échouer ; test de fuite entre organisations ; rapport dans docs/evaluation.md.

J7. CONFORMITÉ ET EXPLOITATION (skills : pia-generation, dpa-review, privacy-legal-setup,
    building-incident-response-playbook, managing-third-party-vendor-risk,
    validating-backup-integrity-for-recovery, performing-nist-csf-maturity-assessment)
    Brouillons : registre de traitement, AIPD, modèle de DPA client, mentions
    de transparence IA (AI Act art. 50), politique de conservation, plan de
    réponse à incident (dont « un connecteur client est compromis »), fiche
    sous-traitants, procédure de sauvegarde testée, page « Sécurité » publique.
    Marqués « à faire relire par un juriste ».

J8. MISE EN LIGNE
    Pas à pas pour moi : projet Supabase, secrets, déploiement des fonctions,
    Cloudflare Pages, bot Teams de test. README de démo avec un scénario de
    10 minutes à jouer devant un prospect.

RÈGLES
- Commits conventionnels sur la branche de la session ; jamais de push sur main.
- Aucune clé dans le code ni dans le chat : secrets Supabase uniquement.
- Aucun tiret cadratin dans les textes d'interface.
- Si une tâche dépasse le périmètre du jalon, note-la dans docs/backlog.md
  au lieu de la faire.

Commence par J1.
```

---

## Ce qu'il vous faudra fournir

| Jalon | Quoi | Coût |
|---|---|---|
| J2 | Compte Supabase et projet en région UE ; URL et clés dans les secrets de l'environnement, jamais dans le chat | 0 € |
| J3 | Clé API Mistral (offre Experiment) ; entraînement désactivé dans Admin Console > Privacy | 0 € |
| J4 | Un tenant Microsoft 365 de test et un site Jira gratuit | 0 € |
| J8 | Compte Cloudflare ; compte Azure gratuit pour le bot Teams | 0 € |
| Optionnel | `releve-ia.fr` ou `releveia.fr` | Environ 10 € par an |
