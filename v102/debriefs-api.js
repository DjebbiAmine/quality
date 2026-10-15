'use strict';
// Menu « Débriefs » : routes dédiées. Chaque route n'écrit que son débrief (verrouillé le temps de la transaction) et les
// événements du journal des fiches liées. Les notes (évaluation) restent figées; l'identifiant, la date de création de
// l'audio et le journal des modifications sont fixés par le serveur.
//   GET    /quality/api/debriefs?view=active|archived[&recordId=...]
//   POST   /quality/api/debriefs                         créer (audio téléversé au préalable, rattaché ici)
//   PATCH  /quality/api/debriefs/:id                     modifier (agent, date, responsable, note, action, audio, liens)
//   POST   /quality/api/debriefs/:id/records             lier des fiches        { recordIds: [...] }
//   DELETE /quality/api/debriefs/:id/records/:recordId   dissocier une fiche
//   POST   /quality/api/debriefs/:id/archive | restore
// Droit requis pour toutes : `debriefs`. Un profil limité (sans records_view_all) ne peut lier que ses propres fiches.
const { loadDebriefs, lockDebrief, saveDebrief, nextDebriefId, saveEvent } = require('./relational-store');
const { sameAgentIdentity, recordAssignedTo, DEBRIEF_RATING_KEYS } = require('./rbac');
const { fail, hasPermission, isRealDate, eventFor, makeTransaction } = require('./api-common');

const PATCH_KEYS = ['agentId', 'date', 'owner', 'note', 'action', 'audioId', 'linkRecordIds', 'unlinkRecordIds'];
const CREATE_KEYS = ['agentId', 'date', 'note', 'ratings', 'recordIds', 'action', 'audioId', 'filenameMetadata'];
const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
// Une clé « undefined » équivaut à une clé absente.
const definedOnly = body => isPlainObject(body) ? Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined)) : {};

function parseIdList(value, label) {
  if (!Array.isArray(value) || value.length > 200 || value.some(id => typeof id !== 'string' || !id.trim() || id.length > 100)) throw fail(400, 'DEBRIEF_INVALID', `${label} : liste d’identifiants invalide.`);
  return [...new Set(value.map(id => id.trim()))];
}
function parseAction(value) {
  if (value === null) return null;
  if (!isPlainObject(value)) throw fail(400, 'DEBRIEF_INVALID', 'Action de suivi invalide.');
  const title = String(value.title ?? '').trim();
  if (!title || title.length > 200) throw fail(400, 'DEBRIEF_INVALID', 'L’action de suivi doit avoir un intitulé de 1 à 200 caractères.');
  if (!isRealDate(value.dueDate)) throw fail(400, 'DEBRIEF_INVALID', 'L’échéance de l’action doit être une date valide (AAAA-MM-JJ).');
  return { title, dueDate: String(value.dueDate) };
}
function parseNote(value) {
  const note = String(value ?? '').trim();
  if (note.length > 4000) throw fail(400, 'DEBRIEF_INVALID', 'La note est limitée à 4000 caractères.');
  return note;
}
function parseFilenameMetadata(value) {
  if (!isPlainObject(value) || JSON.stringify(value).length > 20000) throw fail(400, 'DEBRIEF_INVALID', 'Métadonnées du nom de fichier invalides.');
  return value;
}
function rejectUnknown(input, allowed) {
  if ('ratings' in input && !allowed.includes('ratings')) throw fail(400, 'DEBRIEF_RATINGS_FROZEN', 'Les notes d’un débrief déjà enregistré ne sont pas modifiables.');
  const unknown = Object.keys(input).filter(key => !allowed.includes(key));
  if (unknown.length) throw fail(400, 'DEBRIEF_INVALID', `Champ(s) non autorisé(s) : ${unknown.join(', ')}.`);
}

function parseDebriefCreate(body) {
  const input = definedOnly(body);
  rejectUnknown(input, CREATE_KEYS);
  const agentId = String(input.agentId ?? '').trim();
  if (!agentId) throw fail(400, 'DEBRIEF_INVALID', 'Un agent du référentiel est obligatoire.');
  if (!isRealDate(input.date)) throw fail(400, 'DEBRIEF_INVALID', 'La date du débrief doit être une date valide (AAAA-MM-JJ).');
  const ratings = {};
  if (!isPlainObject(input.ratings)) throw fail(400, 'DEBRIEF_INVALID', 'Les notes de la grille sont obligatoires.');
  for (const key of DEBRIEF_RATING_KEYS) {
    const score = input.ratings[key];
    if (!Number.isInteger(score) || score < 1 || score > 5) throw fail(400, 'DEBRIEF_INVALID', `Note de 1 à 5 obligatoire pour « ${key} ».`);
    ratings[key] = score;
  }
  const extra = Object.keys(input.ratings).filter(key => !DEBRIEF_RATING_KEYS.includes(key));
  if (extra.length) throw fail(400, 'DEBRIEF_INVALID', `Critère(s) de note inconnu(s) : ${extra.join(', ')}.`);
  const audioId = String(input.audioId ?? '').trim();
  if (!audioId) throw fail(400, 'DEBRIEF_AUDIO_REQUIRED', 'L’enregistrement audio du débrief est obligatoire.');
  const values = { agentId, date: String(input.date), note: parseNote(input.note), ratings, recordIds: 'recordIds' in input ? parseIdList(input.recordIds, 'recordIds') : [], action: 'action' in input ? parseAction(input.action) : null, audioId };
  if ('filenameMetadata' in input) values.filenameMetadata = parseFilenameMetadata(input.filenameMetadata);
  return values;
}

function parseDebriefPatch(body) {
  const input = definedOnly(body);
  rejectUnknown(input, PATCH_KEYS);
  const values = {};
  if ('agentId' in input) { const agentId = String(input.agentId ?? '').trim(); if (!agentId) throw fail(400, 'DEBRIEF_INVALID', 'Un agent du référentiel est obligatoire.'); values.agentId = agentId; }
  if ('date' in input) { if (!isRealDate(input.date)) throw fail(400, 'DEBRIEF_INVALID', 'La date du débrief doit être une date valide (AAAA-MM-JJ).'); values.date = String(input.date); }
  if ('owner' in input) { const owner = String(input.owner ?? '').trim(); if (!owner || owner.length > 100) throw fail(400, 'DEBRIEF_INVALID', 'Le responsable de la session est obligatoire (100 caractères maximum).'); values.owner = owner; }
  if ('note' in input) values.note = parseNote(input.note);
  if ('action' in input) values.action = parseAction(input.action);
  if ('audioId' in input) { const audioId = String(input.audioId ?? '').trim(); if (!audioId) throw fail(400, 'DEBRIEF_INVALID', 'Identifiant audio invalide.'); values.audioId = audioId; }
  if ('linkRecordIds' in input) values.linkRecordIds = parseIdList(input.linkRecordIds, 'linkRecordIds');
  if ('unlinkRecordIds' in input) values.unlinkRecordIds = parseIdList(input.unlinkRecordIds, 'unlinkRecordIds');
  return values;
}

// Applique `values` à `current` (sans accès base) : renvoie le nouveau débrief, les champs modifiés et les liens ajoutés/retirés.
// `agent` = agent du référentiel quand agentId change; `audio` = objet audio construit quand audioId change.
function planDebriefChange(current, values, { agent, audio } = {}) {
  const next = { ...current, recordIds: [...(current.recordIds || [])], actions: (current.actions || []).map(action => ({ ...action })) };
  const changed = [];
  const set = (field, value) => { if (JSON.stringify(next[field]) !== JSON.stringify(value)) { next[field] = value; changed.push(field); } };
  if (agent) { set('agent', agent.name); set('agentId', agent.id); set('employeeCode', agent.id); }
  if ('date' in values) set('date', values.date);
  if ('owner' in values) set('owner', values.owner);
  if ('note' in values) set('note', values.note);
  if ('action' in values) {
    const actions = next.actions.map(action => ({ ...action }));
    if (values.action === null) actions.shift();
    else if (actions[0]) actions[0] = { ...actions[0], title: values.action.title, dueDate: values.action.dueDate };
    else actions.unshift({ title: values.action.title, dueDate: values.action.dueDate, status: 'EN_COURS', owner: `${next.agent || 'Agent'} + ${next.owner || ''}`.trim() });
    set('actions', actions);
  }
  const before = current.recordIds || [];
  const removed = new Set(values.unlinkRecordIds || []);
  const afterIds = before.filter(id => !removed.has(id));
  for (const id of values.linkRecordIds || []) if (!afterIds.includes(id)) afterIds.push(id);
  set('recordIds', afterIds);
  if (audio) set('audio', audio);
  return { next, changed, linked: afterIds.filter(id => !before.includes(id)), unlinked: before.filter(id => !afterIds.includes(id)) };
}

function buildAudio(row, debriefId, agentName, date, auth) {
  const folder = `${debriefId}_${String(agentName || 'Agent').replace(/[^A-Za-z0-9]+/g, '_')}_${date}`;
  return { fileName: row.original_name, mimeType: row.mime_type, fileSize: Number(row.byte_size), objectId: row.id, storage: 'MINIO', sha256: row.sha256, localUrl: '', driveFolderName: folder, driveParentFolderId: null, driveFolderId: null, driveFileId: null, driveStatus: 'STORED_MINIO', dateUpload: new Date(row.created_at).toISOString(), uploadedBy: auth.fullName || 'Utilisateur' };
}

function registerDebriefRoutes(app, { pool, requireAuth, requireReadyPassword, requirePermission, audit }) {
  const guard = [requireAuth, requireReadyPassword, requirePermission('debriefs')];
  const inTransaction = makeTransaction(pool);

  async function resolveAgent(db, agentId) {
    const found = await db.query('select matricule as id,name from public.crm_agents where matricule=$1', [agentId]);
    if (!found.rows.length) throw fail(400, 'DEBRIEF_AGENT_UNKNOWN', `L’agent ${agentId} n’existe pas dans le référentiel.`);
    return found.rows[0];
  }
  // Les fiches vérifiées doivent exister et appartenir à l'agent du débrief; les fiches NOUVELLEMENT liées (`scopedIds`) doivent
  // de plus, pour un profil limité, être affectées à l'utilisateur (les liens existants d'autres personnes ne le bloquent pas).
  async function checkLinks(db, debrief, recordIds, auth, scopedIds) {
    if (!recordIds.length) return;
    const found = await db.query('select id,employee_code as "employeeCode",agent,responsible,responsible_id as "responsibleId" from public.crm_records where id=any($1::text[])', [recordIds]);
    const byId = new Map(found.rows.map(row => [row.id, row]));
    for (const id of recordIds) {
      const record = byId.get(id);
      if (!record) throw fail(400, 'DEBRIEF_RECORD_MISMATCH', `La fiche ${id} n’existe pas.`);
      if (!sameAgentIdentity(debrief.agentId || debrief.employeeCode, debrief.agent, record.employeeCode, record.agent)) throw fail(400, 'DEBRIEF_RECORD_MISMATCH', `La fiche ${id} n’appartient pas à l’agent du débrief.`);
      if (scopedIds.includes(id) && !hasPermission(auth, 'records_view_all') && !recordAssignedTo(record, auth)) throw fail(403, 'SCOPE_DENIED', `La fiche ${id} n’est pas affectée à votre compte.`);
    }
  }
  // Rattache l'audio téléversé (brouillon `draft-...`, ou déjà au nom du débrief) à ce débrief.
  async function attachAudio(db, audioId, debriefId, auth) {
    const found = await db.query("select * from public.local_audio_objects where id=$1 and media_kind='debrief'", [audioId]);
    const row = found.rows[0];
    if (!row || row.uploaded_by !== auth.id) throw fail(400, 'DEBRIEF_AUDIO_INVALID', 'Cet audio n’existe pas ou n’a pas été téléversé par vous.');
    if (row.record_id === debriefId) return row;
    if (!String(row.record_id || '').startsWith('draft-')) throw fail(400, 'DEBRIEF_AUDIO_INVALID', 'Cet audio est déjà rattaché à un autre débrief.');
    const updated = await db.query('update public.local_audio_objects set record_id=$1 where id=$2 returning *', [debriefId, audioId]);
    return updated.rows[0];
  }
  async function writeLinkEvents(db, debrief, linked, unlinked, auth, events) {
    for (const id of linked) { const event = eventFor(id, 'Fiche associée à un débrief', `${debrief.id} · ${debrief.agent}`, auth); await saveEvent(db, event); events.push(event); }
    for (const id of unlinked) { const event = eventFor(id, 'Fiche dissociée d’un débrief', `${debrief.id} · ${debrief.agent}`, auth); await saveEvent(db, event); events.push(event); }
  }
  async function applyPatch(db, current, values, auth, req) {
    if (current.archived) throw fail(409, 'DEBRIEF_ARCHIVED', 'Ce débrief est supprimé : restaurez-le avant de le modifier.');
    const agent = 'agentId' in values && String(values.agentId) !== String(current.agentId || current.employeeCode || '') ? await resolveAgent(db, values.agentId) : null;
    let audio = null;
    if ('audioId' in values && values.audioId !== current.audio?.objectId) audio = buildAudio(await attachAudio(db, values.audioId, current.id, auth), current.id, agent?.name || current.agent, values.date || current.date, auth);
    const plan = planDebriefChange(current, values, { agent, audio });
    if (!plan.changed.length) return { debrief: current, events: [] };
    const candidate = plan.next;
    await checkLinks(db, candidate, agent ? candidate.recordIds : plan.linked, auth, plan.linked); // changement d'agent : tous les liens restants doivent correspondre au nouvel agent
    candidate.modifications = [...(current.modifications || []), { at: new Date().toISOString(), by: auth.fullName || 'Utilisateur', fields: plan.changed }];
    await saveDebrief(db, candidate);
    const events = [];
    await writeLinkEvents(db, candidate, plan.linked, plan.unlinked, auth, events);
    await audit(auth.id, 'debrief.updated', 'debrief', candidate.id, { fields: plan.changed }, req.get('x-request-id'), db);
    return { debrief: candidate, events };
  }

  app.get('/quality/api/debriefs', ...guard, async (req, res) => {
    const view = String(req.query.view || 'active');
    if (!['active', 'archived'].includes(view)) throw fail(400, 'DEBRIEF_INVALID', 'Vue inconnue.');
    const debriefs = await loadDebriefs(pool, { archived: view === 'archived', recordId: req.query.recordId ? String(req.query.recordId) : undefined });
    res.set('Cache-Control', 'private, no-store'); res.json({ debriefs });
  });

  app.post('/quality/api/debriefs', ...guard, async (req, res) => {
    const values = parseDebriefCreate(req.body);
    const out = await inTransaction(async db => {
      const agent = await resolveAgent(db, values.agentId);
      const id = await nextDebriefId(db, new Date().getUTCFullYear());
      const audioRow = await attachAudio(db, values.audioId, id, req.auth);
      const debrief = { id, agent: agent.name, agentId: agent.id, employeeCode: agent.id, date: values.date, owner: req.auth.fullName || 'Utilisateur', recordIds: values.recordIds, note: values.note, ratings: values.ratings, rubricVersion: 1, actions: [], audio: buildAudio(audioRow, id, agent.name, values.date, req.auth) };
      if (values.action) debrief.actions = [{ title: values.action.title, dueDate: values.action.dueDate, status: 'EN_COURS', owner: `${agent.name} + ${debrief.owner}` }];
      if (values.filenameMetadata) debrief.filenameMetadata = values.filenameMetadata;
      await checkLinks(db, debrief, debrief.recordIds, req.auth, debrief.recordIds);
      await saveDebrief(db, debrief);
      const events = [];
      await writeLinkEvents(db, debrief, debrief.recordIds, [], req.auth, events);
      await audit(req.auth.id, 'debrief.created', 'debrief', id, { agentId: agent.id, records: debrief.recordIds.length }, req.get('x-request-id'), db);
      return { debrief, events };
    });
    res.status(201).json(out);
  });

  app.patch('/quality/api/debriefs/:id', ...guard, async (req, res) => {
    const values = parseDebriefPatch(req.body);
    const out = await inTransaction(async db => {
      const current = await lockDebrief(db, String(req.params.id));
      if (!current) throw fail(404, 'DEBRIEF_NOT_FOUND', 'Débrief introuvable.');
      return applyPatch(db, current, values, req.auth, req);
    });
    res.json(out);
  });

  app.post('/quality/api/debriefs/:id/records', ...guard, async (req, res) => {
    const input = isPlainObject(req.body) ? req.body : {};
    rejectUnknown(input, ['recordIds']);
    const linkRecordIds = parseIdList(input.recordIds, 'recordIds');
    if (!linkRecordIds.length) throw fail(400, 'DEBRIEF_INVALID', 'Indiquez au moins une fiche.');
    const out = await inTransaction(async db => {
      const current = await lockDebrief(db, String(req.params.id));
      if (!current) throw fail(404, 'DEBRIEF_NOT_FOUND', 'Débrief introuvable.');
      return applyPatch(db, current, { linkRecordIds }, req.auth, req);
    });
    res.json(out);
  });
  app.delete('/quality/api/debriefs/:id/records/:recordId', ...guard, async (req, res) => {
    const out = await inTransaction(async db => {
      const current = await lockDebrief(db, String(req.params.id));
      if (!current) throw fail(404, 'DEBRIEF_NOT_FOUND', 'Débrief introuvable.');
      return applyPatch(db, current, { unlinkRecordIds: [String(req.params.recordId)] }, req.auth, req);
    });
    res.json(out);
  });

  const setArchived = archived => async (req, res) => {
    const out = await inTransaction(async db => {
      const current = await lockDebrief(db, String(req.params.id));
      if (!current) throw fail(404, 'DEBRIEF_NOT_FOUND', 'Débrief introuvable.');
      if (Boolean(current.archived) === archived) return { debrief: current, events: [] };
      const next = { ...current };
      if (archived) { next.archived = true; next.archivedAt = new Date().toISOString(); next.archivedBy = req.auth.fullName || 'Utilisateur'; }
      else { delete next.archived; next.archivedAt = null; next.archivedBy = null; }
      next.modifications = [...(current.modifications || []), { at: new Date().toISOString(), by: req.auth.fullName || 'Utilisateur', fields: ['archived'] }];
      await saveDebrief(db, next);
      const events = [];
      for (const recordId of next.recordIds || []) { const event = eventFor(recordId, archived ? 'Débrief supprimé (archivé)' : 'Débrief restauré', `${next.id} · ${next.agent}`, req.auth); await saveEvent(db, event); events.push(event); }
      await audit(req.auth.id, archived ? 'debrief.archived' : 'debrief.restored', 'debrief', next.id, {}, req.get('x-request-id'), db);
      return { debrief: next, events };
    });
    res.json(out);
  };
  app.post('/quality/api/debriefs/:id/archive', ...guard, setArchived(true));
  app.post('/quality/api/debriefs/:id/restore', ...guard, setArchived(false));
}

module.exports = { registerDebriefRoutes, parseDebriefCreate, parseDebriefPatch, planDebriefChange, buildAudio };
