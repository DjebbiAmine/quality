# Guide d’utilisation — QualiContact CRM

Ce guide décrit les parcours métier et l’accès au CRM local. En mode avec API, PostgreSQL et MinIO, les données sont centralisées et les permissions sont vérifiées côté serveur. La version autonome/statique est une démonstration navigateur seulement : n’y saisissez pas de données réelles.

## 0. Se connecter à l’installation neuve

1. L’administrateur déploie l’application selon [`DEPLOIEMENT.md`](DEPLOIEMENT.md), crée le premier compte puis initialise une base CRM vide. Aucune donnée historique n’est importée au premier démarrage.
2. Ouvrez le CRM servi par l’API locale et connectez-vous avec votre compte QualiContact. Les comptes sont créés par un administrateur; ne partagez pas les mots de passe dans le chat ou le dépôt.
3. Lorsqu’un mot de passe provisoire est attribué, remplacez-le à la première connexion. Le serveur hache le mot de passe et ne l’envoie pas aux autres utilisateurs.
4. Si un enregistrement audio ne peut pas être lu, signalez-le à l’administrateur; les références MinIO et l’accès réseau au stockage doivent être vérifiés.

Les workflows et leurs versions enregistrés après le démarrage sont conservés dans cette nouvelle installation. Les scripts historiques `supabase/*.sql` ne sont pas exécutés.

## Tableau de bord et statistiques

Le tableau de bord calcule ses indicateurs à partir des données autorisées pour l’utilisateur connecté : fiches, évaluations, retours et débriefs. **Fiches évaluées** correspond aux fiches avec Synergy #1; les scores et taux de conformité ne sont calculés qu’à partir des valeurs effectivement renseignées. Les retours comptent chaque version et les fiches concernées; les retours successifs restent attachés à la même fiche. Un débrief complet possède les huit notes obligatoires.

Les statistiques croisées rapprochent les évaluations, les retours, les réévaluations, les débriefs et les tâches. Le serveur filtre les données selon les permissions et la portée client avant le calcul. Les profils client ne reçoivent ni les champs internes d’évaluation ni les événements internes.

## 1. Ajouter une fiche audio

1. Ouvrez **Fiches d’appel**, puis **Nouvel enregistrement**.
2. Sélectionnez le **client** concerné et l’audio. En mode API, le binaire est téléversé dans MinIO; le CRM n’envoie pas de données audio au FTP.
3. Vérifiez les métadonnées proposées depuis le nom du fichier. Le premier segment est le **numéro de poste**; seuls les champs confirmés sont préremplis. `F` est reconnu comme civilité. Les autres segments inconnus restent disponibles pour correction et traçabilité.
4. Saisissez/corrigez l’agent, la campagne, la date, l’indice et les autres informations confirmées. Les champs **Montant de la promesse** et **Référence client** ne sont pas affichés pour un nouvel enregistrement. Les anciennes fiches conservent leur historique et leurs champs d’édition.
5. Enregistrez. L’identifiant technique de la fiche n’est pas un substitut à l’Indice. Dans les listes, **Dossier** correspond au **Nom de base**; un indice inconnu reste vide, ne le devinez pas.

## 2. Réaliser Synergy #1

1. Depuis la fiche, ouvrez **Synergy #1** et démarrez l’évaluation.
2. Réécoutez l’audio et répondez aux critères configurés et approuvés. L’application ne crée pas de nouvelle grille métier.
3. Justifiez toute réponse **X** si le formulaire l’exige, complétez les résultats disponibles puis enregistrez.
4. Une correction ultérieure crée une nouvelle version sur la même fiche; l’ancienne évaluation reste conservée. L’API refuse la suppression ou la réécriture de l’historique.

## 3. Sélectionner et transmettre des fiches

1. Ouvrez **À envoyer au client**. Les fiches sont sélectionnées manuellement par le qualiticien; aucune règle de conformité Synergy #1 n’est ajoutée comme filtre de sélection.
2. Consultez les colonnes Date, Dossier (Nom de base), Agent, Indice, réponses disponibles et libellés d’étape.
3. Choisissez les fiches, puis **Préparer l’envoi** : tableau Excel, ZIP audio, ou les deux.
4. Déposez manuellement les fichiers sur le FTP externe du client. Le CRM n’établit pas de connexion FTP automatique.
5. Après confirmation du dépôt réel, cliquez sur **Confirmer le dépôt FTP** et indiquez éventuellement le chemin. Le serveur ajoute une trace horodatée par fiche; les envois précédents ne sont pas remplacés.

Le tableau Excel contient notamment l’historique des retours client, les réponses de réévaluation et de retour final, les libellés et le statut de la fiche. Ne confirmez pas un dépôt qui n’a pas été effectué.

## 4. Saisir un retour client

1. Pour un retour reçu par e-mail, ouvrez la fiche puis l’onglet **Retour client**. Un compte client peut aussi répondre depuis son portail sécurisé, mais uniquement sur les fiches de son client déjà transmises.
2. Ajoutez le prochain retour. **Nom de base**, **Indice** et **Statut Call 1** sont repris de la fiche et conservés en instantané; ne les ressaisissez pas comme de nouvelles données.
3. Renseignez le statut final confirmé (`DAM` ou `Indécis`), **Déjà donateur** (`Oui` ou `Non`), les remarques et la date de réception demandée par le formulaire.
4. Enregistrez. Chaque retour est ajouté à la même fiche, numéroté et horodaté; le serveur estampe l’auteur et les métadonnées d’audit. Le libellé **Retour client** est appliqué automatiquement et une tâche de réévaluation peut être créée par le workflow.
5. Les retours suivants (**#2, #3**, etc.) ajoutent une nouvelle version. Aucun retour précédent ne peut être édité ou supprimé par un profil standard.

## 5. Réévaluer dans la fiche

1. Après un retour client, ouvrez l’onglet **Réévaluation** de cette même fiche, ou utilisez le bouton/la tâche **Réévaluation après retour client**.
2. Complétez **ANALYSE POLE QUALITE**, choisissez **PROMESSE VALIDE** ou **PROMESSE Non VALIDE**, puis **Don conforme** ou **Don non conforme**.
3. Enregistrez. La réévaluation reste attachée à la fiche, reçoit une version, termine la tâche correspondante et applique le libellé **Réévaluation**. Une nouvelle saisie ajoute une version.

La réévaluation n’est pas une page ou une session indépendante. Les données Synergy #2 historiques sont conservées; aucune règle nouvelle n’est déduite de l’ancien formulaire.

## 6. Enregistrer le retour final

1. Ouvrez **Retour final** depuis la fiche.
2. Choisissez **Valide** ou **Non valide** et enregistrez.
3. Le retour est horodaté, versionné et lié à la même fiche; le libellé **Retour final** est appliqué. Une nouvelle réponse s’ajoute sans remplacer les précédentes.

## 7. Faire un débrief agent

1. Depuis **Débriefs**, choisissez **Nouveau débrief** : aucune fiche n’est préassociée. Si vous lancez le débrief depuis le détail d’une fiche, cette fiche est associée automatiquement.
2. Joignez obligatoirement l’**audio du débrief**. C’est un fichier distinct de l’audio d’appel; en mode API, son binaire est téléversé dans MinIO.
3. La convention de nommage `#` est la même que pour une fiche d’appel. Le nom d’agent extrait est prérempli dans le champ principal **Agent**, modifiable, et relié au référentiel s’il est reconnu. Les champs confirmés (dont le poste, l’indice source, le numéro de prospect du segment 7, la base et la campagne) peuvent être vérifiés et corrigés. Le segment 6 et les segments 9+ ne sont pas interprétés; le nom original et les segments sont conservés pour traçabilité.
4. Donnez de **1 à 5 étoiles** à chacune des huit compétences obligatoires : accroche et autorisation, remerciement, maîtrise du script, découverte et écoute, présentation de l’appel au don, réponse aux objections, confirmation et coordonnées, clôture.
5. Ajoutez observations/points forts et, facultativement, une action de progression avec échéance. Enregistrez pour conserver le débrief, l’audio et son association éventuelle à la fiche.

Le coaching privilégie l’écoute, le consentement explicite et une clôture respectueuse. Ne déduisez pas la capacité d’une personne de son âge ou de sa voix; respectez un refus sans insistance.

## 8. Consulter les fiches, tâches et historiques

- Une fiche regroupe l’audio, les informations, Synergy #1, les retours successifs, la réévaluation, le retour final, les envois, les tâches et la chronologie.
- Les historiques et journaux ne doivent pas être supprimés pour corriger une erreur; demandez une nouvelle version selon le workflow ou faites intervenir un administrateur.
- **Lots client**, **Retours clients** et **Réévaluations** ne sont pas proposés comme écrans autonomes. Leurs données historiques restent conservées.
- Le portail client est limité au(x) client(s) attribué(s) et aux fiches déjà transmises. Le serveur filtre aussi les métadonnées/audio; masquer une fiche dans l’interface n’est pas l’unique contrôle.

## 9. Gérer les comptes et les permissions

Cette section requiert le droit d’administration **Gérer les utilisateurs et les rôles**.

1. Ouvrez **Paramètres → Utilisateurs & rôles**. Ajoutez un compte avec son nom et son e-mail, choisissez un rôle et, pour une portée client, affectez le client concerné. Le serveur crée le compte et fournit un mot de passe provisoire; transmettez-le uniquement par un canal privé approuvé, puis demandez à la personne de le remplacer à la première connexion.
2. Un administrateur peut modifier un compte ou désactiver son accès. Les changements sont journalisés côté serveur; supprimer/désactiver un compte ne supprime pas les fiches et historiques.
3. Pour un rôle, choisissez une portée (**Organisation / clients autorisés** ou **Client affecté uniquement**) et cochez uniquement les activités requises. Les rôles client sont limités au portail, aux retours client et au retour final; l’API refuse les combinaisons de permissions non autorisées.
4. L’interface masque les pages et actions sans permission. En plus, chaque route API vérifie la session, le mot de passe provisoire et la permission correspondante. Les affectations client sont contrôlées serveur; un client ne peut pas contourner le filtre en appelant directement une URL API.

## Mode démonstration sans backend

Si l’application est ouverte comme fichier statique ou avec un serveur de fichiers simple, elle utilise des données locales de démonstration conservées dans `localStorage`. Il n’y a alors ni authentification réelle, ni base centralisée, ni stockage audio MinIO, ni protection RBAC serveur. Les comptes/rôles simulés de cette version ne doivent pas être utilisés comme contrôle d’accès.
