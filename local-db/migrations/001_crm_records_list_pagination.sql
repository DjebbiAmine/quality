-- Pagination SQL de la liste « Fiches d'appel » (GET /quality/api/records?page=…).
-- Idempotent : peut être rejoué sans effet. Sur une grosse table, exécuter chaque
-- CREATE INDEX séparément avec CONCURRENTLY pour ne pas bloquer les écritures.

-- Ordre de la liste (date d'appel la plus récente d'abord) : le parcours de l'index évite tout tri
-- et permet un LIMIT/OFFSET sans lire toute la table. Doit rester identique à RECORD_LIST_ORDER (relational-store.js).
CREATE INDEX IF NOT EXISTS crm_records_list_idx
  ON public.crm_records (archived, call_date DESC NULLS LAST, call_time DESC NULLS LAST, created_at DESC NULLS LAST, id DESC);

-- Filtre « Date de clôture » (la majorité des fiches n'est pas clôturée : index partiel).
CREATE INDEX IF NOT EXISTS crm_records_closed_at_idx
  ON public.crm_records (closed_at) WHERE closed_at IS NOT NULL;

-- Filtres statut / campagne, combinés avec l'ordre de la liste.
CREATE INDEX IF NOT EXISTS crm_records_status_list_idx
  ON public.crm_records (archived, status, call_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS crm_records_campaign_list_idx
  ON public.crm_records (archived, campaign, call_date DESC NULLS LAST);

-- Filtre de conformité Synergy #1 : l'évaluation courante par fiche est déjà couverte par
-- crm_record_evaluations_current_uq (record_id, stage) WHERE is_current.
