'use strict';
const {same,requiredPermissionsForStateChange}=require('./rbac');

const TOP_LEVEL_PERMISSION={
  batches:'client_send',tasks:'tasks',agents:'quality_settings',debriefs:'debriefs',
  criteriaByStage:'quality_settings',labels:'quality_settings',driveFolderId:'quality_settings',driveConnected:'quality_settings'
};
const CLIENT_RECORD_FIELDS=new Set(['clientReturns','client1','clientFinal','finalReturn','finalReturnHistory','status']);
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
  const permissionByField={clientCall1Status:'records_manage',labels:'records_manage',audio:'records_manage',closedAt:'final_return',closedBy:'final_return',responseSentAt:'final_return'};
  for(const field of Object.keys(row)){
    if(protectedFields.has(field)||same(old[field],row[field]))continue;
    if(field==='labels'&&!hasPermission(auth,'records_manage')&&workflowStageChanged)continue;
    if(field==='closedBy'){if(!Object.prototype.hasOwnProperty.call(row,'closedAt')||same(old.closedAt,row.closedAt))throw Object.assign(new Error('Le champ closedBy est dérivé du journal de clôture.'),{status:403,code:'HISTORY_IMMUTABLE'});continue;}
    if(field==='closedAt'){
      const needed=row.closedAt==null&&changed.clientReturns?'client_returns':'final_return';if(!hasPermission(auth,needed))throw Object.assign(new Error(`Permission insuffisante pour modifier ${field}.`),{status:403,code:'PERMISSION_DENIED',missingPermissions:[needed]});
      if(row.closedAt==null){copy.closedAt=null;copy.closedBy=null}else{copy.closedAt=now;copy.closedBy=auth.fullName||'Utilisateur'}continue;
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
function normalizeNewStaffRecord(row,auth){
  if(!hasPermission(auth,'records_manage'))throw Object.assign(new Error('Permission records_manage requise pour créer une fiche.'),{status:403,code:'PERMISSION_DENIED',missingPermissions:['records_manage']});
  const copy=structuredClone(row);const recordId=String(copy.id||'');
  for(const [stage,permission] of [['internal1','synergy1'],['internal2','reevaluation']])if(copy[stage]){if(!hasPermission(auth,permission))throw Object.assign(new Error(`Permission ${permission} requise pour créer une fiche avec une évaluation.`),{status:403,code:'PERMISSION_DENIED',missingPermissions:[permission]});copy[stage]=stampInternalEvaluation(copy[stage],null,stage,auth,!!(copy.clientReturns?.length||copy.client1));}
  if(Array.isArray(copy.clientReturns)&&copy.clientReturns.length){if(!hasPermission(auth,'client_returns'))throw Object.assign(new Error('Permission client_returns requise.'),{status:403,code:'PERMISSION_DENIED',missingPermissions:['client_returns']});copy.clientReturns=stampClientReturns([],copy.clientReturns,copy,auth,false);copy.client1=copy.clientReturns[0];}
  if(Array.isArray(copy.finalReturnHistory)&&copy.finalReturnHistory.length){if(!hasPermission(auth,'final_return'))throw Object.assign(new Error('Permission final_return requise.'),{status:403,code:'PERMISSION_DENIED',missingPermissions:['final_return']});copy.finalReturnHistory=stampFinalHistory([],copy.finalReturnHistory,auth);copy.finalReturn=copy.finalReturnHistory.at(-1);copy.clientFinal=copy.finalReturn;}
  if(Array.isArray(copy.clientSendHistory)&&copy.clientSendHistory.length){if(!hasPermission(auth,'client_send'))throw Object.assign(new Error('Permission client_send requise.'),{status:403,code:'PERMISSION_DENIED',missingPermissions:['client_send']});copy.clientSendHistory=stampClientSendHistory([],copy.clientSendHistory,copy,auth);copy.sentToClientAt=copy.clientSendHistory.at(-1).sentAt;}
  if(Array.isArray(copy.evaluationHistory)&&copy.evaluationHistory.length)throw Object.assign(new Error('Les historiques importés doivent être initialisés par la procédure d’import administrateur.'),{status:403,code:'HISTORY_IMMUTABLE'});
  if(!recordId)throw Object.assign(new Error('Identifiant de fiche invalide.'),{status:400});
  copy.events=[];return copy;
}
function mergeAppendOnlyRows(previous,proposed,label){
  const old=Array.isArray(previous)?previous:[];const incoming=Array.isArray(proposed)?proposed:[];const byId=new Map(incoming.filter(row=>row?.id).map(row=>[row.id,row]));
  for(const row of old){const next=row?.id?byId.get(row.id):incoming.find(candidate=>same(candidate,row));if(!next)continue;if(!same(row,next))throw Object.assign(new Error(`Les ${label} déjà enregistrés sont immuables.`),{status:403,code:'HISTORY_IMMUTABLE'});}
  const oldIds=new Set(old.map(row=>row?.id).filter(Boolean));const additions=incoming.filter(row=>row?.id&&!oldIds.has(row.id));
  return [...additions.map(row=>structuredClone(row)),...old.map(row=>structuredClone(row))];
}
function mergeTasks(previous,proposed){
  const old=Array.isArray(previous)?previous:[];const incoming=Array.isArray(proposed)?proposed:[];const incomingById=new Map(incoming.filter(task=>task?.id).map(task=>[task.id,task]));const oldIds=new Set(old.map(task=>task?.id).filter(Boolean));
  const updated=old.map(task=>{const next=task?.id?incomingById.get(task.id):null;return next?structuredClone(next):structuredClone(task)});const additions=incoming.filter(task=>task?.id&&!oldIds.has(task.id)).map(task=>structuredClone(task));return [...additions,...updated];
}
function isSent(record,batches){return !!(record?.sentToClientAt||(record?.clientSendHistory||[]).length||(batches||[]).some(batch=>(batch.recordIds||[]).includes(record?.id)&&(batch.ftpUploadedAt||batch.sentAt)))}
function isCallAudioAttached(audio,data){const record=(data?.records||[]).find(item=>item.id===audio?.record_id);const reference=record?.audio?.objectId||record?.audio?.id||'';return !!record&&reference===audio?.id&&String(record.clientId||'')===String(audio?.client_id||'')?record:null}
function canAccessCallAudio(auth,audio,data){const record=isCallAudioAttached(audio,data);if(!record)return false;if(hasClientScope(auth))return hasPermission(auth,'portal')&&(auth.clientIds||[]).map(String).includes(String(audio.client_id||''))&&isSent(record,data?.batches);return ['records_view','records_manage','synergy1','reevaluation','client_returns','final_return','client_send'].some(code=>hasPermission(auth,code))}
function isDebriefAudioAttached(audio,data){const debrief=(data?.debriefs||[]).find(item=>item.id===audio?.record_id);const reference=debrief?.audio?.objectId||debrief?.audio?.id||'';return !!debrief&&reference===audio?.id}
function hasClientScope(auth){const roles=Array.isArray(auth.roles)?auth.roles:[];const hasOrganizationRecordAccess=roles.some(role=>role?.scope==='organization')&&hasPermission(auth,'records_view');return (roles.some(role=>role?.scope==='assigned_client')||(Array.isArray(auth.clientIds)&&auth.clientIds.length>0))&&!hasOrganizationRecordAccess}
function mergeIncomingState(current,incoming,auth){
  const existing=structuredClone(current||{});const source=incoming&&typeof incoming==='object'?incoming:{};const merged=structuredClone(existing);
  const clientOnly=hasClientScope(auth);const clientIds=new Set((auth.clientIds||[]).map(String));const serverGeneratedTaskIds=new Set();const serverGeneratedLabelIds=new Set();const modifiedRecordIds=new Set();
  if(clientOnly&&!hasPermission(auth,'portal'))throw Object.assign(new Error('La portée client requiert la permission portail.'),{status:403,code:'PERMISSION_DENIED',missingPermissions:['portal']});
  for(const key of Object.keys(source)){
    if(['users','roles','userRoleAssignments'].includes(key))continue;
    if(key==='records'){
      const oldById=new Map((existing.records||[]).map(record=>[record.id,record]));
      const incomingRows=Array.isArray(source.records)?source.records:[];const seenIncomingIds=new Set();
      for(const row of incomingRows){if(!row||typeof row!=='object'||!row.id||seenIncomingIds.has(row.id))throw Object.assign(new Error('Liste de fiches invalide ou identifiants dupliqués.'),{status:400});seenIncomingIds.add(row.id)}
      if(clientOnly){
        const next=[...(existing.records||[])];const indexById=new Map(next.map((record,index)=>[record.id,index]));
        for(const row of incomingRows){
          const old=oldById.get(row.id);if(!old||!clientIds.has(String(old.clientId||''))||!isSent(old,existing.batches))continue;
          const copy={...old};
          for(const field of CLIENT_RECORD_FIELDS){
            if(!Object.prototype.hasOwnProperty.call(row,field))continue;
            if(field==='clientReturns'){
              if(!hasPermission(auth,'client_returns'))continue;
              copy.clientReturns=stampClientReturns(old.clientReturns,row.clientReturns,old,auth,true);
              if(copy.clientReturns.length>(old.clientReturns||[]).length){copy.client1=copy.client1||copy.clientReturns[0];copy.status='retour_client_recu';if(old.closedAt){copy.closedAt=null;copy.closedBy=null}}
              continue;
            }
            if(field==='client1')continue; // alias legacy dérivé côté serveur à partir de clientReturns
            if(field==='finalReturnHistory'){
              if(!hasPermission(auth,'final_return'))continue;
              copy.finalReturnHistory=stampFinalHistory(old.finalReturnHistory,row.finalReturnHistory,auth);
              if(copy.finalReturnHistory.length>(old.finalReturnHistory||[]).length){copy.finalReturn=copy.finalReturnHistory.at(-1);copy.clientFinal=copy.finalReturn;copy.status='retour_final_recu'}
              continue;
            }
            if(['clientFinal','finalReturn'].includes(field))continue; // alias de l’historique final append-only
            if(field==='status')continue; // le statut est dérivé du retour validé par le serveur
          }
          const index=indexById.get(row.id);next[index]=copy;if(!same(old,copy))modifiedRecordIds.add(row.id);
        }
        merged.records=next;
      }else if(['records_view','records_manage','synergy1','client_returns','reevaluation','final_return','client_send'].some(code=>hasPermission(auth,code))){
        const next=[...(existing.records||[])];const additions=[];const indexById=new Map(next.map((record,index)=>[record.id,index]));
        for(const row of incomingRows){
          const index=indexById.get(row.id);
          if(index===undefined){const normalized=normalizeNewStaffRecord(row,auth);additions.push(normalized);modifiedRecordIds.add(row.id)}
          else{const original=next[index];const updated=mergeStaffRecord(original,row,auth,merged.labels||[]);next[index]=updated;if(!same(original,updated))modifiedRecordIds.add(row.id)}
        }
        merged.records=[...additions,...next];
      }
      continue;
    }
    if(key==='events'){
      if(clientOnly)continue;
      // Le journal faisant autorité est app_audit_log, append-only. L'historique d'interface
      // conserve uniquement de nouvelles entrées; les entrées existantes ne sont jamais éditées.
      const oldEvents=Array.isArray(existing.events)?existing.events:[];const ids=new Set(oldEvents.map(event=>event.id));
      const additions=(Array.isArray(source.events)?source.events:[]).filter(event=>event?.id&&!ids.has(event.id));
      if(additions.length){merged.events=[...additions.map(event=>({...event,actor:auth.fullName||'Utilisateur',at:new Date().toISOString()})),...oldEvents]}
      continue;
    }
    if(Object.prototype.hasOwnProperty.call(TOP_LEVEL_PERMISSION,key)&&hasPermission(auth,TOP_LEVEL_PERMISSION[key])){
      if(key==='debriefs')merged.debriefs=mergeAppendOnlyRows(existing.debriefs,source.debriefs,'sessions de débrief');
      else if(key==='batches')merged.batches=mergeAppendOnlyRows(existing.batches,source.batches,'envois client');
      else if(key==='tasks')merged.tasks=mergeTasks(existing.tasks,source.tasks);
      else merged[key]=structuredClone(source[key]);
    }
  }
  const labelCatalog=Array.isArray(merged.labels)?merged.labels:[];
  for(const recordId of modifiedRecordIds){const record=oldBy(merged.records,recordId);if(!record)continue;const workflowLabels=workflowLabelsForRecord(record,labelCatalog);record.labels=[...new Set([...(Array.isArray(record.labels)?record.labels:[]),...workflowLabels.map(label=>label.id)])];for(const label of workflowLabels){if(labelCatalog.some(existingLabel=>String(existingLabel.id)===label.id))continue;labelCatalog.push(label);if(!hasPermission(auth,'quality_settings'))serverGeneratedLabelIds.add(label.id)}}
  if(modifiedRecordIds.size)merged.labels=labelCatalog;
  for(const record of merged.records||[]){const previous=oldBy(current.records,record.id);if(!previous||(record.clientReturns||[]).length<=(previous.clientReturns||[]).length)continue;const pending=(merged.tasks||[]).some(task=>task.recordId===record.id&&task.type==='REEVALUATION_2'&&task.status!=='TERMINE');if(pending)continue;const due=new Date();due.setUTCDate(due.getUTCDate()+2);const id=`task-auto-reevaluation-${record.id}-${(record.clientReturns||[]).at(-1)?.returnNumber||Date.now()}`;if((merged.tasks||[]).some(task=>task.id===id))continue;const task={id,type:'REEVALUATION_2',title:'Réévaluation après retour client',recordId:record.id,assignedTo:record.responsible||'À assigner',priority:'HAUTE',createdAt:new Date().toISOString(),dueDate:due.toISOString().slice(0,10),status:'A_FAIRE'};merged.tasks=[task,...(merged.tasks||[])];serverGeneratedTaskIds.add(id);}
  // Les profils clients ne peuvent modifier que les champs de retour d'une fiche
  // déjà transmise, appartenant à leur périmètre affecté.
  if(clientOnly){
    const allowed=new Set(['clientReturns','client1','clientFinal','finalReturn','finalReturnHistory','status','labels','closedAt','closedBy']);
    for(const nextRecord of merged.records||[]){
      const old=oldBy(current.records,nextRecord.id);
      if(!old||!clientIds.has(String(old.clientId||''))||!isSent(old,current.batches))continue;
      const proposed=oldBy(source.records,nextRecord.id);if(!proposed)continue;
      for(const field of Object.keys(proposed)){
        if(['id','clientId','events'].includes(field)||allowed.has(field))continue;
        if(!same(old[field],proposed[field]))throw Object.assign(new Error('Un compte client ne peut modifier que les champs de retour des fiches qui lui sont affectées.'),{status:403,code:'CLIENT_SCOPE'});
      }
    }
  }
  const comparisonBase=structuredClone(existing);const comparisonNext=structuredClone(merged);
  for(const key of ['users','roles','userRoleAssignments']){delete comparisonBase[key];delete comparisonNext[key];}
  const delta=requiredPermissionsForStateChange(comparisonBase,comparisonNext);
  if(delta.errors.length)throw Object.assign(new Error(delta.errors.join(' ')),{status:403,code:'STATE_MUTATION_REJECTED'});
  const required=delta.required.filter(code=>!(code==='tasks'&&serverGeneratedTaskIds.size>0&&!hasPermission(auth,'tasks'))&&!(code==='quality_settings'&&serverGeneratedLabelIds.size>0&&!hasPermission(auth,'quality_settings')));
  const missing=required.filter(code=>!hasPermission(auth,code));
  if(missing.length)throw Object.assign(new Error(`Permission insuffisante pour modifier : ${missing.join(', ')}.`),{status:403,code:'PERMISSION_DENIED',missingPermissions:missing});
  return {data:merged,requiredPermissions:required};
}
function oldBy(rows,id){return (rows||[]).find(row=>row.id===id)||null}

module.exports={mergeIncomingState,hasPermission,hasClientScope,isSent,isCallAudioAttached,canAccessCallAudio,isDebriefAudioAttached};
