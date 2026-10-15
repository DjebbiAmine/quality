# Rapport de vérification — QualiContact CRM

**Date : 30 septembre 2026**  
**Cible :** installation neuve PostgreSQL local + MinIO, sans reprise de données.

## Avis général

Les contrôles de code et tests automatisés passent après suppression du parcours d’import local et mise en place d’une initialisation CRM vide protégée. Les workflows et historiques générés après le démarrage restent versionnés. **Cette vérification ne remplace pas une recette avec PostgreSQL et MinIO réels ni un audit de sécurité de production.** Aucun service réel n’a été démarré et aucun secret n’a été configuré dans l’espace de travail.

## Résultats exécutés

- `npm ci` : réussi; 121 paquets installés, 0 vulnérabilité signalée par l’audit npm.
- `node --check app.js` : réussi.
- `node --check local-api/server.js` : réussi.
- `node --check local-api/state-store.js` : réussi.
- `node --check local-api/rbac.js` : réussi.
- `node --check tests/local-api-http.cjs` : réussi.
- `npm test` : réussi; les trois sous-suites ont abouti :
  - **workflow** — conservation des fiches et retours successifs, versions de retours finaux, débrief à huit notes, parsing audio, rôles et exports;
  - **RBAC/state** — filtrage par client, redaction des champs hors permission, estampillage côté serveur, conservation des fiches/tâches/débriefs, retours append-only et tâche de réévaluation;
  - **HTTP/auth** — authentification, contrôle CSRF et disponibilité statique sans base réelle. Le test vérifie aussi que l’initialisation vide exige une session authentifiée et que l’ancien endpoint d’import local n’est plus exposé.
- `npm run build:html` : réussi. `qualicontact-crm.html` a été reconstruit depuis `index.html`, `styles.css` et `app.js`.

## Contrôles de périmètre et sécurité réalisés dans le code

- L’état métier PostgreSQL n’est créé qu’après confirmation d’un administrateur via `POST /quality/api/state/initialize-empty`; l’endpoint insère uniquement un état vide de version 1 et refuse atomiquement une seconde initialisation sans remplacer l’état existant.
- La route historique `POST /quality/api/state/import-local` et les commandes d’import/sauvegarde navigateur ont été retirées du parcours de déploiement. L’initialisation ne lit pas `localStorage` et n’exige aucun téléchargement préalable.
- Les fichiers `supabase/*.sql` ne sont pas exécutés par l’application. L’initialisation documentée lit `local-db/bootstrap.sql` pour créer le schéma d’une nouvelle base.
- L’interface masque les pages/actions non autorisées; les routes API contrôlent à nouveau la session, le mot de passe provisoire et les permissions côté serveur.
- Les profils à portée client ne reçoivent que les fiches transmises du client affecté. L’audio est contrôlé côté serveur selon sa fiche, son client, son objet MinIO et l’état d’envoi.
- Les versions d’évaluation sont estampillées côté serveur. Les retours client, retours finaux, envois, sessions de débrief et journal d’audit ne peuvent pas être réécrits ou supprimés par le merge standard.
- Le serveur vérifie qu’un nouvel audio de fiche ou de débrief référencé par l’état métier existe dans MinIO et correspond au type, à la fiche et, pour l’appel, au client attendus.

## Limites non vérifiées

- Aucun conteneur, serveur PostgreSQL ou MinIO n’a été démarré; `npm run db:init`, la création de compte réel, les téléversements/lectures MinIO et le démarrage complet avec secrets locaux n’ont pas été exécutés.
- Aucune donnée n’a été migrée, importée ou restaurée; aucun script `supabase/*.sql` n’a été exécuté.
- Pas de recette bout en bout avec de vrais comptes contre une base locale, de test navigateur multi-utilisateur, de test de charge ou de test de restauration conjointe PostgreSQL + MinIO.
- Le bundle statique `qualicontact-crm.html` reste une démonstration navigateur sans authentification ni RBAC serveur; les données réelles doivent passer par l’API locale.
- TLS, configuration d’un reverse proxy, pare-feu, secrets de production, sauvegardes périodiques et procédure de restauration restent à valider dans l’environnement de déploiement.

## Suite recommandée

1. Configurer les secrets dans `.env` sur l’hôte privé de déploiement.
2. Déployer sur une nouvelle base PostgreSQL et un nouveau stockage MinIO selon [`DEPLOIEMENT.md`](DEPLOIEMENT.md); initialiser uniquement le schéma, créer le compte administrateur et confirmer une base CRM vide.
3. Tester les rôles interne/client, les limites de portée, les audios avant/après envoi, les évaluations et versions, retours successifs, débriefs et exports.
4. Mettre en place puis tester la restauration coordonnée de PostgreSQL et MinIO.
5. Faire approuver les grilles et règles métier avant configuration; ne pas compléter les critères à partir d’hypothèses.
