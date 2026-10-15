# QualiContact — CRM Qualité Synergy Growth

CRM de qualité organisé autour d’une **fiche d’appel persistante** : une même fiche conserve les évaluations et leurs versions, les retours client successifs, les envois, les tâches et les événements liés aux workflows.

## Installation retenue : base neuve, sans reprise de données

Cette livraison cible une **nouvelle installation PostgreSQL + MinIO**. L’état CRM démarre vide : aucune fiche, évaluation, tâche, retour ou ancien historique n’est importé. Les workflows et versions produits après l’initialisation sont conservés dans la nouvelle base.

Les scripts `supabase/*.sql` sont historiques et ne sont ni requis ni inclus dans le ZIP de déploiement. **Ne pas les exécuter.** `local-db/bootstrap.sql` sert uniquement à créer le schéma de la nouvelle installation; ce n’est pas une procédure de migration de données.

Le guide étape par étape est dans [`DEPLOIEMENT.md`](DEPLOIEMENT.md). Ne transmettez jamais de secret dans le chat; configurez-les uniquement dans l’environnement local.

## Architecture

- **PostgreSQL local** : identités, sessions, rôles et permissions, état métier JSONB versionné, métadonnées audio et journal d’audit append-only.
- **MinIO local** : binaires audio des fiches et débriefs; PostgreSQL ne conserve que leurs métadonnées et références.
- **API Express locale** : authentification par session serveur, autorisation RBAC vérifiée à chaque requête et filtrage des données avant réponse. Le navigateur ne reçoit ni identifiants PostgreSQL ni secrets MinIO.
- **FTP client** : transfert manuel. Le CRM prépare le classeur Excel et/ou le ZIP audio; l’utilisateur dépose les fichiers puis confirme l’envoi.

## Workflow métier conservé

- **Fiches d’appel** : une fiche par audio, affichage de l’indice plutôt que l’ID technique; client sélectionnable, métadonnées modifiables et audio stocké dans MinIO.
- **Synergy #1** : critères configurables; aucune grille ou règle métier n’est inventée. Les évaluations successives sont versionnées.
- **Envoi client** : sélection manuelle sans filtre de conformité ajouté; export Excel, ZIP audio ou les deux; dépôt FTP manuel et historique conservé.
- **Retours client** : entrées successives sur la même fiche; statuts `DAM` / `Indécis`, **Déjà donateur** Oui/Non et remarques; anciennes versions conservées.
- **Réévaluation** : attachée à la fiche et autorisée après un retour client; réponses versionnées; la tâche de suivi correspondante est créée par le workflow.
- **Retour final** : statuts Valide / Non valide, versions conservées sur la fiche.
- **Débriefs** : audio obligatoire distinct de l’appel, huit critères obligatoires de 1 à 5 étoiles; association à la fiche selon le point de départ.
- **Autres modules** : tableaux de bord, recherche et filtres, tâches, progression agents, portail, timeline, paramètres, débriefs et exports. Les pages autonomes Lots client, Retours clients et Réévaluations restent hors navigation sans suppression des données produites.

## Authentification et RBAC

Les permissions sont persistées dans `app_roles` et `app_role_permissions`, et attribuées via `app_user_roles`. Les codes sont définis dans `local-db/bootstrap.sql` et `local-api/rbac.js`.

L’interface masque les pages et actions interdites, mais **le serveur revalide l’authentification et les permissions à chaque requête**. Les profils `assigned_client` ne voient que les fiches déjà transmises appartenant au(x) client(s) affecté(s). Les accès audio sont revalidés selon la fiche, le client, l’association MinIO et l’état d’envoi. Les champs d’évaluation et événements internes ne sont pas renvoyés au portail client. Les historiques d’évaluations, retours, envois, débriefs et le journal ne peuvent pas être réécrits ou supprimés par les profils standards.

Les comptes sont locaux; aucun fournisseur d’identité tiers n’est configuré. Les mots de passe sont hachés côté serveur, la session utilise un cookie HttpOnly et les écritures sont protégées contre CSRF. Un mot de passe provisoire doit être changé à la première connexion.

## Vérification et version autonome

```bash
npm ci
npm test
npm run build:html
```

`npm test` lance les tests de workflow, de filtrage/merge RBAC et le smoke test HTTP/auth, sans PostgreSQL ni MinIO réels. `qualicontact-crm.html` est le bundle autonome de démonstration généré depuis `index.html`, `styles.css` et `app.js`; ne l’utilisez pas pour des données réelles ou comme contrôle d’accès serveur.

## Sauvegardes après mise en service

Après le démarrage opérationnel, sauvegardez PostgreSQL **et** le bucket MinIO selon une procédure locale et testez régulièrement leur restauration. Une sauvegarde PostgreSQL seule ne contient pas les binaires audio. Les sauvegardes ne sont pas un mécanisme d’import d’anciennes données dans cette livraison.

## Structure utile

- `app.js`, `index.html`, `styles.css`, `qualicontact-crm.html` — interface et bundle de démonstration.
- `local-api/server.js` — API, authentification, sessions, audio et contrôles d’accès.
- `local-api/rbac.js`, `local-api/state-store.js` — filtrage, statistiques, permissions et conservation des historiques.
- `local-db/bootstrap.sql` — schéma initial PostgreSQL; `local-api/scripts/` — initialisation et création de l’administrateur.
- `compose.yaml`, `.env.example` — PostgreSQL, MinIO et modèle de configuration sans secret réel.
- `DEPLOIEMENT.md`, `GUIDE_UTILISATION.md`, `RAPPORT_VERIFICATION.md` — déploiement, usages métier et limites vérifiées.
