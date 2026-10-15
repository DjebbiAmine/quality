'use strict';
// Paramètres › agents (table crm_agents, matricule = clé primaire). Routes dédiées :
//   GET    /quality/api/agents                lecture
//   POST   /quality/api/agents                { id, name, team, since }                    records_manage ou quality_settings
//   PATCH  /quality/api/agents/:id            { name, team, since } (le matricule est immuable)
//   DELETE /quality/api/agents/:id            refusé tant que l'agent est lié à une fiche ou à un débrief actif
const { loadAgents } = require('./agents-store');
const { normalizeEmployeeCode, sameAgentIdentity } = require('./rbac');
const { fail, isRealDate, makeTransaction, bumpStateVersion } = require('./api-common');

const invalid = message => fail(400, 'AGENT_INVALID', message);
const agentInitials = name => { const words = String(name || '').trim().split(/\s+/).filter(Boolean); return ((words[0]?.[0] || '') + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase(); };
const keyOf = id => normalizeEmployeeCode(id) || String(id).toUpperCase();

function parseAgentBody(body, { creating = false } = {}) {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const allowed = creating ? ['id', 'name', 'team', 'since'] : ['name', 'team', 'since'];
  const unknown = Object.keys(input).filter(key => !allowed.includes(key));
  if (unknown.length) throw invalid(creating ? `Champ(s) non autorisé(s) : ${unknown.join(', ')}.` : `Champ(s) non modifiable(s) : ${unknown.join(', ')} (le matricule est la clé primaire).`);
  const values = {};
  if (creating) { const id = String(input.id ?? '').trim(); if (!id) throw invalid('Le matricule est obligatoire.'); if (id.length > 50) throw invalid('Le matricule est limité à 50 caractères.'); values.id = id; }
  if ('name' in input || creating) { const name = String(input.name ?? '').trim(); if (!name) throw invalid('Le nom est obligatoire.'); if (name.length > 200) throw invalid('Le nom est limité à 200 caractères.'); values.name = name; }
  if ('team' in input) { const team = String(input.team ?? '').trim(); if (team.length > 200) throw invalid('L’équipe est limitée à 200 caractères.'); values.team = team; }
  if ('since' in input) { const since = String(input.since ?? '').trim(); if (since && !isRealDate(since)) throw invalid('La date d’entrée doit être une date valide (AAAA-MM-JJ).'); values.since = since; }
  return values;
}
// Nombre de fiches et de débriefs actifs liés à un agent (même règle d'identité que le navigateur).
async function agentLinks(db, agent) {
  const records = (await db.query('select employee_code as "employeeCode",agent from public.crm_records')).rows.filter(row => sameAgentIdentity(agent.id, agent.name, row.employeeCode, row.agent)).length;
  const debriefs = (await db.query('select employee_code as "employeeCode",agent from public.crm_debriefs where not archived')).rows.filter(row => sameAgentIdentity(agent.id, agent.name, row.employeeCode, row.agent)).length;
  return { records, debriefs };
}

function registerAgentRoutes(app, { pool, requireAuth, requireReadyPassword, requireAnyPermission, audit }) {
  const guard = [requireAuth, requireReadyPassword, requireAnyPermission(['records_manage', 'quality_settings'])];
  const inTransaction = makeTransaction(pool);

  app.get('/quality/api/agents', requireAuth, requireReadyPassword, requireAnyPermission(['records_manage', 'quality_settings', 'agents', 'records_view']), async (req, res) => { res.set('Cache-Control', 'private, no-store'); res.json({ agents: await loadAgents(pool) }); });

  app.post('/quality/api/agents', ...guard, async (req, res) => {
    const values = parseAgentBody(req.body, { creating: true });
    const out = await inTransaction(async db => {
      const stateVersion = await bumpStateVersion(db, req.auth);
      const agents = await loadAgents(db);
      if (agents.some(agent => keyOf(agent.id) === keyOf(values.id))) throw fail(409, 'AGENT_DUPLICATE_ID', `Le matricule ${values.id} existe déjà : il identifie un seul agent.`);
      const agent = { id: values.id, name: values.name, team: values.team || '', since: values.since || '', initials: agentInitials(values.name) };
      try { await db.query('insert into public.crm_agents(matricule,name,team,since,initials,created_by,updated_by) values($1,$2,$3,$4,$5,$6,$6)', [agent.id, agent.name, agent.team, agent.since || null, agent.initials, req.auth.id]); }
      catch (error) { if (error.code === '23505') throw fail(409, 'AGENT_DUPLICATE_ID', 'Ce matricule existe déjà (clé primaire).'); throw error; }
      await audit(req.auth.id, 'agent.created', 'agent', agent.id, { name: agent.name }, req.get('x-request-id'), db);
      return { agent, stateVersion };
    });
    res.status(201).json(out);
  });
  app.patch('/quality/api/agents/:id', ...guard, async (req, res) => {
    const values = parseAgentBody(req.body);
    const out = await inTransaction(async db => {
      const stateVersion = await bumpStateVersion(db, req.auth);
      const current = (await loadAgents(db)).find(agent => agent.id === String(req.params.id));
      if (!current) throw fail(404, 'AGENT_NOT_FOUND', 'Agent introuvable.');
      const agent = { ...current, ...values }; agent.initials = agentInitials(agent.name);
      await db.query('update public.crm_agents set name=$2,team=$3,since=$4,initials=$5,updated_at=now(),updated_by=$6 where matricule=$1', [agent.id, agent.name, agent.team, agent.since || null, agent.initials, req.auth.id]);
      await audit(req.auth.id, 'agent.updated', 'agent', agent.id, { fields: Object.keys(values) }, req.get('x-request-id'), db);
      return { agent, stateVersion };
    });
    res.json(out);
  });
  app.delete('/quality/api/agents/:id', ...guard, async (req, res) => {
    const out = await inTransaction(async db => {
      const stateVersion = await bumpStateVersion(db, req.auth);
      const agent = (await loadAgents(db)).find(item => item.id === String(req.params.id));
      if (!agent) throw fail(404, 'AGENT_NOT_FOUND', 'Agent introuvable.');
      const links = await agentLinks(db, agent);
      if (links.records || links.debriefs) throw fail(409, 'AGENT_IN_USE', `L’agent ${agent.id} est lié à ${links.records} fiche(s) et ${links.debriefs} débrief(s) actif(s) et ne peut pas être supprimé.`);
      await db.query('delete from public.crm_agents where matricule=$1', [agent.id]);
      await audit(req.auth.id, 'agent.deleted', 'agent', agent.id, { name: agent.name }, req.get('x-request-id'), db);
      return { id: agent.id, stateVersion };
    });
    res.json(out);
  });
}

module.exports = { registerAgentRoutes, parseAgentBody, agentInitials };
