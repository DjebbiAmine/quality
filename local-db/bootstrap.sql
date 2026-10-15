-- QualiContact local: schéma initial PostgreSQL pour une nouvelle installation vide.
-- À exécuter sur une base PostgreSQL neuve avec `npm run db:init`; ce n'est pas un outil de migration.
-- Ce fichier remplace l'utilisation de Supabase : les fichiers supabase/*.sql ne sont pas exécutés.
-- Les accès applicatifs passent exclusivement par local-api/server.js; aucun client navigateur ne reçoit
-- l'identifiant PostgreSQL ni les identifiants MinIO.

begin;

create table if not exists public.app_users (
  id text primary key,
  email text not null,
  full_name text not null,
  password_hash text not null,
  active boolean not null default true,
  must_change_password boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);
create unique index if not exists app_users_email_lower_uq on public.app_users (lower(email));

create table if not exists public.app_roles (
  id text primary key,
  code text not null unique,
  name text not null,
  description text not null default '',
  scope text not null default 'organization' check (scope in ('organization','assigned_client')),
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_permissions (
  code text primary key,
  label text not null,
  permission_group text not null,
  description text not null default '',
  is_api boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.app_role_permissions (
  role_id text not null references public.app_roles(id) on delete cascade,
  permission_code text not null references public.app_permissions(code) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_code)
);

create table if not exists public.app_user_roles (
  user_id text not null references public.app_users(id) on delete cascade,
  role_id text not null references public.app_roles(id) on delete restrict,
  client_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  assigned_by text references public.app_users(id) on delete set null
);
create unique index if not exists app_user_roles_scope_uq
  on public.app_user_roles(user_id, role_id, coalesce(client_id,''));
create index if not exists app_user_roles_user_idx on public.app_user_roles(user_id) where active;

create table if not exists public.app_sessions (
  token_hash char(64) primary key,
  user_id text not null references public.app_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  user_agent text,
  ip_address inet
);
create index if not exists app_sessions_expiry_idx on public.app_sessions(expires_at);

-- L'état métier commence vide dans une nouvelle installation et est conservé en JSONB versionné,
-- afin de garder les champs et historiques créés ensuite sur la même fiche.
-- Les rôles et identités restent dans des tables séparées et ne sont jamais acceptés
-- depuis le document CRM envoyé par le navigateur.
create table if not exists public.crm_state (
  id text primary key check (id='main'),
  data jsonb not null,
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text references public.app_users(id) on delete set null
);

-- Seules les métadonnées sont en PostgreSQL; le binaire audio est stocké dans MinIO.
create table if not exists public.local_audio_objects (
  id text primary key,
  object_key text not null unique,
  sha256 char(64) not null,
  original_name text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size >= 0),
  media_kind text not null check (media_kind in ('call_record','debrief')),
  record_id text,
  client_id text,
  uploaded_by text references public.app_users(id) on delete set null,
  created_at timestamptz not null default now()
);
drop index if exists public.local_audio_hash_kind_uq;
create unique index local_audio_hash_kind_uq on public.local_audio_objects(sha256,media_kind,coalesce(record_id,''),coalesce(client_id,''));
create index if not exists local_audio_record_idx on public.local_audio_objects(record_id);

-- Journal append-only : aucune route d'édition/suppression n'est exposée.
create table if not exists public.app_audit_log (
  id bigserial primary key,
  happened_at timestamptz not null default now(),
  actor_id text references public.app_users(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  request_id text
);
create index if not exists app_audit_actor_time_idx on public.app_audit_log(actor_id,happened_at desc);

create or replace function public.reject_audit_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'app_audit_log is append-only';
end;
$$;
drop trigger if exists trg_app_audit_no_update on public.app_audit_log;
create trigger trg_app_audit_no_update before update or delete on public.app_audit_log
for each row execute function public.reject_audit_mutation();

insert into public.app_permissions(code,label,permission_group,description,is_api) values
  ('dashboard','Tableau de bord','Pilotage & fiches','Afficher la page du tableau de bord.',false),
  ('api_dashboard_read','API — consulter le tableau de bord','API & tableau de bord','Autorise GET /api/dashboard/summary. Le serveur vérifie aussi ce droit à chaque requête.',true),
  ('api_dashboard_export','API — exporter les statistiques','API & tableau de bord','Autorise l’export des statistiques du tableau de bord.',true),
  ('records_view','Consulter les fiches d’appel','Pilotage & fiches','Lire les fiches et leurs historiques.',false),
  ('records_manage','Créer / modifier les fiches','Pilotage & fiches','Créer une fiche et corriger ses métadonnées.',false),
  ('synergy1','Réaliser Synergy #1','Évaluations & envois','Saisir et versionner Synergy #1.',false),
  ('client_returns','Saisir les retours client','Évaluations & envois','Ajouter des retours client historisés.',false),
  ('reevaluation','Réaliser une réévaluation','Évaluations & envois','Saisir une réévaluation dans la fiche.',false),
  ('final_return','Saisir le retour final','Évaluations & envois','Enregistrer le retour final.',false),
  ('client_send','Préparer les envois client','Évaluations & envois','Préparer un export et enregistrer son historique.',false),
  ('debriefs','Consulter / créer les débriefs','Équipe & suivi','Consulter les sessions, notes et suivis.',false),
  ('agents','Consulter les agents & progression','Équipe & suivi','Consulter les profils et statistiques agent.',false),
  ('tasks','Gérer les tâches','Équipe & suivi','Consulter et mettre à jour les tâches.',false),
  ('portal','Accéder au portail client','Espace client','Accéder uniquement aux fiches transmises du client affecté.',false),
  ('quality_settings','Configurer les grilles, libellés et stockage','Administration','Configurer les paramètres qualité et stockage local.',false),
  ('users_roles','Gérer les utilisateurs et les rôles','Administration','Créer/désactiver des comptes et définir les permissions.',false)
on conflict(code) do update set label=excluded.label,permission_group=excluded.permission_group,description=excluded.description,is_api=excluded.is_api;

insert into public.app_roles(id,code,name,description,scope,is_system) values
  ('role-admin','ADMIN','Administrateur','Administration complète du CRM local.','organization',true),
  ('role-quality-lead','QUALITY_MANAGER','Responsable qualité','Pilotage global des évaluations et de l’équipe qualité.','organization',true),
  ('role-qualitician','QUALITY_AGENT','Qualiticien','Évaluations, retours, envois et suivi des fiches.','organization',true),
  ('role-client-admin','CLIENT_ADMIN','Client administrateur','Accès portail pour le client affecté.','assigned_client',true),
  ('role-client-user','CLIENT_USER','Utilisateur client','Consultation et retours sur les fiches autorisées.','assigned_client',true)
on conflict(id) do update set code=excluded.code,name=excluded.name,description=excluded.description,scope=excluded.scope,is_system=excluded.is_system;

insert into public.app_role_permissions(role_id,permission_code)
select 'role-admin',code from public.app_permissions
on conflict do nothing;
insert into public.app_role_permissions(role_id,permission_code)
select 'role-quality-lead',code from public.app_permissions where code <> 'portal'
on conflict do nothing;
insert into public.app_role_permissions(role_id,permission_code) values
  ('role-qualitician','dashboard'),('role-qualitician','api_dashboard_read'),('role-qualitician','api_dashboard_export'),
  ('role-qualitician','records_view'),('role-qualitician','records_manage'),('role-qualitician','synergy1'),
  ('role-qualitician','client_returns'),('role-qualitician','reevaluation'),('role-qualitician','final_return'),
  ('role-qualitician','client_send'),('role-qualitician','debriefs'),('role-qualitician','agents'),('role-qualitician','tasks'),
  ('role-client-admin','portal'),('role-client-admin','client_returns'),('role-client-admin','final_return'),
  ('role-client-user','portal'),('role-client-user','client_returns'),('role-client-user','final_return')
on conflict do nothing;

commit;
