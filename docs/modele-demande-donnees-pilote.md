# Demande de données à un pilote : anciens tickets anonymisés

> **Brouillon à faire relire par un juriste avant tout envoi.** Les passages entre crochets `[À COMPLÉTER]` sont à renseigner. Ce document est un modèle destiné à être adressé à un client pilote ; il n'est pas un contrat. Le DPA (accord de traitement de données) et le formulaire de consentement doivent être signés **avant** tout export.

| | |
|---|---|
| **De** | `[À COMPLÉTER : nom, société, fonction du fondateur]` |
| **À** | `[À COMPLÉTER : nom, fonction du contact chez le pilote]` |
| **Objet** | Mesurer la qualité de Relève sur vos vraies demandes, avant toute réponse automatique à vos salariés |
| **Date** | `[À COMPLÉTER]` |

## 1. Pourquoi nous vous demandons cela

Relève répondra à vos salariés quand vos techniciens ne sont pas là. Avant qu'il réponde à qui que ce soit, nous voulons savoir **s'il se trompe, et comment**, sur **vos** demandes réelles et non sur des exemples inventés. Un support qui répond faux avec assurance est pire qu'un support qui dit « je ne sais pas ».

Nous procédons en trois temps, et **vos salariés ne reçoivent rien de l'IA pendant les deux premiers** :

| Temps | Ce qui se passe | Durée indicative |
|---|---|---|
| 1. Jeu d'évaluation | Vous nous fournissez 100 à 300 anciens tickets anonymisés, avec la solution retenue par votre équipe. Nous mesurons ce que Relève aurait répondu | Semaines 1 et 2 |
| 2. Mode ombre | Relève prépare une réponse à chaque nouvelle demande, **visible de vos seuls techniciens**, qui la notent en quelques secondes (correcte, partielle, fausse, dangereuse) | 2 semaines minimum |
| 3. Ouverture par catégories | Seules les catégories qui atteignent la barre de qualité convenue passent en réponse directe. Les autres restent en mode ombre | Ensuite, avec votre accord |

Vous recevrez les chiffres réels, **y compris les mauvais**, avec le nombre de demandes sur lequel ils reposent.

## 2. Ce que nous demandons

- **100 à 300 tickets résolus** des 12 derniers mois, représentatifs de votre activité (pas uniquement les cas simples). Plus il y en a par catégorie, plus la mesure est fiable : à 100 demandes, un taux de 80 % est connu à plus ou moins 8 points près.
- Pour chaque ticket : la demande de l'utilisateur, la catégorie, la priorité, **la solution retenue** (ce que le technicien a fait ou répondu) et le résultat (résolu, réouvert, escaladé).
- Un technicien de votre équipe disponible **environ 2 heures** pour relire une cinquantaine de réponses préparées et dire si elles sont justes.

### Colonnes souhaitées

| Colonne | Contenu | Remarque |
|---|---|---|
| `ticket_ref` | Numéro neutre (1, 2, 3...) | Pas votre numéro GLPI d'origine |
| `date` | Mois et année seulement | Pas l'heure exacte |
| `categorie` | Catégorie du ticket | Telle que vous la définissez |
| `priorite` | Priorité | |
| `demande` | Texte de la demande, **anonymisé** | Voir la liste du § 3 |
| `solution` | Ce qui a résolu le problème, **anonymisé** | |
| `resultat` | Résolu, réouvert, escaladé | |
| `piece_jointe` | Oui ou non | **Ne pas envoyer les pièces jointes** |

## 3. Anonymisation : à faire avant que les données quittent votre environnement

Merci de retirer ou de remplacer par un repère (`[NOM]`, `[EMAIL]`, `[IP]`, `[POSTE]`, `[TELEPHONE]`) :

- [ ] **noms et prénoms** des salariés, techniciens, fournisseurs, y compris ceux qui apparaissent dans une signature ou une citation ;
- [ ] **adresses e-mail** ;
- [ ] **numéros de téléphone** ;
- [ ] **adresses IP** et noms de domaine internes ;
- [ ] **noms de machines**, de serveurs, de partages réseau et de postes (par exemple `PC-COMPTA-04`) ;
- [ ] **identifiants de connexion**, noms d'utilisateur, numéros de matricule ;
- [ ] **numéros de série**, numéros de contrat ou de licence ;
- [ ] **adresses de sites, de bureaux ou d'étages** si elles permettent d'identifier une personne ;
- [ ] **toute donnée sensible** : mots de passe, codes de récupération, clés, jetons, données de santé ou de paie évoquées dans un ticket (**si un secret figure dans un ticket, ne pas l'envoyer : retirer le ticket**).

> **Une réserve importante.** Remplacer les noms par des repères ne rend pas toujours les données **anonymes** au sens du RGPD. Selon la CNIL, des données ne sont anonymes que si l'on ne peut ni isoler une personne, ni relier des informations, ni en déduire de nouvelles ; sinon elles sont seulement **pseudonymisées** et restent des données personnelles. Le texte libre d'un ticket (« mon collègue du service paie de la Clinique... ») peut rester identifiant. **Nous traitons donc ce jeu comme des données personnelles**, d'où le consentement écrit, l'accord de traitement et les garanties du § 4.
>
> Sources : [CNIL, avis du G29 sur les techniques d'anonymisation](https://www.cnil.fr/fr/le-g29-publie-un-avis-sur-les-techniques-danonymisation) ; [CNIL, anonymisation et pseudonymisation](https://www.cnil.fr/fr/recherche-scientifique-hors-sante-enjeux-et-avantages-de-lanonymisation-et-de-la-pseudonymisation).

Un échantillon de **10 tickets** à relire avec nous avant l'envoi complet évite de découvrir un oubli sur les 300.

## 4. Ce que nous garantissons

| Engagement | Détail |
|---|---|
| **Cadre juridique** | Vous restez **responsable du traitement** ; Relève agit comme **sous-traitant**. Un accord de traitement (DPA) est signé avant tout envoi. `[À COMPLÉTER : référence du DPA]` |
| **Finalité unique** | Mesurer la qualité des réponses de Relève pour votre organisation. Aucun autre usage, aucune revente, **aucun entraînement de modèle** sur vos données |
| **Hébergement** | Union européenne uniquement. Stockage privé de la plateforme, jamais dans un dépôt de code ni dans un outil de partage grand public |
| **Accès** | Limité à des personnes nommées `[À COMPLÉTER : liste]`, journalisé |
| **Sous-traitants ultérieurs** | `[À COMPLÉTER ET CONFIRMER]` : hébergement de la base (Supabase, région UE) ; fournisseur de modèle (Mistral AI, France). **Les textes de tickets sont envoyés au modèle pour produire les réponses évaluées** : c'est le point qui doit figurer dans votre information aux personnes concernées. L'option d'entraînement sur nos données est désactivée sur notre compte `[À CONFIRMER avant envoi]` |
| **Durée** | Conservation jusqu'à la fin du pilote, plus `[À COMPLÉTER]` jours pour le rapport. **Suppression à votre demande**, avec attestation |
| **Droits** | Une personne dont le ticket apparaîtrait malgré l'anonymisation peut demander son retrait : nous supprimons la ligne correspondante sous `[À COMPLÉTER]` jours |
| **Incident** | Nous vous prévenons sans délai en cas de fuite ou d'accès non autorisé `[À COMPLÉTER : délai, interlocuteur]` |

## 5. Comment nous envoyer le fichier

- **Pas par e-mail** ni par un outil de messagerie.
- Nous vous communiquons un **lien d'envoi chiffré à usage unique**, valable `[À COMPLÉTER]` jours. `[À COMPLÉTER : outil retenu]`
- Format : CSV (séparateur point-virgule, encodage UTF-8) ou JSON.
- Après réception, nous vous confirmons le nombre de lignes et l'empreinte du fichier.

## 6. Pièces à signer avant l'envoi

1. **Accord de traitement de données (DPA)** `[À COMPLÉTER : modèle relu par un juriste]`.
2. **Consentement écrit** (annexe A) de la personne habilitée à engager votre organisation.
3. Si votre organisation est une ESN qui fournit les tickets d'un de ses clients : **l'accord écrit de ce client**, qui est le responsable du traitement.

## Annexe A : formulaire de consentement

> Je soussigné(e) `[nom, fonction]`, agissant pour `[organisation]`, autorise Relève `[société]` à utiliser les tickets anonymisés remis le `[date]` dans le seul but de mesurer la qualité des réponses de Relève pour notre organisation, dans les conditions du présent document et de l'accord de traitement signé le `[date]`.
>
> Je confirme que : (a) la liste d'anonymisation du § 3 a été appliquée ; (b) aucun mot de passe, clé ou jeton ne figure dans les données ; (c) j'ai pris connaissance de l'envoi des textes à un fournisseur de modèle situé dans l'Union européenne ; (d) je peux demander la suppression des données à tout moment.
>
> Fait à `[lieu]`, le `[date]`. Signature :

## Annexe B : ce que nous rendons au pilote

- Un rapport par catégorie : nombre de demandes, taux de réponses correctes, fausses, dangereuses, escalades justifiées et manquées, **chaque pourcentage avec son effectif**.
- La liste des cas où Relève s'est trompé, pour votre équipe.
- Une recommandation : quelles catégories ouvrir en réponse directe, lesquelles garder en mode ombre.
- L'attestation de suppression à la fin du pilote, si vous la demandez.
