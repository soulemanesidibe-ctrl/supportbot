# Prompt de démarrage du développement

À coller tel quel dans une session Claude Code ouverte sur ce dépôt. Le fichier `CLAUDE.md` et les skills sont chargés automatiquement ; ce prompt ne fait que fixer l'objectif de la première étape.

---

```text
On démarre le développement de Relève (voir CLAUDE.md et docs/05-architecture-technique-mvp.md).

Objectif de cette étape : une version de test EN LIGNE, à 0 €, que je pourrai montrer
à 2 ou 3 ESN/DSI pilotes. Périmètre = phase 0 + le cœur de la phase 1, niveau
d'autonomie 0 (l'agent conseille et crée des tickets, il n'agit jamais sur le SI).

Contraintes de coût (tout doit rester gratuit) :
- Supabase plan Free, région UE (Paris si possible).
- Mistral La Plateforme, offre gratuite « Experiment » (je désactiverai l'usage
  des données pour l'entraînement dans la console). Prévoir des relances avec
  backoff : la limite est d'environ 1 requête par seconde.
- Front statique hébergé sur un service gratuit qui autorise l'usage commercial
  (Cloudflare Pages), pas Vercel Hobby.
- GLPI de test en local via Docker pour développer le connecteur ; en ligne,
  un connecteur « démo » qui simule GLPI tant qu'aucun pilote n'a branché le sien.

Travaille dans cet ordre, en t'arrêtant à la fin de chaque bloc pour que je valide :

1. CADRAGE (skill plan-task) : propose l'arborescence (app/, supabase/migrations,
   supabase/functions/_shared/{llm,connectors,guardrails}), la liste des tables
   et le découpage en commits. Attends mon accord.

2. BASE DE DONNÉES (skill supabase) : migrations pour organizations, memberships,
   conversations, messages, tickets, connectors, kb_documents, kb_chunks (pgvector),
   relief_schedules, handover_reports, audit_logs ; RLS complète avec
   is_member_of() et org_has_feature() ; fonction match_kb_chunks filtrée par org_id ;
   script SQL de test d'isolation entre deux organisations ; données de démo
   (1 ESN, 2 clients, 15 fiches de connaissance réalistes : mot de passe,
   VPN, imprimante, Outlook, Teams, MFA…).

3. ORCHESTRATEUR (Edge Function "chat") : couche d'abstraction LLM (Mistral par
   défaut), RAG sur kb_chunks, garde-fous (masquage des secrets, contenu externe
   traité comme donnée, refus hors périmètre), détection « je ne sais pas » →
   création d'un ticket bien qualifié via le connecteur, journal d'audit.
   Utilise les skills defending-llms-with-guardrails et
   securing-agentic-ai-tool-invocation.

4. CONNECTEUR GLPI : client API REST GLPI (initSession, création et lecture de
   ticket, suivi), plus le connecteur « démo » avec la même interface.
   docker-compose pour un GLPI local de test.

5. INTERFACE (skills ui-ux-pro-max puis impeccable) : widget de chat intégrable
   (mention « Assistant IA » permanente, bouton « Parler à un technicien »,
   badge « Relève active ») et console technicien minimale (conversations,
   tickets créés, rapport de passation de garde). Charte de docs/04-marque-et-DA.md.

6. ÉVALUATION : jeu de 50 questions de support réalistes avec réponse attendue,
   script qui mesure le taux de bonnes réponses et d'escalades justifiées,
   plus 10 tentatives d'injection de prompt qui doivent toutes échouer.

7. MISE EN LIGNE : instructions pas à pas pour moi (création du projet Supabase,
   secrets, déploiement des fonctions, Cloudflare Pages) et un README de démo.

Règles : commits conventionnels sur la branche de la session, jamais de push
sur main, jamais de clé dans le code. Signale-moi chaque migration à appliquer.
Pose-moi des questions dès qu'un choix produit n'est pas tranché par la doc.
```

---

## Ce qu'il vous faudra fournir pendant le développement

| Quand | Quoi | Coût |
|---|---|---|
| Étape 2 | Un compte Supabase et un projet créé en région UE ; l'URL et les clés à saisir dans les secrets de l'environnement (jamais dans le chat) | 0 € |
| Étape 3 | Une clé API Mistral (offre Experiment, vérification par téléphone) ; désactiver l'entraînement dans Admin Console > Privacy | 0 € |
| Étape 7 | Un compte Cloudflare (Pages) | 0 € |
| Optionnel | Le nom de domaine `releve-ia.fr` ou `releveia.fr` | Environ 10 € par an |
