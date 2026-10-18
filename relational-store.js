'use strict';
// Accès SQL relationnel aux fiches, événements, lots, tâches, débriefs et grilles d'évaluation (schéma local-db/relational.sql).
// Chaque entité est décrite par une liste de colonnes [clé de l'objet, colonne SQL, type, options]; tout champ non décrit est
// conservé tel quel dans la colonne `extra` (aucune perte). `loadRelational` recompose exactement les objets que l'application
// manipulait dans le document JSON, `persistRelational` applique les différences, `insertRelational` sert à la migration.

// ---------------------------------------------------------------- encodage / décodage
function parseTimestamp(value,ctx){
  if(value instanceof Date){if(Number.isNaN(value.getTime()))throw new Error(`Horodatage invalide (${ctx}).`);return value}
  const text=String(value).trim();
  let iso=text;
  if(/^\d{4}-\d{2}-\d{2}$/.test(text))iso=`${text}T00:00:00Z`;
  else if(!/(Z|[+-]\d{2}:?\d{2})$/i.test(text))iso=`${text}Z`; // sans fuseau : horloge UTC, comme currentTime() de l'interface
  const date=new Date(iso);
  if(Number.isNaN(date.getTime()))throw new Error(`Horodatage invalide (${ctx}) : ${text}`);
  return date;
}
function encode(value,type,ctx){
  if(value===undefined||value===null)return null;
  switch(type){
    case 'int':{const n=Number(value);if(!Number.isFinite(n))throw new Error(`Entier invalide (${ctx}) : ${value}`);return Math.trunc(n)}
    case 'num':{const n=Number(value);if(!Number.isFinite(n))throw new Error(`Nombre invalide (${ctx}) : ${value}`);return n}
    case 'bool':return value===true;
    case 'ts':return parseTimestamp(value,ctx).toISOString();
    case 'date':{const text=String(value).slice(0,10);const parsed=new Date(`${text}T00:00:00Z`);if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==text)throw new Error(`Date invalide (${ctx}) : ${value}`);return text}
    case 'json':return JSON.stringify(value);
    case 'textarr':return Array.isArray(value)?value.map(String):null;
    default:return String(value);
  }
}
const CAST={int:'',num:'::numeric',bool:'',ts:'::timestamptz',date:'::date',json:'::jsonb',textarr:'::text[]',text:''};
function selectExpr(c){
  switch(c.type){
    case 'ts':return `to_char(${c.col} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as ${c.col}`;
    case 'date':return `to_char(${c.col},'YYYY-MM-DD') as ${c.col}`;
    case 'num':return `${c.col}::float8 as ${c.col}`;
    default:return c.col;
  }
}
function col(key,column,type='text',options={}){return {key,col:column,type,...options}}
const selectList=(cols)=>cols.map(selectExpr).join(',');

// objet -> { valeurs encodées par colonne, extra }
function split(obj,cols,ctx,skipKeys=[]){
  const extra={...obj};const values={};
  for(const key of skipKeys)delete extra[key];
  for(const c of cols){delete extra[c.key];const encoded=encode(obj[c.key],c.type,`${ctx}.${c.key}`);values[c.col]=encoded===null&&c.defaultValue!==undefined?c.defaultValue:encoded}
  return {values,extra};
}
// ligne -> objet (les NULL sont omis, sauf emitNull)
function join(row,cols){
  const out={...(row.extra||{})};
  for(const c of cols){
    const v=row[c.col];
    if(v===null||v===undefined){if(c.emitNull)out[c.key]=null;continue}
    if(c.type==='bool'&&c.omitFalse&&v===false)continue;
    out[c.key]=v;
  }
  return out;
}
function upsertSql(table,pk,columns,casts){
  const names=columns;const placeholders=names.map((name,i)=>`$${i+1}${casts[name]||''}`).join(',');
  const updates=names.filter(name=>!pk.includes(name)).map(name=>`${name}=excluded.${name}`).join(',');
  return `insert into ${table}(${names.join(',')}) values(${placeholders}) on conflict(${pk.join(',')}) do ${updates?`update set ${updates}`:'nothing'}`;
}
function castsFor(cols){const map={extra:'::jsonb'};for(const c of cols)if(CAST[c.type])map[c.col]=CAST[c.type];return map}

// ---------------------------------------------------------------- descriptions des entités
const RECORD_COLS=[
  col('id','id'),col('clientId','client_id'),col('client','client'),col('campaign','campaign'),col('campaignCode','campaign_code'),
  col('agent','agent'),col('employeeCode','employee_code'),col('agentCodeFromFilename','agent_code_from_filename'),col('agentCivility','agent_civility'),
  col('callDate','call_date','date'),col('callTime','call_time'),col('duration','duration'),col('durationSeconds','duration_seconds','int'),
  col('extension','extension'),col('clientRef','client_ref'),col('recordIndex','record_index'),col('baseName','base_name'),
  col('rawSegment1','raw_segment1'),col('rawSegment6','raw_segment6'),col('rawSegment7','raw_segment7'),col('sourceFilename','source_filename'),col('filenameParts','filename_parts','json'),
  col('amount','amount','num',{emitNull:true}),col('clientCall1Status','client_call1_status'),col('responsible','responsible'),col('responsibleId','responsible_id'),
  col('createdAt','created_at','ts'),col('status','status'),col('batchId','batch_id','text',{emitNull:true}),col('audio','audio','json'),
  col('responseSentAt','response_sent_at','ts',{emitNull:true}),col('closedAt','closed_at','ts',{emitNull:true}),col('closedBy','closed_by'),
  col('sentToClientAt','sent_to_client_at','ts',{emitNull:true}),col('archived','archived','bool',{omitFalse:true,defaultValue:false}),col('archivedAt','archived_at','ts'),col('archivedBy','archived_by'),
  col('client1','legacy_client1','json',{emitNull:true}),col('clientFinal','legacy_client_final','json',{emitNull:true})
];
const RECORD_CHILD_KEYS=['labels','clientReturns','finalReturnHistory','clientSendHistory','evaluationHistory','internal1','internal2','finalReturn'];
const EVAL_COLS=[col('version','version','int'),col('date','evaluated_at','ts'),col('status','status'),col('evaluator','evaluator'),col('score','score','num'),col('conformity','conformity'),col('decision','decision')];
const CLIENT_RETURN_COLS=[col('id','id'),col('returnNumber','return_number','int'),col('stage','stage'),col('status','status'),col('decision','decision'),col('finalStatus','final_status'),col('call1Status','call1_status'),col('alreadyDonor','already_donor','bool'),col('sourceChannel','source_channel'),col('date','returned_date','ts'),col('receivedAt','received_at','ts'),col('recordedAt','recorded_at','ts'),col('recordedBy','recorded_by'),col('user','user_name'),col('score','score','num'),col('comments','comments'),col('disagreements','disagreements'),col('clientRemarks','client_remarks'),col('baseSnapshot','base_snapshot'),col('recordIndexSnapshot','record_index_snapshot')];
const FINAL_RETURN_COLS=[col('id','id'),col('version','version','int'),col('stage','stage'),col('status','status'),col('decision','decision'),col('date','returned_date','ts'),col('recordedBy','recorded_by'),col('user','user_name'),col('comments','comments')];
const SEND_COLS=[col('id','id'),col('evaluationStage','evaluation_stage'),col('evaluationVersion','evaluation_version','int'),col('exportMode','export_mode'),col('fileName','file_name'),col('ftpDestination','ftp_destination'),col('legacyBatchId','legacy_batch_id'),col('sentAt','sent_at','ts'),col('sentBy','sent_by')];
const EVENT_COLS=[col('id','id'),col('action','action'),col('detail','detail'),col('actor','actor'),col('role','role'),col('at','at','ts'),col('clientVisible','client_visible','bool')];
const BATCH_COLS=[col('id','id'),col('stage','stage'),col('clientId','client_id'),col('client','client'),col('createdAt','created_at','ts'),col('createdBy','created_by'),col('status','status'),col('sentAt','sent_at','ts'),col('returnedAt','returned_at','ts'),col('closedAt','closed_at','ts',{emitNull:true}),col('ftpUploadedAt','ftp_uploaded_at','ts'),col('note','note')];
const TASK_COLS=[col('id','id'),col('type','type'),col('title','title'),col('assignedTo','assigned_to'),col('assignedToId','assigned_to_id'),col('priority','priority'),col('createdAt','created_at','ts'),col('dueDate','due_date','date'),col('status','status'),col('completedAt','completed_at','ts'),col('auto','auto','bool'),col('archived','archived','bool',{omitFalse:true,defaultValue:false}),col('archivedAt','archived_at','ts'),col('archivedBy','archived_by')];
const DEBRIEF_COLS=[col('id','id'),col('agent','agent'),col('agentId','agent_id'),col('employeeCode','employee_code'),col('date','debrief_date','date'),col('owner','owner'),col('note','note'),col('rubricVersion','rubric_version','int'),col('audio','audio','json'),col('filenameMetadata','filename_metadata','json'),col('archived','archived','bool',{omitFalse:true,defaultValue:false}),col('archivedAt','archived_at','ts'),col('archivedBy','archived_by')];
const DEBRIEF_ACTION_COLS=[col('title','title'),col('dueDate','due_date','date'),col('status','status'),col('owner','owner')];
const DEBRIEF_MOD_COLS=[col('at','at','ts'),col('by','by'),col('fields','fields','textarr')];
const CRITERION_COLS=[col('id','id'),col('section','section'),col('label','label'),col('description','description'),col('type','type'),col('weight','weight','num'),col('groupId','group_id'),col('groupName','group_name'),col('options','options','json')];
const GROUP_ITEM_COLS=[col('id','id'),col('label','label'),col('points','points','num')];
const STAGES=['internal1','client1','internal2','clientFinal'];

// ---------------------------------------------------------------- lecture
async function selectAll(db,table,cols,extraCols,orderBy){
  const names=[...extraCols];
  const result=await db.query(`select ${selectList(cols)}${names.length?`,${names.join(',')}`:''},extra from public.${table}${orderBy?` order by ${orderBy}`:''}`);
  return result.rows;
}
function groupBy(rows,key){const map=new Map();for(const row of rows){const k=row[key];if(!map.has(k))map.set(k,[]);map.get(k).push(row)}return map}


function composeTask(row){const task=join(row,TASK_COLS);if(row.record_id)task.recordId=row.record_id;return task}
// Chargement ciblé de tâches : toutes, ou par identifiants / fiche / assigné (colonnes indexées).
async function loadTasks(db,{ids,recordId,assignedToId,archived}={}){
  const where=[];const params=[];
  if(ids){params.push(ids);where.push(`id=any($${params.length}::text[])`)}
  if(recordId){params.push(recordId);where.push(`record_id=$${params.length}`)}
  if(assignedToId){params.push(assignedToId);where.push(`assigned_to_id=$${params.length}`)}
  if(archived===true)where.push('archived');else if(archived===false)where.push('not archived');
  const result=await db.query(`select ${selectList(TASK_COLS)},record_id,extra from public.crm_tasks${where.length?` where ${where.join(' and ')}`:''} order by created_at desc nulls last,id desc`,params);
  return result.rows.map(composeTask);
}
async function lockTask(db,id){
  const result=await db.query(`select ${selectList(TASK_COLS)},record_id,extra from public.crm_tasks where id=$1 for update`,[id]);
  return result.rows[0]?composeTask(result.rows[0]):null;
}
const saveTask=(db,task)=>writeTask(db,task,null);
const saveEvent=(db,event)=>writeEvent(db,event,null);

// Chargement ciblé de fiches (avec tous leurs enfants), même composition que le chargement complet.
const RECORD_ORDER='created_at desc nulls last,id desc';
const RECORD_LIST_ORDER='call_date desc nulls last,call_time desc nulls last,created_at desc nulls last,id desc';
async function loadRecordsWhere(db,whereSql,params=[],lock=false,order=RECORD_ORDER){
  const rows=(await db.query(`select ${selectList(RECORD_COLS)},legacy_final_return,extra from public.crm_records${whereSql?` where ${whereSql}`:''} order by ${order}${lock?' for update':''}`,params)).rows;
  if(!rows.length)return [];
  const ids=rows.map(row=>row.id);
  const child=(table,cols,extraCols,order)=>db.query(`select ${selectList(cols)}${extraCols?`,${extraCols}`:''},extra from public.${table} where record_id=any($1::text[]) order by ${order}`,[ids]).then(r=>r.rows);
  const [labels,evals,returns,finals,sends]=await Promise.all([
    db.query('select record_id,label_id from public.crm_record_labels where record_id=any($1::text[]) order by record_id,position',[ids]).then(r=>r.rows),
    child('crm_record_evaluations',EVAL_COLS,'record_id,stage,seq,is_current','record_id,stage,seq'),
    child('crm_record_client_returns',CLIENT_RETURN_COLS,'record_id,seq','record_id,seq'),
    child('crm_record_final_returns',FINAL_RETURN_COLS,'record_id,seq','record_id,seq'),
    child('crm_record_send_history',SEND_COLS,'record_id,seq','record_id,seq')
  ]);
  const by=list=>groupBy(list,'record_id');
  const labelsBy=by(labels),evalBy=by(evals),returnsBy=by(returns),finalsBy=by(finals),sendsBy=by(sends);
  return rows.map(row=>composeRecord(row,labelsBy.get(row.id)||[],evalBy.get(row.id)||[],returnsBy.get(row.id)||[],finalsBy.get(row.id)||[],sendsBy.get(row.id)||[]));
}
async function loadRecords(db,{archived,ids}={}){
  const where=[];const params=[];
  if(archived===true)where.push('archived');else if(archived===false)where.push('not archived');
  if(ids){params.push(ids);where.push(`id=any($${params.length}::text[])`)}
  return loadRecordsWhere(db,where.join(' and '),params);
}
// Liste paginée en SQL : filtres, droits, recherche, tri et LIMIT/OFFSET sont évalués par PostgreSQL ;
// seules les fiches de la page sont ensuite composées (une requête par table enfant, limitée à ces identifiants).
// Index d'appui : migrations/001_crm_records_list_pagination.sql.
const likePattern=text=>`%${String(text).replace(/[\\%_]/g,'\\$&')}%`;
const SQL_NORM_TEXT=column=>`btrim(regexp_replace(translate(lower(coalesce(${column},'')),'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœæ','aaaaaaceeeeiiiinooooouuuuyyoa'),'[^a-z0-9]+',' ','g'))`;
function buildRecordListWhere({archived,filters={},search='',compliance='',scope={}}){
  const params=[];const where=[archived?'r.archived = true':'r.archived = false'];
  const add=(sql,value)=>{params.push(value);where.push(sql.replace(/\?/g,`$${params.length}`))};
  if(scope.restrictedUserId!==undefined){
    // Sans records_view_all : fiches dont le responsable est l'utilisateur (identifiant, ou nom pour les données historiques sans identifiant).
    params.push(scope.restrictedUserId);const idRef=`$${params.length}`;
    params.push(scope.restrictedName||'');const nameRef=`$${params.length}`;
    where.push(`((nullif(btrim(r.responsible_id),'') is not null and r.responsible_id = ${idRef}) or (nullif(btrim(r.responsible_id),'') is null and ${nameRef} <> '' and ${SQL_NORM_TEXT('r.responsible')} = ${nameRef}))`);
  }
  // « À envoyer au client » : fiches non clôturées (littéral, pour pouvoir utiliser l'index partiel crm_records_send_idx).
  if(filters.toSend)where.push("r.status is distinct from 'cloture'");
  if(filters.status)add('r.status = ?',filters.status);
  if(filters.campaign)add('r.campaign = ?',filters.campaign);
  if(filters.callFrom)add('r.call_date >= ?::date',filters.callFrom);
  if(filters.callTo)add('r.call_date <= ?::date',filters.callTo);
  if(filters.closedFrom)add('r.closed_at >= ?::date',filters.closedFrom);
  // Borne haute exclusive au lendemain : reste utilisable par l'index et inclut toute la journée.
  if(filters.closedTo)add("r.closed_at < (?::date + 1)",filters.closedTo);
  if(compliance){
    if(scope.canInternal1===false)where.push('false');
    else add("exists (select 1 from public.crm_record_evaluations e where e.record_id = r.id and e.stage = 'internal1' and e.is_current and e.conformity = ?)",compliance);
  }
  if(search){
    params.push(likePattern(search));const q=`$${params.length}`;
    const text=['r.id','r.agent','r.employee_code','r.agent_code_from_filename','r.client','r.campaign','r.responsible','r.client_ref','r.source_filename','r.record_index','r.base_name','r.campaign_code','r.raw_segment1',"r.audio->>'drive_file_name'","r.audio->>'drive_file_id'"];
    if(scope.canClientReturns!==false)text.push('r.client_call1_status');
    if(scope.canClientSend!==false)text.push('r.batch_id');
    if(scope.canClientReturns!==false&&scope.portal!==true)text.push('r.raw_segment6','r.raw_segment7');
    const parts=text.map(column=>`${column} ilike ${q}`);
    if(scope.canInternal2!==false)parts.push(`exists (select 1 from public.crm_record_evaluations e where e.record_id = r.id and e.stage = 'internal2' and e.is_current and (e.extra->>'analysisPoleQualite' ilike ${q} or e.extra->>'promiseStatus' ilike ${q} or e.extra->>'donConformity' ilike ${q}))`);
    if(scope.canFinalReturn!==false)parts.push(`(select f.status from public.crm_record_final_returns f where f.record_id = r.id order by coalesce(f.version,0) desc, f.returned_date desc nulls last limit 1) ilike ${q}`);
    if(scope.canClientReturns!==false)parts.push(`exists (select 1 from public.crm_record_client_returns c where c.record_id = r.id and (c.call1_status ilike ${q} or c.final_status ilike ${q} or c.client_remarks ilike ${q} or c.base_snapshot ilike ${q} or c.record_index_snapshot ilike ${q}))`);
    where.push(`(${parts.join(' or ')})`);
  }
  return {whereSql:where.join(' and '),params};
}
// KPI : nombre de fiches visibles correspondant aux filtres (sans composer les fiches).
async function countRecords(db,{archived=false,filters,scope}={}){
  const {whereSql,params}=buildRecordListWhere({archived,filters,scope});
  return (await db.query(`select count(*)::int as n from public.crm_records r where ${whereSql}`,params)).rows[0].n;
}
// Score moyen par agent : moyenne des scores Synergy #1 courants de ses fiches (même identité d'agent que sameAgentIdentity :
// matricule normalisé si les deux en ont un, sinon nom normalisé). Calculé en SQL, limité aux fiches visibles du profil.
const SQL_NORM_CODE=column=>`regexp_replace(regexp_replace(upper(coalesce(${column},'')),'[^A-Z0-9]','','g'),'^(AGENT|AG)','')`;
async function loadAgentScores(db,{scope}={}){
  const {whereSql,params}=buildRecordListWhere({archived:false,scope});
  const rows=(await db.query(`
    with visible as (select r.id, r.employee_code, r.agent from public.crm_records r where ${whereSql}),
    scored as (select v.id, v.employee_code, v.agent, e.score from visible v
      join public.crm_record_evaluations e on e.record_id = v.id and e.stage = 'internal1' and e.is_current and e.score is not null)
    select a.matricule as id, round(avg(s.score))::int as average, count(*)::int as count
      from public.crm_agents a
      join scored s on case when ${SQL_NORM_CODE('a.matricule')} <> '' and ${SQL_NORM_CODE('s.employee_code')} <> ''
        then ${SQL_NORM_CODE('a.matricule')} = ${SQL_NORM_CODE('s.employee_code')}
        else ${SQL_NORM_TEXT('a.name')} <> '' and ${SQL_NORM_TEXT('a.name')} = ${SQL_NORM_TEXT('s.agent')} end
      group by a.matricule`,params)).rows;
  return Object.fromEntries(rows.map(row=>[row.id,{average:row.average,count:row.count}]));
}
async function loadRecordsPage(db,{archived=false,filters,search,compliance,scope,page=1,pageSize=10}){
  const {whereSql,params}=buildRecordListWhere({archived,filters,search,compliance,scope});
  const fetchIds=async current=>(await db.query(`select r.id from public.crm_records r where ${whereSql} order by ${RECORD_LIST_ORDER.replace(/\b(call_date|call_time|created_at|id)\b/g,'r.$1')} limit $${params.length+1} offset $${params.length+2}`,[...params,pageSize,(current-1)*pageSize])).rows.map(row=>row.id);
  const countPromise=db.query(`select count(*)::int as n from public.crm_records r where ${whereSql}`,params);
  let current=Math.max(1,page);
  let ids=await fetchIds(current);
  const total=(await countPromise).rows[0].n;
  const pages=Math.max(1,Math.ceil(total/pageSize));
  if(current>pages){current=pages;ids=await fetchIds(current)}
  const records=ids.length?await loadRecordsWhere(db,'id=any($1::text[])',[ids]):[];
  records.sort((a,b)=>ids.indexOf(a.id)-ids.indexOf(b.id));
  return {records,pagination:{page:current,pageSize,total,pages}};
}
async function lockRecord(db,id){return (await loadRecordsWhere(db,'id=$1',[id],true))[0]||null}
const saveRecord=(db,record)=>writeRecord(db,record);
async function nextRecordId(db,year){
  await db.query('select pg_advisory_xact_lock(733100423)');
  const result=await db.query("select coalesce(max((substring(id from '(\\d+)$'))::bigint),0)::text as n from public.crm_records where id ~ '\\d+$'");
  return `QC-${year}-${String((Number(result.rows[0].n)||0)+1).padStart(6,'0')}`;
}

// Recompose les débriefs à partir de leurs lignes et lignes enfants (même code pour la base complète et le chargement ciblé).
function composeDebriefs(debriefRows,ratings,debriefRecords,actions,mods,audios=[]){
  const ratingsBy=groupBy(ratings,'debrief_id'),recordsBy=groupBy(debriefRecords,'debrief_id'),actionsBy=groupBy(actions,'debrief_id'),modsBy=groupBy(mods,'debrief_id'),audiosBy=groupBy(audios,'debrief_id');
  return debriefRows.map(row=>{
    const debrief=join(row,DEBRIEF_COLS);
    const rowRatings=ratingsBy.get(row.id);if(rowRatings)debrief.ratings=Object.fromEntries(rowRatings.map(item=>[item.criterion,item.score]));
    debrief.recordIds=(recordsBy.get(row.id)||[]).map(item=>item.record_id);
    const rowAudios=audiosBy.get(row.id);if(rowAudios)debrief.audios=rowAudios.map(item=>item.audio);
    debrief.actions=(actionsBy.get(row.id)||[]).map(item=>join(item,DEBRIEF_ACTION_COLS));
    const rowMods=modsBy.get(row.id);if(rowMods)debrief.modifications=rowMods.map(item=>join(item,DEBRIEF_MOD_COLS));
    return debrief;
  });
}
const DEBRIEF_ORDER='debrief_date desc nulls last,id desc';
async function loadDebriefsWhere(db,whereSql,params,lock=false){
  const rows=(await db.query(`select ${selectList(DEBRIEF_COLS)},extra from public.crm_debriefs${whereSql?` where ${whereSql}`:''} order by ${DEBRIEF_ORDER}${lock?' for update':''}`,params)).rows;
  if(!rows.length)return [];
  const ids=rows.map(row=>row.id);
  const [ratings,debriefRecords,actions,mods,audios]=await Promise.all([
    db.query('select debrief_id,criterion,score from public.crm_debrief_ratings where debrief_id=any($1::text[])',[ids]).then(r=>r.rows),
    db.query('select debrief_id,record_id from public.crm_debrief_records where debrief_id=any($1::text[]) order by debrief_id,position',[ids]).then(r=>r.rows),
    db.query(`select ${selectList(DEBRIEF_ACTION_COLS)},debrief_id,seq,extra from public.crm_debrief_actions where debrief_id=any($1::text[]) order by debrief_id,seq`,[ids]).then(r=>r.rows),
    db.query(`select ${selectList(DEBRIEF_MOD_COLS)},debrief_id,seq,extra from public.crm_debrief_modifications where debrief_id=any($1::text[]) order by debrief_id,seq`,[ids]).then(r=>r.rows),
    db.query('select debrief_id,audio from public.crm_debrief_audios where debrief_id=any($1::text[]) order by debrief_id,position',[ids]).then(r=>r.rows)
  ]);
  return composeDebriefs(rows,ratings,debriefRecords,actions,mods,audios);
}
// Chargement ciblé : vue active/archivée, par fiche liée ou par identifiant.
async function loadDebriefs(db,{archived,recordId,ids}={}){
  const where=[];const params=[];
  if(archived===true)where.push('archived');else if(archived===false)where.push('not archived');
  if(recordId){params.push(recordId);where.push(`id in (select debrief_id from public.crm_debrief_records where record_id=$${params.length})`)}
  if(ids){params.push(ids);where.push(`id=any($${params.length}::text[])`)}
  return loadDebriefsWhere(db,where.join(' and '),params);
}
async function lockDebrief(db,id){return (await loadDebriefsWhere(db,'id=$1',[id],true))[0]||null}
const saveDebrief=(db,debrief)=>writeDebrief(db,debrief,null);
async function nextDebriefId(db,year){
  await db.query('select pg_advisory_xact_lock(733100422)');
  const result=await db.query("select coalesce(max((substring(id from '(\\d+)$'))::bigint),0)::text as n from public.crm_debriefs where id ~ '\\d+$'");
  return `DB-${year}-${String((Number(result.rows[0].n)||0)+1).padStart(3,'0')}`;
}

// Recompose l'objet « fiche » à partir de sa ligne et de ses lignes enfants (identique pour la base et pour la canonicalisation).
function composeRecord(row,labelRows,evalRows,returnRows,finalRows,sendRows){
  const record=join(row,RECORD_COLS);
  record.labels=labelRows.map(item=>item.label_id);
  for(const stage of ['internal1','internal2']){
    const current=evalRows.find(item=>item.stage===stage&&item.is_current);
    record[stage]=current?{...join(current,EVAL_COLS),stage}:null;
  }
  record.evaluationHistory=evalRows.filter(item=>!item.is_current).map(item=>({...join(item,EVAL_COLS),stage:item.stage}));
  record.clientReturns=returnRows.map(item=>join(item,CLIENT_RETURN_COLS));
  record.finalReturnHistory=finalRows.map(item=>join(item,FINAL_RETURN_COLS));
  record.finalReturn=row.legacy_final_return??record.finalReturnHistory.at(-1)??null;
  record.clientSendHistory=sendRows.map(item=>join(item,SEND_COLS));
  return record;
}

async function loadRelational(db){
  const [records,labels,evaluations,returns,finals,sends,batches,batchRecords,events,tasks,debriefs,ratings,debriefRecords,actions,mods,debriefAudios,groups,groupItems,criteria]=await Promise.all([
    selectAll(db,'crm_records',RECORD_COLS,['legacy_final_return'],'created_at desc nulls last,id desc'),
    db.query('select record_id,label_id from public.crm_record_labels order by record_id,position').then(r=>r.rows),
    selectAll(db,'crm_record_evaluations',EVAL_COLS,['record_id','stage','seq','is_current'],'record_id,stage,seq'),
    selectAll(db,'crm_record_client_returns',CLIENT_RETURN_COLS,['record_id','seq'],'record_id,seq'),
    selectAll(db,'crm_record_final_returns',FINAL_RETURN_COLS,['record_id','seq'],'record_id,seq'),
    selectAll(db,'crm_record_send_history',SEND_COLS,['record_id','seq'],'record_id,seq'),
    selectAll(db,'crm_batches',BATCH_COLS,[],'created_at desc nulls last,id desc'),
    db.query('select batch_id,record_id from public.crm_batch_records order by batch_id,position').then(r=>r.rows),
    selectAll(db,'crm_events',EVENT_COLS,['record_id','orphan_record_id'],'at desc nulls last,id desc'),
    selectAll(db,'crm_tasks',TASK_COLS,['record_id'],'created_at desc nulls last,id desc'),
    selectAll(db,'crm_debriefs',DEBRIEF_COLS,[],'debrief_date desc nulls last,id desc'),
    db.query('select debrief_id,criterion,score from public.crm_debrief_ratings').then(r=>r.rows),
    db.query('select debrief_id,record_id from public.crm_debrief_records order by debrief_id,position').then(r=>r.rows),
    selectAll(db,'crm_debrief_actions',DEBRIEF_ACTION_COLS,['debrief_id','seq'],'debrief_id,seq'),
    selectAll(db,'crm_debrief_modifications',DEBRIEF_MOD_COLS,['debrief_id','seq'],'debrief_id,seq'),
    db.query('select debrief_id,audio from public.crm_debrief_audios order by debrief_id,position').then(r=>r.rows),
    selectAll(db,'crm_option_groups',[col('id','id'),col('name','name')],['position'],'position,id'),
    selectAll(db,'crm_option_group_items',GROUP_ITEM_COLS,['group_id','position'],'group_id,position'),
    selectAll(db,'crm_grid_criteria',CRITERION_COLS,['stage','position'],'stage,position')
  ]);
  const labelsBy=groupBy(labels,'record_id'),evalBy=groupBy(evaluations,'record_id'),returnsBy=groupBy(returns,'record_id'),finalsBy=groupBy(finals,'record_id'),sendsBy=groupBy(sends,'record_id');
  const outRecords=records.map(row=>composeRecord(row,labelsBy.get(row.id)||[],evalBy.get(row.id)||[],returnsBy.get(row.id)||[],finalsBy.get(row.id)||[],sendsBy.get(row.id)||[]));
  const batchIds=groupBy(batchRecords,'batch_id');
  const outBatches=batches.map(row=>({...join(row,BATCH_COLS),recordIds:(batchIds.get(row.id)||[]).map(item=>item.record_id)}));
  const outEvents=events.map(row=>({...join(row,EVENT_COLS),recordId:row.record_id||row.orphan_record_id||undefined})).map(event=>{if(event.recordId===undefined)delete event.recordId;return event});
  const outTasks=tasks.map(composeTask);
  const outDebriefs=composeDebriefs(debriefs,ratings,debriefRecords,actions,mods,debriefAudios);
  const itemsBy=groupBy(groupItems,'group_id');
  const optionGroups=groups.map(row=>({...join(row,[col('id','id'),col('name','name')]),options:(itemsBy.get(row.id)||[]).map(item=>join(item,GROUP_ITEM_COLS))}));
  const criteriaByStage=Object.fromEntries(STAGES.map(stage=>[stage,[]]));
  for(const row of criteria){(criteriaByStage[row.stage]||(criteriaByStage[row.stage]=[])).push(join(row,CRITERION_COLS))}
  return {records:outRecords,events:outEvents,batches:outBatches,tasks:outTasks,debriefs:outDebriefs,criteriaByStage,optionGroups};
}

// ---------------------------------------------------------------- écriture
function ensureArray(value){return Array.isArray(value)?value:[]}
function recordRows(record){
  const ctx=`fiche ${record.id}`;
  const {values,extra}=split(record,RECORD_COLS,ctx,RECORD_CHILD_KEYS);
  const history=ensureArray(record.finalReturnHistory);
  const finalReturn=record.finalReturn??null;
  const derived=history.length?history[history.length-1]:null;
  const legacyFinal=finalReturn&&!(derived&&looseEqual(derived,finalReturn))?finalReturn:null;
  const evaluations=[];
  for(const stage of ['internal1','internal2']){
    if(record[stage])evaluations.push({stage,seq:0,current:true,entry:record[stage]});
  }
  ensureArray(record.evaluationHistory).forEach((entry,index)=>evaluations.push({stage:String(entry?.stage||'internal1'),seq:index+1,current:false,entry}));
  return {
    main:{...values,extra:JSON.stringify(extra),legacy_final_return:legacyFinal?JSON.stringify(legacyFinal):null},
    labels:ensureArray(record.labels).map((label,index)=>({label_id:String(label),position:index})),
    evaluations:evaluations.map(item=>{const {entry,...meta}=item;const {values:v,extra:e}=split(entry,EVAL_COLS,`${ctx}.${item.stage}`,['stage']);return {...meta,values:v,extra:e}}),
    returns:ensureArray(record.clientReturns).map((entry,index)=>({seq:index,...split(entry,CLIENT_RETURN_COLS,`${ctx}.clientReturns[${index}]`)})),
    finals:history.map((entry,index)=>({seq:index,...split(entry,FINAL_RETURN_COLS,`${ctx}.finalReturnHistory[${index}]`)})),
    sends:ensureArray(record.clientSendHistory).map((entry,index)=>({seq:index,...split(entry,SEND_COLS,`${ctx}.clientSendHistory[${index}]`)}))
  };
}
const REC_NAMES=RECORD_COLS.map(c=>c.col);
const REC_UPSERT=upsertSql('public.crm_records',['id'],[...REC_NAMES,'legacy_final_return','extra'],{...castsFor(RECORD_COLS),legacy_final_return:'::jsonb'});
const childInsert=(table,cols,fixed)=>{const names=[...fixed,...cols.map(c=>c.col),'extra'];return {sql:`insert into public.${table}(${names.join(',')}) values(${names.map((n,i)=>`$${i+1}${n==='extra'?'::jsonb':(cols.find(c=>c.col===n)?CAST[cols.find(c=>c.col===n).type]:'')}`).join(',')})`,names}};
const EVAL_INSERT=childInsert('crm_record_evaluations',EVAL_COLS,['record_id','stage','seq','is_current']);
const RETURN_INSERT=childInsert('crm_record_client_returns',CLIENT_RETURN_COLS,['record_id','seq']);
const FINAL_INSERT=childInsert('crm_record_final_returns',FINAL_RETURN_COLS,['record_id','seq']);
const SEND_INSERT=childInsert('crm_record_send_history',SEND_COLS,['record_id','seq']);

async function writeRecord(db,record){
  const rows=recordRows(record);
  const mainValues=[...REC_NAMES.map(name=>rows.main[name]),rows.main.legacy_final_return,rows.main.extra];
  await db.query(REC_UPSERT,mainValues);
  for(const table of ['crm_record_labels','crm_record_evaluations','crm_record_client_returns','crm_record_final_returns','crm_record_send_history'])await db.query(`delete from public.${table} where record_id=$1`,[record.id]);
  for(const item of rows.labels)await db.query('insert into public.crm_record_labels(record_id,label_id,position) values($1,$2,$3) on conflict do nothing',[record.id,item.label_id,item.position]);
  for(const item of rows.evaluations)await db.query(EVAL_INSERT.sql,[record.id,item.stage,item.seq,item.current,...EVAL_COLS.map(c=>item.values[c.col]),JSON.stringify(item.extra)]);
  for(const item of rows.returns)await db.query(RETURN_INSERT.sql,[record.id,item.seq,...CLIENT_RETURN_COLS.map(c=>item.values[c.col]),JSON.stringify(item.extra)]);
  for(const item of rows.finals)await db.query(FINAL_INSERT.sql,[record.id,item.seq,...FINAL_RETURN_COLS.map(c=>item.values[c.col]),JSON.stringify(item.extra)]);
  for(const item of rows.sends)await db.query(SEND_INSERT.sql,[record.id,item.seq,...SEND_COLS.map(c=>item.values[c.col]),JSON.stringify(item.extra)]);
}
async function writeBatch(db,batch,knownRecordIds){
  const {values,extra}=split(batch,BATCH_COLS,`lot ${batch.id}`,['recordIds']);
  const names=BATCH_COLS.map(c=>c.col);
  await db.query(upsertSql('public.crm_batches',['id'],[...names,'extra'],castsFor(BATCH_COLS)),[...names.map(n=>values[n]),JSON.stringify(extra)]);
  await db.query('delete from public.crm_batch_records where batch_id=$1',[batch.id]);
  let position=0;
  for(const recordId of ensureArray(batch.recordIds)){
    if(knownRecordIds&&!knownRecordIds.has(recordId))throw Object.assign(new Error(`Le lot ${batch.id} référence une fiche inconnue : ${recordId}.`),{code:'ORPHAN',status:400});
    await db.query('insert into public.crm_batch_records(batch_id,record_id,position) values($1,$2,$3) on conflict do nothing',[batch.id,recordId,position++]);
  }
}
async function writeEvent(db,event,knownRecordIds){
  const {values,extra}=split(event,EVENT_COLS,`événement ${event.id}`,['recordId']);
  const orphan=event.recordId&&knownRecordIds&&!knownRecordIds.has(event.recordId);
  const names=EVENT_COLS.map(c=>c.col);
  await db.query(upsertSql('public.crm_events',['id'],[...names,'record_id','orphan_record_id','extra'],castsFor(EVENT_COLS)),[...names.map(n=>values[n]),orphan||!event.recordId?null:event.recordId,orphan?event.recordId:null,JSON.stringify(extra)]);
}
async function writeTask(db,task,knownRecordIds){
  const {values,extra}=split(task,TASK_COLS,`tâche ${task.id}`,['recordId']);
  if(task.recordId&&knownRecordIds&&!knownRecordIds.has(task.recordId))throw Object.assign(new Error(`La tâche ${task.id} référence une fiche inconnue : ${task.recordId}.`),{code:'ORPHAN',status:400});
  const names=TASK_COLS.map(c=>c.col);
  await db.query(upsertSql('public.crm_tasks',['id'],[...names,'record_id','extra'],castsFor(TASK_COLS)),[...names.map(n=>values[n]),task.recordId||null,JSON.stringify(extra)]);
}
async function writeDebrief(db,debrief,knownRecordIds){
  const ctx=`débrief ${debrief.id}`;
  const {values,extra}=split(debrief,DEBRIEF_COLS,ctx,['ratings','recordIds','actions','modifications','audios']);
  const names=DEBRIEF_COLS.map(c=>c.col);
  await db.query(upsertSql('public.crm_debriefs',['id'],[...names,'extra'],castsFor(DEBRIEF_COLS)),[...names.map(n=>values[n]),JSON.stringify(extra)]);
  for(const table of ['crm_debrief_ratings','crm_debrief_records','crm_debrief_actions','crm_debrief_modifications','crm_debrief_audios'])await db.query(`delete from public.${table} where debrief_id=$1`,[debrief.id]);
  for(const [criterion,score] of Object.entries(debrief.ratings||{}))await db.query('insert into public.crm_debrief_ratings(debrief_id,criterion,score) values($1,$2,$3)',[debrief.id,criterion,Number(score)]);
  let position=0;
  for(const recordId of ensureArray(debrief.recordIds)){
    if(knownRecordIds&&!knownRecordIds.has(recordId))throw Object.assign(new Error(`Le débrief ${debrief.id} référence une fiche inconnue : ${recordId}.`),{code:'ORPHAN',status:400});
    await db.query('insert into public.crm_debrief_records(debrief_id,record_id,position) values($1,$2,$3) on conflict do nothing',[debrief.id,recordId,position++]);
  }
  // Relation 1 -> n débrief / audios : chaque audio pointe vers local_audio_objects quand il est stocké (objectId).
  let audioPosition=0;
  for(const audio of ensureArray(debrief.audios)){
    const audioId=String(audio?.objectId||audio?.id||`local-${audioPosition}`);
    await db.query('insert into public.crm_debrief_audios(debrief_id,audio_id,position,source_record_id,audio) values($1,$2,$3,$4,$5::jsonb) on conflict do nothing',[debrief.id,audioId,audioPosition++,audio?.sourceRecordId||null,JSON.stringify(audio)]);
  }
  const actionNames=DEBRIEF_ACTION_COLS.map(c=>c.col);
  let seq=0;
  for(const action of ensureArray(debrief.actions)){
    const part=split(action,DEBRIEF_ACTION_COLS,`${ctx}.actions[${seq}]`);
    await db.query(`insert into public.crm_debrief_actions(debrief_id,seq,${actionNames.join(',')},extra) values($1,$2,${actionNames.map((n,i)=>`$${i+3}${CAST[DEBRIEF_ACTION_COLS[i].type]}`).join(',')},$${actionNames.length+3}::jsonb)`,[debrief.id,seq++,...actionNames.map(n=>part.values[n]),JSON.stringify(part.extra)]);
  }
  const modNames=DEBRIEF_MOD_COLS.map(c=>c.col);
  seq=0;
  for(const mod of ensureArray(debrief.modifications)){
    const part=split(mod,DEBRIEF_MOD_COLS,`${ctx}.modifications[${seq}]`);
    await db.query(`insert into public.crm_debrief_modifications(debrief_id,seq,${modNames.join(',')},extra) values($1,$2,${modNames.map((n,i)=>`$${i+3}${CAST[DEBRIEF_MOD_COLS[i].type]}`).join(',')},$${modNames.length+3}::jsonb)`,[debrief.id,seq++,...modNames.map(n=>part.values[n]||(n==='fields'?[]:null)),JSON.stringify(part.extra)]);
  }
}
const CRITERION_NAMES=['id','stage','position',...CRITERION_COLS.map(c=>c.col).filter(name=>name!=='id')];
const CRITERION_SQL=upsertSql('public.crm_grid_criteria',['id'],[...CRITERION_NAMES,'extra'],castsFor(CRITERION_COLS));
async function writeGroup(db,group,position){
  const {values,extra}=split(group,[col('id','id'),col('name','name')],`groupe ${group.id}`,['options']);
  await db.query('insert into public.crm_option_groups(id,name,position,extra) values($1,$2,$3,$4::jsonb) on conflict(id) do update set name=excluded.name,position=excluded.position,extra=excluded.extra,updated_at=now()',[values.id,values.name,position,JSON.stringify(extra)]);
  await db.query('delete from public.crm_option_group_items where group_id=$1',[group.id]);
  let itemPosition=0;
  for(const item of ensureArray(group.options)){
    const part=split(item,GROUP_ITEM_COLS,`groupe ${group.id}.options`);
    await db.query('insert into public.crm_option_group_items(id,group_id,position,label,points,extra) values($1,$2,$3,$4,$5::numeric,$6::jsonb)',[part.values.id,group.id,itemPosition++,part.values.label,part.values.points??100,JSON.stringify(part.extra)]);
  }
}
async function writeCriterion(db,stage,criterion,position){
  const {values,extra}=split(criterion,CRITERION_COLS,`critère ${criterion.id}`);
  await db.query(CRITERION_SQL,[...CRITERION_NAMES.map(name=>name==='stage'?stage:name==='position'?position:values[name]),JSON.stringify(extra)]);
}
async function writeGrids(db,after){
  let position=0;
  for(const group of ensureArray(after.optionGroups))await writeGroup(db,group,position++);
  for(const stage of Object.keys(after.criteriaByStage||{})){
    let order=0;
    for(const criterion of ensureArray(after.criteriaByStage[stage]))await writeCriterion(db,stage,criterion,order++);
  }
}
// Chargement ciblé des grilles (mêmes colonnes et même composition que le chargement complet).
async function loadGrids(db){
  const [groups,items,criteria]=await Promise.all([
    selectAll(db,'crm_option_groups',[col('id','id'),col('name','name')],['position'],'position,id'),
    selectAll(db,'crm_option_group_items',GROUP_ITEM_COLS,['group_id','position'],'group_id,position'),
    selectAll(db,'crm_grid_criteria',CRITERION_COLS,['stage','position'],'stage,position')
  ]);
  const itemsBy=groupBy(items,'group_id');
  const optionGroups=groups.map(row=>({...join(row,[col('id','id'),col('name','name')]),options:(itemsBy.get(row.id)||[]).map(item=>join(item,GROUP_ITEM_COLS))}));
  const criteriaByStage=Object.fromEntries(STAGES.map(stage=>[stage,[]]));
  for(const row of criteria)(criteriaByStage[row.stage]||(criteriaByStage[row.stage]=[])).push(join(row,CRITERION_COLS));
  return {criteriaByStage,optionGroups};
}
const saveOptionGroup=async(db,group)=>{const next=(await db.query('select coalesce(max(position),-1)+1 as n from public.crm_option_groups')).rows[0].n;const existing=(await db.query('select position from public.crm_option_groups where id=$1',[group.id])).rows[0];return writeGroup(db,group,existing?existing.position:Number(next))};
const saveCriterion=async(db,stage,criterion)=>{const existing=(await db.query('select position from public.crm_grid_criteria where id=$1',[criterion.id])).rows[0];const next=(await db.query('select coalesce(max(position),-1)+1 as n from public.crm_grid_criteria where stage=$1',[stage])).rows[0].n;return writeCriterion(db,stage,criterion,existing?existing.position:Number(next))};
const deleteCriterionRow=(db,id)=>db.query('delete from public.crm_grid_criteria where id=$1',[id]);
const deleteOptionGroupRow=(db,id)=>db.query('delete from public.crm_option_groups where id=$1',[id]);
function recordIdSet(state){return new Set(ensureArray(state.records).map(record=>record.id))}

// Insertion complète (migration) : renvoie les compteurs.
async function insertRelational(db,state){
  const known=recordIdSet(state);
  await writeGrids(db,state);
  for(const batch of ensureArray(state.batches)){const {recordIds,...rest}=batch;await writeBatch(db,{...rest,recordIds:[]},null)}
  for(const record of ensureArray(state.records))await writeRecord(db,record);
  for(const batch of ensureArray(state.batches))await writeBatch(db,batch,known);
  for(const event of ensureArray(state.events))await writeEvent(db,event,known);
  for(const task of ensureArray(state.tasks))await writeTask(db,task,known);
  for(const debrief of ensureArray(state.debriefs))await writeDebrief(db,debrief,known);
  return counts(state);
}
function counts(state){return {records:ensureArray(state.records).length,events:ensureArray(state.events).length,batches:ensureArray(state.batches).length,tasks:ensureArray(state.tasks).length,debriefs:ensureArray(state.debriefs).length,criteria:Object.values(state.criteriaByStage||{}).reduce((sum,list)=>sum+ensureArray(list).length,0),optionGroups:ensureArray(state.optionGroups).length}}

// ---------------------------------------------------------------- comparaison tolérante (migration, tests)
const TS_LIKE=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;
function loose(value,path=''){
  if(Array.isArray(value))return value.map(item=>loose(item,path));
  if(value&&typeof value==='object'){
    const out={};
    for(const key of Object.keys(value).sort()){
      const v=loose(value[key],`${path}.${key}`);
      if(v===null||v===undefined)continue;
      if(Array.isArray(v)&&v.length===0&&['labels','clientReturns','finalReturnHistory','clientSendHistory','evaluationHistory','actions','recordIds'].includes(key))continue;
      if(key==='archived'&&v===false)continue;
      out[key]=v;
    }
    return out;
  }
  if(typeof value==='string'&&TS_LIKE.test(value)){const d=parseTimestamp(value,path);return d.toISOString()}
  return value;
}
function looseEqual(a,b){return JSON.stringify(loose(a))===JSON.stringify(loose(b))}
// Normalisations structurelles tolérées (clés dérivées ajoutées à la relecture).
function comparable(entity,kind){
  const copy=JSON.parse(JSON.stringify(entity));
  if(kind==='record'){
    for(const stage of ['internal1','internal2'])if(copy[stage]&&typeof copy[stage]==='object')delete copy[stage].stage;
    for(const entry of ensureArray(copy.evaluationHistory))delete entry.stage;
    if(!copy.finalReturn&&ensureArray(copy.finalReturnHistory).length)copy.finalReturn=copy.finalReturnHistory.at(-1);
  }
  return loose(copy);
}
// Compare l'état d'origine et l'état relu : renvoie la liste des écarts (vide = aucune perte).
function diffStates(original,reloaded){
  const problems=[];
  const sortById=list=>[...ensureArray(list)].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  const kinds={records:'record',events:'event',batches:'batch',tasks:'task',debriefs:'debrief'};
  for(const [key,kind] of Object.entries(kinds)){
    const a=sortById(original[key]),b=sortById(reloaded[key]);
    if(a.length!==b.length)problems.push(`${key} : ${a.length} d'origine, ${b.length} relus.`);
    const byId=new Map(b.map(item=>[item.id,item]));
    for(const item of a){
      const other=byId.get(item.id);
      if(!other){problems.push(`${key} ${item.id} : absent après relecture.`);continue}
      if(JSON.stringify(comparable(item,kind))!==JSON.stringify(comparable(other,kind)))problems.push(`${key} ${item.id} : contenu différent après relecture.`);
    }
  }
  for(const stage of STAGES){
    const a=comparable(ensureArray(original.criteriaByStage?.[stage]),'criterion'),b=comparable(ensureArray(reloaded.criteriaByStage?.[stage]),'criterion');
    if(JSON.stringify(a)!==JSON.stringify(b))problems.push(`grille ${stage} : contenu différent après relecture.`);
  }
  if(JSON.stringify(comparable(sortById(original.optionGroups),'group'))!==JSON.stringify(comparable(sortById(reloaded.optionGroups),'group')))problems.push('groupes d’options : contenu différent après relecture.');
  return problems;
}

// ---------------------------------------------------------------- mise à jour par différences
async function persistRelational(db,before,after){
  const known=recordIdSet(after);
  const changedBy=(prevList,nextList,kind)=>{
    const prev=new Map(ensureArray(prevList).map(item=>[item.id,item]));
    const nextIds=new Set(ensureArray(nextList).map(item=>item.id));
    return {
      upserts:ensureArray(nextList).filter(item=>{const old=prev.get(item.id);return !old||JSON.stringify(comparable(old,kind))!==JSON.stringify(comparable(item,kind))}),
      deletes:ensureArray(prevList).filter(item=>!nextIds.has(item.id)).map(item=>item.id)
    };
  };
  const result={};
  // grilles : remplacement complet si une différence existe (petites tables, ordre significatif)
  const gridsChanged=JSON.stringify(comparable({c:before.criteriaByStage,g:before.optionGroups},'grid'))!==JSON.stringify(comparable({c:after.criteriaByStage,g:after.optionGroups},'grid'));
  if(gridsChanged){
    const nextCriteria=new Set(Object.values(after.criteriaByStage||{}).flat().map(c=>c.id));const nextGroups=new Set(ensureArray(after.optionGroups).map(g=>g.id));
    for(const stage of Object.keys(before.criteriaByStage||{}))for(const c of ensureArray(before.criteriaByStage[stage]))if(!nextCriteria.has(c.id))await db.query('delete from public.crm_grid_criteria where id=$1',[c.id]);
    await writeGrids(db,after);
    for(const g of ensureArray(before.optionGroups))if(!nextGroups.has(g.id))await db.query('delete from public.crm_option_groups where id=$1',[g.id]);
    result.grids=true;
  }
  const records=changedBy(before.records,after.records,'record');
  const batches=changedBy(before.batches,after.batches,'batch');
  for(const batch of batches.upserts){const {recordIds,...rest}=batch;await writeBatch(db,{...rest,recordIds:[]},null)}
  for(const record of records.upserts)await writeRecord(db,record);
  for(const batch of batches.upserts)await writeBatch(db,batch,known);
  for(const id of batches.deletes)await db.query('delete from public.crm_batches where id=$1',[id]);
  for(const id of records.deletes)await db.query('delete from public.crm_records where id=$1',[id]);
  const events=changedBy(before.events,after.events,'event');
  for(const event of events.upserts)await writeEvent(db,event,known);
  for(const id of events.deletes)await db.query('delete from public.crm_events where id=$1',[id]);
  const tasks=changedBy(before.tasks,after.tasks,'task');
  for(const task of tasks.upserts)await writeTask(db,task,known);
  for(const id of tasks.deletes)await db.query('delete from public.crm_tasks where id=$1',[id]);
  const debriefs=changedBy(before.debriefs,after.debriefs,'debrief');
  for(const debrief of debriefs.upserts)await writeDebrief(db,debrief,known);
  for(const id of debriefs.deletes)await db.query('delete from public.crm_debriefs where id=$1',[id]);
  return {...result,records:records.upserts.length,events:events.upserts.length,batches:batches.upserts.length,tasks:tasks.upserts.length,debriefs:debriefs.upserts.length};
}


// ---------------------------------------------------------------- canonicalisation des données entrantes
// Ramène un objet envoyé par le navigateur à la forme exacte que la base relirait (horodatages en ISO UTC, dates, nombres...).
// Une ligne inchangée est alors strictement égale à celle de la base : aucun faux « changement » ne peut être détecté.
function decoded(values,cols,extra){
  const row={extra:extra||{}};
  for(const c of cols){let v=values[c.col];if(typeof v==='string'&&c.type==='json')v=JSON.parse(v);row[c.col]=v}
  return row;
}
function canonSimple(obj,cols,ctx,skipKeys=[]){const {values,extra}=split(obj,cols,ctx,skipKeys);return join(decoded(values,cols,extra),cols)}
function canonRecord(record){
  const rows=recordRows(record);
  const main={...decoded(rows.main,RECORD_COLS,JSON.parse(rows.main.extra)),legacy_final_return:rows.main.legacy_final_return?JSON.parse(rows.main.legacy_final_return):null};
  const evalRows=rows.evaluations.map(item=>({...decoded(item.values,EVAL_COLS,item.extra),stage:item.stage,seq:item.seq,is_current:item.current}));
  const plainRows=(items,cols)=>items.map(item=>decoded(item.values,cols,item.extra));
  return composeRecord(main,rows.labels,evalRows,plainRows(rows.returns,CLIENT_RETURN_COLS),plainRows(rows.finals,FINAL_RETURN_COLS),plainRows(rows.sends,SEND_COLS));
}
function canonDebrief(debrief){
  const ctx=`débrief ${debrief.id}`;
  const out=canonSimple(debrief,DEBRIEF_COLS,ctx,['ratings','recordIds','actions','modifications','audios']);
  if(ensureArray(debrief.audios).length)out.audios=debrief.audios;
  const ratings=Object.fromEntries(Object.entries(debrief.ratings||{}).map(([key,value])=>[key,Number(value)]));
  if(Object.keys(ratings).length)out.ratings=ratings;
  out.recordIds=ensureArray(debrief.recordIds).map(String);
  out.actions=ensureArray(debrief.actions).map((action,index)=>canonSimple(action,DEBRIEF_ACTION_COLS,`${ctx}.actions[${index}]`));
  if(ensureArray(debrief.modifications).length)out.modifications=debrief.modifications.map((mod,index)=>canonSimple(mod,DEBRIEF_MOD_COLS,`${ctx}.modifications[${index}]`));
  return out;
}
function canonicalizeRelational(state){
  const out={...state};
  const mapList=(key,fn)=>{if(Array.isArray(state[key]))out[key]=state[key].map(fn)};
  mapList('records',canonRecord);
  mapList('events',event=>{const item=canonSimple(event,EVENT_COLS,`événement ${event.id}`,['recordId']);if(event.recordId!==undefined)item.recordId=event.recordId;return item});
  mapList('batches',batch=>({...canonSimple(batch,BATCH_COLS,`lot ${batch.id}`,['recordIds']),recordIds:ensureArray(batch.recordIds).map(String)}));
  mapList('tasks',task=>{const item=canonSimple(task,TASK_COLS,`tâche ${task.id}`,['recordId']);if(task.recordId!==undefined&&task.recordId!==null)item.recordId=task.recordId;return item});
  mapList('debriefs',canonDebrief);
  if(state.criteriaByStage&&typeof state.criteriaByStage==='object')out.criteriaByStage=Object.fromEntries(Object.entries(state.criteriaByStage).map(([stage,list])=>[stage,ensureArray(list).map(criterion=>canonSimple(criterion,CRITERION_COLS,`critère ${criterion.id}`))]));
  mapList('optionGroups',group=>({...canonSimple(group,[col('id','id'),col('name','name')],`groupe ${group.id}`,['options']),options:ensureArray(group.options).map(item=>canonSimple(item,GROUP_ITEM_COLS,`groupe ${group.id}.options`))}));
  return out;
}

const RELATIONAL_KEYS=['records','events','batches','tasks','debriefs','criteriaByStage','optionGroups'];
module.exports={loadGrids,saveOptionGroup,saveCriterion,deleteCriterionRow,deleteOptionGroupRow,loadRecords,loadRecordsPage,countRecords,loadAgentScores,lockRecord,saveRecord,nextRecordId,loadDebriefs,lockDebrief,saveDebrief,nextDebriefId,loadTasks,lockTask,saveTask,saveEvent,canonicalizeRelational,loadRelational,insertRelational,persistRelational,diffStates,counts,looseEqual,loose,RELATIONAL_KEYS,STAGES};
