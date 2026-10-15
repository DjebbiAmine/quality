const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  toggle(value, force) {
    const enabled = force === undefined ? !this.values.has(value) : force;
    enabled ? this.values.add(value) : this.values.delete(value);
    return enabled;
  }
  contains(value) { return this.values.has(value); }
}
class FakeElement {
  constructor(id = '') {
    this.id = id; this.innerHTML = ''; this.textContent = ''; this.value = '';
    this.hidden = false; this.checked = false; this.files = []; this.dataset = {};
    this.children = []; this.style = {}; this.classList = new FakeClassList();
  }
  appendChild(child) { this.children.push(child); return child; }
  addEventListener() {}
  contains() { return false; }
  focus() {}
  insertAdjacentHTML(_where, html) { this.innerHTML += html; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  remove() {}
  setAttribute() {}
  click() {}
}
class FakeFormData {
  constructor(form) { this.values = form?.values || {}; this.multi = form?.multi || {}; }
  get(key) { const value = this.values[key]; return value == null ? '' : value; }
  getAll(key) { return this.multi[key] || []; }
}

async function run() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, new FakeElement(id));
    return elements.get(id);
  };
  const storage = new Map();
  const documentHandlers = new Map();
  const document = {
    getElementById: element,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (name, handler) => documentHandlers.set(name, handler),
    createElement: tag => new FakeElement(tag),
    body: new FakeElement('body')
  };
  const context = {
    document, documentHandlers,
    window: { scrollTo() {}, location: { reload() {} } },
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    },
    FormData: FakeFormData,
    setTimeout: () => 1,
    clearTimeout() {},
    console, Intl, Date, Math, JSON, Map, Set,
    Blob, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView, URL,
    confirm: () => true, alert() {}
  };
  vm.createContext(context);
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  vm.runInContext(appSource, context, { filename: 'app.js' });

  const result = await vm.runInContext(`(async()=>{
    const count=state.records.length;
    const record=getRecord('QC-2026-000125');
    const legacyFinal=getRecord('QC-2026-000123');
    const dashboardHtml=renderDashboard();const qualityStatsInitial=qualityDashboardStats();const expectedReturnCount=state.records.reduce((sum,item)=>sum+getClientReturns(item).length,0);
    if(qualityStatsInitial.recordCount!==count||qualityStatsInitial.returnCount!==expectedReturnCount||qualityStatsInitial.debrief.sessionCount!==state.debriefs.length)
      throw Error('Le tableau de bord ne recalcule pas ses statistiques depuis les fiches, retours client et débriefs enregistrés.');
    for(const dashboardSection of ['Statistiques croisées par agent','Retours client','Débriefs liés aux fiches','dashboard-agent-table'])
      if(!dashboardHtml.includes(dashboardSection))throw Error('Section de statistiques croisées manquante : '+dashboardSection);
    if(['Fiches suivies','91,4 %','8,6 %','248'].some(value=>dashboardHtml.includes(value)))
      throw Error('Une statistique fictive statique subsiste dans le tableau de bord.');
    const mohamedMetrics=dashboardAgentMetrics().find(item=>normalizeEmployeeCode(item.employeeCode)==='0418');
    const mohamedRecords=state.records.filter(item=>sameAgentIdentity('AG-0418','Mohamed Trabelsi',item.employeeCode,item.agent));
    const mohamedDebriefs=state.debriefs.filter(item=>sameAgentIdentity('AG-0418','Mohamed Trabelsi',item.employeeCode,item.agent));
    if(!mohamedMetrics||mohamedMetrics.records.length!==mohamedRecords.length||mohamedMetrics.debriefCount!==mohamedDebriefs.length||mohamedMetrics.returnCount!==mohamedRecords.reduce((sum,item)=>sum+getClientReturns(item).length,0))
      throw Error('Les statistiques par agent ne relient pas correctement évaluations, retours et débriefs.');
    const savedAgentId=app.agentId;app.agentId='AG-0418';const profileHtml=renderAgentProfile();app.agentId=savedAgentId;
    if(!profileHtml.includes('Évaluations & retours associés')||!profileHtml.includes('Débriefs liés aux fiches')||profileHtml.includes('Vue de démonstration · les séries réelles viendront'))
      throw Error('Le profil agent ne présente pas les statistiques réelles des fiches, retours et débriefs.');
    if(state.debriefs[0]&&!renderDebriefCard(state.debriefs[0]).includes('Retours client liés'))
      throw Error('La fiche de débrief ne récapitule pas les retours des appels qui lui sont associés.');

    if(clientSendAllowedRecords().length!==count)throw Error('Toutes les fiches ne sont pas listées pour envoi.');
    if(!clientSendAllowed(getRecord('QC-2026-000127')))throw Error('Une fiche non conforme Synergy #1 reste filtrée.');
    if(!record.labels.some(id=>getLabel(id)?.name==='Retour client'))throw Error('Libellé Retour client absent après migration.');
    if(!finalReturnHistory(legacyFinal).length)throw Error('Le retour final historique n’a pas été migré.');
    if(getClientReturns(legacyFinal).some(ev=>ev.stage==='finalReturn'))throw Error('Le retour final historique a été classé comme retour client.');
    const carriedLegacy={...legacyFinal.clientFinal,returnNumber:99,receivedAt:legacyFinal.clientFinal.date};
    legacyFinal.clientReturns.push(carriedLegacy);legacyFinal.finalReturnHistory=[];
    migrateRecordCentricWorkflow();migrateRecordCentricWorkflow();
    if(legacyFinal.clientReturns.some(ev=>ev.returnNumber===99)||finalReturnHistory(legacyFinal).length!==1)
      throw Error('Une ancienne migration locale n’a pas séparé le retour final sans doublon.');

    const table=renderRecordsTable(state.records,{sendMode:true});
    const sendPage=renderSend();
    for(const label of ['<th>Date</th>','<th>Dossier</th>','<th>Agent</th>','<th>Indice</th>','Réévaluation','Retour final','Libellés'])
      if(!table.includes(label))throw Error('Colonne manquante : '+label);
    if((sendPage.match(/<tr data-open-record=/g)||[]).length!==count||sendPage.includes('éligibles'))
      throw Error('La page d’envoi filtre des fiches ou contient une restriction d’éligibilité.');
    app.fromPage='records';app.recordId=record.id;
    const recordView=renderRecord();
    if(recordView.includes('Actions sur cette fiche'))throw Error('Le panneau d’actions en doublon est encore présent.');
    if(!recordView.includes('workflow-history-card')||!recordView.includes('Historique des étapes'))throw Error('L’historique n’est pas rendu dans la colonne de droite.');
    if(recordView.indexOf('record-col-right')>recordView.indexOf('workflow-history-card'))throw Error('L’historique métier a quitté la colonne droite de la fiche.');
    if(!table.includes('data-action="open-record"'))throw Error('Le bouton Ouvrir n’est pas présent dans les lignes de fiche.');
    const openButton={dataset:{action:'open-record',recordId:record.id}};
    const clickTarget={closest:selector=>selector==='[data-action]'?openButton:null,matches:()=>false};
    documentHandlers.get('click')({target:clickTarget,preventDefault(){}});
    if(app.page!=='record'||app.recordId!==record.id)throw Error('Le clic délégué du bouton Ouvrir ne navigue pas vers la fiche.');
    app.page='records';
    window.openQualiContactRecord({preventDefault(){},stopPropagation(){}},record.id);
    if(app.page!=='record'||app.recordId!==record.id)throw Error('Le callback direct du bouton Ouvrir ne navigue pas vers la fiche.');

    app.page='records';app.fromPage='portal';
    openNewRecord();
    if(modalRoot.innerHTML.includes('name="amount"')||modalRoot.innerHTML.includes('name="clientRef"')||modalRoot.innerHTML.includes('Montant de la promesse')||modalRoot.innerHTML.includes('Référence client'))
      throw Error('Le formulaire de nouvel enregistrement affiche encore Montant de la promesse ou Référence client.');
    closeModal();
    const testFile={name:'test-call.wav',type:'audio/wav',size:1024};
    createNewRecord({querySelector:()=>({files:[testFile]}),values:{agentName:'Agent Test',callDate:'2026-09-29',campaign:'Test',recordIndex:'IND-TEST',baseName:'BASE-TEST'}});
    const created=state.records[0];
    if(app.page!=='record'||app.fromPage!=='records'||app.recordId!==created.id)throw Error('Une nouvelle fiche reste coincée en vue portail.');
    if(!mainContent.innerHTML.includes('Démarrer Synergy #1')||!mainContent.innerHTML.includes('Ajouter une tâche')||mainContent.innerHTML.includes('Actions sur cette fiche'))
      throw Error('Les actions métier ne sont pas visibles correctement après création.');
    handleAction({dataset:{action:'begin-evaluation',recordId:created.id,stage:'internal1'}});
    if(!modalRoot.innerHTML.includes('data-form="evaluation"')||!modalRoot.innerHTML.includes('Enregistrer évaluation'))
      throw Error('L’action Synergy #1 ne lance pas le formulaire après création.');
    closeModal();

    app.page='record'; app.recordId=record.id;
    handleAction({dataset:{action:'open-final-return-modal',recordId:record.id}});
    if(!modalRoot.innerHTML.includes('name="finalReturnStatus"')||!modalRoot.innerHTML.includes('Non valide'))
      throw Error('Le bouton de saisie n’ouvre pas le formulaire Retour final.');
    closeModal();
    saveFinalReturn({values:{recordId:record.id,finalReturnStatus:'VALIDE'}});
    saveFinalReturn({values:{recordId:record.id,finalReturnStatus:'NON_VALIDE'}});
    if(finalReturnHistory(record).length!==2||finalReturnHistory(record)[1].version!==2)
      throw Error('Les retours finaux ne sont pas versionnés.');
    if(!record.labels.some(id=>getLabel(id)?.name==='Retour final'))throw Error('Libellé Retour final absent.');

    record.baseName='BASE-TEST';record.recordIndex='125';record.clientCall1Status='Répondu';
    openClientReturnModal(record.id);
    for(const value of ['value="DAM"','value="INDECIS"','name="alreadyDonor"','value="OUI"','value="NON"'])
      if(!modalRoot.innerHTML.includes(value))throw Error('Menu de retour client incomplet : '+value);
    for(const duplicateField of ['name="clientBase"','name="clientIndex"','name="clientCall1Status"'])
      if(modalRoot.innerHTML.includes(duplicateField))throw Error('Champ déjà présent dans les informations de la fiche répété dans le retour : '+duplicateField);
    if(!modalRoot.innerHTML.includes('name="baseSnapshot"')||!modalRoot.innerHTML.includes('name="recordIndexSnapshot"')||!modalRoot.innerHTML.includes('name="call1StatusSnapshot"'))
      throw Error('Les informations existantes ne sont pas reprises comme snapshots cachés.');
    closeModal();
    const oldReturnCount=getClientReturns(record).length;
    const returnForm=(status,donor,remarks)=>({values:{recordId:record.id,sourceChannel:'EMAIL',receivedAt:'2026-09-28T12:00',clientFinalStatus:status,alreadyDonor:donor,clientRemarks:remarks}});
    saveClientReturn(returnForm('DAM','OUI','Premier test'));
    saveClientReturn(returnForm('INDECIS','NON','Deuxième test'));
    if(getClientReturns(record).length!==oldReturnCount+2)throw Error('Les retours successifs ont écrasé une entrée.');
    if(getClientReturns(record).at(-1).baseSnapshot!=='BASE-TEST'||getClientReturns(record).at(-1).recordIndexSnapshot!=='125'||getClientReturns(record).at(-1).call1Status!=='Répondu')
      throw Error('Les métadonnées de la fiche ne sont pas archivées dans le retour client.');
    if(!record.labels.some(id=>getLabel(id)?.name==='Retour client'))throw Error('Libellé Retour client absent après enregistrement.');
    const workflowHistory=renderWorkflowHistory(record);
    for(const step of ['Synergy #1','Retour client #','Retour final','workflow-history-marker'])
      if(!workflowHistory.includes(step))throw Error('Étape absente de l’historique métier coloré : '+step);

    saveEvaluation({values:{recordId:record.id,stage:'internal2',analysisPoleQualite:'Analyse de test',promiseStatus:'PROMESSE_NON_VALIDE',reevaluationDonStatus:'NON_CONFORME'}});
    if(record.internal2?.analysisPoleQualite!=='Analyse de test'||record.internal2?.promiseStatus!=='PROMESSE_NON_VALIDE'||record.internal2?.donConformity!=='NON_CONFORME')
      throw Error('Les champs de réévaluation ne sont pas sauvegardés.');
    if(!record.labels.some(id=>getLabel(id)?.name==='Réévaluation'))throw Error('Libellé Réévaluation absent.');
    if(!renderWorkflowHistory(record).includes('Réévaluation'))throw Error('La réévaluation n’est pas visible dans l’historique métier.');

    app.selectedToSend.clear(); app.selectedToSend.add(getRecord('QC-2026-000127').id);
    openClientSendExportModal();
    if(app.pendingClientSend.recordIds[0]!=='QC-2026-000127')throw Error('La fiche non conforme Synergy #1 n’est pas sélectionnable pour envoi.');

    openDebriefModal(record.id,record.employeeCode);
    const starInputCount=(modalRoot.innerHTML.match(/name="rating_/g)||[]).length;
    if(starInputCount!==DEBRIEF_RUBRIC.length*5||!modalRoot.innerHTML.includes('required aria-label='))throw Error('Le formulaire de débrief ne propose pas cinq étoiles obligatoires pour chaque compétence.');
    if(!modalRoot.innerHTML.includes('name="debriefAudioFile"')||!modalRoot.innerHTML.includes('type="file"')||!modalRoot.innerHTML.includes('Enregistrement audio du débrief'))
      throw Error('Le formulaire de débrief ne demande pas son propre enregistrement audio.');
    if(!modalRoot.innerHTML.includes('name="agentName"')||!modalRoot.innerHTML.includes('name="agentId"')||!modalRoot.innerHTML.includes('Prérempli depuis le nom de l’enregistrement')||!modalRoot.innerHTML.includes('<input type="hidden" name="debriefFilenameAgent"')||modalRoot.innerHTML.includes('<label>Nom d’agent détecté'))
      throw Error('Le champ principal Agent doit être modifiable; le nom source doit rester caché pour la traçabilité, sans champ secondaire visible.');
    for(const filenameField of ['debriefFilenameEmployeeCode','debriefFilenameCivility','debriefSessionTime','debriefExtension','debriefSourceIndex','debriefBaseName','debriefCampaignCode','debriefProspectNumber','debriefFilenameParts'])
      if(!modalRoot.innerHTML.includes('name="'+filenameField+'"'))throw Error('Champ de métadonnée du nom de fichier manquant : '+filenameField);
    for(const rubricItem of DEBRIEF_RUBRIC)
      if(!modalRoot.innerHTML.includes('name="rating_'+rubricItem.key+'"')||!modalRoot.innerHTML.includes(rubricItem.title.replaceAll('&','&amp;')))throw Error('Critère de débrief manquant : '+rubricItem.title);
    if(modalRoot.innerHTML.includes('debriefFilenamePreview')||modalRoot.innerHTML.includes('debriefRawSegment6')||modalRoot.innerHTML.includes('debriefExtraSegment_9')||modalRoot.innerHTML.includes('Fiches d’appel à discuter')||modalRoot.innerHTML.includes('name="recordIds"'))
      throw Error('Le résumé d’analyse et les segments supprimés sont encore affichés dans le formulaire.');
    closeModal();
    const filenameValues={agentName:{value:''},agentId:{value:''},date:{value:'2026-08-01'},debriefFilenameAgent:{value:''},debriefFilenameEmployeeCode:{value:''},debriefFilenameCivility:{value:''},debriefSessionTime:{value:''},debriefExtension:{value:''},debriefSourceIndex:{value:''},debriefBaseName:{value:''},debriefCampaignCode:{value:''},debriefProspectNumber:{value:''},debriefFilenameParts:{value:'[]'}};
    const filenameForm={dataset:{},elements:{namedItem:name=>filenameValues[name]||null}};
    const sampleName='3001#0418 Mohamed Trabelsi M#20260929#101530#IND125#INCONNU6#NUM-PROSPECT-42#LRO6076P#EXTRA9.wav';
    updateDebriefFilenameFields({name:sampleName,type:'audio/wav'},filenameForm);
    if(filenameValues.agentName.value!=='Mohamed Trabelsi'||filenameValues.debriefFilenameAgent.value!=='Mohamed Trabelsi'||filenameValues.agentId.value!==record.employeeCode||filenameValues.debriefFilenameEmployeeCode.value!=='0418'||filenameValues.date.value!=='2026-09-29'||filenameValues.debriefSessionTime.value!=='10:15:30'||filenameValues.debriefExtension.value!=='3001'||filenameValues.debriefSourceIndex.value!=='IND125'||filenameValues.debriefBaseName.value!=='LRO6076P'||filenameValues.debriefCampaignCode.value!=='LRO'||filenameValues.debriefProspectNumber.value!=='NUM-PROSPECT-42')
      throw Error('Le nom de l’audio du débrief ne préremplit pas le champ principal Agent, son lien et les champs confirmés.');
    if(!JSON.parse(filenameValues.debriefFilenameParts.value).includes('INCONNU6')||!JSON.parse(filenameValues.debriefFilenameParts.value).includes('EXTRA9'))
      throw Error('Les segments supprimés de l’interface ne sont plus conservés dans les métadonnées source.');
    const civilitySample=parseCallAudioName('3042#36ASSAM Ruth F#20260925#122206#1099#0565657797#33568081584#CFD6451P##1#40.wav');
    if(civilitySample.agentCivility!=='F'||civilitySample.employeeCode!=='36'||civilitySample.agentName!=='ASSAM Ruth')
      throw Error('La civilité F n’est pas extraite correctement du segment agent.');
    const unmatchedFilenameValues={agentName:{value:''},agentId:{value:''},date:{value:'2026-08-01'},debriefFilenameAgent:{value:''},debriefFilenameEmployeeCode:{value:''},debriefFilenameCivility:{value:''},debriefSessionTime:{value:''},debriefExtension:{value:''},debriefSourceIndex:{value:''},debriefBaseName:{value:''},debriefCampaignCode:{value:''},debriefProspectNumber:{value:''},debriefFilenameParts:{value:'[]'}};
    const unmatchedFilenameForm={dataset:{},elements:{namedItem:name=>unmatchedFilenameValues[name]||null}};
    updateDebriefFilenameFields({name:'3042#36ASSAM Ruth F#20260925#122206#1099#0565657797#33568081584#CFD6451P##1#40.wav',type:'audio/wav'},unmatchedFilenameForm);
    if(unmatchedFilenameValues.agentName.value!=='ASSAM Ruth'||unmatchedFilenameValues.debriefFilenameAgent.value!=='ASSAM Ruth'||unmatchedFilenameValues.agentId.value!==''||unmatchedFilenameValues.debriefFilenameEmployeeCode.value!=='36')
      throw Error('Un agent absent du référentiel n’est pas affiché dans le champ principal Agent.');
    updateDebriefFilenameFields({name:'debrief-sans-convention.wav',type:'audio/wav'},filenameForm);
    if(filenameValues.date.value!=='2026-08-01'||!JSON.parse(filenameValues.debriefFilenameParts.value).includes('debrief-sans-convention'))
      throw Error('Un nom non reconnu conserve ses segments sans laisser les anciennes valeurs préremplies.');

    const debriefCountBeforeValidation=state.debriefs.length;
    const ratingValues=Object.fromEntries(DEBRIEF_RUBRIC.map((item,index)=>['rating_'+item.key,String(index%5+1)]));
    const testDebriefAudio={name:sampleName,type:'audio/wav',size:2048};
    const debriefForm=(values,includeAudio=true)=>({values:{...values,agentName:values.agentName??record.agent,agentId:values.agentId??record.employeeCode,recordId:record.id},multi:{},querySelector:selector=>selector==='[name="debriefAudioFile"]'?{files:includeAudio?[testDebriefAudio]:[]}:null});
    createDebrief(debriefForm({agentName:'ASSAM Ruth',agentId:'',debriefFilenameEmployeeCode:'36',date:'2026-09-29',owner:'Sarah Ben Salem',...ratingValues}));
    if(state.debriefs.length!==debriefCountBeforeValidation)throw Error('Un agent absent du référentiel a été enregistré sans lien agent valide.');
    createDebrief(debriefForm({agentId:record.employeeCode,date:'2026-09-29',owner:'Sarah Ben Salem',...ratingValues},false));
    if(state.debriefs.length!==debriefCountBeforeValidation)throw Error('Un débrief a été enregistré sans joindre son enregistrement audio.');
    createDebrief(debriefForm({agentId:record.employeeCode,date:'2026-09-29',owner:'Sarah Ben Salem'}));
    if(state.debriefs.length!==debriefCountBeforeValidation)throw Error('Un débrief incomplet a été enregistré sans notes obligatoires.');
    createDebrief(debriefForm({agentId:record.employeeCode,date:'2026-09-29',owner:'Sarah Ben Salem',note:'Coaching test',actionTitle:'Revoir les objections',actionDue:'2026-10-10',debriefFilenameParts:JSON.stringify(['3001','0418 Mohamed Trabelsi M','20260929','101530','IND125','INCONNU6','INCONNU7','LRO6076P','EXTRA9']),agentName:'Mohamed Trabelsi',debriefFilenameAgent:'Mohamed Trabelsi',debriefFilenameEmployeeCode:'0418',debriefFilenameCivility:'M',debriefSessionTime:'10:15:30',debriefExtension:'3001',debriefSourceIndex:'IND125',debriefBaseName:'LRO6076P',debriefCampaignCode:'LRO',debriefProspectNumber:'NUM-PROSPECT-42',...ratingValues}));
    const createdDebrief=state.debriefs[0];
    if(Object.keys(createdDebrief.ratings||{}).length!==DEBRIEF_RUBRIC.length||createdDebrief.ratings.accroche!==1||createdDebrief.ratings.cloture!==3)
      throw Error('Les notes du formulaire de débrief ne sont pas sauvegardées.');
    if(createdDebrief.audio?.fileName!==sampleName||createdDebrief.audio.objectId||createdDebrief.audio.storage||createdDebrief.audio.driveFolderId!==null||createdDebrief.audio.driveStatus!=='DEMO_NOT_UPLOADED'||!createdDebrief.recordIds.includes(record.id))
      throw Error('L’audio n’est pas associé à sa session ou son dossier Drive dédié est ambigu.');
    const persistedDebrief=JSON.parse(localStorage.getItem(DB_KEY)).debriefs.find(d=>d.id===createdDebrief.id);
    if(persistedDebrief.audio.fileName!==sampleName||Object.hasOwn(persistedDebrief.audio,'localUrl'))
      throw Error('Les métadonnées audio ne sont pas persistées seules, sans URL temporaire ni binaire.');
    const debriefCard=renderDebriefCard(createdDebrief);
    if(!debriefCard.includes('Note du débrief')||!debriefCard.includes(' étoiles'))throw Error('Le score étoilé n’est pas affiché dans le débrief.');
    if(!debriefCard.includes('Dossier de démonstration')||!debriefCard.includes(sampleName)||!debriefCard.includes('Fichier disponible uniquement dans la session de démonstration.'))
      throw Error('La carte du débrief ne montre pas l’audio associé et son statut de démo.');
    if(createdDebrief.filenameMetadata?.agentName!=='Mohamed Trabelsi'||createdDebrief.filenameMetadata?.extension!=='3001'||createdDebrief.filenameMetadata?.sessionTime!=='10:15:30'||createdDebrief.filenameMetadata?.sourceRecordIndex!=='IND125'||createdDebrief.filenameMetadata?.prospectNumber!=='NUM-PROSPECT-42'||!createdDebrief.filenameMetadata.rawSegments.includes('INCONNU6')||!createdDebrief.filenameMetadata.rawSegments.includes('EXTRA9'))
      throw Error('Les champs corrigés depuis le nom du fichier ne sont pas associés à la session de débrief.');
    const dashboardStats=debriefDashboardStats();const debriefPage=renderDebriefs();
    if(dashboardStats.completedCount!==1||dashboardStats.sessionCount!==state.debriefs.length||dashboardStats.agentCount!==1)
      throw Error('Les KPI du débrief ne sont pas calculés à partir de l’ensemble des formulaires remplis.');
    for(const kpi of ['Formulaires remplis','Moyenne des notes','Agents évalués','Actions de suivi'])
      if(!debriefPage.includes(kpi))throw Error('KPI dynamique manquant : '+kpi);
    for(const obsoleteKpi of ['Débriefs ce mois','Agents suivis','Actions en cours','Actions en retard'])
      if(debriefPage.includes(obsoleteKpi))throw Error('Un KPI de démonstration statique est encore affiché : '+obsoleteKpi);

    const userSettings=renderUserSettings();
    if(!userSettings.includes('Rôles & activités')||assignedRole('u-client')?.scope!=='assigned_client')
      throw Error('La gestion des rôles ou la portée client initiale est absente.');
    for(const userControl of ['Ajouter un utilisateur','data-action="edit-user"','data-action="delete-user"','@demo.local'])
      if(!userSettings.includes(userControl))throw Error('Contrôle de gestion des utilisateurs manquant : '+userControl);
    openDemoUserModal();
    if(!modalRoot.innerHTML.includes('data-form="demoUser"')||!modalRoot.innerHTML.includes('name="email"')||!modalRoot.innerHTML.includes('data-user-account-type')||!modalRoot.innerHTML.includes('Compte de démonstration local uniquement; aucune authentification réelle.')||modalRoot.innerHTML.includes('Supabase Auth'))
      throw Error('Le formulaire d’ajout utilisateur local ou son avertissement de démonstration est absent.');
    closeModal();
    const userCountBeforeCreate=demoUsers.length;
    saveDemoUser({values:{name:'Amira Test',email:'amira@example.test',accountType:'internal',userRoleId:'role-qualitician'}});
    const addedUser=demoUsers.find(user=>user.email==='amira@example.test');
    if(demoUsers.length!==userCountBeforeCreate+1||!addedUser||assignedRoleId(addedUser.id)!=='role-qualitician'||!JSON.parse(localStorage.getItem(DB_KEY)).users.some(user=>user.id===addedUser.id))
      throw Error('La création et la persistance locale d’un utilisateur ont échoué.');
    openDemoUserModal(addedUser.id);
    if(!modalRoot.innerHTML.includes('Modifier l’utilisateur')||!modalRoot.innerHTML.includes('value="amira@example.test"'))
      throw Error('Le formulaire de modification ne reprend pas le compte sélectionné.');
    closeModal();
    saveDemoUser({values:{userId:addedUser.id,name:'Amira Client',email:'amira.client@example.test',accountType:'client',userRoleId:'role-client-user',clientId:'client-qc'}});
    if(addedUser.name!=='Amira Client'||addedUser.accountType!=='client'||addedUser.clientId!=='client-qc'||assignedRoleId(addedUser.id)!=='role-client-user')
      throw Error('La modification utilisateur ou la restriction de portée client a échoué.');
    const clientRoleBefore=assignedRoleId(addedUser.id);assignUserRole(addedUser.id,'role-admin');
    if(assignedRoleId(addedUser.id)!==clientRoleBefore)throw Error('Un compte client peut recevoir un rôle d’organisation.');
    saveDemoUser({values:{name:'Autre Compte',email:'u-khaled@demo.local',accountType:'internal',userRoleId:'role-qualitician'}});
    if(demoUsers.some(user=>user.email==='u-khaled@demo.local'&&user.name==='Autre Compte'))throw Error('Un e-mail déjà utilisé a été accepté.');
    const userCountBeforeDelete=demoUsers.length;deleteDemoUser(addedUser.id);
    if(demoUsers.length!==userCountBeforeDelete-1||demoUsers.some(user=>user.id===addedUser.id)||JSON.parse(localStorage.getItem(DB_KEY)).users.some(user=>user.id===addedUser.id))
      throw Error('La suppression locale de l’utilisateur ou sa persistance a échoué.');
    const usersBeforeActiveDelete=demoUsers.length;deleteDemoUser('u-sarah');
    if(demoUsers.length!==usersBeforeActiveDelete)throw Error('Le compte actif de démonstration a été supprimé.');
    openRoleModal();
    for(const activityId of ROLE_ACTIVITY_IDS)
      if(!modalRoot.innerHTML.includes('value="'+activityId+'"')||!modalRoot.innerHTML.includes('name="activityIds"'))throw Error('Activité non sélectionnable dans le formulaire de rôle : '+activityId);
    closeModal();
    const customRoleName='Contrôle fiches client';
    saveAccessRole({values:{roleName:customRoleName,roleScope:'assigned_client',roleDescription:'Lecture et retours autorisés'},multi:{activityIds:['portal','client_returns']}});
    const customRole=state.roles.find(role=>role.name===customRoleName);
    if(!customRole||customRole.activities.length!==2||customRole.scope!=='assigned_client')throw Error('La création du rôle avec ses activités cochées a échoué.');
    const roleCountBeforeScopeCheck=state.roles.length;
    saveAccessRole({values:{roleName:'Client trop large',roleScope:'assigned_client'},multi:{activityIds:['portal','users_roles']}});
    if(state.roles.length!==roleCountBeforeScopeCheck)throw Error('Un rôle client peut recevoir des activités administratives globales.');
    const assignedClientRoleBefore=assignedRoleId('u-client');assignUserRole('u-client','role-admin');
    if(assignedRoleId('u-client')!==assignedClientRoleBefore)throw Error('Un compte client a pu recevoir un rôle à portée organisation.');
    const roleSelect={dataset:{userRole:'u-client'},value:customRole.id,matches:selector=>selector==='[data-user-role]'};
    documentHandlers.get('change')({target:roleSelect});
    if(assignedRoleId('u-client')!==customRole.id||!JSON.parse(localStorage.getItem(DB_KEY)).roles.some(role=>role.id===customRole.id))
      throw Error('L’attribution du rôle utilisateur ou sa persistance locale a échoué.');
    deleteAccessRole(customRole.id);
    if(!getAccessRole(customRole.id))throw Error('Un rôle attribué a été supprimé sans réaffectation préalable.');

    return {recordCount:count,clientReturnCount:getClientReturns(record).length,finalReturnCount:finalReturnHistory(record).length,debriefRatingCount:Object.keys(createdDebrief.ratings).length,debriefAudioName:createdDebrief.audio.fileName,debriefFolderName:createdDebrief.audio.driveFolderName,roleActivityCount:ROLE_ACTIVITY_IDS.length,userCrudVerified:true,dashboardStatsVerified:true,table,xlsx:createClientReturnWorkbook([record])};
  })()`, context, { filename: 'workflow-regression' });

  const workbook = Buffer.from(await result.xlsx.arrayBuffer());
  const sheet = extractStoredZipEntry(workbook, 'xl/worksheets/sheet1.xml').toString('utf8');
  for (const value of ['Analyse de test', 'PROMESSE Non VALIDE', 'DAM', 'Indécis', 'Retour final', 'Retour client'])
    assert.ok(sheet.includes(value), `Le classeur Excel ne contient pas « ${value} »`);
  assert.ok(result.table.includes('QC-2026-000127'));
  console.log(`OK — ${result.recordCount} fiches visibles/sélectionnables; ${result.clientReturnCount} retours client conservés; ${result.finalReturnCount} retours finaux versionnés; débrief étoilé et parsing audio vérifiés (${result.debriefRatingCount} critères); audio lié à ${result.debriefFolderName}; rôles vérifiés (${result.roleActivityCount} activités); gestion utilisateurs locale vérifiée (${result.userCrudVerified?'ajout/modification/suppression':''}); statistiques croisées fiches/retours/débriefs vérifiées (${result.dashboardStatsVerified?'oui':'non'}); export XLSX vérifié (${workbook.length} octets).`);
}

function extractStoredZipEntry(buffer, expectedName) {
  let offset = 0;
  while (offset + 30 < buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString('utf8');
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (name === expectedName) {
      assert.equal(method, 0, 'Classeur XLSX attendu sans compression');
      return buffer.subarray(dataStart, dataEnd);
    }
    offset = dataEnd;
  }
  throw new Error(`Entrée ZIP absente : ${expectedName}`);
}

run().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
