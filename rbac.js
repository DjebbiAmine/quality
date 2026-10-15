'use strict';

const ALL_ACTIVITY_IDS = [
  'dashboard','records_view','records_manage','records_assign','records_view_all','synergy1','client_returns','reevaluation',
  'final_return','client_send','debriefs','agents','tasks','tasks_manage','portal','quality_settings',
  'users_roles','api_dashboard_read','api_dashboard_export'
];
const DEBRIEF_RATING_KEYS = ['accroche','remerciement','script','decouverte','appelDon','objections','confirmation','cloture'];

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
  const records=(Array.isArray(data?.records)?data.records:[]).filter(record=>!record.archived);
  const debriefs=(Array.isArray(data?.debriefs)?data.debriefs:[]).filter(debrief=>!debrief.archived);
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
// Vue limitée : sans records_view_all, un profil interne ne voit que ses fiches (qualiticien = lui) et ses tâches (assigné = lui).
// Correspondance par identifiant d'utilisateur, avec le nom en secours pour les données historiques sans identifiant.
function assignedToUser(idValue,nameValue,auth){
  const id=String(idValue||'').trim();
  if(id)return id===String(auth?.id||'');
  const name=normalizeAgentText(nameValue);
  return !!name&&name===normalizeAgentText(auth?.fullName||'');
}
function recordAssignedTo(record,auth){return assignedToUser(record?.responsibleId,record?.responsible,auth)}
function taskAssignedTo(task,auth){return assignedToUser(task?.assignedToId,task?.assignedTo,auth)}
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
    source.records=can('portal')?(source.records||[]).filter(record=>!record.archived&&clientIds.has(String(record.clientId||''))&&sent(record)).map(record=>{
      const safe={...record};
      for(const key of ['internal1','internal2','evaluationHistory','responsible','responsibleId','amount','clientRef','rawSegment6','rawSegment7','labels'])delete safe[key];
      safe.events=[];
      return safe;
    }):[];
    source.batches=(source.batches||[]).filter(batch=>clientIds.has(String(batch.clientId||''))&&(batch.recordIds||[]).some(id=>source.records.some(record=>record.id===id)));
    source.tasks=[];source.debriefs=[];source.labels=[];source.optionGroups=[];source.events=can('portal')?(source.events||[]).filter(event=>event.clientVisible===true):[];
    source.agents=(source.agents||[]).filter(agent=>source.records.some(record=>sameAgentIdentity(agent.id,agent.name,record.employeeCode,record.agent)));
  }else{
    if(!can('records_view')&&!can('records_manage')&&!can('client_returns')&&!can('synergy1')&&!can('reevaluation')&&!can('final_return')&&!can('client_send'))source.records=[];
    else source.records=(source.records||[]).filter(record=>!record.archived||can('records_manage')).map(record=>{
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
    if(!can('tasks'))source.tasks=[];else if(!can('tasks_manage'))source.tasks=(source.tasks||[]).filter(task=>!task.archived);
    if(!can('agents')&&!can('records_manage')&&!can('quality_settings'))source.agents=[];
    if(!can('debriefs'))source.debriefs=[];
    if(!can('quality_settings')){source.criteriaByStage={};source.optionGroups=[];source.driveFolderId='';source.driveConnected=false;}
    if(!can('records_view')&&!can('tasks')&&!can('debriefs'))source.events=[];
    if(!can('records_view_all')){
      source.records=(source.records||[]).filter(record=>recordAssignedTo(record,auth));
      source.tasks=(source.tasks||[]).filter(task=>taskAssignedTo(task,auth));
      const visibleRecordIds=new Set(source.records.map(record=>record.id));
      source.events=(source.events||[]).filter(event=>visibleRecordIds.has(event.recordId));
    }
  }
  return source;
}

module.exports={recordAssignedTo,taskAssignedTo,ALL_ACTIVITY_IDS,DEBRIEF_RATING_KEYS,stable,same,normalizeAgentText,normalizeEmployeeCode,sameAgentIdentity,getClientReturns,latestClientReturn,isEvaluated,needsReevaluation,debriefRatingStats,dashboardAgentRows,calculateDashboardSummary,filterStateForUser};
