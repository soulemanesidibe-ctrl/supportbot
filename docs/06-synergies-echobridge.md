# 06 · Synergies avec EchoBridge

## 1. Rappel : ce qu'est EchoBridge

Plateforme de recueil anonyme de la parole des collaborateurs (baromètre, signalements, climat social), prévention des risques psychosociaux, document unique inclus. Forfait à partir de 89 € HT par mois, offre Sérénité jusqu'à 500 salariés. Slogan : « La parole. Sans les noms. » Cible : RH et QVT. *(Source : echobridge.fr.)*

## 2. Les vraies synergies

| Synergie | Concrètement | Valeur |
|---|---|---|
| **Pile technique commune** | React, Vite, Supabase, Vercel, Edge Functions, RLS multi-client : même savoir-faire, mêmes modèles de code | Divise le temps de démarrage par deux |
| **Socle conformité** | RGPD, AIPD, DPA, politique de confidentialité, anonymisation, seuils CNIL : déjà rédigés ou outillés pour EchoBridge | Gros gain sur la partie juridique |
| **Skills Claude** | Les 363 skills repris (sécurité, juridique, GEO/SEO, UX) servent les deux projets | Fait, dans ce dépôt |
| **Expérience de l'achat public** | Candidature Resah déjà réalisée pour EchoBridge | Canal secteur public plus rapide |
| **Histoire commune « bien-être des équipes »** | EchoBridge mesure la charge et les risques psychosociaux ; la relève IA les **réduit** pour les équipes support (astreintes, interruptions, tâches répétitives) | **Argument unique** : vous pouvez mesurer l'effet sur les techniciens, aucun concurrent ne le peut |
| **Offre croisée ESN** | Une ESN est aussi un employeur avec un fort turnover de techniciens : elle peut acheter les deux | Augmente la valeur par client |

## 3. Une offre commune possible : « Support serein »

Pour une ESN ou une DSI :

1. **Relève** prend en charge le niveau 1 pendant les absences et les pics.
2. **EchoBridge** mesure anonymement la charge ressentie par l'équipe support avant et après.
3. Le client obtient **une preuve chiffrée** de l'amélioration des conditions de travail de ses techniciens, utile pour sa marque employeur et son document unique.

C'est une différence que ni ServiceNow, ni EasyVista, ni Freshservice ne peuvent reproduire.

## 4. Ce qu'il ne faut pas mélanger

- **Les acheteurs sont différents** : RH pour EchoBridge, DSI pour Relève. Un discours commun brouillerait les deux.
- **Les données ne doivent jamais se croiser** : EchoBridge garantit l'anonymat. Aucune donnée EchoBridge ne doit alimenter Relève, et inversement. Bases séparées, projets Supabase séparés.
- **La marque** : garder deux identités distinctes au départ (voir [04](04-marque-et-DA.md)).

## 5. La question franche : le temps du fondateur

Mener deux jeunes sociétés en parallèle est **le premier risque du projet**, devant la concurrence. Trois options :

| Option | Avantage | Inconvénient |
|---|---|---|
| **A. Relève comme second produit de la même structure** | Une seule société, des coûts mutualisés, une histoire « bien-être au travail » cohérente | Dilue le focus d'EchoBridge |
| **B. Société séparée avec un associé technique** | Focus, et une personne dédiée au produit | Partage du capital, recrutement à faire |
| **C. Valider d'abord avec 3 pilotes, décider ensuite** (recommandé) | Coût faible, décision fondée sur des preuves | Reporte la décision de 4 mois |

**Ma recommandation : option C.** Lancer les pilotes sous la structure existante, et ne créer une société dédiée (ou recruter un associé) que si les pilotes atteignent les objectifs fixés.
