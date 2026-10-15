'use strict';

const ALL_ACTIVITY_IDS = [
  'dashboard','records_view','records_manage','synergy1','client_returns','reevaluation',
  'final_return','client_send','debriefs','agents','tasks','portal','quality_settings',
  'users_roles','api_dashboard_read','api_dashboard_export'
];
const DEBRIEF_RATING_KEYS = ['accroche','remerciement','script','decouverte','appelDon','objections','confirmation','cloture'];
const SENSITIVE_STATE_KEYS = new Set(['users','roles','userRoleAssignments']);

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function same(a,b) { return stable(a) === stable(b); }
function normalizeAgentText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}
function normalizeEmployeeCode(value) { return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/^(AGENT|AG)/,''); }
function sameAgentIdentity(codeA,nameA,codeB,nameB) {
  const a=normalizeEmployeeCode(codeA),b=normalizeEmployeeCode(codeB);
  if(a&&b)return a===b;
  const left=normalizeAgentText(nameA),right=normalizeAgentText(nameB);
  return !!(left&&right&&left===right);
}
function getClientReturns(record) {
  if(Array.isArray(record?.clientReturns))return record.clientReturns;
  return record?.client1?[record.client1]:[];
}
function latestClientReturn(record) {
  return [...getClientReturns(record)].sort((a,b)=>Number(b.returnNumber||0)-Number(a.returnNumber||0))[0]||null;
}
function isEvaluated(record) {
  const evaluation=record?.internal1;
  if(!evaluation)return false;
  const status=String(evaluation.status||'').toUpperCase();
  const decision=String(evaluation.conformity||evaluation.decision||'').toUpperCase();
  return ['TERMINEE','TERMINE','COMPLETED','DONE'].includes(status) ||
    (evaluation.score!==null&&evaluation.score!==undefined&&String(evaluation.score).trim()!==''&&Number.isFinite(Number(evaluation.score))) ||
    ['CONFORME','NON_CONFORME'].includes(decision);
}
function needsReevaluation(record) {
  const returned=latestClientReturn(record);if(!returned)return false;
  const returnDate=returned.receivedAt||returned.date||'';
  return !record.internal2||String(record.internal2.date||'')<String(returnDate);
}
function debriefRatingStats(debrief) {
  const values=DEBRIEF_RATING_KEYS.map(key=>Number(debrief?.ratings?.[key])).filter(value=>Number.isInteger(value)&&value>=1&&value<=5);
  return {count:values.length,average:values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null};
}
function dashboardAgentRows(records,debriefs) {
  const rows=[];
  const getRow=(code,name)=>{
    let row=rows.find(item=>sameAgentIdentity(item.employeeCode,item.name,code,name));
    if(!row){row={employeeCode:String(code||''),name:String(name||'Agent non renseigné'),records:[],debriefs:[],linkedRecordIds:new Set()};rows.push(row);}
    if(!row.employeeCode&&code)row.employeeCode=String(code);
    if((!row.name||row.name==='Agent non renseigné')&&name)row.name=String(name);
    return row;
  };
  records.forEach(record=>getRow(record.employeeCode,record.agent).records.push(record));
  debriefs.forEach(debrief=>{
    const row=getRow(debrief.employeeCode,debrief.agent);row.debriefs.push(debrief);
    (debrief.recordIds||[]).forEach(id=>{if(records.some(record=>record.id===id))row.linkedRecordIds.add(id);});
  });
  return rows.map(row=>{
    const evaluated=row.records.filter(isEvaluated);
    const scores=evaluated.map(record=>record.internal1?.score).filter(value=>value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value))).map(Number);
    const decisions=evaluated.map(record=>String(record.internal1?.conformity||record.internal1?.decision||'').toUpperCase()).filter(value=>['CONFORME','NON_CONFORME'].includes(value));
    const returns=row.records.flatMap(getClientReturns);
    const complete=row.debriefs.filter(item=>debriefRatingStats(item).count===DEBRIEF_RATING_KEYS.length);
    const debriefScores=complete.map(item=>debriefRatingStats(item).average).filter(Number.isFinite);
    const actions=row.debriefs.flatMap(item=>Array.isArray(item.actions)?item.actions:[]);
    const open=actions.filter(item=>item.status!=='TERMINE');
    return {
      employeeCode:row.employeeCode,name:row.name,recordCount:row.records.length,evaluatedCount:evaluated.length,
      scoreAverage:scores.length?scores.reduce((sum,value)=>sum+value,0)/scores.length:null,
      conformityRate:decisions.length?decisions.filter(value=>value==='CONFORME').length/decisions.length*100:null,
      returnCount:returns.length,returnRecordCount:row.records.filter(item=>getClientReturns(item).length>0).length,
      reviewRecordCount:row.records.filter(needsReevaluation).length,debriefCount:row.debriefs.length,
      completedDebriefCount:complete.length,debriefAverage:debriefScores.length?debriefScores.reduce((sum,value)=>sum+value,0)/debriefScores.length:null,
      openActionCount:open.length,linkedRecordCount:row.linkedRecordIds.size
    };
  }).sort((a,b)=>b.evaluatedCount-a.evaluatedCount||b.returnCount-a.returnCount||a.name.localeCompare(b.name,'fr'));
}
function calculateDashboardSummary(data) {
  const records=Array.isArray(data?.records)?data.records:[];
  const debriefs=Array.isArray(data?.debriefs)?data.debriefs:[];
  const evaluated=records.filter(isEvaluated);
  const scores=evaluated.map(record=>record.internal1?.score).filter(value=>value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value))).map(Number);
  const decisions=evaluated.map(record=>String(record.internal1?.conformity||record.internal1?.decision||'').toUpperCase()).filter(value=>['CONFORME','NON_CONFORME'].includes(value));
  const returns=records.flatMap(getClientReturns);
  const returnedRecords=records.filter(record=>getClientReturns(record).length>0);
  const returnStatusCounts={DAM:0,INDECIS:0,OTHER:0,UNKNOWN:0};let donorYes=0,donorNo=0;
  returns.forEach(entry=>{
    const status=String(entry.finalStatus||entry.decision||'').toUpperCase();
    if(status==='DAM')returnStatusCounts.DAM++;else if(['INDECIS','INDECIS_ALT'].includes(status))returnStatusCounts.INDECIS++;else if(status)returnStatusCounts.OTHER++;else returnStatusCounts.UNKNOWN++;
    if(entry.alreadyDonor===true||['OUI','YES'].includes(String(entry.alreadyDonor||'').toUpperCase()))donorYes++;
    else if(entry.alreadyDonor===false||['NON','NO'].includes(String(entry.alreadyDonor||'').toUpperCase()))donorNo++;
  });
  const completed=debriefs.filter(item=>debriefRatingStats(item).count===DEBRIEF_RATING_KEYS.length);
  const completeAverages=completed.map(item=>debriefRatingStats(item).average).filter(Number.isFinite);
  const allActions=debriefs.flatMap(item=>Array.isArray(item.actions)?item.actions:[]);
  const openActions=allActions.filter(item=>item.status!=='TERMINE');
  const today=new Date().toISOString().slice(0,10);
  const overdueActions=openActions.filter(item=>item.status==='EN_RETARD'||!!(item.dueDate&&item.dueDate<today));
  const uniqueDebriefAgents=[];
  completed.forEach(item=>{if((item.employeeCode||item.agent)&&!uniqueDebriefAgents.some(other=>sameAgentIdentity(other.employeeCode,other.agent,item.employeeCode,item.agent)))uniqueDebriefAgents.push(item);});
  const linkedIds=new Set(debriefs.flatMap(item=>Array.isArray(item.recordIds)?item.recordIds:[]));
  const linkedRecords=[...linkedIds].map(id=>records.find(record=>record.id===id)).filter(Boolean);
  const linkedReturnCount=linkedRecords.reduce((sum,record)=>sum+getClientReturns(record).length,0);
  const agentMetrics=dashboardAgentRows(records,debriefs);
  return {
    recordCount:records.length,evaluatedCount:evaluated.length,unevaluatedCount:records.length-evaluated.length,
    scoreCount:scores.length,scoreAverage:scores.length?scores.reduce((sum,value)=>sum+value,0)/scores.length:null,
    decisionCount:decisions.length,conformingCount:decisions.filter(value=>value==='CONFORME').length,
    nonconformingCount:decisions.filter(value=>value==='NON_CONFORME').length,
    conformityRate:decisions.length?decisions.filter(value=>value==='CONFORME').length/decisions.length*100:null,
    returnCount:returns.length,returnedRecordCount:returnedRecords.length,returnToReviewCount:records.filter(needsReevaluation).length,
    returnStatusCounts,donorYes,donorNo,
    debrief:{sessionCount:debriefs.length,completedCount:completed.length,average:completeAverages.length?completeAverages.reduce((sum,value)=>sum+value,0)/completeAverages.length:null,agentCount:uniqueDebriefAgents.length,actionCount:allActions.length,openActionCount:openActions.length,overdueActionCount:overdueActions.length},
    linkedRecordCount:linkedRecords.length,linkedEvaluatedCount:linkedRecords.filter(isEvaluated).length,
    linkedReturnCount,linkedReviewCount:linkedRecords.filter(needsReevaluation).length,agentMetrics
  };
}
function requiredPermissionsForStateChange(existing,incoming) {
  const required=new Set();const errors=[];
  if(!existing||typeof existing!=='object')return {required:['users_roles'],errors:['Initialisation requiert le contrôle administrateur.']};
  for(const key of Object.keys(incoming||{})){
    if(SENSITIVE_STATE_KEYS.has(key)){
      if(!same(existing[key],incoming[key]))errors.push(`La propriété ${key} doit être modifiée par l'API d'administration.`);
      continue;
    }
    if(same(existing[key],incoming[key]))continue;
    if(key==='records'){
      const oldRows=new Map((existing.records||[]).map(row=>[row.id,row]));
      for(const row of incoming.records||[]){
        const old=oldRows.get(row.id);
        if(!old){required.add('records_manage');continue;}
        const keys=new Set([...Object.keys(old),...Object.keys(row)]);
        const businessChanges=[];
        for(const field of keys){if(same(old[field],row[field]))continue;
          if(field==='evaluationHistory'){
            const before=Array.isArray(old.evaluationHistory)?old.evaluationHistory:[];const after=Array.isArray(row.evaluationHistory)?row.evaluationHistory:[];
            if(after.length<before.length||before.some((entry,index)=>!same(entry,after[index])))errors.push('L’historique des évaluations doit rester append-only.');
            else for(const entry of after.slice(before.length)){const stagePermission=entry.stage==='internal1'?'synergy1':entry.stage==='internal2'?'reevaluation':entry.stage==='clientReturn'?'client_returns':entry.stage==='finalReturn'?'final_return':'records_manage';required.add(stagePermission)}
            businessChanges.push(field);continue;
          }
          if(field==='labels'&&(!same(old.internal1,row.internal1)||!same(old.internal2,row.internal2)||!same(old.clientReturns,row.clientReturns)||!same(old.finalReturnHistory,row.finalReturnHistory))){businessChanges.push(field);continue;}
          const permission=(['closedAt','closedBy'].includes(field)&&row.closedAt==null&&!same(old.clientReturns,row.clientReturns))?'client_returns':({internal1:'synergy1',internal2:'reevaluation',clientReturns:'client_returns',client1:'client_returns',clientFinal:'final_return',finalReturn:'final_return',finalReturnHistory:'final_return',clientSendHistory:'client_send',sentToClientAt:'client_send',batchId:'client_send',responseSentAt:'final_return',closedAt:'final_return',closedBy:'final_return',labels:'records_manage',audio:'records_manage'})[field];
          if(permission){required.add(permission);businessChanges.push(field);}
          else if(['status','events','updatedAt'].includes(field)){businessChanges.push(field);}
          else {required.add('records_manage');businessChanges.push(field);}
        }
        if(businessChanges.length&&!businessChanges.some(field=>!['status','events','updatedAt'].includes(field)))required.add('records_manage');
      }
      // Suppression d'une fiche n'est pas offerte dans l'interface; elle requiert une permission dédiée.
      const incomingIds=new Set((incoming.records||[]).map(row=>row.id));
      if((existing.records||[]).some(row=>!incomingIds.has(row.id)))errors.push('La suppression d’une fiche est désactivée; l’historique doit être conservé.');
      continue;
    }
    const map={batches:'client_send',tasks:'tasks',agents:'quality_settings',debriefs:'debriefs',criteriaByStage:'quality_settings',labels:'quality_settings',driveFolderId:'quality_settings',driveConnected:'quality_settings'};
    if(map[key])required.add(map[key]);else if(key==='events')continue;else errors.push(`La propriété ${key} n'est pas modifiable par l'API CRM.`);
  }
  return {required:[...required],errors};
}
function filterStateForUser(data,auth) {
  const source=JSON.parse(JSON.stringify(data||{}));
  delete source.users;delete source.roles;delete source.userRoleAssignments;
  const permissions=auth.permissions||new Set();
  const can=code=>permissions instanceof Set?permissions.has(code):Array.isArray(permissions)&&permissions.includes(code);
  const clientIds=new Set((auth.clientIds||[]).map(String));
  const roles=Array.isArray(auth.roles)?auth.roles:[];const organizationRecordAccess=roles.some(role=>role?.scope==='organization')&&can('records_view');
  const clientScoped=(clientIds.size>0||roles.some(role=>role?.scope==='assigned_client'))&&!organizationRecordAccess;
  if(clientScoped){
    const sent=record=>!!(record.sentToClientAt||(record.clientSendHistory||[]).length||(source.batches||[]).some(batch=>(batch.recordIds||[]).includes(record.id)&&(batch.ftpUploadedAt||batch.sentAt)));
    source.records=can('portal')?(source.records||[]).filter(record=>clientIds.has(String(record.clientId||''))&&sent(record)).map(record=>{
      const safe={...record};
      for(const key of ['internal1','internal2','evaluationHistory','responsible','amount','clientRef','rawSegment6','rawSegment7','labels'])delete safe[key];
      safe.events=[];
      return safe;
    }):[];
    source.batches=(source.batches||[]).filter(batch=>clientIds.has(String(batch.clientId||''))&&(batch.recordIds||[]).some(id=>source.records.some(record=>record.id===id)));
    source.tasks=[];source.debriefs=[];source.labels=[];source.events=can('portal')?(source.events||[]).filter(event=>event.clientVisible===true):[];
    source.agents=(source.agents||[]).filter(agent=>source.records.some(record=>sameAgentIdentity(agent.id,agent.name,record.employeeCode,record.agent)));
  }else{
    if(!can('records_view')&&!can('records_manage')&&!can('client_returns')&&!can('synergy1')&&!can('reevaluation')&&!can('final_return')&&!can('client_send'))source.records=[];
    else source.records=(source.records||[]).map(record=>{
      const safe={...record};
      if(!can('synergy1'))delete safe.internal1;
      if(!can('reevaluation'))delete safe.internal2;
      if(!can('client_returns')){delete safe.clientReturns;delete safe.client1;delete safe.clientCall1Status;}
      if(!can('final_return')){delete safe.clientFinal;delete safe.finalReturn;delete safe.finalReturnHistory;delete safe.responseSentAt;delete safe.closedAt;delete safe.closedBy;}
      if(!can('client_send')){delete safe.clientSendHistory;delete safe.sentToClientAt;delete safe.batchId;}
      safe.evaluationHistory=(safe.evaluationHistory||[]).filter(entry=>(entry.stage==='internal1'&&can('synergy1'))||(entry.stage==='internal2'&&can('reevaluation'))||(['clientReturn','client1'].includes(entry.stage)&&can('client_returns'))||(['finalReturn','clientFinal'].includes(entry.stage)&&can('final_return')));
      return safe;
    });
    if(!can('client_send'))source.batches=[];
    if(!can('tasks'))source.tasks=[];
    if(!can('agents'))source.agents=[];
    if(!can('debriefs'))source.debriefs=[];
    if(!can('quality_settings')){source.criteriaByStage={};source.driveFolderId='';source.driveConnected=false;}
    if(!can('records_view')&&!can('tasks')&&!can('debriefs'))source.events=[];
  }
  return source;
}

module.exports={ALL_ACTIVITY_IDS,DEBRIEF_RATING_KEYS,stable,same,normalizeAgentText,normalizeEmployeeCode,sameAgentIdentity,getClientReturns,latestClientReturn,isEvaluated,needsReevaluation,debriefRatingStats,dashboardAgentRows,calculateDashboardSummary,requiredPermissionsForStateChange,filterStateForUser};
