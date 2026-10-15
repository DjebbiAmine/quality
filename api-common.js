'use strict';
// Outils communs aux routes dédiées (tâches, débriefs, fiches...) : erreurs, droits, dates, journal des fiches, transactions.
const crypto = require('node:crypto');

const fail = (status, code, message, extra) => Object.assign(new Error(message), { status, code, ...extra });
const hasPermission = (auth, code) => auth.permissions instanceof Set ? auth.permissions.has(code) : (auth.permissions || []).includes(code);
function isRealDate(value) {
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}
// Événement du journal d'une fiche, signé par l'utilisateur authentifié.
function eventFor(recordId, action, detail, auth) {
  return { id: `ev-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`, recordId, action, detail, actor: auth.fullName || 'Utilisateur', role: auth.roles?.[0]?.name || 'Utilisateur', at: new Date().toISOString() };
}
const displayTitle = title => String(title || '').replace(/\s*[—-]\s*QC-\d{4}-\d+.*$/, '').trim();
function makeTransaction(pool) {
  return async fn => {
    const db = await pool.connect();
    try { await db.query('begin'); const out = await fn(db); await db.query('commit'); return out; }
    catch (error) { await db.query('rollback').catch(() => {}); throw error; }
    finally { db.release(); }
  };
}
// Verrou global de l'état + incrément de version : sérialise avec la sauvegarde d'état complet et invalide les navigateurs périmés.
async function bumpStateVersion(db, auth) {
  const found = await db.query("select version from public.crm_state where id='main' for update");
  if (!found.rows.length) throw fail(404, 'STATE_NOT_INITIALIZED', 'La base CRM n’est pas encore initialisée.');
  const before = Number(found.rows[0].version);
  await db.query("update public.crm_state set version=version+1,updated_at=now(),updated_by=$1 where id='main'", [auth.id]);
  return { before, after: before + 1 };
}
module.exports = { fail, hasPermission, isRealDate, eventFor, displayTitle, makeTransaction, bumpStateVersion };
