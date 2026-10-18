'use strict';
// Paramètres › grilles d'évaluation et groupes d'options. Routes dédiées (permission quality_settings) :
//   GET    /quality/api/grids                       { criteriaByStage, optionGroups }
//   POST   /quality/api/option-groups               { name, options:[{label,points}] }
//   PATCH  /quality/api/option-groups/:id           { name, options }
//   DELETE /quality/api/option-groups/:id           refusé tant qu'un critère l'utilise
//   POST   /quality/api/criteria                    { stage, section, label, type, description, weight, groupId }
//   DELETE /quality/api/criteria/:id
// Le serveur attribue les identifiants et les positions; un critère « liste » ou « cases à cocher » embarque une copie
// (nom + options) de son groupe au moment de sa création : modifier le groupe ensuite ne change pas les critères existants.
const crypto = require('node:crypto');
const { loadGrids, saveOptionGroup, saveCriterion, deleteCriterionRow, deleteOptionGroupRow } = require('./relational-store');
const { fail, makeTransaction, bumpStateVersion } = require('./api-common');

const STAGES = ['internal1', 'client1', 'internal2', 'clientFinal'];
const CRITERION_TYPES = ['ok_x', 'conformity', 'scale', 'select', 'checkbox', 'text'];
const LIST_TYPES = ['select', 'checkbox'];
const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const invalid = message => fail(400, 'GRID_INVALID', message);
const shortText = (value, max, label, required = false) => {
  const out = String(value ?? '').trim();
  if (required && !out) throw invalid(`${label} est obligatoire.`);
  if (out.length > max) throw invalid(`${label} est limité à ${max} caractères.`);
  return out;
};

function parseGroupBody(body, { partial = false } = {}) {
  const input = isPlainObject(body) ? body : {};
  const unknown = Object.keys(input).filter(key => !['name', 'options'].includes(key));
  if (unknown.length) throw invalid(`Champ(s) non autorisé(s) : ${unknown.join(', ')}.`);
  const values = {};
  if ('name' in input || !partial) values.name = shortText(input.name, 120, 'Le nom du groupe', true);
  if ('options' in input || !partial) {
    if (!Array.isArray(input.options) || !input.options.length) throw invalid('Ajoutez au moins une option.');
    if (input.options.length > 100) throw invalid('Un groupe est limité à 100 options.');
    const seen = new Set();
    values.options = input.options.map(raw => {
      const label = shortText(raw?.label, 200, 'Le libellé d’une option', true);
      const points = raw?.points === undefined || raw?.points === null || raw?.points === '' ? 100 : Number(raw.points);
      if (!Number.isFinite(points) || points < 0 || points > 100) throw invalid(`Option invalide : « ${label} ». Les points doivent être compris entre 0 et 100.`);
      if (seen.has(label.toLowerCase())) throw invalid(`Option en double : « ${label} ».`);
      seen.add(label.toLowerCase());
      return { label, points };
    });
  }
  return values;
}
function parseCriterionBody(body) {
  const input = isPlainObject(body) ? body : {};
  const unknown = Object.keys(input).filter(key => !['stage', 'section', 'label', 'type', 'description', 'weight', 'groupId', 'scaleSize'].includes(key));
  if (unknown.length) throw invalid(`Champ(s) non autorisé(s) : ${unknown.join(', ')}.`);
  const stage = String(input.stage ?? '');
  if (!STAGES.includes(stage)) throw invalid('Étape de grille inconnue.');
  const type = String(input.type ?? '');
  if (!CRITERION_TYPES.includes(type)) throw invalid('Type de critère inconnu.');
  const weight = input.weight === undefined || input.weight === null || input.weight === '' ? 1 : Number(input.weight);
  // Poids -1 = négation (une réponse OK retire un point) ; sinon un nombre positif.
  if (!Number.isFinite(weight) || (weight !== -1 && weight <= 0) || weight > 1000) throw invalid('Le poids doit être un nombre positif, ou -1 pour une négation.');
  // Taille de l'échelle (type « scale ») : la réponse v vaut v / taille.
  const scaleSize = input.scaleSize === undefined || input.scaleSize === null || input.scaleSize === '' ? 5 : Number(input.scaleSize);
  if (type === 'scale' && (!Number.isInteger(scaleSize) || scaleSize < 2 || scaleSize > 10)) throw invalid('La taille de l’échelle doit être un entier de 2 à 10.');
  const groupId = String(input.groupId ?? '').trim();
  if (LIST_TYPES.includes(type) && !groupId) throw invalid('Choisissez un groupe d’options pour ce type de réponse.');
  return { stage, type, weight, ...(type === 'scale' ? { scaleSize } : {}), section: shortText(input.section, 200, 'La section'), label: shortText(input.label, 300, 'Le libellé du critère', true), description: shortText(input.description, 1000, 'La description'), groupId: LIST_TYPES.includes(type) ? groupId : '' };
}
// Construit le groupe à enregistrer (identifiants d'options conservés quand le libellé existe déjà).
function buildGroup(id, values, previous) {
  const known = new Map((previous?.options || []).map(option => [option.label, option.id]));
  return { id, name: values.name ?? previous.name, options: (values.options ?? previous.options).map(option => ({ id: known.get(option.label) || `opt-${crypto.randomUUID()}`, label: option.label, points: option.points ?? 100 })) };
}
function buildCriterion(values, group) {
  const criterion = { id: `crit-${crypto.randomUUID()}`, section: values.section, label: values.label, type: values.type, description: values.description, weight: values.weight };
  if (values.type === 'scale') criterion.scaleSize = values.scaleSize;
  if (LIST_TYPES.includes(values.type)) Object.assign(criterion, { groupId: group.id, groupName: group.name, options: group.options.map(option => ({ ...option })) });
  return criterion;
}

function registerGridRoutes(app, { pool, requireAuth, requireReadyPassword, requirePermission, audit }) {
  const guard = [requireAuth, requireReadyPassword, requirePermission('quality_settings')];
  const inTransaction = makeTransaction(pool);
  const nameTaken = async (db, name, exceptId) => (await db.query('select 1 from public.crm_option_groups where lower(name)=lower($1) and id<>$2', [name, exceptId || ''])).rows.length > 0;
  const findGroup = async (db, id) => (await loadGrids(db)).optionGroups.find(group => group.id === id) || null;

  app.get('/quality/api/grids', ...guard, async (req, res) => { res.set('Cache-Control', 'private, no-store'); res.json(await loadGrids(pool)); });

  app.post('/quality/api/option-groups', ...guard, async (req, res) => {
    const values = parseGroupBody(req.body);
    const out = await inTransaction(async db => {
      const stateVersion = await bumpStateVersion(db, req.auth);
      if (await nameTaken(db, values.name)) throw fail(409, 'GROUP_NAME_TAKEN', 'Un groupe porte déjà ce nom.');
      const group = buildGroup(`grp-${crypto.randomUUID()}`, values, null);
      await saveOptionGroup(db, group);
      await audit(req.auth.id, 'grid.group_created', 'option_group', group.id, { name: group.name }, req.get('x-request-id'), db);
      return { group, stateVersion };
    });
    res.status(201).json(out);
  });
  app.patch('/quality/api/option-groups/:id', ...guard, async (req, res) => {
    const values = parseGroupBody(req.body, { partial: true });
    const out = await inTransaction(async db => {
      const stateVersion = await bumpStateVersion(db, req.auth);
      const previous = await findGroup(db, String(req.params.id));
      if (!previous) throw fail(404, 'GROUP_NOT_FOUND', 'Groupe introuvable.');
      if (values.name && await nameTaken(db, values.name, previous.id)) throw fail(409, 'GROUP_NAME_TAKEN', 'Un groupe porte déjà ce nom.');
      const group = buildGroup(previous.id, values, previous);
      await saveOptionGroup(db, group);
      await audit(req.auth.id, 'grid.group_updated', 'option_group', group.id, { name: group.name }, req.get('x-request-id'), db);
      return { group, stateVersion };
    });
    res.json(out);
  });
  app.delete('/quality/api/option-groups/:id', ...guard, async (req, res) => {
    const out = await inTransaction(async db => {
      const stateVersion = await bumpStateVersion(db, req.auth);
      const grids = await loadGrids(db);
      const group = grids.optionGroups.find(item => item.id === String(req.params.id));
      if (!group) throw fail(404, 'GROUP_NOT_FOUND', 'Groupe introuvable.');
      const used = Object.values(grids.criteriaByStage).flat().filter(criterion => criterion.groupId === group.id).length;
      if (used) throw fail(409, 'GROUP_IN_USE', `Ce groupe est utilisé par ${used} critère${used === 1 ? '' : 's'} et ne peut pas être supprimé.`);
      await deleteOptionGroupRow(db, group.id);
      await audit(req.auth.id, 'grid.group_deleted', 'option_group', group.id, { name: group.name }, req.get('x-request-id'), db);
      return { id: group.id, stateVersion };
    });
    res.json(out);
  });

  app.post('/quality/api/criteria', ...guard, async (req, res) => {
    const values = parseCriterionBody(req.body);
    const out = await inTransaction(async db => {
      const stateVersion = await bumpStateVersion(db, req.auth);
      let group = null;
      if (values.groupId) { group = await findGroup(db, values.groupId); if (!group) throw invalid('Le groupe d’options choisi n’existe pas.'); }
      const criterion = buildCriterion(values, group);
      await saveCriterion(db, values.stage, criterion);
      await audit(req.auth.id, 'grid.criterion_created', 'criterion', criterion.id, { stage: values.stage, label: criterion.label }, req.get('x-request-id'), db);
      return { stage: values.stage, criterion, stateVersion };
    });
    res.status(201).json(out);
  });
  app.delete('/quality/api/criteria/:id', ...guard, async (req, res) => {
    const out = await inTransaction(async db => {
      const stateVersion = await bumpStateVersion(db, req.auth);
      const grids = await loadGrids(db);
      const stage = STAGES.find(name => (grids.criteriaByStage[name] || []).some(criterion => criterion.id === String(req.params.id)));
      if (!stage) throw fail(404, 'CRITERION_NOT_FOUND', 'Critère introuvable.');
      await deleteCriterionRow(db, String(req.params.id));
      await audit(req.auth.id, 'grid.criterion_deleted', 'criterion', String(req.params.id), { stage }, req.get('x-request-id'), db);
      return { id: String(req.params.id), stage, stateVersion };
    });
    res.json(out);
  });
}

module.exports = { registerGridRoutes, parseGroupBody, parseCriterionBody, buildGroup, buildCriterion };
