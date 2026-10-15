'use strict';
// Menu « Tâches » : routes dédiées (liste, création, modification, archivage, restauration). Chaque route n'écrit que sa propre
// ligne (+ les événements du journal de la fiche liée) dans une transaction, avec ses propres droits et sa propre portée.
//   GET    /quality/api/tasks?view=active|archived    tasks (archived : tasks_manage)
//   POST   /quality/api/tasks                          tasks
//   PATCH  /quality/api/tasks/:id                      tasks (statut) / tasks_manage (contenu)
//   POST   /quality/api/tasks/:id/archive|restore      tasks_manage
const crypto = require('node:crypto');
const { loadTasks, lockTask, saveTask, saveEvent } = require('./relational-store');
const { taskAssignedTo, recordAssignedTo } = require('./rbac');
const { fail, hasPermission, isRealDate, eventFor, displayTitle, makeTransaction } = require('./api-common');

const TASK_TYPES = ['EVALUATION_1', 'CONTROLE', 'RETOUR_CLIENT', 'REEVALUATION_2', 'REPONSE_CLIENT', 'DEBRIEF', 'SUIVI_AGENT'];
const TASK_PRIORITIES = ['BASSE', 'NORMALE', 'HAUTE', 'URGENTE'];
const TASK_STATUSES = ['A_FAIRE', 'EN_COURS', 'TERMINE'];
const CONTENT_FIELDS = ['title', 'type', 'recordId', 'assignedToId', 'priority', 'dueDate'];
const AUTO_ASSIGNEE = 'À assigner';

// Valide les champs présents dans `body`. Renvoie les valeurs nettoyées (seulement les clés fournies).
function parseTaskBody(body, { creating = false, currentType } = {}) {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const values = {};
  if ('title' in input || creating) {
    const title = String(input.title ?? '').trim();
    if (!title) throw fail(400, 'TASK_INVALID', 'L’intitulé de la tâche est obligatoire.');
    if (title.length > 200) throw fail(400, 'TASK_INVALID', 'L’intitulé de la tâche est limité à 200 caractères.');
    values.title = title;
  }
  if ('type' in input || creating) {
    const type = String(input.type ?? '');
    if (!TASK_TYPES.includes(type) && !(currentType && type === currentType)) throw fail(400, 'TASK_INVALID', 'Type de tâche invalide.');
    values.type = type;
  }
  if ('priority' in input || creating) {
    const priority = String(input.priority ?? 'NORMALE');
    if (!TASK_PRIORITIES.includes(priority)) throw fail(400, 'TASK_INVALID', 'Priorité de tâche invalide.');
    values.priority = priority;
  }
  if ('dueDate' in input || creating) {
    if (!isRealDate(input.dueDate)) throw fail(400, 'TASK_INVALID', 'L’échéance doit être une date valide (AAAA-MM-JJ).');
    values.dueDate = String(input.dueDate);
  }
  if ('recordId' in input) values.recordId = input.recordId ? String(input.recordId) : null;
  if ('assignedToId' in input) values.assignedToId = input.assignedToId ? String(input.assignedToId) : '';
  if ('status' in input) {
    const status = String(input.status);
    if (!TASK_STATUSES.includes(status)) throw fail(400, 'TASK_INVALID', 'Statut de tâche invalide.');
    values.status = status;
  }
  const unknown = Object.keys(input).filter(key => ![...CONTENT_FIELDS, 'status'].includes(key));
  if (unknown.length) throw fail(400, 'TASK_INVALID', `Champ(s) non modifiable(s) : ${unknown.join(', ')}.`);
  return values;
}

// Compare les valeurs demandées à la tâche actuelle : renvoie les vrais changements et les droits requis.
function planTaskChange(current, values) {
  const changes = {};
  for (const key of Object.keys(values)) {
    const before = key === 'recordId' ? (current.recordId ?? null) : key === 'assignedToId' ? (current.assignedToId || '') : current[key];
    if (String(before ?? '') !== String(values[key] ?? '')) changes[key] = values[key];
  }
  const needsManage = CONTENT_FIELDS.some(key => key in changes);
  return { changes, needsManage, statusChanged: 'status' in changes };
}

function registerTaskRoutes(app, { pool, requireAuth, requireReadyPassword, requirePermission, assignableUsers, audit }) {
  const guard = [requireAuth, requireReadyPassword, requirePermission('tasks')];
  const visible = (task, auth) => hasPermission(auth, 'records_view_all') || taskAssignedTo(task, auth);

  async function resolveAssignee(db, assignedToId) {
    if (!assignedToId) return { name: AUTO_ASSIGNEE, id: '' };
    const user = (await assignableUsers(db)).find(item => item.id === assignedToId);
    if (!user) throw fail(400, 'ASSIGNEE_INVALID', 'L’assigné doit être un utilisateur actif avec le rôle Qualiticien ou Responsable qualité.');
    return { name: user.name, id: user.id };
  }
  async function checkRecord(db, recordId, auth) {
    if (!recordId) return null;
    const found = await db.query('select id,responsible,responsible_id as "responsibleId" from public.crm_records where id=$1', [recordId]);
    if (!found.rows.length) throw fail(400, 'TASK_RECORD_UNKNOWN', `La fiche ${recordId} n’existe pas.`);
    if (!hasPermission(auth, 'records_view_all') && !recordAssignedTo(found.rows[0], auth)) throw fail(403, 'SCOPE_DENIED', 'Cette fiche n’est pas affectée à votre compte.');
    return found.rows[0];
  }
  const inTransaction = makeTransaction(pool);

  app.get('/quality/api/tasks', ...guard, async (req, res) => {
    const view = String(req.query.view || 'active');
    if (!['active', 'archived'].includes(view)) throw fail(400, 'TASK_INVALID', 'Vue inconnue.');
    if (view === 'archived' && !hasPermission(req.auth, 'tasks_manage')) throw fail(403, 'PERMISSION_DENIED', 'Permission requise : tasks_manage.', { missingPermissions: ['tasks_manage'] });
    const tasks = (await loadTasks(pool, { archived: view === 'archived' })).filter(task => visible(task, req.auth));
    res.set('Cache-Control', 'private, no-store'); res.json({ tasks });
  });

  app.post('/quality/api/tasks', ...guard, async (req, res) => {
    const values = parseTaskBody(req.body, { creating: true });
    if ('status' in (req.body || {}) || 'archived' in (req.body || {})) throw fail(400, 'TASK_INVALID', 'Une nouvelle tâche démarre « À faire ».');
    const out = await inTransaction(async db => {
      await checkRecord(db, values.recordId, req.auth);
      const assignee = await resolveAssignee(db, values.assignedToId);
      const task = { id: `task-${crypto.randomUUID()}`, type: values.type, title: values.title, assignedTo: assignee.name, assignedToId: assignee.id, priority: values.priority, createdAt: new Date().toISOString(), dueDate: values.dueDate, status: 'A_FAIRE' };
      if (values.recordId) task.recordId = values.recordId;
      await saveTask(db, task);
      const events = [];
      if (task.recordId) { const event = eventFor(task.recordId, 'Tâche créée', `${task.title} · échéance ${task.dueDate}`, req.auth); await saveEvent(db, event); events.push(event); }
      await audit(req.auth.id, 'task.created', 'task', task.id, { title: task.title, assignedToId: assignee.id }, req.get('x-request-id'), db);
      return { task, events };
    });
    res.status(201).json(out);
  });

  app.patch('/quality/api/tasks/:id', ...guard, async (req, res) => {
    const out = await inTransaction(async db => {
      const current = await lockTask(db, String(req.params.id));
      if (!current) throw fail(404, 'TASK_NOT_FOUND', 'Tâche introuvable.');
      if (!visible(current, req.auth)) throw fail(403, 'SCOPE_DENIED', 'Cette tâche n’est pas assignée à votre compte.');
      if (current.archived) throw fail(409, 'TASK_ARCHIVED', 'Cette tâche est supprimée : restaurez-la avant de la modifier.');
      const values = parseTaskBody(req.body, { currentType: current.type });
      const plan = planTaskChange(current, values);
      if (plan.needsManage && !hasPermission(req.auth, 'tasks_manage')) throw fail(403, 'PERMISSION_DENIED', 'Permission insuffisante pour modifier cette tâche : tasks_manage requise.', { missingPermissions: ['tasks_manage'] });
      const { changes } = plan;
      if (!Object.keys(changes).length) return { task: current, events: [] };
      if ('recordId' in changes) await checkRecord(db, changes.recordId, req.auth);
      const next = { ...current };
      for (const key of ['title', 'type', 'priority', 'dueDate']) if (key in changes) next[key] = changes[key];
      if ('recordId' in changes) { if (changes.recordId) next.recordId = changes.recordId; else delete next.recordId; }
      if ('assignedToId' in changes) { const assignee = await resolveAssignee(db, changes.assignedToId); next.assignedTo = assignee.name; next.assignedToId = assignee.id; }
      if (plan.statusChanged) { next.status = changes.status; if (changes.status === 'TERMINE') next.completedAt = new Date().toISOString(); else delete next.completedAt; }
      await saveTask(db, next);
      const events = [];
      const recordId = next.recordId || current.recordId;
      if (recordId) {
        if (plan.statusChanged && next.status === 'TERMINE') events.push(eventFor(recordId, 'Tâche terminée', displayTitle(next.title), req.auth));
        if (plan.needsManage) events.push(eventFor(recordId, 'Tâche modifiée', `${displayTitle(current.title)} → ${displayTitle(next.title)} · ${next.assignedTo || AUTO_ASSIGNEE} · ${next.dueDate}`, req.auth));
        for (const event of events) await saveEvent(db, event);
      }
      await audit(req.auth.id, 'task.updated', 'task', next.id, { fields: Object.keys(changes) }, req.get('x-request-id'), db);
      return { task: next, events };
    });
    res.json(out);
  });

  const setArchived = archived => async (req, res) => {
    if (!hasPermission(req.auth, 'tasks_manage')) throw fail(403, 'PERMISSION_DENIED', 'Permission requise : tasks_manage.', { missingPermissions: ['tasks_manage'] });
    const out = await inTransaction(async db => {
      const current = await lockTask(db, String(req.params.id));
      if (!current) throw fail(404, 'TASK_NOT_FOUND', 'Tâche introuvable.');
      if (Boolean(current.archived) === archived) return { task: current, events: [] };
      const next = { ...current };
      if (archived) { next.archived = true; next.archivedAt = new Date().toISOString(); next.archivedBy = req.auth.fullName || 'Utilisateur'; }
      else { delete next.archived; next.archivedAt = null; next.archivedBy = null; }
      await saveTask(db, next);
      const events = [];
      if (next.recordId) { const event = eventFor(next.recordId, archived ? 'Tâche supprimée (archivée)' : 'Tâche restaurée', displayTitle(next.title), req.auth); await saveEvent(db, event); events.push(event); }
      await audit(req.auth.id, archived ? 'task.archived' : 'task.restored', 'task', next.id, {}, req.get('x-request-id'), db);
      return { task: next, events };
    });
    res.json(out);
  };
  app.post('/quality/api/tasks/:id/archive', ...guard, setArchived(true));
  app.post('/quality/api/tasks/:id/restore', ...guard, setArchived(false));
}

module.exports = { registerTaskRoutes, parseTaskBody, planTaskChange, TASK_TYPES, TASK_PRIORITIES, TASK_STATUSES };
