-- Base de connaissance de DÉMONSTRATION : fiches génériques écrites pour ce dépôt (aucune donnée réelle, aucune procédure d'un client).
-- 20 fiches pour le client Alpha (mot de passe, authentification à deux facteurs, VPN, imprimante, Outlook, Teams, OneDrive, poste lent,
-- arrivée, départ, courriel suspect) et 2 fiches propres au client Bêta : elles servent à montrer que la recherche d'un client ne remonte
-- JAMAIS les fiches de l'autre. Les fiches sont déjà VALIDÉES par le technicien assigné (sans cette validation l'agent ne les lit pas, M08).
-- Les vecteurs sont absents : la tâche d'indexation (jalon J3) les calcule avec le modèle d'embedding.

insert into public.kb_documents (id, org_id, title, category, source, status, validated_by, validated_at) values
  ('00000000-0000-4000-8000-000000001001', '00000000-0000-4000-8000-0000000000b1', 'Mot de passe oublié : réinitialisation en libre-service', 'password', 'seed', 'validated', '00000000-0000-4000-8000-000000000103', now()),
  ('00000000-0000-4000-8000-000000001002', '00000000-0000-4000-8000-0000000000b1', 'Compte verrouillé après plusieurs tentatives', 'password', 'seed', 'validated', '00000000-0000-4000-8000-000000000103', now()),
  ('00000000-0000-4000-8000-000000001003', '00000000-0000-4000-8000-0000000000b1', 'Nouveau téléphone : reconfigurer l''authentification à deux facteurs', 'mfa', 'seed', 'validated', '00000000-0000-4000-8000-000000000103', now()),
  ('00000000-0000-4000-8000-000000001004', '00000000-0000-4000-8000-0000000000b1', 'Le code d''authentification est refusé', 'mfa', 'seed', 'validated', '00000000-0000-4000-8000-000000000103', now()),
  ('00000000-0000-4000-8000-000000001005', '00000000-0000-4000-8000-0000000000b1', 'Connexion VPN impossible', 'vpn', 'seed', 'validated', '00000000-0000-4000-8000-000000000103', now()),
  ('00000000-0000-4000-8000-000000001006', '00000000-0000-4000-8000-0000000000b1', 'VPN lent ou coupures répétées', 'vpn', 'seed', 'validated', '00000000-0000-4000-8000-000000000103', now()),
  ('00000000-0000-4000-8000-000000001007', '00000000-0000-4000-8000-0000000000b1', 'Imprimante hors ligne', 'printer', 'seed', 'validated', '00000000-0000-4000-8000-000000000103', now()),
  ('00000000-0000-4000-8000-000000001008', '00000000-0000-4000-8000-0000000000b1', 'Impression bloquée dans la file d''attente', 'printer', 'seed', 'validated', '00000000-0000-4000-8000-000000000103', now()),
  ('00000000-0000-4000-8000-000000001009', '00000000-0000-4000-8000-0000000000b1', 'Outlook demande le mot de passe en boucle', 'outlook', 'seed', 'validated', '00000000-0000-4000-8000-000000000103', now()),
  ('00000000-0000-4000-8000-00000000100a', '00000000-0000-4000-8000-0000000000b1', 'Boîte aux lettres pleine', 'outlook', 'seed', 'validated', '00000000-0000-4000-8000-000000000103', now()),
  ('00000000-0000-4000-8000-00000000100b', '00000000-0000-4000-8000-0000000000b1', 'Un courriel attendu n''arrive pas', 'outlook', 'seed', 'validated', '00000000-0000-4000-8000-000000000103', now()),
  ('00000000-0000-4000-8000-00000000100c', '00000000-0000-4000-8000-0000000000b1', 'Pas de son ou de micro dans Teams', 'teams', 'seed', 'validated', '00000000-0000-4000-8000-000000000103', now()),
  ('00000000-0000-4000-8000-00000000100d', '00000000-0000-4000-8000-0000000000b1', 'Impossible de rejoindre une réunion', 'teams', 'seed', 'validated', '00000000-0000-4000-8000-000000000103', now()),
  ('00000000-0000-4000-8000-00000000100e', '00000000-0000-4000-8000-0000000000b1', 'Synchronisation OneDrive bloquée', 'onedrive', 'seed', 'validated', '00000000-0000-4000-8000-000000000103', now()),
  ('00000000-0000-4000-8000-00000000100f', '00000000-0000-4000-8000-0000000000b1', 'Fichier supprimé ou écrasé par erreur', 'onedrive', 'seed', 'validated', '00000000-0000-4000-8000-000000000103', now()),
  ('00000000-0000-4000-8000-000000001010', '00000000-0000-4000-8000-0000000000b1', 'Poste de travail lent', 'slow_pc', 'seed', 'validated', '00000000-0000-4000-8000-000000000103', now()),
  ('00000000-0000-4000-8000-000000001011', '00000000-0000-4000-8000-0000000000b1', 'Écran bleu ou redémarrages inattendus', 'slow_pc', 'seed', 'validated', '00000000-0000-4000-8000-000000000103', now()),
  ('00000000-0000-4000-8000-000000001012', '00000000-0000-4000-8000-0000000000b1', 'Arrivée d''un nouveau collaborateur', 'onboarding', 'seed', 'validated', '00000000-0000-4000-8000-000000000103', now()),
  ('00000000-0000-4000-8000-000000001013', '00000000-0000-4000-8000-0000000000b1', 'Départ d''un collaborateur', 'offboarding', 'seed', 'validated', '00000000-0000-4000-8000-000000000103', now()),
  ('00000000-0000-4000-8000-000000001014', '00000000-0000-4000-8000-0000000000b1', 'Courriel suspect : que faire ?', 'other', 'seed', 'validated', '00000000-0000-4000-8000-000000000103', now());

insert into public.kb_chunks (org_id, document_id, chunk_index, content) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000001001', 0, 'Symptôme : le salarié ne se souvient plus de son mot de passe ou celui-ci a expiré.
Solution :
1. Ouvrir la page de réinitialisation de mot de passe de l''organisation depuis un autre appareil si besoin.
2. Saisir son adresse professionnelle puis valider les informations de sécurité déjà enregistrées (application d''authentification ou code par SMS).
3. Choisir un nouveau mot de passe d''au moins 12 caractères, différent des précédents.
4. Se reconnecter partout (poste, téléphone, messagerie) avec le nouveau mot de passe.
Si la réinitialisation en libre-service n''est pas proposée ou échoue : ne jamais communiquer le mot de passe par message. Demander une réinitialisation par un technicien, qui vérifiera l''identité de la personne par un autre canal avant d''agir.'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000001002', 0, 'Symptôme : « Votre compte est verrouillé » ou « trop de tentatives ».
Cause fréquente : un ancien mot de passe enregistré sur un téléphone ou une tablette tente de se connecter en boucle.
Solution :
1. Attendre quelques minutes : le verrouillage temporaire se lève seul.
2. Supprimer ou mettre à jour le compte professionnel sur le téléphone et la tablette.
3. Si le compte reste verrouillé ou désactivé, demander à un technicien de le réactiver après vérification de l''identité de la personne.
Ne jamais contourner un verrouillage répété sans en chercher la cause : il peut signaler une tentative d''intrusion. Si le verrouillage revient sans explication, escalader au technicien.'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000001003', 0, 'Symptôme : le salarié a changé de téléphone et ne peut plus approuver les connexions.
Solution :
1. Si l''ancien téléphone fonctionne encore : ouvrir la page des informations de sécurité du compte, ajouter la nouvelle application d''authentification, puis supprimer l''ancienne.
2. Si l''ancien téléphone est perdu, cassé ou réinitialisé : seule une réinitialisation des facteurs par un technicien permet de reprendre la main.
La réinitialisation est une action sensible : le technicien vérifie l''identité de la personne par un canal indépendant (appel au numéro connu, responsable hiérarchique) avant de la valider. Aucune réinitialisation n''est faite sur la seule demande d''un message.'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000001004', 0, 'Symptôme : le code à six chiffres est rejeté alors qu''il vient d''être généré.
Causes fréquentes :
- l''heure du téléphone n''est pas réglée automatiquement (décalage de quelques dizaines de secondes suffit) ;
- le code expiré a été saisi (il change toutes les 30 secondes) ;
- plusieurs comptes sont enregistrés dans l''application et le mauvais a été utilisé.
Solution : activer le réglage automatique de la date et de l''heure, attendre le code suivant, vérifier le nom du compte dans l''application. Si le problème persiste, demander une réinitialisation des facteurs par un technicien (identité vérifiée hors bande).'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000001005', 0, 'Symptôme : le client VPN reste sur « Connexion en cours » ou affiche une erreur d''authentification.
Vérifications dans l''ordre :
1. L''accès à internet fonctionne-t-il sans le VPN ? Sinon, traiter d''abord la connexion (box, partage de connexion du téléphone).
2. Le mot de passe a-t-il changé récemment ? Se déconnecter puis se reconnecter du VPN avec le nouveau.
3. Le client VPN est-il à jour ? Redémarrer l''application puis le poste.
4. L''erreur concerne-t-elle plusieurs personnes ? Dans ce cas, c''est probablement une panne côté passerelle : escalader au technicien en précisant l''heure et les personnes touchées.
Ne pas demander au salarié de désactiver son antivirus ou son pare-feu.'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000001006', 0, 'Symptôme : le VPN se connecte mais les applications sont lentes ou la connexion tombe plusieurs fois par heure.
Solution :
1. Tester la connexion internet seule (test de débit depuis un navigateur, sans VPN).
2. Préférer le câble ou être près de la borne Wi-Fi ; éviter le partage de connexion d''un téléphone en mauvaise couverture.
3. Fermer les applications qui synchronisent beaucoup (sauvegarde en ligne, vidéo).
4. Noter l''heure des coupures : cela aide le technicien à les retrouver dans les journaux.
Si plusieurs salariés se plaignent au même moment, escalader : l''incident est probablement central.'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000001007', 0, 'Symptôme : l''imprimante apparaît « hors ligne » ou n''est plus trouvée.
Solution :
1. Vérifier que l''imprimante est allumée, sans bourrage ni message d''erreur sur son écran.
2. Vérifier qu''elle est reliée au réseau (câble branché ou Wi-Fi) en imprimant sa page de configuration depuis son menu.
3. Sur le poste, retirer puis rajouter l''imprimante depuis les paramètres, en choisissant l''imprimante partagée de l''organisation.
4. Si elle fonctionne pour d''autres collègues, le problème est local au poste ; si personne ne peut imprimer, escalader.
Ne pas communiquer d''adresse réseau à modifier à la main sans consigne du technicien.'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000001008', 0, 'Symptôme : un document reste « en cours d''impression » et bloque les suivants.
Solution :
1. Ouvrir la file d''impression et annuler le document bloqué ; si l''annulation ne répond pas, annuler tous les documents.
2. Éteindre puis rallumer l''imprimante, attendre une minute.
3. Relancer l''impression d''un seul document de test.
4. Si le blocage revient avec un document précis (très lourd, format inhabituel), l''enregistrer en PDF puis imprimer le PDF.
Si la file reste bloquée après redémarrage du poste, escalader au technicien.'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000001009', 0, 'Symptôme : une fenêtre demande le mot de passe sans fin, ou Outlook reste en « déconnecté ».
Causes fréquentes : mot de passe changé récemment, session expirée, profil local abîmé.
Solution :
1. Fermer complètement Outlook, puis le relancer.
2. Se déconnecter puis se reconnecter au compte professionnel depuis les paramètres du système.
3. Vérifier que la messagerie fonctionne depuis le navigateur ; si oui, le problème est local au poste.
4. Redémarrer le poste. Si le problème persiste, escalader : le technicien recréera le profil.
Ne jamais saisir le mot de passe dans un message ou un ticket.'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000100a', 0, 'Symptôme : « Votre boîte aux lettres est pleine », les messages ne sont plus reçus.
Solution :
1. Vider les éléments supprimés et le dossier des courriers indésirables.
2. Trier les messages avec pièces jointes volumineuses (tri par taille) et enregistrer les pièces utiles dans l''espace de stockage de l''organisation.
3. Activer l''archivage si l''organisation le propose.
4. Si l''espace reste insuffisant, demander une augmentation au technicien en précisant le besoin ; cette demande suit la politique de l''organisation.'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000100b', 0, 'Symptôme : un message attendu d''un correspondant n''apparaît pas.
Vérifications dans l''ordre :
1. Dossiers « Courrier indésirable » et « Autres ».
2. Boîte pleine ? (voir la fiche dédiée).
3. L''expéditeur a-t-il reçu un message d''erreur de non-remise ? Lui demander de le transmettre.
4. Si l''expéditeur est externe et fiable, demander au technicien de rechercher le message dans la quarantaine.
Ne pas autoriser soi-même un expéditeur inconnu à contourner les protections de la messagerie.'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000100c', 0, 'Symptôme : on n''entend pas les autres, ou ils n''entendent pas le salarié.
Solution :
1. Dans les paramètres de Teams, choisir le bon casque ou le bon micro (l''appareil par défaut change quand on branche un casque).
2. Faire l''appel de test proposé dans les paramètres audio.
3. Vérifier que le micro n''est pas coupé par le système ou par un bouton physique du casque.
4. Quitter Teams complètement puis le relancer ; en dernier recours, redémarrer le poste.
Si le problème est le même dans le navigateur, le matériel est en cause ; sinon, c''est l''application.'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000100d', 0, 'Symptôme : le lien de réunion ne s''ouvre pas, ou « vous n''avez pas accès ».
Solution :
1. Essayer depuis le navigateur plutôt que depuis l''application (ou l''inverse).
2. Vérifier que le salarié est connecté avec son compte professionnel et non un compte personnel.
3. Si la réunion est organisée par une société externe, vérifier auprès de l''organisateur que les invités externes sont admis.
4. Si la salle d''attente est active, attendre l''admission par l''organisateur.
Escalader si plusieurs salariés ne peuvent pas rejoindre au même moment.'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000100e', 0, 'Symptôme : l''icône de synchronisation affiche une pause, une croix rouge ou « traitement des modifications » sans fin.
Solution :
1. Vérifier la connexion internet et qu''il reste de la place sur le disque.
2. Repérer les fichiers en erreur : noms trop longs, caractères interdits, fichiers ouverts par une autre personne.
3. Mettre la synchronisation en pause puis la reprendre.
4. Se déconnecter puis se reconnecter du compte dans l''application. Les fichiers déjà synchronisés ne sont pas perdus.
Ne jamais supprimer le dossier de synchronisation pour « repartir de zéro » : escalader au technicien.'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000100f', 0, 'Symptôme : un fichier a disparu ou une ancienne version a remplacé la bonne.
Solution :
1. Ouvrir la corbeille du stockage en ligne depuis le navigateur et restaurer le fichier.
2. Pour une version écrasée : clic droit sur le fichier, historique des versions, restaurer la version voulue.
3. Pour un dossier partagé, la corbeille de l''espace partagé est distincte : la consulter aussi.
Passé le délai de conservation de la corbeille, seule une restauration par le technicien est possible : escalader en précisant le chemin, la date et l''heure approximatives.'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000001010', 0, 'Symptôme : le poste met longtemps à démarrer ou à ouvrir les applications.
Solution :
1. Redémarrer le poste (un arrêt complet, pas une simple mise en veille ; beaucoup de postes ne sont pas redémarrés depuis des semaines).
2. Fermer les onglets et applications inutiles.
3. Vérifier l''espace disque : sous 10 % d''espace libre, le système ralentit nettement.
4. Laisser terminer les mises à jour en cours.
Si la lenteur persiste après redémarrage, noter l''application concernée et l''heure et escalader : une analyse sur le poste est nécessaire.'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000001011', 0, 'Symptôme : le poste affiche un écran bleu ou redémarre seul.
Ces signes peuvent annoncer une panne de matériel (disque, mémoire) : ne pas tenter de réparation.
Solution :
1. Noter le code d''erreur affiché sur l''écran bleu et l''heure.
2. Enregistrer son travail dès que le poste le permet.
3. Escalader au technicien, qui décidera d''un diagnostic ou d''un poste de remplacement.
Cette fiche est toujours à escalader : l''agent ne propose pas de dépannage à distance.'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000001012', 0, 'Demande à faire par le responsable hiérarchique, au moins cinq jours ouvrés avant l''arrivée.
Informations nécessaires : nom et prénom, date d''arrivée, service, responsable, poste (ordinateur, téléphone), applications et partages à ouvrir, personne à qui le nouvel arrivant ressemble en droits (profil de référence).
Le technicien : crée le compte, attribue la licence, ajoute aux groupes du profil de référence, prépare le poste, transmet l''accès initial par un canal sûr (jamais par message écrit en clair) et programme la configuration de l''authentification à deux facteurs.
L''agent ne crée aucun compte : il aide à compléter la demande et la transmet au technicien.'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000001013', 0, 'Demande à faire par le responsable hiérarchique ou les ressources humaines, avec la date et l''heure de fin d''accès.
Le technicien : désactive le compte à l''heure convenue, révoque les sessions ouvertes, récupère le matériel, transfère les fichiers et la boîte aux lettres à la personne désignée, retire les licences et accès aux applications.
Points d''attention : départ conflictuel (désactivation immédiate), comptes partagés à renouveler, appareils personnels connectés à retirer.
L''agent ne désactive aucun compte : il prépare la demande et la transmet au technicien.'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000001014', 0, 'Symptôme : un message inattendu demande un mot de passe, un paiement urgent, l''ouverture d''une pièce jointe ou un clic sur un lien.
Conduite à tenir :
1. Ne pas cliquer, ne pas ouvrir la pièce jointe, ne pas répondre.
2. Signaler le message avec le bouton de signalement de la messagerie, ou le transférer en pièce jointe à l''adresse de signalement de l''organisation.
3. Si un lien a été cliqué ou un mot de passe saisi : prévenir immédiatement un technicien (l''incident est traité comme une urgence de sécurité) ; changer le mot de passe depuis un autre appareil.
Cette situation est toujours escaladée à un technicien. Les organismes officiels (Cybermalveillance.gouv.fr, ANSSI) publient des conseils à partager avec les salariés.');

insert into public.kb_documents (id, org_id, title, category, source, status, validated_by, validated_at) values
  ('00000000-0000-4000-8000-000000002001', '00000000-0000-4000-8000-0000000000b2', 'Badge d''accès à l''atelier : badge perdu', 'other', 'seed', 'validated', '00000000-0000-4000-8000-000000000104', now()),
  ('00000000-0000-4000-8000-000000002002', '00000000-0000-4000-8000-0000000000b2', 'Imprimante d''étiquettes de l''atelier : étiquettes décalées', 'printer', 'seed', 'validated', '00000000-0000-4000-8000-000000000104', now());

insert into public.kb_chunks (org_id, document_id, chunk_index, content) values
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-000000002001', 0, 'Symptôme : un salarié a perdu ou cassé son badge d''accès à l''atelier.
Conduite à tenir : prévenir le responsable d''atelier pour désactiver le badge, puis demander un badge de remplacement. Ce n''est pas une demande informatique : l''agent oriente vers le responsable d''atelier et n''ouvre pas de ticket.'),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-000000002002', 0, 'Symptôme : l''impression des étiquettes est décalée ou coupée.
Solution : recharger le rouleau en suivant le guide collé sur l''imprimante, lancer le calibrage depuis le menu de l''imprimante, puis imprimer une étiquette de test. Si l''étiquette reste décalée, escalader au technicien.');
