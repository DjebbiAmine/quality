'use strict';
// Menu « Fiches d'appel » (étape 2) : évaluations, retours client, retours finaux, libellés, clôture. Routes dédiées :
//   POST /quality/api/records/:id/evaluations    synergy1 (internal1) / reevaluation (internal2)   { stage, evaluation }
//   POST /quality/api/records/:id/client-returns client_returns (personnel ou portail client)       { finalStatus, alreadyDonor, ... }
//   POST /quality/api/records/:id/final-returns  final_return (personnel ou portail client)         { status }
//   PUT  /quality/api/records/:id/labels         records_manage                                     { labelIds }
//   POST /quality/api/records/:id/close          final_return
// Les règles métier restent celles de state-store.js (historiques immuables, estampillage serveur, statut dérivé, droits par champ) :
// chaque route construit la ligne proposée puis la fait valider par le même code que l'ancienne sauvegarde d'état complet.
// Le serveur écrit le journal, les tâches automatiques et les libellés de suivi, et incrémente la version globale de l'état.
const { lockRecord, saveRecord, loadTasks, saveTask, saveEvent } = require('./relational-store');
const { mergeStaffRecord, stampClientReturns, stampFinalHistory, workflowLabelsForRecord, createAutoReevaluationTasks, completeEvaluationTasks, hasClientScope } = require('./state-store');
const { filterStateForUser, recordAssignedTo, latestClientReturn, needsReevaluation } = require('./rbac');
const { fail, hasPermission, eventFor, makeTransaction, bumpStateVersion } = require('./api-common');

const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const PROMISE_LABELS = { PROMESSE_VALIDE: 'PROMESSE VALIDE', PROMESSE_NON_VALIDE: 'PROMESSE Non VALIDE' };
const DON_LABELS = { CONFORME: 'Don conforme', NON_CONFORME: 'Don non conforme' };
const FINAL_LABELS = { VALIDE: 'Valide', NON_VALIDE: 'Non valide' };
const EVALUATION_STAGES = ['internal1', 'internal2'];
const invalid = message => fail(400, 'RECORD_INVALID', message);
const text = (value, max, label) => { const out = String(value ?? '').trim(); if (out.length > max) throw invalid(`${label} est limité à ${max} caractères.`); return out; };

// ---- Validation des corps de requête (fonctions pures).
function parseEvaluationBody(body) {
  const stage = String(body?.stage ?? '');
  if (!EVALUATION_STAGES.includes(stage)) throw invalid('Étape d’évaluation inconnue (internal1 ou internal2).');
  const input = isPlainObject(body.evaluation) ? body.evaluation : null;
  if (!input) throw invalid('Évaluation manquante.');
  if (stage === 'internal2') {
    const analysisPoleQualite = text(input.analysisPoleQualite, 4000, 'L’analyse');
    const promiseStatus = String(input.promiseStatus ?? ''); const donConformity = String(input.donConformity ?? '');
    if (!analysisPoleQualite || !PROMISE_LABELS[promiseStatus] || !DON_LABELS[donConformity]) throw invalid('Renseignez l’analyse du Pôle qualité, le statut de la promesse et la conformité du don.');
    return { stage, evaluation: { score: null, conformity: donConformity, decision: promiseStatus, finalStatus: promiseStatus, donStatus: donConformity, promiseStatus, donConformity, analysisPoleQualite, answers: {}, answerComments: {}, criteriaSnapshot: [], templateVersion: 1 } };
  }
  const answers = input.answers ?? {}; const answerComments = input.answerComments ?? {};
  if (!isPlainObject(answers) || !isPlainObject(answerComments)) throw invalid('Réponses d’évaluation invalides.');
  for (const [key, value] of Object.entries(answers)) if (value === 'X' && !String(answerComments[key] ?? '').trim()) throw invalid('Ajoutez une justification pour chaque réponse X.');
  const score = input.score == null || input.score === '' ? null : Number(input.score);
  if (score !== null && (!Number.isFinite(score) || score < 0 || score > 100)) throw invalid('Le score doit être compris entre 0 et 100.');
  const amount = input.amount == null || input.amount === '' ? null : Number(input.amount);
  if (amount !== null && (!Number.isFinite(amount) || amount < 0 || amount > 1e9)) throw invalid('Le montant doit être un nombre positif.');
  const snapshot = input.criteriaSnapshot ?? [];
  if (!Array.isArray(snapshot) || snapshot.length > 300) throw invalid('Grille d’évaluation invalide.');
  const finalStatus = text(input.finalStatus, 100, 'Le statut final'); const donStatus = text(input.donStatus, 100, 'Le statut du don');
  const remark = text(input.remark, 4000, 'La remarque');
  return { stage, evaluation: { score, conformity: donStatus, decision: finalStatus, finalStatus, donStatus, amount, cancelReason: text(input.cancelReason, 1000, 'Le motif'), remark, comments: remark, observations: text(input.observations, 4000, 'Les observations'), answers, answerComments, criteriaSnapshot: snapshot, templateVersion: 1 } };
}
function parseClientReturnBody(body) {
  const input = isPlainObject(body) ? body : {};
  const finalStatus = String(input.finalStatus ?? '').toUpperCase();
  if (!['DAM', 'INDECIS'].includes(finalStatus) || typeof input.alreadyDonor !== 'boolean') throw invalid('Choisissez le Statut final (DAM ou Indécis) et Déjà donateur (Oui ou Non).');
  let receivedAt = null;
  if (input.receivedAt) { const parsed = new Date(input.receivedAt); if (Number.isNaN(parsed.getTime())) throw invalid('La date de réception est invalide.'); receivedAt = parsed.toISOString(); }
  return { finalStatus, alreadyDonor: input.alreadyDonor, receivedAt, clientRemarks: text(input.clientRemarks, 4000, 'La remarque'), baseSnapshot: text(input.baseSnapshot, 300, 'Le nom de base'), recordIndexSnapshot: text(input.recordIndexSnapshot, 300, 'L’indice'), call1Status: text(input.call1Status, 300, 'Le statut Call 1') };
}
function parseFinalReturnBody(body) {
  const status = String(body?.status ?? '').toUpperCase();
  if (!FINAL_LABELS[status]) throw invalid('Choisissez Valide ou Non valide.');
  return { status };
}
function parseLabelsBody(body) {
  if (!Array.isArray(body?.labelIds) || body.labelIds.length > 200 || body.labelIds.some(id => typeof id !== 'string' || !id || id.length > 100)) throw invalid('Liste de libellés invalide.');
  return { labelIds: [...new Set(body.labelIds)] };
}
const canCloseRecord = record => !!(record?.internal1 && (record.clientReturns || []).length && record.internal2 && !needsReevaluation(record) && !record.closedAt);

// Ligne proposée à la validation : la fiche actuelle + les changements demandés. L'historique des évaluations est dérivé par le serveur
// (jamais proposé), sinon un profil qui ne voit pas toutes les étapes se verrait refuser une copie complète.
const proposed = (old, changes) => { const { evaluationHistory, ...row } = old; return { ...row, ...changes }; };

// ---- Plans de changement (purs) : renvoient la fiche suivante et les lignes de journal.
function planEvaluation(old, parsed, auth, catalog) {
  const { stage, evaluation } = parsed;
  const base = { ...old };
  if (stage === 'internal2' && old.internal2 && old.responseSentAt) base.internal2 = { ...old.internal2, sharedWithClientAt: old.responseSentAt };
  const next = mergeStaffRecord(base, proposed(base, { [stage]: evaluation }), auth, catalog);
  const done = next[stage];
  const detail = stage === 'internal2'
    ? `Version ${done.version} · ${PROMISE_LABELS[done.promiseStatus]} · ${DON_LABELS[done.donConformity]} · ${done.analysisPoleQualite}`
    : `Version ${done.version} · ${done.score == null ? 'Score non calculé' : `${done.score} %`} · Don ${done.conformity} · ${done.finalStatus}`;
  return { next, events: [[stage === 'internal2' ? 'Réévaluation du Pôle qualité enregistrée' : 'Évaluation Synergy #1 terminée', detail]] };
}
function clientReturnEntry(parsed) {
  return { receivedAt: parsed.receivedAt || new Date().toISOString(), finalStatus: parsed.finalStatus, alreadyDonor: parsed.alreadyDonor, clientRemarks: parsed.clientRemarks, baseSnapshot: parsed.baseSnapshot, recordIndexSnapshot: parsed.recordIndexSnapshot, call1Status: parsed.call1Status };
}
function planClientReturn(old, parsed, auth, catalog, { portal = false } = {}) {
  const entry = clientReturnEntry(parsed);
  let next;
  if (portal) {
    if (!hasPermission(auth, 'client_returns')) throw fail(403, 'PERMISSION_DENIED', 'Permission insuffisante pour saisir les retours client.', { missingPermissions: ['client_returns'] });
    next = { ...old, clientReturns: stampClientReturns(old.clientReturns, [...(old.clientReturns || []), entry], old, auth, true) };
    next.client1 = old.client1 || next.clientReturns[0]; next.status = 'retour_client_recu';
    if (old.closedAt) { next.closedAt = null; next.closedBy = null; }
  } else next = mergeStaffRecord(old, proposed(old, { clientReturns: [...(old.clientReturns || []), entry] }), auth, catalog);
  const added = next.clientReturns.at(-1);
  const events = [[`Retour client #${added.returnNumber} enregistré`, `${added.baseSnapshot || '—'} / ${added.recordIndexSnapshot || '—'} · Statut Call 1 : ${added.call1Status || '—'} · ${added.finalStatus} · Déjà donateur : ${added.alreadyDonor ? 'Oui' : 'Non'}${added.clientRemarks ? ` · ${added.clientRemarks}` : ''}`]];
  if (old.closedAt) events.unshift(['Dossier rouvert', `Nouveau retour client #${added.returnNumber} reçu après clôture.`]);
  return { next, events };
}
function planFinalReturn(old, parsed, auth, catalog, { portal = false } = {}) {
  const entry = { status: parsed.status };
  let next;
  if (portal) {
    if (!hasPermission(auth, 'final_return')) throw fail(403, 'PERMISSION_DENIED', 'Permission insuffisante pour saisir le retour final.', { missingPermissions: ['final_return'] });
    next = { ...old, finalReturnHistory: stampFinalHistory(old.finalReturnHistory, [...(old.finalReturnHistory || []), entry], auth) };
    next.finalReturn = next.finalReturnHistory.at(-1); next.clientFinal = next.finalReturn; next.status = 'retour_final_recu';
  } else next = mergeStaffRecord(old, proposed(old, { finalReturnHistory: [...(old.finalReturnHistory || []), entry] }), auth, catalog);
  const added = next.finalReturnHistory.at(-1);
  return { next, events: [['Retour final enregistré', `Version ${added.version} · ${FINAL_LABELS[added.status]}`]] };
}
function planLabels(old, parsed, auth, catalog) {
  const known = new Set((catalog || []).map(label => String(label.id)));
  const unknown = parsed.labelIds.filter(id => !known.has(id));
  if (unknown.length) throw invalid(`Libellé(s) inconnu(s) : ${unknown.join(', ')}.`);
  const next = mergeStaffRecord(old, proposed(old, { labels: parsed.labelIds }), auth, catalog);
  const names = next.labels.map(id => catalog.find(label => String(label.id) === String(id))?.name).filter(Boolean).join(', ');
  return { next, events: [['Libellés mis à jour', names || 'Aucun libellé']] };
}
function planClose(old, auth, catalog) {
  if (!canCloseRecord(old)) throw fail(409, 'RECORD_NOT_CLOSABLE', 'La fiche doit avoir au moins un retour client et une réévaluation postérieure au dernier retour avant clôture.');
  const next = mergeStaffRecord(old, proposed(old, { closedAt: new Date().toISOString(), closedBy: auth.fullName || 'Utilisateur', status: 'cloture' }), auth, catalog);
  return { next, events: [['Dossier clôturé', `Après la réévaluation · dernier retour client #${Number(latestClientReturn(old)?.returnNumber) || 1}`]] };
}

function registerRecordWorkflowRoutes(app, { pool, requireAuth, requireReadyPassword, requireAnyPermission, requirePermission, audit }) {
  const inTransaction = makeTransaction(pool);
  const base = [requireAuth, requireReadyPassword];
  const sentToClient = async (db, id) => (await db.query(`select (r.sent_to_client_at is not null
      or exists(select 1 from public.crm_record_send_history h where h.record_id=r.id)
      or exists(select 1 from public.crm_batch_records br join public.crm_batches b on b.id=br.batch_id where br.record_id=r.id and (b.ftp_uploaded_at is not null or b.sent_at is not null))) as sent
      from public.crm_records r where r.id=$1`, [id])).rows[0]?.sent === true;
  const loadCatalog = async db => { const found = await db.query("select data->'labels' as labels from public.crm_state where id='main'"); return Array.isArray(found.rows[0]?.labels) ? found.rows[0].labels : []; };

  // Cœur commun : verrou, portée, plan, enregistrement de la fiche, libellés de suivi, tâches automatiques, journal, audit.
  async function run(req, action, { portalAllowed = false, plan }) {
    return inTransaction(async db => {
      const stateVersion = await bumpStateVersion(db, req.auth);
      const old = await lockRecord(db, String(req.params.id));
      if (!old) throw fail(404, 'RECORD_NOT_FOUND', 'Fiche introuvable.');
      const portal = hasClientScope(req.auth);
      if (portal) {
        if (!portalAllowed) throw fail(403, 'PERMISSION_DENIED', 'Cette action n’est pas disponible pour un profil client.');
        if ( !hasPermission(req.auth, 'portal') || !(req.auth.clientIds || []).map(String).includes(String(old.clientId || '')) || old.archived || !(await sentToClient(db, old.id))) throw fail(404, 'RECORD_NOT_FOUND', 'Fiche introuvable.');
      } else if (!hasPermission(req.auth, 'records_view_all') && !recordAssignedTo(old, req.auth)) throw fail(403, 'SCOPE_DENIED', 'Cette fiche n’est pas affectée à votre compte.');
      if (old.archived) throw fail(409, 'RECORD_ARCHIVED', 'Cette fiche est supprimée : restaurez-la avant de la modifier.');
      const catalog = await loadCatalog(db);
      const { next, events: lines } = plan(old, { catalog, portal });
      // libellés de suivi (Retour client, Réévaluation, Retour final) : ajoutés à la fiche et, s'ils manquent, au catalogue
      const workflow = workflowLabelsForRecord(next, catalog);
      next.labels = [...new Set([...(Array.isArray(next.labels) ? next.labels : []), ...workflow.map(label => label.id)])];
      const addedLabels = workflow.filter(label => !catalog.some(item => String(item.id) === label.id));
      if (addedLabels.length) await db.query("update public.crm_state set data=jsonb_set(data,'{labels}',$1::jsonb,true) where id='main'", [JSON.stringify([...catalog, ...addedLabels])]);
      await saveRecord(db, next);
      const stored = await lockRecord(db, old.id);
      const before = { records: [old] };
      const after = { records: [next], tasks: await loadTasks(db, { recordId: old.id, archived: false }) };
      const taskBefore = JSON.stringify(after.tasks);
      completeEvaluationTasks(before, after); createAutoReevaluationTasks(before, after);
      const previousById = new Map(JSON.parse(taskBefore).map(task => [task.id, JSON.stringify(task)]));
      const tasks = after.tasks.filter(task => previousById.get(task.id) !== JSON.stringify(task));
      for (const task of tasks) await saveTask(db, task);
      const events = lines.map(([title, detail]) => eventFor(old.id, title, detail, req.auth));
      for (const event of events) await saveEvent(db, event);
      await audit(req.auth.id, action, 'record', old.id, {}, req.get('x-request-id'), db);
      // le portail client ne voit pas les mêmes champs que le personnel : la réponse suit les mêmes règles que la lecture de l'état
      const batches = portal ? [{ clientId: stored.clientId, recordIds: [stored.id], sentAt: 'oui' }] : [];
      const record = filterStateForUser({ records: [stored], batches }, req.auth).records[0] || null;
      return { record, tasks: portal ? [] : tasks, events: portal ? [] : events, labels: portal ? [] : addedLabels, stateVersion };
    });
  }

  app.post('/quality/api/records/:id/evaluations', ...base, requireAnyPermission(['synergy1', 'reevaluation']), async (req, res) => {
    const parsed = parseEvaluationBody(req.body);
    const needed = parsed.stage === 'internal1' ? 'synergy1' : 'reevaluation';
    if (!hasPermission(req.auth, needed)) throw fail(403, 'PERMISSION_DENIED', `Permission insuffisante pour enregistrer cette évaluation : ${needed} requise.`, { missingPermissions: [needed] });
    res.status(201).json(await run(req, 'record.evaluated', { plan: (old, ctx) => planEvaluation(old, parsed, req.auth, ctx.catalog) }));
  });
  app.post('/quality/api/records/:id/client-returns', ...base, requirePermission('client_returns'), async (req, res) => {
    const parsed = parseClientReturnBody(req.body);
    res.status(201).json(await run(req, 'record.client_return', { portalAllowed: true, plan: (old, ctx) => planClientReturn(old, parsed, req.auth, ctx.catalog, { portal: ctx.portal }) }));
  });
  app.post('/quality/api/records/:id/final-returns', ...base, requirePermission('final_return'), async (req, res) => {
    const parsed = parseFinalReturnBody(req.body);
    res.status(201).json(await run(req, 'record.final_return', { portalAllowed: true, plan: (old, ctx) => planFinalReturn(old, parsed, req.auth, ctx.catalog, { portal: ctx.portal }) }));
  });
  app.put('/quality/api/records/:id/labels', ...base, requirePermission('records_manage'), async (req, res) => {
    const parsed = parseLabelsBody(req.body);
    res.json(await run(req, 'record.labels', { plan: (old, ctx) => planLabels(old, parsed, req.auth, ctx.catalog) }));
  });
  app.post('/quality/api/records/:id/close', ...base, requirePermission('final_return'), async (req, res) => {
    res.json(await run(req, 'record.closed', { plan: (old, ctx) => planClose(old, req.auth, ctx.catalog) }));
  });
}

module.exports = { registerRecordWorkflowRoutes, parseEvaluationBody, parseClientReturnBody, parseFinalReturnBody, parseLabelsBody, planEvaluation, planClientReturn, planFinalReturn, planLabels, planClose, canCloseRecord };
