# Déploiement neuf — QualiContact CRM

## Périmètre

Cette procédure crée une **nouvelle installation locale PostgreSQL + MinIO avec un état CRM vide**. Elle ne restaure, ne copie et n’importe aucune donnée issue d’un ancien navigateur, Supabase ou d’une autre base. Après l’initialisation, les fiches, workflows et historiques créés dans cette nouvelle installation sont conservés et versionnés.

N’exécutez pas `supabase/*.sql`. Ces fichiers historiques ne sont pas nécessaires au déploiement et ne figurent pas dans le ZIP final.

## Prérequis

- Node.js 20 ou supérieur et npm.
- Docker avec Docker Compose.
- Un poste ou hôte local adapté à la confidentialité des audios.

## Installation

1. **Décompresser** `qualicontact-crm-deploiement.zip` dans un répertoire privé et se placer à la racine du projet.

2. Créer la configuration locale à partir du modèle :
   ```bash
   cp .env.example .env
   ```
   Dans `.env`, remplacez les valeurs d’exemple par des secrets forts et uniques. Gardez cohérents `POSTGRES_PASSWORD` et le mot de passe de `DATABASE_URL`; configurez également `MINIO_ACCESS_KEY` et `MINIO_SECRET_KEY`. Ne partagez pas ce fichier et ne l’ajoutez pas au ZIP ou au dépôt.

3. Installer les dépendances Node :
   ```bash
   npm ci
   ```

4. Démarrer PostgreSQL et MinIO :
   ```bash
   docker compose up -d postgres minio
   docker compose ps
   ```
   PostgreSQL et MinIO sont publiés uniquement sur l’interface locale `127.0.0.1` dans la configuration fournie. L’API Node s’exécute sur l’hôte local.

5. Créer le schéma de la nouvelle base :
   ```bash
   npm run db:init
   ```
   Cette commande lit uniquement `local-db/bootstrap.sql`. Exécutez-la sur une base PostgreSQL neuve destinée à cette installation. Elle crée les tables, les permissions et les rôles système; elle ne charge aucune fiche ni aucun historique CRM. Ce n’est pas une procédure de mise à niveau ou de migration.

6. Créer le premier compte administrateur :
   ```bash
   npm run auth:create-admin
   ```
   Suivez les invites dans le terminal et choisissez un mot de passe d’au moins 12 caractères. Le mot de passe n’est pas inscrit dans le projet. Pour une exécution non interactive, le script accepte `BOOTSTRAP_ADMIN_PASSWORD` fourni depuis un gestionnaire de secrets local; ne le mettez pas dans le dépôt ni dans le chat.

7. Lancer l’application :
   ```bash
   npm start
   ```
   Ouvrez `http://127.0.0.1:3000` (ou le port configuré dans `PORT`) et connectez-vous avec le compte administrateur. Au démarrage, l’API crée le bucket MinIO configuré s’il n’existe pas.

8. **Initialiser l’état métier vide** dans l’interface : lorsque la base ne contient pas encore d’état CRM, l’administrateur voit l’écran d’initialisation et confirme **Initialiser une base CRM vide**. L’API crée atomiquement un état vide (version 1); une seconde tentative est refusée sans remplacer les données. Aucun fichier ou état du navigateur n’est lu.

9. Utiliser **Paramètres → Utilisateurs & rôles** pour ajouter les comptes appropriés. Configurez ensuite les clients, les critères qualité et les libellés selon les règles réellement approuvées; l’application n’invente pas de grilles métier.

## Démarrage ultérieur

Après l’installation initiale, les démarrages suivants ne nécessitent que :

```bash
docker compose up -d postgres minio
npm start
```

Ne relancez pas `npm run db:init` sur une base de production en service comme opération de mise à niveau. Les nouvelles écritures métier sont versionnées dans PostgreSQL et les binaires audio restent dans MinIO.

## Sauvegardes et sécurité opérationnelle

- Mettre en place une sauvegarde régulière de PostgreSQL et du bucket MinIO; vérifier régulièrement les restaurations dans un environnement isolé. Une seule sauvegarde ne suffit pas à restaurer les audios.
- Garder `.env`, sauvegardes et données hors du ZIP et des dépôts partagés. Ne jamais publier les ports PostgreSQL ou MinIO sur Internet.
- Pour un accès réseau, utiliser TLS avec un reverse proxy, limiter le pare-feu, sécuriser l’hôte et adapter la configuration d’exposition des services. En production, configurez `NODE_ENV=production` afin d’activer les cookies `Secure`; servez le CRM uniquement via HTTPS.
- Aucun service PostgreSQL ou MinIO réel n’est démarré par cette préparation du ZIP. Validez l’installation dans votre environnement local avant tout usage opérationnel.

## Contrôles logiciels disponibles

```bash
npm test
npm run build:html
```

Les tests automatisés ne remplacent pas une recette avec PostgreSQL et MinIO réels. Voir [`RAPPORT_VERIFICATION.md`](RAPPORT_VERIFICATION.md) pour les contrôles exécutés et leurs limites.
