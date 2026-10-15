'use strict';
// Paramètres › libellés de suivi et dossier de stockage. Routes dédiées (permission quality_settings) :
//   POST   /quality/api/labels               { name, tone }
//   DELETE /quality/api/labels/:id           retire aussi le libellé des fiches; refusé pour les libellés du workflow
//   PUT    /quality/api/settings/drive       { driveFolderId }
// Le catalogue de libellés et le dossier vivent dans la ligne JSON `crm_state` (verrouillée par chaque route).
const crypto = require('node:crypto');
const { fail, makeTransaction, bumpStateVersion } = require('./api-common');

const TONES = ['blue', 'green', 'amber', 'red', 'purple'];
const WORKFLOW_LABELS = ['retour client', 'réévaluation', 'retour final'];
const invalid = message => fail(400, 'SETTINGS_INVALID', message);

function parseLabelBody(body) {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const unknown = Object.keys(input).filter(key => !['name', 'tone'].includes(key));
  if (unknown.length) throw invalid(`Champ(s) non autorisé(s) : ${unknown.join(', ')}.`);
  const name = String(input.name ?? '').trim();
  if (!name) throw invalid('Le nom du libellé est obligatoire.');
  if (name.length > 60) throw invalid('Le nom du libellé est limité à 60 caractères.');
  const tone = String(input.tone ?? 'blue');
  if (!TONES.includes(tone)) throw invalid('Couleur de libellé inconnue.');
  return { name, tone };
}
function parseDriveBody(body) {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  if (Object.keys(input).some(key => key !== 'driveFolderId')) throw invalid('Champ non autorisé.');
  const driveFolderId = String(input.driveFolderId ?? '').trim();
  if (driveFolderId.length > 200) throw invalid('L’identifiant du dossier est limité à 200 caractères.');
  return { driveFolderId, driveConnected: !!driveFolderId };
}
const isWorkflowLabel = label => WORKFLOW_LABELS.includes(String(label?.name || '').trim().toLowerCase());

function registerSettingsRoutes(app, { pool, requireAuth, requireReadyPassword, requirePermission, audit }) {
  const guard = [requireAuth, requireReadyPassword, requirePermission('quality_settings')];
  const inTransaction = makeTransaction(pool);
  const readData = async db => { const found = await db.query("select data from public.crm_state where id='main'"); return found.rows[0]?.data || {}; };
  const writeKeys = (db, patch) => db.query("update public.crm_state set data=data||$1::jsonb where id='main'", [JSON.stringify(patch)]);

  app.post('/quality/api/labels', ...guard, async (req, res) => {
    const values = parseLabelBody(req.body);
    const out = await inTransaction(async db => {
      const stateVersion = await bumpStateVersion(db, req.auth);
      const { labels: stored } = await readData(db); const labels = Array.isArray(stored) ? stored : [];
      if (labels.some(label => String(label.name || '').trim().toLowerCase() === values.name.toLowerCase())) throw fail(409, 'LABEL_EXISTS', 'Ce libellé existe déjà.');
      const label = { id: `lbl-${crypto.randomUUID()}`, name: values.name, tone: values.tone };
      await writeKeys(db, { labels: [...labels, label] });
      await audit(req.auth.id, 'settings.label_created', 'label', label.id, { name: label.name }, req.get('x-request-id'), db);
      return { label, stateVersion };
    });
    res.status(201).json(out);
  });
  app.delete('/quality/api/labels/:id', ...guard, async (req, res) => {
    const out = await inTransaction(async db => {
      const stateVersion = await bumpStateVersion(db, req.auth);
      const { labels: stored } = await readData(db); const labels = Array.isArray(stored) ? stored : [];
      const label = labels.find(item => String(item.id) === String(req.params.id));
      if (!label) throw fail(404, 'LABEL_NOT_FOUND', 'Libellé introuvable.');
      if (isWorkflowLabel(label)) throw fail(409, 'LABEL_REQUIRED', `Le libellé « ${label.name} » est requis par une étape du workflow.`);
      await writeKeys(db, { labels: labels.filter(item => item !== label) });
      const removed = await db.query('delete from public.crm_record_labels where label_id=$1 returning record_id', [label.id]);
      await audit(req.auth.id, 'settings.label_deleted', 'label', label.id, { name: label.name, records: removed.rows.length }, req.get('x-request-id'), db);
      return { id: label.id, recordIds: removed.rows.map(row => row.record_id), stateVersion };
    });
    res.json(out);
  });
  app.put('/quality/api/settings/drive', ...guard, async (req, res) => {
    const values = parseDriveBody(req.body);
    const out = await inTransaction(async db => {
      const stateVersion = await bumpStateVersion(db, req.auth);
      await writeKeys(db, values);
      await audit(req.auth.id, 'settings.drive_updated', 'settings', 'drive', { connected: values.driveConnected }, req.get('x-request-id'), db);
      return { ...values, stateVersion };
    });
    res.json(out);
  });
}

module.exports = { registerSettingsRoutes, parseLabelBody, parseDriveBody, isWorkflowLabel };
