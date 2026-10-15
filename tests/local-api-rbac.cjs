const assert = require('node:assert/strict');
const {
  calculateDashboardSummary,
  filterStateForUser,
  requiredPermissionsForStateChange
} = require('../local-api/rbac');
const { mergeIncomingState, canAccessCallAudio, isDebriefAudioAttached } = require('../local-api/state-store');

function permissions(...codes) { return new Set(codes); }
function fixture() {
  return {
    records: [
      {
        id: 'R-A-1', clientId: 'client-A', client: 'Client A', baseName: 'Base A', recordIndex: '42',
        clientCall1Status: 'Appel réalisé', status: 'envoyee', sentToClientAt: '2026-09-20T10:00:00Z',
        amount: 55, clientRef: 'REF-A', rawSegment6: 'secret-a', rawSegment7: 'prospect-a',
        internal1: { score: 88, conformity: 'CONFORME', version: 1 }, internal2: { analysisPoleQualite: 'interne' },
        evaluationHistory: [{ stage: 'internal1', version: 1 }], audio: { objectId: 'audio-A' },
        clientReturns: [], client1: null, clientFinal: null, finalReturn: null, finalReturnHistory: [],
        clientSendHistory: [{ id: 'send-A', sentAt: '2026-09-20T10:00:00Z' }],
        labels: ['Retour client'], events: [{ id: 'record-event-private', action: 'Interne' }]
      },
      {
        id: 'R-B-1', clientId: 'client-B', client: 'Client B', baseName: 'Base B', recordIndex: '77',
        status: 'envoyee', sentToClientAt: '2026-09-20T10:00:00Z', clientReturns: [], client1: null,
        internal1: { score: 70 }, clientSendHistory: [{ id: 'send-B', sentAt: '2026-09-20T10:00:00Z' }]
      }
    ],
    batches: [
      { id: 'batch-A', clientId: 'client-A', recordIds: ['R-A-1'], sentAt: '2026-09-20T10:00:00Z' },
      { id: 'batch-B', clientId: 'client-B', recordIds: ['R-B-1'], sentAt: '2026-09-20T10:00:00Z' }
    ],
    tasks: [{ id: 'task-A', recordId: 'R-A-1', status: 'A_FAIRE' }],
    debriefs: [{ id: 'debrief-A', recordIds: ['R-A-1'] }],
    agents: [{ id: 'agent-A', name: 'Agent A' }],
    labels: [{ id: 'label-A', name: 'Retour client' }],
    events: [
      { id: 'event-private', recordId: 'R-A-1', action: 'Note interne' },
      { id: 'event-public', recordId: 'R-A-1', action: 'Envoi client', clientVisible: true }
    ],
    criteriaByStage: { internal1: [] },
    users: [{ id: 'must-not-leak' }], roles: [{ id: 'must-not-leak' }], userRoleAssignments: { private: 'role-admin' }
  };
}
function clientAuth(clientId = 'client-A') {
  return { id: 'client-user', fullName: 'Client A User', clientIds: [clientId], permissions: permissions('portal', 'client_returns', 'final_return') };
}
function expectStatus(fn, status, code) {
  assert.throws(fn, error => error.status === status && (!code || error.code === code));
}

function run() {
  const state = fixture();
  const client = clientAuth();
  const visible = filterStateForUser(state, client);
  assert.deepEqual(visible.records.map(record => record.id), ['R-A-1']);
  assert.equal(visible.records[0].internal1, undefined);
  assert.equal(visible.records[0].internal2, undefined);
  assert.equal(visible.records[0].evaluationHistory, undefined);
  assert.equal(visible.records[0].amount, undefined);
  assert.equal(visible.records[0].clientRef, undefined);
  assert.deepEqual(visible.records[0].events, []);
  assert.equal(visible.records[0].labels,undefined);
  assert.deepEqual(visible.labels,[]);
  assert.deepEqual(visible.batches.map(batch => batch.id), ['batch-A']);
  assert.deepEqual(visible.tasks, []);
  assert.deepEqual(visible.debriefs, []);
  assert.deepEqual(visible.events.map(event => event.id), ['event-public']);
  assert.equal(visible.users, undefined);
  assert.equal(visible.roles, undefined);
  assert.equal(visible.userRoleAssignments, undefined);

  const clientWithOverbroadPermission={...client,roles:[{scope:'assigned_client'}],permissions:permissions('portal','records_view','client_returns','final_return')};
  assert.deepEqual(filterStateForUser(state,clientWithOverbroadPermission).records.map(record=>record.id),['R-A-1'],'La portée client doit rester limitante même si records_view est attribué par erreur.');
  const callAudioA={id:'audio-A',media_kind:'call_record',record_id:'R-A-1',client_id:'client-A'};
  assert.equal(canAccessCallAudio(client,callAudioA,state),true);
  assert.equal(canAccessCallAudio(clientWithOverbroadPermission,callAudioA,state),true);
  assert.equal(canAccessCallAudio(client,{...callAudioA,client_id:'client-B'},state),false,'Un client ne peut pas lire l’audio d’un autre client.');
  assert.equal(canAccessCallAudio(client,{...callAudioA,id:'audio-other'},state),false,'L’objet doit être l’audio associé à la fiche.');
  const unsentState=structuredClone(state);unsentState.records[0].sentToClientAt=null;unsentState.records[0].clientSendHistory=[];unsentState.batches=[];
  assert.equal(canAccessCallAudio(client,callAudioA,unsentState),false,'Un client ne peut pas lire un audio avant l’envoi.');
  const internalAudioReader={id:'reader',clientIds:[],permissions:permissions('records_view')};
  assert.equal(canAccessCallAudio(internalAudioReader,callAudioA,state),true);
  assert.equal(canAccessCallAudio({id:'no-audio',clientIds:[],permissions:permissions('tasks')},callAudioA,state),false);
  assert.equal(isDebriefAudioAttached({id:'debrief-audio',record_id:'debrief-A'},{debriefs:[{id:'debrief-A',audio:{objectId:'debrief-audio'}}]}),true);
  assert.equal(isDebriefAudioAttached({id:'other-audio',record_id:'debrief-A'},{debriefs:[{id:'debrief-A',audio:{objectId:'debrief-audio'}}]}),false);

  const incoming = structuredClone(visible);
  incoming.records[0].clientReturns.push({
    id: 'client-chosen-id', stage: 'clientReturn', returnNumber: 999, sourceChannel: 'EMAIL',
    finalStatus: 'DAM', alreadyDonor: true, receivedAt: '1999-01-01T00:00:00Z',
    baseSnapshot: 'Base A', recordIndexSnapshot: '42', call1Status: 'Appel réalisé',
    recordedBy: 'Forged actor', clientRemarks: 'Retour confirmé'
  });
  incoming.events.push({ id: 'forged-event', recordId: 'R-A-1', action: 'Client a modifié le journal' });
  incoming.records.push({ id: 'R-B-1', clientId: 'client-B', clientReturns: [{ finalStatus: 'DAM', alreadyDonor: true }] });
  const clientMerge = mergeIncomingState(state, incoming, client);
  const savedReturn = clientMerge.data.records.find(record => record.id === 'R-A-1').clientReturns[0];
  assert.equal(savedReturn.returnNumber, 1);
  assert.notEqual(savedReturn.id, 'client-chosen-id');
  assert.equal(savedReturn.sourceChannel, 'PORTAL');
  assert.equal(savedReturn.recordedBy, 'Client A User');
  assert.equal(savedReturn.recordedById, 'client-user');
  assert.notEqual(savedReturn.receivedAt, '1999-01-01T00:00:00Z');
  assert.equal(clientMerge.data.records.find(record => record.id === 'R-A-1').status, 'retour_client_recu');
  assert.equal(clientMerge.data.records.find(record => record.id === 'R-B-1').clientReturns.length, 0);
  assert.equal(clientMerge.data.events.some(event => event.id === 'forged-event'), false);
  assert.equal(clientMerge.requiredPermissions.includes('client_returns'), true);
  assert.equal(clientMerge.requiredPermissions.includes('tasks'), false, 'La tâche de réévaluation créée par le serveur ne requiert pas un droit tasks côté client.');
  const closedState=structuredClone(state);closedState.records[0].closedAt='2026-09-22T10:00:00Z';closedState.records[0].closedBy='Ancien agent';
  const closedIncoming=filterStateForUser(closedState,client);closedIncoming.records[0].clientReturns.push({baseSnapshot:'Base A',recordIndexSnapshot:'42',call1Status:'Appel réalisé',finalStatus:'DAM',alreadyDonor:false,clientRemarks:'Nouvelle réponse'});closedIncoming.records[0].closedAt=null;closedIncoming.records[0].closedBy=null;
  const reopened=mergeIncomingState(closedState,closedIncoming,client).data.records[0];
  assert.equal(reopened.closedAt,null,'Un nouveau retour client rouvre la fiche côté serveur.');
  assert.equal(reopened.closedBy,null);
  const automatedTask=clientMerge.data.tasks.find(task=>task.recordId==='R-A-1'&&task.type==='REEVALUATION_2');
  assert.ok(automatedTask,'Un retour client doit déclencher côté serveur la tâche de réévaluation.');
  assert.equal(automatedTask.status,'A_FAIRE');

  const tamperedHistory = structuredClone(clientMerge.data);
  const clientSnapshot = filterStateForUser(tamperedHistory, client);
  clientSnapshot.records[0].clientReturns[0].clientRemarks = 'Modification interdite';
  expectStatus(() => mergeIncomingState(tamperedHistory, clientSnapshot, client), 403, 'HISTORY_IMMUTABLE');

  const invalidReturn = structuredClone(visible);
  invalidReturn.records[0].clientReturns.push({ finalStatus: 'PEUT-ETRE', alreadyDonor: true });
  expectStatus(() => mergeIncomingState(state, invalidReturn, client), 400);

  const internalReturnAuth={id:'email-user',fullName:'Équipe qualité',clientIds:[],permissions:permissions('client_returns')};
  const emailReturnInput=filterStateForUser(state,internalReturnAuth);
  emailReturnInput.records[0].clientReturns.push({sourceChannel:'PORTAL',baseSnapshot:'Base A',recordIndexSnapshot:'42',call1Status:'Appel réalisé',finalStatus:'INDECIS',alreadyDonor:false,receivedAt:'1999-01-01T00:00:00Z',clientRemarks:'Retour reçu par courriel'});
  const emailReturnMerge=mergeIncomingState(state,emailReturnInput,internalReturnAuth);
  const emailReturn=emailReturnMerge.data.records[0].clientReturns[0];
  assert.equal(emailReturn.sourceChannel,'EMAIL');
  assert.equal(emailReturn.recordedBy,'Équipe qualité');
  assert.notEqual(emailReturn.recordedAt,'1999-01-01T00:00:00Z');
  assert.equal(emailReturn.returnNumber,1);
  assert.ok(emailReturnMerge.data.records[0].labels.includes('label-A'),'Le libellé workflow doit pouvoir être ajouté automatiquement sans records_manage.');
  assert.deepEqual(emailReturnMerge.requiredPermissions,['client_returns']);
  const internalClosedState=structuredClone(state);internalClosedState.records[0].closedAt='2026-09-22T10:00:00Z';internalClosedState.records[0].closedBy='Ancien agent';
  const internalClosedInput=filterStateForUser(internalClosedState,internalReturnAuth);internalClosedInput.records[0].clientReturns.push({baseSnapshot:'Base A',recordIndexSnapshot:'42',call1Status:'Appel réalisé',finalStatus:'DAM',alreadyDonor:true});
  const internallyReopened=mergeIncomingState(internalClosedState,internalClosedInput,internalReturnAuth).data.records[0];
  assert.equal(internallyReopened.closedAt,null,'Le serveur rouvre la fiche après un nouveau retour même si le rôle ne voit pas les champs de clôture.');
  const reevaluationState=structuredClone(state);reevaluationState.records[0].clientReturns=[{returnNumber:1,finalStatus:'DAM',alreadyDonor:true,receivedAt:'2026-09-21T10:00:00Z'}];
  const reevaluationAuth={id:'reevaluation-user',fullName:'Réévaluateur',clientIds:[],permissions:permissions('reevaluation')};
  const reevaluationInput=filterStateForUser(reevaluationState,reevaluationAuth);reevaluationInput.records[0].internal2={analysisPoleQualite:'Vérification du retour',promiseStatus:'PROMESSE_VALIDE',donConformity:'CONFORME'};
  const reevaluationMerge=mergeIncomingState(reevaluationState,reevaluationInput,reevaluationAuth);
  assert.equal(reevaluationMerge.data.records[0].internal2.evaluator,'Réévaluateur');
  assert.ok(reevaluationMerge.data.records[0].labels.includes('lbl-reevaluation'));
  assert.ok(reevaluationMerge.data.labels.some(label=>label.id==='lbl-reevaluation'));
  assert.deepEqual(reevaluationMerge.requiredPermissions,['reevaluation']);

  const forgedOtherClient = structuredClone(visible);
  forgedOtherClient.records[0].internal1 = { score: 0 };
  expectStatus(() => mergeIncomingState(state, forgedOtherClient, client), 403, 'CLIENT_SCOPE');

  const staffReadOnly = { id: 'reader', fullName: 'Lecteur', clientIds: [], permissions: permissions('records_view') };
  const readOnlyRecord=filterStateForUser(state,staffReadOnly).records[0];
  assert.equal(readOnlyRecord.internal1,undefined);
  assert.equal(readOnlyRecord.internal2,undefined);
  assert.equal(readOnlyRecord.clientReturns,undefined);
  assert.equal(readOnlyRecord.clientSendHistory,undefined);
  assert.deepEqual(readOnlyRecord.evaluationHistory,[]);
  assert.deepEqual(readOnlyRecord.labels,['Retour client']);
  assert.equal(filterStateForUser(state,staffReadOnly).labels[0].id,'label-A');
  const filteredRoundTrip=mergeIncomingState(state,filterStateForUser(state,staffReadOnly),staffReadOnly).data;
  assert.equal(filteredRoundTrip.records[0].internal1.score,88,'Un état filtré ne doit pas effacer l’évaluation masquée.');
  assert.equal(filteredRoundTrip.records[0].clientReturns.length,0,'Un retour masqué reste conservé dans l’état serveur.');
  const unauthorizedState = structuredClone(state);
  unauthorizedState.records[0].internal1.score = 0;
  expectStatus(() => mergeIncomingState(state, unauthorizedState, staffReadOnly), 403, 'PERMISSION_DENIED');
  const reevaluationOnly={id:'reevaluator',fullName:'Réévaluateur',clientIds:[],permissions:permissions('reevaluation')};
  const reevaluationView=filterStateForUser(state,reevaluationOnly).records[0];
  assert.equal(reevaluationView.internal1,undefined);
  assert.ok(reevaluationView.internal2);
  assert.equal(reevaluationView.evaluationHistory.length,0);

  const noDelete = filterStateForUser(state,staffReadOnly);
  noDelete.records.pop();
  const deletionAttempt = mergeIncomingState(state, noDelete, staffReadOnly);
  assert.equal(deletionAttempt.data.records.length, state.records.length, 'Une suppression demandée par le navigateur ne doit jamais effacer une fiche.');

  const debriefAuth={id:'coach',fullName:'Coach',clientIds:[],permissions:permissions('debriefs')};
  const debriefDelete=structuredClone(state);debriefDelete.debriefs=[];
  assert.equal(mergeIncomingState(state,debriefDelete,debriefAuth).data.debriefs.length,state.debriefs.length,'Une session de débrief historique ne peut pas être supprimée.');
  const debriefEdit=structuredClone(state);debriefEdit.debriefs[0].note='Modification interdite';
  expectStatus(()=>mergeIncomingState(state,debriefEdit,debriefAuth),403,'HISTORY_IMMUTABLE');
  const taskAuth={id:'task-user',fullName:'Gestionnaire de tâches',clientIds:[],permissions:permissions('tasks')};
  const taskDelete=structuredClone(state);taskDelete.tasks=[];
  assert.equal(mergeIncomingState(state,taskDelete,taskAuth).data.tasks.length,state.tasks.length,'Une tâche ne peut pas être supprimée par omission.');

  const staff = { id: 'quality-user', fullName: 'Qualiticien', clientIds: [], permissions: permissions('synergy1') };
  const staffInput = structuredClone(state);
  staffInput.records[0].internal1 = { score: 90, conformity: 'CONFORME' };
  staffInput.events.push({ id: 'new-ui-event', recordId: 'R-A-1', actor: 'Forged actor', at: '1999-01-01', action: 'Évaluation terminée' });
  const staffMerge = mergeIncomingState(state, staffInput, staff);
  const auditEvent = staffMerge.data.events.find(event => event.id === 'new-ui-event');
  assert.equal(auditEvent.actor, 'Qualiticien');
  assert.notEqual(auditEvent.at, '1999-01-01');
  assert.deepEqual(staffMerge.requiredPermissions, ['synergy1']);
  assert.equal(staffMerge.data.records[0].internal1.evaluator,'Qualiticien');
  assert.equal(staffMerge.data.records[0].internal1.version,2);
  assert.equal(staffMerge.data.records[0].evaluationHistory.length,2);
  assert.ok(staffMerge.data.records[0].evaluationHistory.at(-1).archivedAt);

  const dashboard = calculateDashboardSummary({
    records: [
      { id: 'one', agent: 'Agent A', internal1: { status: 'TERMINEE', score: 80, conformity: 'CONFORME' }, clientReturns: [{ finalStatus: 'DAM', alreadyDonor: true }] },
      { id: 'two', agent: 'Agent A', clientReturns: [{ finalStatus: 'INDECIS', alreadyDonor: false }] }
    ],
    debriefs: [{ agent: 'Agent A', ratings: { accroche: 5, remerciement: 4, script: 3, decouverte: 4, appelDon: 5, objections: 4, confirmation: 5, cloture: 4 }, actions: [{ status: 'A_FAIRE' }], recordIds: ['one'] }]
  });
  assert.equal(dashboard.recordCount, 2);
  assert.equal(dashboard.evaluatedCount, 1);
  assert.equal(dashboard.returnCount, 2);
  assert.equal(dashboard.returnStatusCounts.DAM, 1);
  assert.equal(dashboard.returnStatusCounts.INDECIS, 1);
  assert.equal(dashboard.debrief.completedCount, 1);
  assert.equal(dashboard.debrief.openActionCount, 1);
  assert.equal(dashboard.linkedRecordCount, 1);

  const delta = requiredPermissionsForStateChange(state, { ...state, tasks: [{ id: 'task-B' }] });
  assert.deepEqual(delta.required, ['tasks']);
  console.log('API/RBAC state regression tests passed.');
}

run();
