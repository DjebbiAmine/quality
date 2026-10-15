'use strict';
// Menu « Fiches d'appel » (étape 1 : création, lecture, modification, affectation, archivage). Routes dédiées :
//   GET    /quality/api/records?view=active|archived      records_view ou records_manage (archived : records_manage)
//   GET    /quality/api/records/:id
//   POST   /quality/api/records                           records_manage  (audio téléversé au préalable, rattaché ici)
//   PATCH  /quality/api/records/:id                       records_manage  (changer le qualiticien : records_assign)
//   POST   /quality/api/records/:id/archive | restore     records_manage
// Le serveur attribue le numéro de fiche, impose le nom du qualiticien, vérifie l'agent et l'audio, crée la tâche automatique
// « Évaluer l'appel » et écrit le journal. Chaque écriture verrouille puis incrémente la version globale de l'état : un
// navigateur resté sur l'ancienne sauvegarde d'état complet reçoit un conflit de version (puis fusionne) au lieu d'écraser la fiche.
const { loadRecords, loadRecordsPage, lockRecord, saveRecord, nextRecordId, loadTasks, saveTask, saveEvent } = require('./relational-store');
const { filterStateForUser, isClientScopedAuth, recordAssignedTo, normalizeAgentText, normalizeEmployeeCode } = require('./rbac');
const { fail, hasPermission, isRealDate, eventFor, makeTransaction, bumpStateVersion } = require('./api-common');

const TEXT_FIELDS = ['campaign', 'campaignCode', 'agentCivility', 'agentCodeFromFilename', 'callTime', 'duration', 'extension', 'clientRef', 'recordIndex', 'baseName', 'rawSegment1', 'rawSegment6', 'rawSegment7', 'clientCall1Status'];
const CREATE_KEYS = ['clientId', 'client', 'agentName', 'agentId', 'callDate', 'amount', 'filenameParts', 'sourceFilename', 'responsibleId', 'audioId', ...TEXT_FIELDS];
const PATCH_KEYS = ['agentName', 'agentId', 'callDate', 'amount', 'responsibleId', 'audioId', ...TEXT_FIELDS.filter(key => key !== 'rawSegment1')];
const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const definedOnly = body => isPlainObject(body) ? Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined)) : {};
const todayUtc = () => new Date().toISOString().slice(0, 10);

function durationToSeconds(value) {
  const parts = String(value || '').split(':').map(Number);
  if (parts.some(part => !Number.isFinite(part) || part < 0)) return null;
  if (parts.length === 2 && parts[1] < 60) return parts[0] * 60 + parts[1];
  if (parts.length === 3 && parts[1] < 60 && parts[2] < 60) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}
function parseText(key, value) {
  const text = String(value ?? '').trim();
  if (text.length > 300) throw fail(400, 'RECORD_INVALID', `${key} est limité à 300 caractères.`);
  if (key === 'callTime' && text && !/^\d{2}:\d{2}(:\d{2})?$/.test(text)) throw fail(400, 'RECORD_INVALID', 'L’heure de l’appel doit être au format HH:MM ou HH:MM:SS.');
  if (key === 'duration' && text && durationToSeconds(text) === null) throw fail(400, 'RECORD_INVALID', 'La durée doit être au format MM:SS ou HH:MM:SS.');
  return text;
}
function parseAmount(value) {
  if (value === null || value === '') return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1e9) throw fail(400, 'RECORD_INVALID', 'Le montant doit être un nombre positif.');
  return amount;
}
function parseCommon(input, values) {
  for (const key of TEXT_FIELDS) if (key in input) values[key] = parseText(key, input[key]);
  if ('callDate' in input) { if (!isRealDate(input.callDate)) throw fail(400, 'RECORD_INVALID', 'La date de l’appel doit être une date valide (AAAA-MM-JJ).'); values.callDate = String(input.callDate); }
  if ('amount' in input) values.amount = parseAmount(input.amount);
  if ('agentName' in input) { const name = String(input.agentName ?? '').trim(); if (name.length > 200) throw fail(400, 'RECORD_INVALID', 'Le nom de l’agent est limité à 200 caractères.'); values.agentName = name; }
  if ('agentId' in input) values.agentId = String(input.agentId ?? '').trim();
  if ('responsibleId' in input) values.responsibleId = String(input.responsibleId ?? '').trim();
  if ('audioId' in input) { const audioId = String(input.audioId ?? '').trim(); if (!audioId) throw fail(400, 'RECORD_INVALID', 'Identifiant audio invalide.'); values.audioId = audioId; }
}
function rejectUnknown(input, allowed) {
  const unknown = Object.keys(input).filter(key => !allowed.includes(key));
  if (unknown.length) throw fail(400, 'RECORD_INVALID', `Champ(s) non autorisé(s) : ${unknown.join(', ')}.`);
}

function parseRecordCreate(body) {
  const input = definedOnly(body);
  rejectUnknown(input, CREATE_KEYS);
  if (!String(input.audioId ?? '').trim()) throw fail(400, 'RECORD_AUDIO_REQUIRED', 'L’enregistrement audio de la fiche est obligatoire.');
  const values = {};
  parseCommon(input, values);
  const clientId = String(input.clientId ?? '').trim();
  if (!clientId || clientId.length > 100) throw fail(400, 'RECORD_INVALID', 'Le client est obligatoire.');
  values.clientId = clientId;
  values.client = String(input.client ?? '').trim().slice(0, 200);
  if (!values.agentName && !values.agentId) throw fail(400, 'RECORD_INVALID', 'Le nom de l’agent est obligatoire.');
  if (!values.responsibleId) throw fail(400, 'ASSIGNEE_REQUIRED', 'Le choix du qualiticien est obligatoire pour créer une fiche.');
  if (!values.audioId) throw fail(400, 'RECORD_AUDIO_REQUIRED', 'L’enregistrement audio de la fiche est obligatoire.');
  values.callDate = values.callDate || todayUtc();
  if ('amount' in values === false) values.amount = null;
  if ('sourceFilename' in input) values.sourceFilename = String(input.sourceFilename ?? '').trim().slice(0, 300);
  if ('filenameParts' in input) {
    if (!Array.isArray(input.filenameParts) || input.filenameParts.length > 60 || input.filenameParts.some(part => typeof part !== 'string' || part.length > 300)) throw fail(400, 'RECORD_INVALID', 'Segments du nom de fichier invalides.');
    values.filenameParts = input.filenameParts;
  }
  return values;
}

function parseRecordPatch(body) {
  const input = definedOnly(body);
  rejectUnknown(input, PATCH_KEYS);
  const values = {};
  parseCommon(input, values);
  if ('agentName' in values && !values.agentName && !values.agentId) throw fail(400, 'RECORD_INVALID', 'Le nom de l’agent est obligatoire.');
  return values;
}

// Résolution du nom d'agent saisi (mêmes règles que le navigateur) : matricule vérifié, ou nom unique du référentiel, ou nom libre.
function resolveAgent(agents, { agentId, agentName, candidateCode }) {
  if (agentId) {
    const found = agents.find(agent => agent.id === agentId);
    if (!found) throw fail(400, 'RECORD_AGENT_UNKNOWN', `L’agent ${agentId} n’existe pas dans le référentiel.`);
    return { name: found.name, id: found.id };
  }
  const wanted = normalizeAgentText(agentName);
  const sameName = wanted ? agents.filter(agent => normalizeAgentText(agent.name) === wanted) : [];
  if (sameName.length === 1) return { name: sameName[0].name, id: sameName[0].id };
  if (sameName.length > 1 && candidateCode) {
    const code = normalizeEmployeeCode(candidateCode);
    const picked = code ? sameName.find(agent => normalizeEmployeeCode(agent.id) === code) : null;
    if (picked) return { name: picked.name, id: picked.id };
  }
  return { name: String(agentName || '').trim(), id: '' };
}

const summary = record => `${record.agent} · ${record.campaign} · index ${record.recordIndex || '—'}`;
// Applique `values` à `current` sans accès base. `agent` / `assignee` / `audio` : valeurs déjà résolues et vérifiées.
function planRecordChange(current, values, { agent, assignee, audio } = {}) {
  const next = { ...current };
  const changed = [];
  const set = (field, value) => { if (JSON.stringify(next[field] ?? null) !== JSON.stringify(value ?? null)) { next[field] = value; changed.push(field); } };
  for (const key of TEXT_FIELDS) if (key in values) set(key, values[key]);
  if ('duration' in values) set('durationSeconds', durationToSeconds(values.duration));
  if ('callDate' in values) set('callDate', values.callDate);
  if ('amount' in values) set('amount', values.amount);
  if (agent) { set('agent', agent.name); set('employeeCode', agent.id); }
  const assignChanged = !!assignee && (String(current.responsibleId || '') !== assignee.id || String(current.responsible || '') !== assignee.name);
  if (assignChanged) { set('responsible', assignee.name); set('responsibleId', assignee.id); }
  if (audio) set('audio', audio);
  return { next, changed, assignChanged, before: summary(current), after: summary(next), audioChanged: changed.includes('audio') };
}

function buildRecordAudio(row, auth) {
  const size = Number(row.byte_size);
  return { id: row.id, objectId: row.id, storage: 'MINIO', fileName: row.original_name, originalName: row.original_name, mimeType: row.mime_type, fileSize: size, sha256: row.sha256, drive_file_id: '', drive_file_name: row.original_name, drive_file_url: '', mime_type: row.mime_type, file_size: size, date_upload: new Date(row.created_at).toISOString(), uploaded_by: auth.fullName || 'Utilisateur' };
}

function registerRecordRoutes(app, { pool, requireAuth, requireReadyPassword, requirePermission, requireAnyPermission, assignableUsers, audit }) {
  const readGuard = [requireAuth, requireReadyPassword, requireAnyPermission(['records_view', 'records_manage'])];
  const writeGuard = [requireAuth, requireReadyPassword, requirePermission('records_manage')];
  const inTransaction = makeTransaction(pool);

  const bumpState = bumpStateVersion;
  async function resolveAssignee(db, responsibleId) {
    const user = (await assignableUsers(db)).find(item => item.id === responsibleId);
    if (!user) throw fail(400, 'ASSIGNEE_INVALID', 'Le qualiticien choisi n’est pas un utilisateur actif avec le rôle Qualiticien ou Responsable qualité.');
    return { id: user.id, name: user.name };
  }
  const loadAgents = async db => (await db.query('select matricule as id,name from public.crm_agents')).rows;
  async function attachAudio(db, audioId, recordId, clientId, auth) {
    const found = await db.query("select * from public.local_audio_objects where id=$1 and media_kind='call_record'", [audioId]);
    const row = found.rows[0];
    if (!row || row.uploaded_by !== auth.id) throw fail(400, 'RECORD_AUDIO_INVALID', 'Cet audio n’existe pas ou n’a pas été téléversé par vous.');
    if (row.record_id === recordId) return row;
    if (!String(row.record_id || '').startsWith('draft-')) throw fail(400, 'RECORD_AUDIO_INVALID', 'Cet audio est déjà rattaché à une autre fiche.');
    if (clientId && row.client_id !== clientId) throw fail(400, 'RECORD_AUDIO_INVALID', 'Cet audio a été téléversé pour un autre client.');
    // Un identifiant réutilisé peut laisser un audio orphelin identique (même fichier, même cible) : on le retire avant le rattachement.
    await db.query('delete from public.local_audio_objects where id<>$1 and sha256=$2 and media_kind=$3 and record_id=$4 and client_id is not distinct from $5', [audioId, row.sha256, row.media_kind, recordId, row.client_id]);
    return (await db.query('update public.local_audio_objects set record_id=$1 where id=$2 returning *', [recordId, audioId])).rows[0];
  }
  const visible = (record, auth) => hasPermission(auth, 'records_view_all') || recordAssignedTo(record, auth);
  const toVisible = (records, auth) => filterStateForUser({ records }, auth).records;

  const isoDay = (value) => { const text = String(value || '').trim(); return text === '' ? '' : isRealDate(text) ? text : null; };
  // Liste paginée : filtres, droits, recherche, tri et LIMIT/OFFSET sont exécutés par PostgreSQL (index crm_records_list_idx).
  // Seuls les profils portail client, dont la visibilité dépend de l'historique d'envoi, passent par le calcul en mémoire.
  app.get('/quality/api/records', ...readGuard, async (req, res) => {
    const view = String(req.query.view || 'active');
    if (!['active', 'archived'].includes(view)) throw fail(400, 'RECORD_INVALID', 'Vue inconnue.');
    if (view === 'archived' && !hasPermission(req.auth, 'records_manage')) throw fail(403, 'PERMISSION_DENIED', 'Permission requise : records_manage.', { missingPermissions: ['records_manage'] });
    res.set('Cache-Control', 'private, no-store');
    if (req.query.page === undefined) {
      const records = toVisible(await loadRecords(pool, { archived: view === 'archived' }), req.auth);
      return res.json({ records });
    }
    const page = Number(req.query.page);
    const pageSize = req.query.pageSize === undefined ? 10 : Number(req.query.pageSize);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw fail(400, 'RECORD_INVALID', 'Pagination invalide (page ≥ 1, pageSize entre 1 et 100).');
    const days = {};
    for (const key of ['callFrom', 'callTo', 'closedFrom', 'closedTo']) {
      const day = isoDay(req.query[key]);
      if (day === null) throw fail(400, 'RECORD_INVALID', 'Date de filtre invalide (AAAA-MM-JJ).');
      days[key] = day;
    }
    const text = (key) => { const value = String(req.query[key] || '').trim(); return value && value !== 'all' ? value.slice(0, 200) : ''; };
    const filters = { status: text('status'), campaign: text('campaign'), ...days };
    const compliance = text('compliance');
    const search = text('search');
    if (isClientScopedAuth(req.auth)) {
      const normText = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const query = normText(search);
      let records = toVisible(await loadRecords(pool, { archived: view === 'archived' }), req.auth);
      const inRange = (value, from, to) => { const day = String(value || '').slice(0, 10); return (!from && !to) || (day && (!from || day >= from) && (!to || day <= to)); };
      records = records.filter((r) => (!filters.status || r.status === filters.status) && (!filters.campaign || r.campaign === filters.campaign)
        && inRange(r.callDate, filters.callFrom, filters.callTo) && inRange(r.closedAt, filters.closedFrom, filters.closedTo)
        && (!compliance || r.internal1?.conformity === compliance) && (!query || [r.id, r.agent, r.client, r.campaign, r.recordIndex, r.baseName, r.sourceFilename].some((value) => normText(value).includes(query))));
      records.sort((a, b) => String(b.callDate || '').localeCompare(String(a.callDate || '')) || String(b.callTime || '').localeCompare(String(a.callTime || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      const total = records.length;
      const pages = Math.max(1, Math.ceil(total / pageSize));
      const current = Math.min(page, pages);
      return res.json({ records: records.slice((current - 1) * pageSize, current * pageSize), pagination: { page: current, pageSize, total, pages } });
    }
    const scope = {
      canInternal1: hasPermission(req.auth, 'synergy1'), canInternal2: hasPermission(req.auth, 'reevaluation'),
      canClientReturns: hasPermission(req.auth, 'client_returns'), canFinalReturn: hasPermission(req.auth, 'final_return'), canClientSend: hasPermission(req.auth, 'client_send')
    };
    if (!hasPermission(req.auth, 'records_view_all')) { scope.restrictedUserId = String(req.auth.id || ''); scope.restrictedName = normalizeAgentText(req.auth.fullName || ''); }
    const result = await loadRecordsPage(pool, { archived: view === 'archived', filters, search, compliance, scope, page, pageSize });
    // Les fiches de la page repassent par le filtre de champs autorisés (internal1/2, retours client, envoi…).
    res.json({ records: toVisible(result.records, req.auth), pagination: result.pagination });
  });
  app.get('/quality/api/records/:id', ...readGuard, async (req, res) => {
    const [record] = toVisible(await loadRecords(pool, { ids: [String(req.params.id)] }), req.auth);
    if (!record) throw fail(404, 'RECORD_NOT_FOUND', 'Fiche introuvable.');
    res.set('Cache-Control', 'private, no-store'); res.json({ record });
  });

  app.post('/quality/api/records', ...writeGuard, async (req, res) => {
    const values = parseRecordCreate(req.body);
    const out = await inTransaction(async db => {
      const stateVersion = await bumpState(db, req.auth);
      const assignee = await resolveAssignee(db, values.responsibleId);
      const agent = resolveAgent(await loadAgents(db), { agentId: values.agentId, agentName: values.agentName, candidateCode: values.agentCodeFromFilename });
      if (!agent.name) throw fail(400, 'RECORD_INVALID', 'Le nom de l’agent est obligatoire.');
      const id = await nextRecordId(db, values.callDate.slice(0, 4));
      const audioRow = await attachAudio(db, values.audioId, id, values.clientId, req.auth);
      const clientName = values.client || (await db.query('select client from public.crm_records where client_id=$1 and client is not null limit 1', [values.clientId])).rows[0]?.client || values.clientId;
      const duration = values.duration || '00:00';
      const record = {
        id, clientId: values.clientId, client: clientName, campaign: values.campaign || values.campaignCode || 'À rattacher', campaignCode: values.campaignCode || '',
        agent: agent.name, employeeCode: agent.id, agentCodeFromFilename: values.agentCodeFromFilename || '', agentCivility: values.agentCivility || '',
        callDate: values.callDate, callTime: values.callTime || '', duration, durationSeconds: durationToSeconds(duration), extension: values.extension || '', clientRef: values.clientRef || '',
        recordIndex: values.recordIndex || '', baseName: values.baseName || '', rawSegment1: values.rawSegment1 || '', rawSegment6: values.rawSegment6 || '', rawSegment7: values.rawSegment7 || '',
        sourceFilename: values.sourceFilename || audioRow.original_name, filenameParts: values.filenameParts || [], amount: values.amount, clientCall1Status: values.clientCall1Status || '',
        responsible: assignee.name, responsibleId: assignee.id, createdAt: new Date().toISOString(), status: 'audio_recu', batchId: null, audio: buildRecordAudio(audioRow, req.auth),
        internal1: null, client1: null, internal2: null, responseSentAt: null, clientFinal: null, closedAt: null, labels: []
      };
      await saveRecord(db, record);
      const stored = await lockRecord(db, id);
      const now = new Date();
      const task = { id: `task-auto-eval-${id}`, type: 'EVALUATION_1', auto: true, title: 'Évaluer l’appel', recordId: id, assignedTo: assignee.name, assignedToId: assignee.id, priority: 'NORMALE', createdAt: now.toISOString(), dueDate: now.toISOString().slice(0, 10), status: 'A_FAIRE' };
      await saveTask(db, task);
      const events = [eventFor(id, 'Audio téléversé', `${audioRow.original_name} · S3 Bucket local`, req.auth), eventFor(id, 'Fiche créée', `Indice ${record.recordIndex || '—'} · base ${record.baseName || '—'} · campagne ${record.campaignCode || record.campaign}`, req.auth)];
      for (const event of events) await saveEvent(db, event);
      await audit(req.auth.id, 'record.created', 'record', id, { clientId: record.clientId, responsibleId: assignee.id }, req.get('x-request-id'), db);
      return { record: stored, tasks: [task], events, stateVersion };
    });
    res.status(201).json(out);
  });

  app.patch('/quality/api/records/:id', ...writeGuard, async (req, res) => {
    const values = parseRecordPatch(req.body);
    const out = await inTransaction(async db => {
      const stateVersion = await bumpState(db, req.auth);
      const current = await lockRecord(db, String(req.params.id));
      if (!current) throw fail(404, 'RECORD_NOT_FOUND', 'Fiche introuvable.');
      if (!visible(current, req.auth)) throw fail(403, 'SCOPE_DENIED', 'Cette fiche n’est pas affectée à votre compte.');
      if (current.archived) throw fail(409, 'RECORD_ARCHIVED', 'Cette fiche est supprimée : restaurez-la avant de la modifier.');
      let assignee = null;
      if ('responsibleId' in values && values.responsibleId !== String(current.responsibleId || '')) {
        if (!hasPermission(req.auth, 'records_assign')) throw fail(403, 'PERMISSION_DENIED', 'Permission insuffisante pour modifier l’affectation : records_assign requise.', { missingPermissions: ['records_assign'] });
        if (!values.responsibleId) throw fail(400, 'ASSIGNEE_REQUIRED', 'Une fiche affectée ne peut pas être laissée sans qualiticien : choisissez-en un.');
        assignee = await resolveAssignee(db, values.responsibleId);
      }
      let agent = null;
      if ('agentName' in values || 'agentId' in values) {
        agent = resolveAgent(await loadAgents(db), { agentId: values.agentId, agentName: values.agentName || current.agent, candidateCode: values.agentCodeFromFilename ?? current.agentCodeFromFilename });
        if (!agent.name) throw fail(400, 'RECORD_INVALID', 'Le nom de l’agent est obligatoire.');
      }
      let audio = null; let previousAudioName = null;
      if ('audioId' in values && values.audioId !== (current.audio?.objectId || current.audio?.id)) {
        const row = await attachAudio(db, values.audioId, current.id, current.clientId, req.auth);
        previousAudioName = current.audio?.drive_file_name || '—'; audio = buildRecordAudio(row, req.auth);
      }
      const plan = planRecordChange(current, values, { agent, assignee, audio });
      if (!plan.changed.length) return { record: current, tasks: [], events: [], stateVersion };
      await saveRecord(db, plan.next);
      const stored = await lockRecord(db, current.id);
      const events = []; const tasks = [];
      const textChanged = plan.changed.some(field => !['responsible', 'responsibleId', 'audio'].includes(field));
      if (textChanged) events.push(eventFor(current.id, 'Informations de la fiche modifiées', `${plan.before} → ${plan.after}`, req.auth));
      if (plan.audioChanged) events.push(eventFor(current.id, 'Audio remplacé', `${previousAudioName} → ${plan.next.audio.drive_file_name}`, req.auth));
      if (plan.assignChanged) {
        for (const task of await loadTasks(db, { recordId: current.id, archived: false })) {
          if (task.auto === true && task.status !== 'TERMINE') { const followed = { ...task, assignedTo: assignee.name, assignedToId: assignee.id }; await saveTask(db, followed); tasks.push(followed); }
        }
        events.push(eventFor(current.id, 'Qualiticien modifié', `${current.responsible || 'Non affecté'} → ${assignee.name}${tasks.length ? ` · ${tasks.length} tâche(s) automatique(s) réassignée(s)` : ''}`, req.auth));
      }
      for (const event of events) await saveEvent(db, event);
      await audit(req.auth.id, 'record.updated', 'record', current.id, { fields: plan.changed }, req.get('x-request-id'), db);
      return { record: stored, tasks, events, stateVersion };
    });
    res.json(out);
  });

  const setArchived = archived => async (req, res) => {
    const out = await inTransaction(async db => {
      const stateVersion = await bumpState(db, req.auth);
      const current = await lockRecord(db, String(req.params.id));
      if (!current) throw fail(404, 'RECORD_NOT_FOUND', 'Fiche introuvable.');
      if (!visible(current, req.auth)) throw fail(403, 'SCOPE_DENIED', 'Cette fiche n’est pas affectée à votre compte.');
      if (Boolean(current.archived) === archived) return { record: current, tasks: [], events: [], stateVersion };
      const next = { ...current };
      if (archived) { next.archived = true; next.archivedAt = new Date().toISOString(); next.archivedBy = req.auth.fullName || 'Utilisateur'; }
      else { delete next.archived; next.archivedAt = null; next.archivedBy = null; }
      await saveRecord(db, next);
      const stored = await lockRecord(db, next.id);
      const event = eventFor(next.id, archived ? 'Fiche supprimée (archivée)' : 'Fiche restaurée', `Indice ${next.recordIndex || '—'} · ${next.agent}`, req.auth);
      await saveEvent(db, event);
      await audit(req.auth.id, archived ? 'record.archived' : 'record.restored', 'record', next.id, {}, req.get('x-request-id'), db);
      return { record: stored, tasks: [], events: [event], stateVersion };
    });
    res.json(out);
  };
  app.post('/quality/api/records/:id/archive', ...writeGuard, setArchived(true));
  app.post('/quality/api/records/:id/restore', ...writeGuard, setArchived(false));
}

module.exports = { registerRecordRoutes, parseRecordCreate, parseRecordPatch, planRecordChange, resolveAgent, durationToSeconds, buildRecordAudio };
