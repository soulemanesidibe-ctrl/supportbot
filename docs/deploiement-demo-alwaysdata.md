# Mettre la démonstration de Relève en ligne chez alwaysdata

Ce guide met en ligne la **démonstration** : les cinq écrans avec des **données fictives**, sans aucune clé et sans lien avec le projet Supabase. Le déploiement réel (connexion à la base, clé Mistral, envoi des codes par e-mail) est l'objet du jalon J8.

Résultat : une adresse `https://VOTRECOMPTE.alwaysdata.net` qui ouvre la page « Démonstration de Relève », avec un lien vers chaque écran. Partout, remplacez `VOTRECOMPTE` par le nom de votre compte alwaysdata.

Les noms de menus ci-dessous viennent de la documentation d'alwaysdata ; ils peuvent varier légèrement dans votre interface.

## 1. Préparer le paquet

1. Téléchargez `releve-demo.zip` (fabriqué par `scripts/build-demo-package.sh`).
2. Décompressez-le sur votre ordinateur : vous obtenez un dossier `releve` qui contient `dist`, `server`, `package.json` et `LISEZMOI.txt`.

## 2. Choisir la version de Node.js

Dans l'administration d'alwaysdata : **Environment > Node.js** (« Environnement »). Choisissez la version **24** et enregistrez. Le serveur de Relève demande Node.js 22.18 ou plus.

## 3. Autoriser le dépôt de fichiers (SFTP)

1. **Remote access > SSH** (« Accès distant »). Modifiez l'utilisateur qui porte le nom de votre compte.
2. Cochez l'autorisation de **connexion par mot de passe** et choisissez un mot de passe solide, que vous n'utilisez nulle part ailleurs.
3. Ce mot de passe reste chez vous : ne l'envoyez jamais, ni à Claude ni à personne.

## 4. Déposer le dossier avec FileZilla

1. Installez FileZilla (client gratuit, `filezilla-project.org`), la version « Client ».
2. Connectez-vous :
   - Hôte : `sftp://ssh-VOTRECOMPTE.alwaysdata.net`
   - Identifiant : `VOTRECOMPTE`
   - Mot de passe : celui de l'étape 3
   - Port : `22`
3. À la première connexion, FileZilla demande de confirmer la clé du serveur : acceptez.
4. À droite, vous êtes dans `/home/VOTRECOMPTE`. Glissez le dossier `releve` de la partie gauche vers la droite.
5. Vérifiez que `/home/VOTRECOMPTE/releve` contient bien `dist`, `server` et `package.json`.

## 5. Régler le site

1. **Web > Sites**. Modifiez le site de l'adresse `VOTRECOMPTE.alwaysdata.net` (crayon). S'il n'existe pas, ajoutez un site avec cette adresse.
2. Type : **Node.js**.
3. Commande, en une seule ligne :

   ```
   node /home/VOTRECOMPTE/releve/server/node.ts https://VOTRECOMPTE.alwaysdata.net
   ```

4. Répertoire de travail, si le champ existe : `/home/VOTRECOMPTE/releve`.
5. Onglet SSL : activez **Forcer HTTPS**.
6. Enregistrez.

Le serveur écoute tout seul sur l'adresse et le port que fournit alwaysdata (variables `IP` et `PORT`) : rien d'autre à régler.

## 6. Vérifier

Ouvrez `https://VOTRECOMPTE.alwaysdata.net`. La page « Démonstration de Relève » liste quatre écrans :

- **Widget salarié** : n'importe quelle adresse, puis n'importe quel code à 6 chiffres.
- **Console technicien**, **Écran ESN**, **Administrateur client** : n'importe quelle adresse, n'importe quel mot de passe, puis n'importe quel code à 6 chiffres.

Le badge « Données fictives » s'affiche en haut des écrans du personnel.

## En cas de problème

Ouvrez les journaux du site dans l'administration (menu **Logs**) et envoyez à Claude les dernières lignes, **sans mot de passe**. Causes fréquentes :

| Ce que vous voyez | Cause probable | Que faire |
|---|---|---|
| `ERR_UNKNOWN_FILE_EXTENSION` ou « Unknown file extension .ts » | Node.js trop ancien | Étape 2 : choisir la version 24, puis redémarrer le site |
| « L'adresse publique doit être exacte et en https » | Adresse absente ou mal écrite dans la commande | Étape 5 : vérifier `https://VOTRECOMPTE.alwaysdata.net` à la fin de la commande |
| `Cannot find module` ou page 404 partout | Dossier mal placé | Étape 4 : le chemin doit être exactement `/home/VOTRECOMPTE/releve` |
| Erreur 502 ou 503 | Le serveur ne démarre pas | Lire les journaux, et vérifier le nom du compte dans la commande (deux fois) |

## Mettre la démonstration à jour

Claude fournit un nouveau `releve-demo.zip`. Dans FileZilla, remplacez le dossier `releve` par le nouveau, puis redémarrez le site dans **Web > Sites**.

## Ce qu'il ne faut jamais faire

- Mettre une vraie donnée de client, une clé ou un mot de passe dans ce dossier ou dans la commande.
- Utiliser ce compte gratuit pour un client payant : alwaysdata peut suspendre un compte gratuit sans préavis, et son offre gratuite est présentée comme destinée à un usage personnel. Au premier client payant, on passe à une offre payante.

Le lien est public : toute personne qui l'a peut voir la démonstration. Elle ne contient que des données inventées.

## Sources

- [alwaysdata, configurer Node.js](https://help.alwaysdata.com/en/docs/web-hosting/languages/nodejs/configuration/) : variables `IP`, `HOST` et `PORT`, choix de la version, commande du site.
- [alwaysdata, SFTP](https://help.alwaysdata.com/en/docs/web-hosting/remote-access/sftp/) : hôte `ssh-[compte].alwaysdata.net`, port 22, connexion par mot de passe à autoriser.
- [alwaysdata, conditions](https://www.alwaysdata.com/en/terms-and-legal/) : suspension possible d'un compte gratuit.
