---
name: plan-task
description: Planifie une tâche complexe sur SupportBot avant implémentation. Utiliser pour toute demande touchant plusieurs composants (moteur de conversation, connecteurs ITSM, console technicien, base de connaissances), le schéma de données ou les règles d'escalade, pour lister l'impact avant d'écrire du code.
---

# SupportBot — Planifier avant d'implémenter

Avant d'écrire du code sur une tâche non triviale (plusieurs fichiers, nouvelle fonctionnalité, nouvelle table, nouveau connecteur), passer par cette checklist. Pour une vraie planification interactive, utiliser `EnterPlanMode` ; ce skill sert de checklist de cadrage rapide, pas de substitut.

## 1. Cadrer l'impact

- Quelles surfaces sont touchées : widget de chat utilisateur final, console technicien, back-office client (ESN/DSI), connecteurs ITSM (GLPI, Jira Service Management, EasyVista…), pipeline de base de connaissances (RAG) ?
- Nouvelle donnée persistée ? Identifier si elle contient des données personnelles ou des secrets (identifiants, mots de passe, jetons, journaux système) : minimisation, chiffrement, durée de conservation, jamais de secret en clair dans les logs ni dans les prompts.
- Nouvelle action exécutée par l'agent (réinitialisation, ouverture de ticket, changement de droits) ? Elle doit passer par la liste blanche d'actions, avec niveau d'autorisation et journal d'audit. Jamais d'appel direct en dur.
- Nouvelle fonctionnalité réservée à une offre ? La conditionner par le contrôle de plan, jamais par un accès en dur.

## 2. Vérifier avant de coder

- [ ] Le composant ou le pattern existe-t-il déjà ? (éviter la duplication, cf. skill `ui-ux-pro-max`)
- [ ] Une migration de base de données est-elle nécessaire ? Si oui, prévenir qu'elle devra être appliquée par l'utilisateur.
- [ ] Le texte UI est-il en français d'abord, avec sa traduction anglaise ?
- [ ] Transparence IA (AI Act, art. 50) : l'utilisateur sait-il toujours qu'il parle à une IA ? Le chemin d'escalade vers un humain reste-t-il disponible ?
- [ ] Sécurité de l'agent : la nouvelle entrée (ticket, mail, document de la base de connaissances) peut-elle contenir une injection de prompt ? Prévoir le filtrage et les garde-fous (skills `defending-llms-with-guardrails`, `securing-agentic-ai-tool-invocation`, `testing-prompt-injection-in-rag-pipelines`).

## 3. Ordre de travail recommandé

1. Rester sur la branche désignée par la session ; sinon, branche dédiée si le changement est substantiel.
2. Implémenter en respectant les tokens et composants existants.
3. `node .agents/skills/impeccable/scripts/detect.mjs --json <fichiers>` si la tâche touche l'UI.
4. Build et tests : les deux doivent passer avant tout push.
5. Commit avec message conventionnel (`feat:`, `fix:`, `style:`, `chore:`…).
6. Push sur la branche de travail. Ne jamais merger ou pousser sur `main` (production) sans confirmation explicite de l'utilisateur pour ce tour précis : une autorisation passée ne vaut pas pour les tours suivants.

## 4. Signaux d'alerte à ne pas ignorer

- Une demande qui élargit les droits de l'agent (nouvelle action sur l'annuaire, accès administrateur, suppression de données) : s'arrêter et demander une confirmation explicite.
- Une demande qui affaiblit la traçabilité (désactiver le journal d'audit, masquer qu'une réponse vient de l'IA) : refuser ou escalader.
- Une demande de modification des documents légaux (CGV, DPA, politique de confidentialité) : signaler que ce sont des documents de conformité, pas du contenu produit ordinaire.
- Une demande de déploiement (push `main`, mise en production) : toujours un point de confirmation séparé, jamais implicite dans le reste de la tâche.
