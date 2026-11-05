# 05 · Architecture technique et MVP à moindre coût

## 1. Principe

**Ne rien construire qui existe déjà.** On assemble des briques matures, on réutilise la pile technique d'EchoBridge que vous maîtrisez (React, Vite, Supabase, Vercel), et on concentre l'effort sur ce qui fait la différence : connecteurs, garde-fous et passation de garde.

## 2. Architecture cible

```
 Utilisateur final                     Technicien
 (Teams, widget web, mail)             (console web)
        │                                    │
        ▼                                    ▼
 ┌──────────────────────────────────────────────────┐
 │  Orchestrateur de conversation                     │
 │  · Détection d'intention et de priorité            │
 │  · Garde-fous (injection de prompt, données        │
 │    sensibles, périmètre)                           │
 │  · Politique d'autonomie (niveau 0, 1 ou 2)        │
 └───────┬───────────────┬──────────────────┬────────┘
         │               │                  │
         ▼               ▼                  ▼
  Base de           Fournisseur LLM     Connecteurs
  connaissance      (abstraction)       · GLPI (API REST)
  · pgvector        · Mistral (défaut)  · Jira SM, EasyVista…
  · fiches KB       · autre modèle      · Entra ID / AD
  · tickets         en secours            (actions, plus tard)
    résolus                             · Teams (Bot Framework)
         │                                  │
         └────────────┬─────────────────────┘
                      ▼
          Journal d'audit et rapports
          (passation de garde, indicateurs)
```

## 3. Pile technique et coûts de départ

| Brique | Choix | Pourquoi | Coût mensuel au départ |
|---|---|---|---|
| Front (widget, console) | React + Vite | Déjà maîtrisé sur EchoBridge | 0 € |
| Back-end et base | **Supabase**, région UE (Postgres, Auth, RLS, Edge Functions, pgvector) | Déjà maîtrisé ; tout-en-un ; RLS pour le multi-client | 0 à 25 € |
| Hébergement front | Vercel au départ, puis **Scaleway ou OVHcloud** quand un client exige de la souveraineté | Rapidité au départ, argument souverain ensuite | 0 à 20 € |
| LLM | **Mistral** (API hébergée dans l'UE) via une couche d'abstraction permettant de changer de modèle | Européen, peu cher, argument commercial | 10 à 50 € |
| Canal principal | **Microsoft Teams** (Bot Framework), plus widget web et mail | Teams est l'outil de travail de la majorité de vos cibles | 0 € |
| Connecteur n°1 | **GLPI** (API REST) | Base installée française énorme, test local gratuit avec Docker | 0 € |
| Observabilité | Journaux Supabase + tableau simple | Suffisant pour le MVP | 0 € |
| **Total** | | | **environ 50 à 150 €/mois** |

*Les tarifs de Supabase, Vercel et Mistral viennent des pages éditeur ou d'agrégateurs : à reconfirmer au moment de souscrire.*

## 4. Feuille de route

### Phase 0 · Fondations (semaines 1 à 2)

- Projet Supabase en région UE, schéma multi-client (organisations, utilisateurs, conversations, tickets, fiches, journal d'audit), RLS.
- Couche d'abstraction LLM, premier prompt système, **mention IA obligatoire** dans toutes les réponses d'ouverture.
- GLPI de test en local (Docker) avec 200 tickets fictifs réalistes.

### Phase 1 · MVP « niveau 0 » (semaines 3 à 8)

- Widget web et **bot Teams**.
- Ingestion de la base de connaissance (PDF, pages web, export de tickets résolus) dans pgvector.
- L'agent **répond et guide**, **crée un ticket GLPI bien qualifié** quand il ne sait pas, et **ne fait aucune action** sur le SI.
- **Mode relève** : planning d'absence, badge « Relève active », **rapport de passation de garde** envoyé au technicien à son retour.
- Jeu d'évaluation : 200 questions réelles avec la réponse attendue, mesure automatique à chaque modification.

### Phase 2 · Pilotes (mois 3 à 4)

- 3 à 5 clients pilotes, mesure des indicateurs du document [03](03-go-to-market.md).
- **Mémoire de l'équipe** : chaque ticket résolu par un humain devient une proposition de fiche, validée en un clic.
- Tests de sécurité : injection de prompt, fuite du prompt système, données sensibles (skills `continuous-llm-red-teaming-with-promptfoo`, `testing-for-system-prompt-leakage`, `detecting-indirect-prompt-injection`).

### Phase 3 · Niveau 1 et canal ESN (mois 5 à 9)

- **Actions avec validation humaine** : réinitialisation de mot de passe via Entra ID ou Active Directory, déverrouillage de compte, ajout à un groupe. Le technicien d'astreinte valide depuis son téléphone.
- Marque blanche et console multi-clients pour les ESN.
- Deuxième connecteur (Jira Service Management ou EasyVista selon les pilotes).

### Phase 4 · Industrialiser (mois 9 et plus)

- Niveau 2 (autonomie sur liste blanche), SSO, rapports avancés.
- Démarche **ISO 27001** (skill `implementing-iso-27001-information-security-management`) si les ETI et le public l'exigent.
- Option modèle hébergé chez vous (Mistral auto-hébergé) pour les clients les plus exigeants.

## 5. Règles de sécurité non négociables dès le MVP

1. **Aucun secret dans le fil de conversation** : l'agent ne demande jamais de mot de passe et masque ce qu'il détecte.
2. **Liste blanche d'actions** : l'agent n'appelle que des actions déclarées, avec un niveau d'autorisation.
3. **Tout contenu externe est suspect** : tickets, mails et documents sont traités comme des données, jamais comme des instructions.
4. **Journal d'audit** immuable : qui a demandé quoi, ce que l'IA a répondu, quelle action a été faite, qui l'a validée.
5. **Escalade humaine toujours possible** en un clic.

## 6. Effort estimé

Pour un développeur expérimenté seul, assisté par Claude Code : **8 à 10 semaines pour la phase 1**. Si vous ne codez pas vous-même, prévoir un associé technique ou un freelance. Je peux démarrer le code de la phase 0 dans ce dépôt dès votre feu vert.
