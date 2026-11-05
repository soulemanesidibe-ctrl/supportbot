# 02 · Différenciation et modèle économique

## 1. Positionnement en une phrase

> **La relève IA de votre support IT : elle prend la garde quand vos techniciens ne sont pas là, et leur rend la main avec un dossier propre.**

On ne vend pas un chatbot. On vend **la continuité de service** et **la tranquillité de l'équipe support**.

## 2. Les 7 différences à construire

| # | Différence | Pourquoi personne ne le fait bien | Coût pour vous |
|---|---|---|---|
| 1 | **Mode relève** : activation selon le planning (absences, congés, nuits, astreintes) et **passation de garde** au retour du technicien (résumé de ce qui a été traité, en attente, escaladé) | Les concurrents vendent du 24/7 générique, sans notion de garde ni de passation | Faible : planning + rapport généré |
| 2 | **GLPI d'abord**, puis Jira SM, EasyVista, Freshservice : un seul agent pour tous les outils | Les éditeurs n'optimisent que leur propre outil | Moyen : un connecteur par outil |
| 3 | **Marque blanche pour ESN** : l'ESN revend l'agent sous son nom dans ses contrats d'infogérance | Pas d'offre partenaire simple sur ce segment | Faible : thème et multi-locataire |
| 4 | **Autonomie graduée** : niveau 0 (conseille), 1 (agit avec validation humaine), 2 (agit seul sur liste blanche) | Les autres vendent l'autonomie maximale, ce qui fait peur aux DSI | Moyen, mais c'est un argument de confiance |
| 5 | **Mémoire de l'équipe** : chaque ticket résolu par un humain devient une fiche de connaissance proposée à validation | Le savoir part avec les techniciens absents ou partis | Faible : pipeline RAG |
| 6 | **Souveraineté et conformité prouvées** : hébergement en France, modèles européens (Mistral) par défaut, registre AI Act, DPA prêt, journal d'audit NIS2 | Peu d'acteurs PME peuvent le prouver | Faible au départ, croissant avec les certifications |
| 7 | **Mesure honnête** : on publie le taux de **résolution réelle** confirmée par l'utilisateur, pas un taux de « déflexion » flatteur | Les chiffres du marché sont surtout déclaratifs | Nul : c'est de la discipline |

## 3. Modèle économique proposé

### Principe

Un **abonnement au forfait**, lisible pour une PME, plus une **offre relève à la demande** qui est votre signature.

### Grille de départ (hypothèses à tester en pilote)

| Offre | Pour qui | Contenu | Prix indicatif HT |
|---|---|---|---|
| **Relève saisonnière** | PME qui veut couvrir l'été ou Noël | Activation 1 à 3 mois, GLPI ou mail, base de connaissance, passation de garde | **190 €/mois activé**, sans engagement |
| **Essentiel** | PME, 50 à 300 utilisateurs finaux | Agent permanent, 1 connecteur ITSM, Teams ou web, niveau d'autonomie 0 et 1 | **390 €/mois** |
| **Pro** | ETI, collectivité, 300 à 1 500 utilisateurs | Plusieurs connecteurs, niveau 2 sur liste blanche, rapports, SSO | **890 €/mois** |
| **Partenaire ESN** | Infogéreurs | Marque blanche, multi-clients, console unique | **Prix par client final, dégressif**, ou 25 à 35 % de remise revendeur |

**Repère de valeur** : un technicien de niveau 1 coûte environ 45 000 € par an chargé. L'offre Essentiel coûte environ 4 700 € par an, soit **un dixième d'un poste**, sans prétendre le remplacer. L'argument n'est pas « vous économisez un salarié », c'est **« vos techniciens arrêtent de réinitialiser des mots de passe et vos absences ne bloquent plus personne »**.

### Pourquoi ne pas facturer à la résolution ?

C'est tendance (Jira, Intercom), mais c'est imprévisible pour une PME et ça vous expose à des litiges sur ce qui est une « résolution ». À garder pour plus tard, en option grands comptes.

### Économie unitaire (ordre de grandeur)

- Coût LLM : environ **0,02 € par conversation** avec Mistral Medium (environ 6 000 jetons en entrée et 1 000 en sortie). 1 000 conversations par mois, c'est environ 20 € de coût direct. *(Tarifs tiers à vérifier sur la page officielle de Mistral.)*
- Hébergement : 50 à 150 € par mois au départ, tous clients confondus.
- **Marge brute visée : plus de 85 %.** Le vrai coût, c'est l'intégration et le support client, d'où l'importance des connecteurs standardisés.

## 4. Ce qu'il ne faut pas faire

- Promettre de remplacer un technicien.
- Développer son propre outil de ticketing : on se branche sur l'existant.
- Viser les grands comptes en premier : cycle de vente de 12 à 18 mois, appels d'offres, exigences SecNumCloud.
- Entraîner son propre modèle : inutile et coûteux. On utilise des modèles existants avec une bonne base de connaissance.
