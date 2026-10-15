'use strict';
// Accès SQL aux agents (table public.crm_agents). Le matricule est la clé primaire.
const SELECT_AGENTS="select matricule as id,name,team,coalesce(to_char(since,'YYYY-MM-DD'),'') as since,initials from public.crm_agents order by lower(name),matricule";

async function loadAgents(db){
  const result=await db.query(SELECT_AGENTS);
  return result.rows;
}

module.exports={loadAgents};
