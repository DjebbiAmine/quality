'use strict';
const {same,recordAssignedTo}=require('./rbac');

function hasPermission(auth,code){return auth.permissions instanceof Set?auth.permissions.has(code):(auth.permissions||[]).includes(code)}
function canSeeEvaluationStage(auth,stage){return (stage==='internal1'&&hasPermission(auth,'synergy1'))||(stage==='internal2'&&hasPermission(auth,'reevaluation'))||(['clientReturn','client1'].includes(stage)&&hasPermission(auth,'client_returns'))||(['finalReturn','clientFinal'].includes(stage)&&hasPermission(auth,'final_return'))}
function stampClientReturns(previous,proposed,record,auth,clientPortal=false){
  if(!Array.isArray(proposed))throw Object.assign(new Error('Historique des retours invalide.'),{status:400});
  const old=Array.isArray(previous)?previous:[];
  if(proposed.length<old.length||old.some((entry,index)=>!same(entry,proposed[index])))throw Object.assign(new Error('Les retours client déjà enregistrés sont immuables.'),{status:403,code:'HISTORY_IMMUTABLE'});
  const now=new Date().toISOString();const nextNumber=Math.max(0,...old.map(entry=>Number(entry?.returnNumber)||0));const newEntries=proposed.slice(old.length);if(newEntries.length>1)throw Object.assign(new Error('Un seul nouveau retour client peut être ajouté par requête.'),{status:400});const additions=newEntries.map((entry,index)=>{
    const status=String(entry?.finalStatus||entry?.decision||'').toUpperCase();
    if(!['DAM','INDECIS'].includes(status)||typeof entry?.alreadyDonor!=='boolean')throw Object.assign(new Error('Un retour client doit avoir un statut final DAM/Indécis et une réponse donateur Oui/Non.'),{status:400});
    const previousReturn=(record?.clientReturns||[]).slice(-1)[0]||{};const expectedBase=String(record?.baseName||previousReturn.baseSnapshot||previousReturn.base||'').trim();const expectedIndex=String(record?.recordIndex||previousReturn.recordIndexSnapshot||previousReturn.indexSnapshot||'').trim();const expectedCall1=String(record?.clientCall1Status||record?.call1Status||previousReturn.call1Status||'').trim();
    if(String(entry.baseSnapshot||'').trim()!==expectedBase)throw Object.assign(new Error('Le Nom de base ne correspond pas à la fiche.'),{status:400});
    if(String(entry.recordIndexSnapshot||'').trim()!==expectedIndex)throw Object.assign(new Error('L’indice ne correspond pas à la fiche.'),{status:400});
    if(String(entry.call1Status||'').trim()!==expectedCall1)throw Object.assign(new Error('Le Statut Call 1 ne correspond pas à la fiche.'),{status:400});
    const sourceChannel=clientPortal?'PORTAL':'EMAIL';const receivedAt=clientPortal?now:String(entry.receivedAt||entry.date||now);
    return {...entry,id:`return-${Date.now()}-${nextNumber+index+1}`,stage:'clientReturn',returnNumber:nextNumber+index+1,receivedAt,recordedAt:now,recordedBy:auth.fullName||'Utilisateur',recordedById:auth.id,sourceChannel,baseSnapshot:expectedBase||String(entry.baseSnapshot||''),recordIndexSnapshot:expectedIndex||String(entry.recordIndexSnapshot||''),call1Status:expectedCall1||String(entry.call1Status||''),finalStatus:status,clientRemarks:String(entry.clientRemarks||'').slice(0,4000)};
  });
  return [...old,...additions];
}
function stampFinalHistory(previous,proposed,auth){
  if(!Array.isArray(proposed))throw Object.assign(new Error('Historique de retour final invalide.'),{status:400});
  const old=Array.isArray(previous)?previous:[];
  if(proposed.length<old.length||old.some((entry,index)=>!same(entry,proposed[index])))throw Object.assign(new Error('Les retours finaux déjà enregistrés sont immuables.'),{status:403,code:'HISTORY_IMMUTABLE'});
  const nextVersion=Math.max(0,...old.map(entry=>Number(entry?.version)||0));const additions=proposed.slice(old.length);if(additions.length>1)throw Object.assign(new Error('Un seul nouveau retour final peut être ajouté par requête.'),{status:400});
  return [...old,...additions.map((entry,index)=>{const status=String(entry?.status||entry?.decision||entry?.finalStatus||'').toUpperCase();if(!['VALIDE','NON_VALIDE'].includes(status))throw Object.assign(new Error('Statut final invalide.'),{status:400});const now=new Date().toISOString();return {...entry,id:`final-${Date.now()}-${nextVersion+index+1}`,stage:'finalReturn',version:nextVersion+index+1,status,date:now,recordedBy:auth.fullName||'Utilisateur',recordedById:auth.id}})];
}
function stampInternalEvaluation(entry,previous,stage,auth,hasClientReturn){
  if(!entry||typeof entry!=='object'||Array.isArray(entry))throw Object.assign(new Error('Évaluation invalide.'),{status:400});
  if(stage==='internal2'){
    const analysis=String(entry.analysisPoleQualite||'').trim();const promise=String(entry.promiseStatus||entry.finalStatus||entry.decision||'');const donation=String(entry.donConformity||entry.donStatus||entry.conformity||'');
    if(!hasClientReturn)throw Object.assign(new Error('La réévaluation doit rester attachée à une fiche ayant un retour client.'),{status:400});
    if(!analysis||!['PROMESSE_VALIDE','PROMESSE_NON_VALIDE'].includes(promise)||!['CONFORME','NON_CONFORME'].includes(donation))throw Object.assign(new Error('Les champs de réévaluation enregistrés sont incomplets.'),{status:400});
  }
  return {...structuredClone(entry),stage,status:'TERMINEE',version:(Number(previous?.version)||0)+1,date:new Date().toISOString(),evaluator:auth.fullName||'Utilisateur',evaluatorId:auth.id};
}
function workflowLabelsForRecord(record,catalog=[]){
  const wanted=[];if((record?.clientReturns||[]).length||record?.client1)wanted.push(['Retour client','purple']);if(record?.internal2||(record?.evaluationHistory||[]).some(entry=>entry.stage==='internal2'))wanted.push(['Réévaluation','amber']);if((record?.finalReturnHistory||[]).length||record?.finalReturn||record?.clientFinal)wanted.push(['Retour final','green']);
  return wanted.map(([name,tone])=>{const existing=(catalog||[]).find(label=>String(label?.name||'').trim().toLocaleLowerCase('fr')===name.toLocaleLowerCase('fr'));const slug=name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');return {id:String(existing?.id||`lbl-${slug}`),name:existing?.name||name,tone:existing?.tone||tone}});
}
function stampClientSendHistory(previous,proposed,record,auth){
  if(!Array.isArray(proposed))throw Object.assign(new Error('Historique d’envoi invalide.'),{status:400});
  const old=Array.isArray(previous)?previous:[];
  if(proposed.length<old.length||old.some((entry,index)=>!same(entry,proposed[index])))throw Object.assign(new Error('Les envois déjà enregistrés sont immuables.'),{status:403,code:'HISTORY_IMMUTABLE'});
  const additions=proposed.slice(old.length);if(additions.length>1)throw Object.assign(new Error('Un seul nouvel envoi peut être ajouté par requête.'),{status:400});
  return [...old,...additions.map(entry=>{
    const exportMode=String(entry?.exportMode||'');if(!['EXCEL','AUDIO_ZIP','BOTH'].includes(exportMode))throw Object.assign(new Error('Mode d’export client invalide.'),{status:400});
    const evaluation=record?.internal2?{stage:'internal2',evaluation:record.internal2}:record?.internal1?{stage:'internal1',evaluation:record.internal1}:{stage:'NONE',evaluation:null};
    return {...entry,id:`send-${Date.now()}-${old.length+1}`,sentAt:new Date().toISOString(),sentBy:auth.fullName||'Utilisateur',deliveryMethod:'FTP_MANUAL',evaluationStage:evaluation.stage,evaluationVersion:Number(evaluation.evaluation?.version)||0,ftpDestination:String(entry.ftpDestination||'').slice(0,500)};
  })];
}
function mergeStaffRecord(old,row,auth,labelCatalog=[]){
  const copy=structuredClone(old);const changed={internal1:false,internal2:false,clientReturns:false,finalReturn:false,clientSend:false};const history=Array.isArray(old.evaluationHistory)?structuredClone(old.evaluationHistory):[];const now=new Date().toISOString();
  for(const [stage,permission] of [['internal1','synergy1'],['internal2','reevaluation']]){
    if(!Object.prototype.hasOwnProperty.call(row,stage)||same(old[stage],row[stage]))continue;
    if(!hasPermission(auth,permission))throw Object.assign(new Error(`Permission insuffisante pour modifier ${stage}.`),{status:403,code:'PERMISSION_DENIED',missingPermissions:[permission]});
    if(!row[stage]&&old[stage])throw Object.assign(new Error('Une évaluation existante ne peut pas être supprimée.'),{status:403,code:'HISTORY_IMMUTABLE'});
    if(old[stage])history.push({...structuredClone(old[stage]),stage,archivedAt:now});
    const hasReturn=(old.clientReturns||[]).length>0||!!old.client1||(Array.isArray(row.clientReturns)&&row.clientReturns.length>0);
    copy[stage]=stampInternalEvaluation(row[stage],old[stage],stage,auth,hasReturn);changed[stage]=true;
  }
  if(Object.prototype.hasOwnProperty.call(row,'clientReturns')){
    if(!same(old.clientReturns,row.clientReturns)){
      if(!hasPermission(auth,'client_returns'))throw Object.assign(new Error('Permission insuffisante pour saisir les retours client.'),{status:403,code:'PERMISSION_DENIED',missingPermissions:['client_returns']});
      copy.clientReturns=stampClientReturns(old.clientReturns,row.clientReturns,old,auth,false);changed.clientReturns=true;
    }else copy.clientReturns=structuredClone(old.clientReturns||[]);
  }else if(old.clientReturns)copy.clientReturns=structuredClone(old.clientReturns);
  if(changed.clientReturns)copy.client1=old.client1||copy.clientReturns[0]||null;
  if(Object.prototype.hasOwnProperty.call(row,'client1')&&!same(old.client1,row.client1)&&!changed.clientReturns)throw Object.assign(new Error('L’alias historique du retour client est en lecture seule.'),{status:403,code:'HISTORY_IMMUTABLE'});
  if(Object.prototype.hasOwnProperty.call(row,'finalReturnHistory')){
    if(!same(old.finalReturnHistory,row.finalReturnHistory)){
      if(!hasPermission(auth,'final_return'))throw Object.assign(new Error('Permission insuffisante pour saisir le retour final.'),{status:403,code:'PERMISSION_DENIED',missingPermissions:['final_return']});
      copy.finalReturnHistory=stampFinalHistory(old.finalReturnHistory,row.finalReturnHistory,auth);changed.finalReturn=true;
    }else copy.finalReturnHistory=structuredClone(old.finalReturnHistory||[]);
  }else if(old.finalReturnHistory)copy.finalReturnHistory=structuredClone(old.finalReturnHistory);
  if(changed.finalReturn){copy.finalReturn=copy.finalReturnHistory.at(-1)||null;copy.clientFinal=copy.finalReturn;}
  if(!changed.finalReturn&&((Object.prototype.hasOwnProperty.call(row,'finalReturn')&&!same(old.finalReturn,row.finalReturn))||(Object.prototype.hasOwnProperty.call(row,'clientFinal')&&!same(old.clientFinal,row.clientFinal))))throw Object.assign(new Error('Les alias du retour final sont en lecture seule; ajoutez une version à l’historique.'),{status:403,code:'HISTORY_IMMUTABLE'});
  if(Object.prototype.hasOwnProperty.call(row,'clientSendHistory')){
    if(!same(old.clientSendHistory,row.clientSendHistory)){
      if(!hasPermission(auth,'client_send'))throw Object.assign(new Error('Permission insuffisante pour enregistrer un envoi client.'),{status:403,code:'PERMISSION_DENIED',missingPermissions:['client_send']});
      copy.clientSendHistory=stampClientSendHistory(old.clientSendHistory,row.clientSendHistory,old,auth);changed.clientSend=true;
    }else copy.clientSendHistory=structuredClone(old.clientSendHistory||[]);
  }else if(old.clientSendHistory)copy.clientSendHistory=structuredClone(old.clientSendHistory);
  if(changed.clientSend){copy.sentToClientAt=copy.clientSendHistory.at(-1)?.sentAt||old.sentToClientAt||null;if(!copy.clientReturns?.length)copy.status='envoyee_client';}
  if(changed.clientReturns){copy.status='retour_client_recu';if(old.closedAt){copy.closedAt=null;copy.closedBy=null}}
  if(changed.finalReturn)copy.status='retour_final_recu';
  if(changed.internal1)copy.status='evaluation_1_terminee';
  if(changed.internal2)copy.status='evaluation_2_terminee';
  const protectedFields=new Set(['id','internal1','internal2','evaluationHistory','clientReturns','client1','clientFinal','finalReturn','finalReturnHistory','clientSendHistory','sentToClientAt','status','events','updatedAt']);
  const workflowStageChanged=changed.internal1||changed.internal2||changed.clientReturns||changed.finalReturn;
  const permissionByField={clientCall1Status:'records_manage',labels:'records_manage',audio:'records_manage',responsible:'records_assign',responsibleId:'records_assign',closedAt:'final_return',closedBy:'final_return',responseSentAt:'final_return'};
  for(const field of Object.keys(row)){
    if(protectedFields.has(field)||same(old[field],row[field]))continue;
    if(field==='labels'&&!hasPermission(auth,'records_manage')&&workflowStageChanged)continue;
    if(field==='closedBy'){if(!Object.prototype.hasOwnProperty.call(row,'closedAt')||same(old.closedAt,row.closedAt))throw Object.assign(new Error('Le champ closedBy est dérivé du journal de clôture.'),{status:403,code:'HISTORY_IMMUTABLE'});continue;}
    if(field==='closedAt'){
      const needed=row.closedAt==null&&changed.clientReturns?'client_returns':'final_return';if(!hasPermission(auth,needed))throw Object.assign(new Error(`Permission insuffisante pour modifier ${field}.`),{status:403,code:'PERMISSION_DENIED',missingPermissions:[needed]});
      if(row.closedAt==null){copy.closedAt=null;copy.closedBy=null}else{copy.closedAt=now;copy.closedBy=auth.fullName||'Utilisateur'}continue;
    }
    if(field==='archivedAt'||field==='archivedBy')continue;
    if(field==='archived'){
      if(!hasPermission(auth,'records_manage'))throw Object.assign(new Error('Permission insuffisante pour modifier archived.'),{status:403,code:'PERMISSION_DENIED',missingPermissions:['records_manage']});
      copy.archived=row.archived===true;copy.archivedAt=copy.archived?now:null;copy.archivedBy=copy.archived?(auth.fullName||'Utilisateur'):null;continue;
    }
    let needed=permissionByField[field]||'records_manage';
    if(!hasPermission(auth,needed))throw Object.assign(new Error(`Permission insuffisante pour modifier ${field}.`),{status:403,code:'PERMISSION_DENIED',missingPermissions:[needed]});
    copy[field]=structuredClone(row[field]);
  }
  const historyChanged=changed.internal1||changed.internal2;
  if(history.length||Array.isArray(old.evaluationHistory))copy.evaluationHistory=history;
  if(Object.prototype.hasOwnProperty.call(row,'evaluationHistory')&&!historyChanged){const visibleHistory=(Array.isArray(old.evaluationHistory)?old.evaluationHistory:[]).filter(entry=>canSeeEvaluationStage(auth,entry.stage));if(!same(visibleHistory,row.evaluationHistory))throw Object.assign(new Error('L’historique des évaluations est en lecture seule.'),{status:403,code:'HISTORY_IMMUTABLE'});}
  if(Object.prototype.hasOwnProperty.call(row,'status')&&!same(old.status,row.status)&&!changed.clientReturns&&!changed.finalReturn&&!changed.clientSend&&!changed.internal1&&!changed.internal2){
    const closing=Object.prototype.hasOwnProperty.call(row,'closedAt')&&!same(old.closedAt,row.closedAt);
    const needed=closing?'final_return':'records_manage';if(!hasPermission(auth,needed))throw Object.assign(new Error('Permission insuffisante pour modifier le statut de la fiche.'),{status:403,code:'PERMISSION_DENIED',missingPermissions:[needed]});
    copy.status=String(row.status||'');
  }
  const shouldSyncWorkflowLabels=workflowStageChanged||hasPermission(auth,'records_manage');
  const workflowLabels=shouldSyncWorkflowLabels?workflowLabelsForRecord(copy,labelCatalog):[];const workflowIds=new Set(workflowLabels.map(label=>label.id));
  if(!shouldSyncWorkflowLabels){if(Object.prototype.hasOwnProperty.call(old,'labels'))copy.labels=structuredClone(old.labels);else delete copy.labels;}
  else if(!hasPermission(auth,'records_manage')){
    const previousLabels=new Set(Array.isArray(old.labels)?old.labels.map(String):[]);const proposedLabels=new Set(Array.isArray(row.labels)?row.labels.map(String):[...previousLabels]);
    if([...previousLabels].some(id=>!proposedLabels.has(id))||[...proposedLabels].some(id=>!previousLabels.has(id)&&!workflowIds.has(id)))throw Object.assign(new Error('La modification de libellés personnalisés requiert records_manage.'),{status:403,code:'PERMISSION_DENIED',missingPermissions:['records_manage']});
    copy.labels=[...new Set([...previousLabels,...workflowLabels.map(label=>label.id)])];
  }else copy.labels=[...new Set([...(Array.isArray(copy.labels)?copy.labels:[]),...workflowLabels.map(label=>label.id)])];
  return copy;
}
function mergeAppendOnlyRows(previous,proposed,label){
  const old=Array.isArray(previous)?previous:[];const incoming=Array.isArray(proposed)?proposed:[];const byId=new Map(incoming.filter(row=>row?.id).map(row=>[row.id,row]));
  for(const row of old){const next=row?.id?byId.get(row.id):incoming.find(candidate=>same(candidate,row));if(!next)continue;if(!same(row,next))throw Object.assign(new Error(`Les ${label} déjà enregistrés sont immuables.`),{status:403,code:'HISTORY_IMMUTABLE'});}
  const oldIds=new Set(old.map(row=>row?.id).filter(Boolean));const additions=incoming.filter(row=>row?.id&&!oldIds.has(row.id));
  return [...additions.map(row=>structuredClone(row)),...old.map(row=>structuredClone(row))];
}
// Un nouveau retour client déclenche (côté serveur) une tâche « Réévaluation » assignée au qualiticien de la fiche, sauf s'il en existe déjà une ouverte.
function createAutoReevaluationTasks(before,after,now=new Date()){
  const previous=new Map((before?.records||[]).map(record=>[record.id,record]));
  for(const record of after.records||[]){
    const old=previous.get(record.id);
    if(!old||(record.clientReturns||[]).length<=(old.clientReturns||[]).length)continue;
    if((after.tasks||[]).some(task=>!task.archived&&task.recordId===record.id&&task.type==='REEVALUATION_2'&&task.status!=='TERMINE'))continue;
    const id=`task-auto-reevaluation-${record.id}-${(record.clientReturns||[]).at(-1)?.returnNumber||now.getTime()}`;
    if((after.tasks||[]).some(task=>task.id===id))continue;
    const due=new Date(now);due.setUTCDate(due.getUTCDate()+2);
    after.tasks=[{id,type:'REEVALUATION_2',auto:true,title:'Réévaluation après retour client',recordId:record.id,assignedTo:record.responsible||'À assigner',assignedToId:record.responsibleId||'',priority:'HAUTE',createdAt:now.toISOString(),dueDate:due.toISOString().slice(0,10),status:'A_FAIRE'},...(after.tasks||[])];
  }
}
// Une évaluation enregistrée termine la tâche ouverte correspondante (Synergy #1 -> EVALUATION_1, réévaluation -> REEVALUATION_2).
function completeEvaluationTasks(before,after,now=new Date()){
  const previous=new Map((before?.records||[]).map(record=>[record.id,record]));
  for(const record of after.records||[]){
    const old=previous.get(record.id);if(!old)continue;
    for(const [stage,type] of [['internal1','EVALUATION_1'],['internal2','REEVALUATION_2']]){
      if(!record[stage]||same(old[stage],record[stage]))continue;
      const task=(after.tasks||[]).find(item=>!item.archived&&item.recordId===record.id&&item.type===type&&item.status!=='TERMINE');
      if(task)after.tasks=after.tasks.map(item=>item===task?{...item,status:'TERMINE',completedAt:now.toISOString()}:item);
    }
  }
}
function isSent(record,batches){return !!(record?.sentToClientAt||(record?.clientSendHistory||[]).length||(batches||[]).some(batch=>(batch.recordIds||[]).includes(record?.id)&&(batch.ftpUploadedAt||batch.sentAt)))}
function isCallAudioAttached(audio,data){const record=(data?.records||[]).find(item=>item.id===audio?.record_id);const reference=record?.audio?.objectId||record?.audio?.id||'';return !!record&&reference===audio?.id&&String(record.clientId||'')===String(audio?.client_id||'')?record:null}
function canAccessCallAudio(auth,audio,data){const record=isCallAudioAttached(audio,data);if(!record)return false;if(record.archived&&(hasClientScope(auth)||!hasPermission(auth,'records_manage')))return false;if(!hasClientScope(auth)&&!hasPermission(auth,'records_view_all')&&!recordAssignedTo(record,auth))return false;if(hasClientScope(auth))return hasPermission(auth,'portal')&&(auth.clientIds||[]).map(String).includes(String(audio.client_id||''))&&isSent(record,data?.batches);return ['records_view','records_manage','synergy1','reevaluation','client_returns','final_return','client_send'].some(code=>hasPermission(auth,code))}
function isDebriefAudioAttached(audio,data){const debrief=(data?.debriefs||[]).find(item=>item.id===audio?.record_id);const reference=debrief?.audio?.objectId||debrief?.audio?.id||'';return !!debrief&&reference===audio?.id}
function hasClientScope(auth){const roles=Array.isArray(auth.roles)?auth.roles:[];const hasOrganizationRecordAccess=roles.some(role=>role?.scope==='organization')&&hasPermission(auth,'records_view');return (roles.some(role=>role?.scope==='assigned_client')||(Array.isArray(auth.clientIds)&&auth.clientIds.length>0))&&!hasOrganizationRecordAccess}
// Seule voie d'écriture restante de PUT /quality/api/state : le circuit d'envoi client (historique d'envoi des fiches, lots, journal).
// Tout le reste passe par des routes dédiées; une modification d'une autre donnée est refusée (USE_DEDICATED_ROUTE).
const SEND_RECORD_KEYS=new Set(['clientSendHistory','sentToClientAt','status']);
const IGNORED_RECORD_KEYS=new Set(['evaluationHistory','events','updatedAt']);
// Le navigateur n'envoie jamais `localUrl` (URL d'objet locale, purement d'affichage) : elle ne compte pas comme une modification.
const withoutLocalUrl=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value,(key,item)=>key==='localUrl'?undefined:item));
const dedicatedRoute=message=>Object.assign(new Error(message),{status:400,code:'USE_DEDICATED_ROUTE'});
function mergeSendStateChange(current,incoming,auth){
  const existing=structuredClone(current||{});const source=incoming&&typeof incoming==='object'?incoming:{};const merged=structuredClone(existing);
  const canSend=hasPermission(auth,'client_send');let touched=false;
  const requireSend=()=>{if(!canSend)throw Object.assign(new Error('Permission insuffisante pour modifier : client_send.'),{status:403,code:'PERMISSION_DENIED',missingPermissions:['client_send']});touched=true};
  if(hasClientScope(auth)){
    // Un profil client reçoit un état filtré et n'écrit que par les routes dédiées des fiches (retours client / retours finaux) :
    // on refuse explicitement un ancien navigateur qui tenterait encore d'y ajouter un retour, le reste est ignoré.
    const oldById=new Map((existing.records||[]).map(record=>[record.id,record]));
    for(const row of Array.isArray(source.records)?source.records:[]){
      const old=oldById.get(row?.id);if(!old)continue;
      if((row.clientReturns||[]).length>(old.clientReturns||[]).length||(row.finalReturnHistory||[]).length>(old.finalReturnHistory||[]).length)throw dedicatedRoute('Les retours d’un compte client passent par les routes dédiées des fiches : rechargez l’application.');
    }
    return {data:merged,requiredPermissions:[]};
  }
  // Sections déplacées vers des routes dédiées : toute modification est refusée (comparées seulement quand l'utilisateur les voit en entier).
  const visible={agents:['agents','records_manage','quality_settings'],labels:null,criteriaByStage:['quality_settings'],optionGroups:['quality_settings'],driveFolderId:['quality_settings'],driveConnected:['quality_settings']};
  for(const [key,codes] of Object.entries(visible)){
    if(!Object.prototype.hasOwnProperty.call(source,key)||(codes&&!codes.some(code=>hasPermission(auth,code))))continue;
    if(!same(existing[key],source[key]))throw dedicatedRoute(`La section « ${key} » ne se modifie plus par l’enregistrement d’état : utilisez sa route dédiée (rechargez l’application).`);
  }
  if(Object.prototype.hasOwnProperty.call(source,'records')){
    const incomingRows=Array.isArray(source.records)?source.records:[];const seen=new Set();
    for(const row of incomingRows){if(!row||typeof row!=='object'||!row.id||seen.has(row.id))throw Object.assign(new Error('Liste de fiches invalide ou identifiants dupliqués.'),{status:400});seen.add(row.id)}
    const oldById=new Map((existing.records||[]).map(record=>[record.id,record]));const next=[...(existing.records||[])];const indexById=new Map(next.map((record,index)=>[record.id,index]));
    for(const row of incomingRows){
      const old=oldById.get(row.id);
      if(!old)throw dedicatedRoute('La création d’une fiche passe par POST /quality/api/records : rechargez l’application.');
      const changed=Object.keys(row).filter(key=>!IGNORED_RECORD_KEYS.has(key)&&!same(withoutLocalUrl(old[key]),withoutLocalUrl(row[key])));
      if(!changed.length)continue;
      if(!hasPermission(auth,'records_view_all')&&!recordAssignedTo(old,auth))throw Object.assign(new Error('Cette fiche n’est pas affectée à votre compte.'),{status:403,code:'SCOPE_DENIED'});
      const refused=changed.filter(key=>!SEND_RECORD_KEYS.has(key));
      if(refused.length||!changed.includes('clientSendHistory'))throw dedicatedRoute(`Modification de la fiche ${row.id} refusée (${(refused.length?refused:changed).join(', ')}) : utilisez les routes dédiées des fiches (rechargez l’application).`);
      requireSend();
      if(old.archived)throw Object.assign(new Error('Cette fiche est supprimée : elle ne peut plus être envoyée.'),{status:409,code:'RECORD_ARCHIVED'});
      {const {evaluationHistory,...base}=old;next[indexById.get(row.id)]=mergeStaffRecord(old,{...base,clientSendHistory:row.clientSendHistory},auth,existing.labels||[])}
    }
    merged.records=next;
  }
  if(Object.prototype.hasOwnProperty.call(source,'events')){
    // Le journal d'interface ne reçoit que de nouvelles entrées; les entrées existantes ne sont jamais éditées.
    const oldEvents=Array.isArray(existing.events)?existing.events:[];const ids=new Set(oldEvents.map(event=>event.id));
    const scopedIds=hasPermission(auth,'records_view_all')?null:new Set((existing.records||[]).filter(record=>recordAssignedTo(record,auth)).map(record=>record.id));
    const additions=(Array.isArray(source.events)?source.events:[]).filter(event=>event?.id&&!ids.has(event.id)&&(!scopedIds||!event.recordId||scopedIds.has(event.recordId)));
    if(additions.length&&canSend){requireSend();merged.events=[...additions.map(event=>({...event,actor:auth.fullName||'Utilisateur',at:new Date().toISOString()})),...oldEvents]}
  }
  if(canSend&&Object.prototype.hasOwnProperty.call(source,'batches')&&!same(existing.batches,source.batches)){requireSend();merged.batches=mergeAppendOnlyRows(existing.batches,source.batches,'envois client')}
  return {data:merged,requiredPermissions:touched?['client_send']:[]};
}


module.exports={mergeStaffRecord,stampClientReturns,stampFinalHistory,workflowLabelsForRecord,mergeSendStateChange,createAutoReevaluationTasks,completeEvaluationTasks,hasPermission,hasClientScope,isSent,isCallAudioAttached,canAccessCallAudio,isDebriefAudioAttached};
