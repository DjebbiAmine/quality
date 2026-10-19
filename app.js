/* QualiContact CRM — interface navigateur + mode local connecté à l’API DB / S3 Bucket. */
const TODAY = "2026-09-29";
const DB_KEY = "qualicontact-demo-v2";
const BACKEND_LOCK_KEY = "qualicontact-backend-configured";
const PENDING_STATE_KEY = "qualicontact-pending-sync-v1";
const backend = {
  enabled: false,
  authenticated: false,
  user: null,
  permissions: new Set(),
  clientIds: [],
  csrfToken: "",
  stateVersion: 0,
  saveQueue: Promise.resolve(),
  saveEpoch: 0,
  saveSequence: 0,
  syncBlocked: false,
  pendingSnapshot: null,
  pendingDownloaded: false,
  dashboardStats: null,
  accessLoaded: false,
  stateInitialized: false,
  minioConfigured: false,
};
const stageLabels = {
  internal1: "Synergy #1",
  clientReturns: "Retours client",
  client1: "Retour client",
  internal2: "Réévaluation",
  clientFinal: "Retour final",
};
const stageTitles = {
  internal1: "Évaluation Synergy #1",
  clientReturns: "Historique des retours client",
  client1: "Retour client",
  internal2: "Réévaluation · Pôle qualité",
  clientFinal: "Retour final",
};
const pageTitles = {
  dashboard: "Vue d'ensemble",
  records: "Fiches d’appel",
  send: "À envoyer au client",
  debriefs: "Débriefs agents",
  agents: "Agents & progression",
  tasks: "Tâches",
  portal: "Espace client",
  settings: "Paramètres",
  record: "Indice d’appel",
  agentProfile: "Profil qualité",
};
const stageNames = ["internal1"];
const demoUsers = [
  {
    id: "u-sarah",
    name: "Sarah Ben Salem",
    initials: "SB",
    role: "Qualiticienne",
  },
  {
    id: "u-khaled",
    name: "Khaled Mansour",
    initials: "KM",
    role: "Responsable qualité",
  },
  { id: "u-maya", name: "Maya Haddad", initials: "MH", role: "Qualiticienne" },
  {
    id: "u-client",
    name: "Nadia Kacem",
    initials: "NK",
    role: "Utilisatrice client",
  },
];
function normalizeDemoUser(user) {
  const accountType =
    user?.accountType ||
    (user?.role === "Utilisatrice client" ? "client" : "internal");
  return {
    ...user,
    email: String(user?.email || `${user?.id || "user"}@demo.local`),
    accountType,
    clientId:
      accountType === "client" ? String(user?.clientId || "client-qc") : "",
  };
}
function isClientDemoUser(user) {
  return user?.accountType === "client" || user?.role === "Utilisatrice client";
}
const ROLE_ACTIVITY_GROUPS = [
  {
    name: "Pilotage & fiches",
    activities: [
      {
        id: "dashboard",
        label: "Tableau de bord",
        hint: "Consulter les indicateurs généraux.",
      },
      {
        id: "records_view",
        label: "Consulter les fiches d’appel",
        hint: "Voir les fiches et leurs historiques.",
      },
      {
        id: "records_manage",
        label: "Créer / modifier les fiches",
        hint: "Ajouter un audio et corriger les informations de fiche.",
      },
      {
        id: "records_assign",
        label: "Affecter les qualiticiens",
        hint: "Modifier le qualiticien affecté à une fiche après sa création.",
      },
      {
        id: "records_view_all",
        label: "Voir toutes les fiches et tâches",
        hint: "Sans ce droit, un profil ne voit que les fiches et tâches qui lui sont affectées.",
      },
    ],
  },
  {
    name: "API & tableau de bord",
    activities: [
      {
        id: "api_dashboard_read",
        label: "API — consulter les statistiques",
        hint: "Autorise le chargement des données du tableau de bord; le serveur vérifie ce droit à chaque requête.",
      },
      {
        id: "api_dashboard_export",
        label: "API — exporter les statistiques",
        hint: "Autorise l’export des statistiques via l’API locale.",
      },
    ],
  },
  {
    name: "Évaluations & envois",
    activities: [
      {
        id: "synergy1",
        label: "Réaliser Synergy #1",
        hint: "Compléter et versionner l’évaluation interne.",
      },
      {
        id: "client_returns",
        label: "Saisir les retours client",
        hint: "Ajouter les réponses reçues sur une fiche.",
      },
      {
        id: "reevaluation",
        label: "Réaliser une réévaluation",
        hint: "Compléter la réévaluation dans la fiche.",
      },
      {
        id: "final_return",
        label: "Saisir le retour final",
        hint: "Enregistrer la décision finale du client.",
      },
      {
        id: "client_send",
        label: "Préparer les envois client",
        hint: "Sélectionner les fiches et préparer les exports.",
      },
    ],
  },
  {
    name: "Équipe & suivi",
    activities: [
      {
        id: "debriefs",
        label: "Consulter / créer les débriefs",
        hint: "Créer les sessions et plans de progression.",
      },
      {
        id: "agents",
        label: "Consulter les agents & progression",
        hint: "Voir les profils et leur suivi qualité.",
      },
      {
        id: "tasks",
        label: "Gérer les tâches",
        hint: "Créer, attribuer et suivre les actions.",
      },
      {
        id: "tasks_manage",
        label: "Modifier / supprimer les tâches",
        hint: "Modifier les tâches existantes ou les supprimer (archivage).",
      },
    ],
  },
  {
    name: "Espace client",
    activities: [
      {
        id: "portal",
        label: "Accéder au portail client",
        hint: "Voir uniquement les fiches du client affecté.",
      },
    ],
  },
  {
    name: "Administration",
    activities: [
      {
        id: "quality_settings",
        label: "Configurer les grilles, libellés et stockage local",
        hint: "Accéder aux réglages qualité et aux connexions.",
      },
      {
        id: "users_roles",
        label: "Gérer les utilisateurs et les rôles",
        hint: "Créer des rôles et attribuer des accès.",
      },
    ],
  },
];
const ROLE_ACTIVITY_IDS = ROLE_ACTIVITY_GROUPS.flatMap((group) =>
  group.activities.map((activity) => activity.id),
);
const DEFAULT_ACCESS_ROLES = [
  {
    id: "role-admin",
    name: "Administrateur",
    description: "Administration complète de l’espace QualiContact.",
    scope: "organization",
    activities: [...ROLE_ACTIVITY_IDS],
    system: true,
  },
  {
    id: "role-quality-lead",
    name: "Responsable qualité",
    description: "Pilotage du workflow et de l’équipe qualité.",
    scope: "organization",
    activities: [...ROLE_ACTIVITY_IDS.filter((id) => id !== "portal")],
    system: true,
  },
  {
    id: "role-qualitician",
    name: "Qualiticienne",
    description: "Évaluations, retours, envois et suivi des fiches.",
    scope: "organization",
    activities: [
      "dashboard",
      "api_dashboard_read",
      "api_dashboard_export",
      "records_view",
      "records_manage",
      "synergy1",
      "client_returns",
      "reevaluation",
      "final_return",
      "client_send",
      "debriefs",
      "agents",
      "tasks",
    ],
    system: true,
  },
  {
    id: "role-client-admin",
    name: "Client administrateur",
    description: "Accès au portail pour le client affecté.",
    scope: "assigned_client",
    activities: ["portal", "client_returns", "final_return"],
    system: true,
  },
  {
    id: "role-client-user",
    name: "Utilisateur client",
    description: "Consultation et retours sur les fiches autorisées.",
    scope: "assigned_client",
    activities: ["portal", "client_returns", "final_return"],
    system: true,
  },
];
const DEFAULT_USER_ROLE_ASSIGNMENTS = {
  "u-sarah": "role-qualitician",
  "u-khaled": "role-quality-lead",
  "u-maya": "role-qualitician",
  "u-client": "role-client-user",
};
const synergyRubric = [
  {
    id: "synergy-lock",
    section: "Critères qualité",
    label: "Verrouillage",
    description: "Adresse, consentement",
    type: "ok_x",
    weight: 1,
  },
  {
    id: "synergy-coordinates",
    section: "Critères qualité",
    label: "Coordonnées",
    description: "Téléphone",
    type: "ok_x",
    weight: 1,
  },
  {
    id: "synergy-add",
    section: "Critères qualité",
    label: "ADD",
    description: "Mentions légales",
    type: "ok_x",
    weight: 1,
  },
  {
    id: "synergy-shield",
    section: "Critères qualité",
    label: "Blindage",
    description: "Reformulation",
    type: "ok_x",
    weight: 1,
  },
];
const defaultLabels = [
  { id: "lbl-rerecouter", name: "À réécouter", tone: "blue" },
  { id: "lbl-retour", name: "Retour client", tone: "purple" },
  { id: "lbl-reevaluation", name: "Réévaluation", tone: "amber" },
  { id: "lbl-retour-final", name: "Retour final", tone: "green" },
  { id: "lbl-urgent", name: "Urgent", tone: "red" },
  { id: "lbl-desaccord", name: "Désaccord", tone: "amber" },
  { id: "lbl-promesse", name: "Promesse sensible", tone: "amber" },
  { id: "lbl-debrief", name: "À débriefer", tone: "green" },
  { id: "lbl-script", name: "Erreur script", tone: "red" },
  { id: "lbl-verrouillage", name: "Erreur verrouillage", tone: "red" },
  { id: "lbl-conforme", name: "Conforme", tone: "green" },
];
function makeInitialState() {
  const records = [
    {
      id: "QC-2026-000125",
      clientId: "client-qc",
      client: "Qualicontact",
      campaign: "Dons particuliers",
      agent: "Mohamed Trabelsi",
      employeeCode: "AG-0418",
      callDate: "2026-09-28",
      callTime: "08:52",
      duration: "08:42",
      extension: "204",
      clientRef: "QCL-45781",
      amount: 45,
      responsible: "Sarah Ben Salem",
      createdAt: "2026-09-28T09:00:00",
      status: "retour_client_recu",
      batchId: "LOT-2026-09-001",
      audio: {
        drive_file_id: "1QCDemoAudio125",
        drive_file_name: "QC_125_Mohamed_T_280926.mp3",
        drive_file_url: "",
        mime_type: "audio/mpeg",
        file_size: 8421760,
        date_upload: "2026-09-28T09:15:00",
        uploaded_by: "Sarah Ben Salem",
      },
      internal1: {
        status: "TERMINEE",
        score: 94,
        conformity: "CONFORME",
        date: "2026-09-28T09:45:00",
        evaluator: "Sarah Ben Salem",
        decision: "CONFORME",
        comments:
          "Évaluation de démonstration. La grille réelle n’est pas encore configurée.",
      },
      client1: {
        status: "TERMINE",
        date: "2026-09-28T11:10:00",
        user: "Nadia Kacem",
        score: null,
        decision: "A_TRAITER",
        comments:
          "Retour de démonstration reçu. Les critères détaillés seront renseignés après configuration de la grille client.",
        disagreements: "À préciser après configuration de la grille.",
      },
      internal2: null,
      responseSentAt: null,
      clientFinal: null,
      closedAt: null,
      labels: ["lbl-retour", "lbl-desaccord"],
    },
    {
      id: "QC-2026-000126",
      clientId: "client-qc",
      client: "Qualicontact",
      campaign: "Dons particuliers",
      agent: "Ines Gharbi",
      employeeCode: "AG-0392",
      callDate: "2026-09-27",
      callTime: "14:12",
      duration: "06:18",
      extension: "118",
      clientRef: "QCL-45739",
      amount: 30,
      responsible: "Maya Haddad",
      createdAt: "2026-09-27T14:30:00",
      status: "envoyee_client",
      batchId: "LOT-2026-09-001",
      audio: {
        drive_file_id: "1QCDemoAudio126",
        drive_file_name: "QC_126_Ines_G_270926.mp3",
        drive_file_url: "",
        mime_type: "audio/mpeg",
        file_size: 6384720,
        date_upload: "2026-09-27T14:31:00",
        uploaded_by: "Maya Haddad",
      },
      internal1: {
        status: "TERMINEE",
        score: 91,
        conformity: "CONFORME",
        date: "2026-09-27T15:10:00",
        evaluator: "Maya Haddad",
        decision: "CONFORME",
        comments: "Évaluation de démonstration.",
      },
      client1: null,
      internal2: null,
      responseSentAt: null,
      clientFinal: null,
      closedAt: null,
      labels: ["lbl-conforme"],
    },
    {
      id: "QC-2026-000127",
      clientId: "client-qc",
      client: "Qualicontact",
      campaign: "Dons particuliers",
      agent: "Amir Ben Salah",
      employeeCode: "AG-0526",
      callDate: "2026-09-28",
      callTime: "08:17",
      duration: "05:51",
      extension: "302",
      clientRef: "QCL-45802",
      amount: 20,
      responsible: "Sarah Ben Salem",
      createdAt: "2026-09-28T08:40:00",
      status: "evaluation_1_terminee",
      batchId: null,
      audio: {
        drive_file_id: "1QCDemoAudio127",
        drive_file_name: "QC_127_Amir_BS_280926.wav",
        drive_file_url: "",
        mime_type: "audio/wav",
        file_size: 9451120,
        date_upload: "2026-09-28T08:41:00",
        uploaded_by: "Sarah Ben Salem",
      },
      internal1: {
        status: "TERMINEE",
        score: 68,
        conformity: "NON_CONFORME",
        date: "2026-09-28T09:30:00",
        evaluator: "Sarah Ben Salem",
        decision: "NON_CONFORME",
        comments: "Évaluation de démonstration.",
      },
      client1: null,
      internal2: null,
      responseSentAt: null,
      clientFinal: null,
      closedAt: null,
      labels: ["lbl-debrief", "lbl-rerecouter"],
    },
    {
      id: "QC-2026-000128",
      clientId: "client-qc",
      client: "Qualicontact",
      campaign: "Fidélisation",
      agent: "Rania Jlassi",
      employeeCode: "AG-0474",
      callDate: "2026-09-28",
      callTime: "09:41",
      duration: "07:06",
      extension: "219",
      clientRef: "QCL-45817",
      amount: 60,
      responsible: "Sarah Ben Salem",
      createdAt: "2026-09-28T09:50:00",
      status: "evaluation_1_terminee",
      batchId: null,
      audio: {
        drive_file_id: "1QCDemoAudio128",
        drive_file_name: "QC_128_Rania_J_280926.m4a",
        drive_file_url: "",
        mime_type: "audio/mp4",
        file_size: 7226024,
        date_upload: "2026-09-28T09:51:00",
        uploaded_by: "Sarah Ben Salem",
      },
      internal1: {
        status: "TERMINEE",
        score: 88,
        conformity: "CONFORME",
        date: "2026-09-28T10:15:00",
        evaluator: "Sarah Ben Salem",
        decision: "CONFORME",
        comments: "Évaluation de démonstration.",
      },
      client1: null,
      internal2: null,
      responseSentAt: null,
      clientFinal: null,
      closedAt: null,
      labels: ["lbl-conforme"],
    },
    {
      id: "QC-2026-000129",
      clientId: "client-qc",
      client: "Qualicontact",
      campaign: "Dons particuliers",
      agent: "Youssef Ben Amor",
      employeeCode: "AG-0611",
      callDate: "2026-09-28",
      callTime: "10:12",
      duration: "09:14",
      extension: "157",
      clientRef: "QCL-45821",
      amount: 50,
      responsible: "Sarah Ben Salem",
      createdAt: "2026-09-28T10:20:00",
      status: "audio_recu",
      batchId: null,
      audio: {
        drive_file_id: "1QCDemoAudio129",
        drive_file_name: "QC_129_Youssef_BA_280926.ogg",
        drive_file_url: "",
        mime_type: "audio/ogg",
        file_size: 10014002,
        date_upload: "2026-09-28T10:20:00",
        uploaded_by: "Sarah Ben Salem",
      },
      internal1: null,
      client1: null,
      internal2: null,
      responseSentAt: null,
      clientFinal: null,
      closedAt: null,
      labels: [],
    },
    {
      id: "QC-2026-000123",
      clientId: "client-qc",
      client: "Qualicontact",
      campaign: "Dons particuliers",
      agent: "Mohamed Trabelsi",
      employeeCode: "AG-0418",
      callDate: "2026-09-25",
      callTime: "11:05",
      duration: "07:34",
      extension: "204",
      clientRef: "QCL-45388",
      amount: 40,
      responsible: "Khaled Mansour",
      createdAt: "2026-09-25T11:22:00",
      status: "cloture",
      batchId: "LOT-2026-09-000",
      audio: {
        drive_file_id: "1QCDemoAudio123",
        drive_file_name: "QC_123_Mohamed_T_250926.mp3",
        drive_file_url: "",
        mime_type: "audio/mpeg",
        file_size: 7631890,
        date_upload: "2026-09-25T11:24:00",
        uploaded_by: "Khaled Mansour",
      },
      internal1: {
        status: "TERMINEE",
        score: 96,
        conformity: "CONFORME",
        date: "2026-09-25T12:05:00",
        evaluator: "Khaled Mansour",
        decision: "CONFORME",
        comments: "Évaluation de démonstration.",
      },
      client1: {
        status: "TERMINE",
        date: "2026-09-26T09:30:00",
        user: "Nadia Kacem",
        score: null,
        decision: "VALIDE",
        comments: "Retour de démonstration enregistré.",
        disagreements: "",
      },
      internal2: {
        status: "TERMINEE",
        score: 96,
        conformity: "CONFORME",
        date: "2026-09-26T10:45:00",
        evaluator: "Khaled Mansour",
        decision: "CONFIRMEE",
        comments: "Réécoute de démonstration.",
        responseToClient: "Réponse de démonstration.",
      },
      responseSentAt: "2026-09-26T11:10:00",
      clientFinal: {
        status: "VALIDE",
        decision: "VALIDE",
        date: "2026-09-26T15:20:00",
        user: "Nadia Kacem",
        comments: "Décision finale de démonstration.",
      },
      closedAt: "2026-09-26T15:35:00",
      labels: ["lbl-conforme"],
    },
  ];
  return {
    records,
    batches: [
      {
        id: "LOT-2026-09-001",
        stage: "ECOUTE_1",
        clientId: "client-qc",
        client: "Qualicontact",
        createdAt: "2026-09-28T10:00:00",
        createdBy: "Sarah Ben Salem",
        recordIds: ["QC-2026-000125", "QC-2026-000126"],
        status: "ENVOYE",
        sentAt: "2026-09-28T10:05:00",
        returnedAt: "2026-09-28T11:10:00",
        closedAt: null,
        note: "Envoi de démonstration.",
      },
      {
        id: "LOT-2026-09-000",
        stage: "ECOUTE_1",
        clientId: "client-qc",
        client: "Qualicontact",
        createdAt: "2026-09-25T12:30:00",
        createdBy: "Khaled Mansour",
        recordIds: ["QC-2026-000123"],
        status: "CLOTURE",
        sentAt: "2026-09-25T12:35:00",
        returnedAt: "2026-09-26T15:20:00",
        closedAt: "2026-09-26T15:35:00",
        note: "Lot de démonstration clôturé.",
      },
    ],
    tasks: [
      {
        id: "task-1",
        type: "EVALUATION_1",
        title: "Évaluer l’appel — QC-2026-000129",
        recordId: "QC-2026-000129",
        assignedTo: "Sarah Ben Salem",
        priority: "HAUTE",
        createdAt: "2026-09-28T10:20:00",
        dueDate: "2026-09-28",
        status: "A_FAIRE",
      },
      {
        id: "task-2",
        type: "REEVALUATION_2",
        title: "Réévaluation après retour client",
        recordId: "QC-2026-000125",
        assignedTo: "Sarah Ben Salem",
        priority: "URGENTE",
        createdAt: "2026-09-28T11:10:00",
        dueDate: "2026-09-29",
        status: "A_FAIRE",
      },
      {
        id: "task-3",
        type: "DEBRIEF",
        title: "Préparer le débrief de Mohamed",
        recordId: "QC-2026-000127",
        assignedTo: "Sarah Ben Salem",
        priority: "NORMALE",
        createdAt: "2026-09-28T09:40:00",
        dueDate: "2026-09-30",
        status: "EN_COURS",
      },
      {
        id: "task-4",
        type: "REPONSE_CLIENT",
        title: "Valider la réponse du lot précédent",
        recordId: "QC-2026-000123",
        assignedTo: "Khaled Mansour",
        priority: "NORMALE",
        createdAt: "2026-09-26T10:00:00",
        dueDate: "2026-09-26",
        status: "TERMINE",
      },
      {
        id: "task-5",
        type: "CONTROLE",
        title: "Contrôle de cohérence des fiches du lot",
        recordId: "QC-2026-000126",
        assignedTo: "Maya Haddad",
        priority: "BASSE",
        createdAt: "2026-09-28T08:50:00",
        dueDate: "2026-09-30",
        status: "A_FAIRE",
      },
    ],
    agents: [
      {
        id: "AG-0418",
        name: "Mohamed Trabelsi",
        team: "Équipe Dons",
        since: "2024-03-11",
        initials: "MT",
      },
      {
        id: "AG-0392",
        name: "Ines Gharbi",
        team: "Équipe Dons",
        since: "2024-01-08",
        initials: "IG",
      },
      {
        id: "AG-0526",
        name: "Amir Ben Salah",
        team: "Équipe Dons",
        since: "2024-11-04",
        initials: "AB",
      },
      {
        id: "AG-0474",
        name: "Rania Jlassi",
        team: "Équipe Fidélisation",
        since: "2024-06-19",
        initials: "RJ",
      },
      {
        id: "AG-0611",
        name: "Youssef Ben Amor",
        team: "Équipe Dons",
        since: "2025-02-03",
        initials: "YA",
      },
    ],
    debriefs: [
      {
        id: "DB-2026-034",
        agent: "Mohamed Trabelsi",
        employeeCode: "AG-0418",
        date: "2026-09-24",
        owner: "Khaled Mansour",
        recordIds: ["QC-2026-000123", "QC-2026-000125"],
        actions: [
          {
            title: "Point de suivi qualité à planifier",
            dueDate: "2026-10-05",
            status: "EN_COURS",
          },
        ],
        note: "Session de démonstration — contenu à compléter.",
      },
    ],
    users: demoUsers.map((user) =>
      normalizeDemoUser({
        ...user,
        email: `${user.id}@demo.local`,
        accountType:
          user.role === "Utilisatrice client" ? "client" : "internal",
        clientId: user.role === "Utilisatrice client" ? "client-qc" : "",
      }),
    ),
    roles: DEFAULT_ACCESS_ROLES.map((role) => ({
      ...role,
      activities: [...role.activities],
    })),
    userRoleAssignments: { ...DEFAULT_USER_ROLE_ASSIGNMENTS },
    criteriaByStage: {
      internal1: synergyRubric,
      client1: [],
      internal2: synergyRubric.map((c) => ({
        ...c,
        id: c.id.replace("synergy-", "synergy2-"),
      })),
      clientFinal: [],
    },
    optionGroups: [],
    labels: defaultLabels,
    events: [
      {
        id: "ev-1",
        recordId: "QC-2026-000125",
        action: "Audio téléversé",
        detail: "QC_125_Mohamed_T_280926.mp3 · Google Drive (démo)",
        actor: "Sarah Ben Salem",
        role: "Qualiticienne",
        at: "2026-09-28T09:15:00",
      },
      {
        id: "ev-2",
        recordId: "QC-2026-000125",
        action: "Évaluation Synergy #1 terminée",
        detail: "94 % · Conforme",
        actor: "Sarah Ben Salem",
        role: "Qualiticienne",
        at: "2026-09-28T09:45:00",
      },
      {
        id: "ev-3",
        recordId: "QC-2026-000125",
        action: "Fiche envoyée au client",
        detail: "Lot LOT-2026-09-001",
        actor: "Sarah Ben Salem",
        role: "Qualiticienne",
        at: "2026-09-28T10:05:00",
      },
      {
        id: "ev-4",
        recordId: "QC-2026-000125",
        action: "Retour client reçu",
        detail: "Formulaire de démonstration reçu · réévaluation à traiter",
        actor: "Nadia Kacem",
        role: "Utilisatrice client",
        at: "2026-09-28T11:10:00",
      },
      {
        id: "ev-5",
        recordId: "QC-2026-000126",
        action: "Évaluation Synergy #1 terminée",
        detail: "91 % · Conforme",
        actor: "Maya Haddad",
        role: "Qualiticienne",
        at: "2026-09-27T15:10:00",
      },
      {
        id: "ev-6",
        recordId: "QC-2026-000126",
        action: "Fiche envoyée au client",
        detail: "Lot LOT-2026-09-001",
        actor: "Sarah Ben Salem",
        role: "Qualiticienne",
        at: "2026-09-28T10:05:00",
      },
      {
        id: "ev-7",
        recordId: "QC-2026-000127",
        action: "Évaluation Synergy #1 terminée",
        detail: "68 % · Non conforme",
        actor: "Sarah Ben Salem",
        role: "Qualiticienne",
        at: "2026-09-28T09:30:00",
      },
      {
        id: "ev-8",
        recordId: "QC-2026-000128",
        action: "Évaluation Synergy #1 terminée",
        detail: "88 % · Conforme",
        actor: "Sarah Ben Salem",
        role: "Qualiticienne",
        at: "2026-09-28T10:15:00",
      },
      {
        id: "ev-9",
        recordId: "QC-2026-000123",
        action: "Dossier clôturé",
        detail: "Évaluation finale client : validée",
        actor: "Khaled Mansour",
        role: "Responsable qualité",
        at: "2026-09-26T15:35:00",
      },
    ],
    driveFolderId: "",
    driveConnected: false,
  };
}
function loadState() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      const fallback = makeInitialState();
      return {
        ...fallback,
        ...s,
        criteriaByStage: {
          ...fallback.criteriaByStage,
          ...(s.criteriaByStage || {}),
        },
      };
    }
  } catch (err) {
    console.warn("État local illisible, jeu de démonstration chargé.", err);
  }
  return makeInitialState();
}
const state = loadState();
demoUsers.splice(
  0,
  demoUsers.length,
  ...(Array.isArray(state.users) ? state.users : demoUsers).map(
    normalizeDemoUser,
  ),
);
state.users = demoUsers.map((user) => ({ ...user }));
function migrateRecordCentricWorkflow() {
  state.labels = Array.isArray(state.labels) ? state.labels : [];
  ensureWorkflowLabel("Retour client", "purple");
  ensureWorkflowLabel("Réévaluation", "amber");
  ensureWorkflowLabel("Retour final", "green");
  state.records.forEach((r) => {
    const priorFinal = r.clientFinal || null;
    const rawReturns = Array.isArray(r.clientReturns)
      ? r.clientReturns
      : [
          ...(r.evaluationHistory || []).filter((ev) => ev.stage === "client1"),
          r.client1,
        ].filter(Boolean);
    const isLegacyFinal = (ev) => {
      if (["clientFinal", "finalReturn"].includes(ev?.stage)) return true;
      if (!priorFinal) return false;
      const entryDate = ev?.receivedAt || ev?.date || ev?.archivedAt || "";
      const finalDate =
        priorFinal.date || priorFinal.receivedAt || priorFinal.archivedAt || "";
      const entryStatus = ev?.decision || ev?.finalStatus || ev?.status || "";
      const finalStatus =
        priorFinal.decision ||
        priorFinal.finalStatus ||
        priorFinal.status ||
        "";
      const entryActor = ev?.user || ev?.recordedBy || ev?.evaluator || "";
      const finalActor =
        priorFinal.user || priorFinal.recordedBy || priorFinal.evaluator || "";
      return !!(
        entryDate &&
        finalDate &&
        entryDate === finalDate &&
        entryStatus &&
        entryStatus === finalStatus &&
        (!entryActor || !finalActor || entryActor === finalActor)
      );
    };
    const carriedFinals = rawReturns.filter(isLegacyFinal);
    const clientEntries = rawReturns.filter((ev) => !isLegacyFinal(ev));
    r.clientReturns = clientEntries
      .map((ev, index) => ({
        ...ev,
        returnNumber: Number(ev.returnNumber) || index + 1,
        receivedAt: ev.receivedAt || ev.date || ev.archivedAt || r.createdAt,
        clientRemarks:
          ev.clientRemarks ||
          ev.remarks ||
          ev.comments ||
          ev.disagreements ||
          "",
      }))
      .sort((a, b) => Number(a.returnNumber) - Number(b.returnNumber));

    let finalHistory = Array.isArray(r.finalReturnHistory)
      ? r.finalReturnHistory.map((ev, index) => ({
          ...ev,
          stage: "finalReturn",
          version: Number(ev.version) || index + 1,
          status: ev.decision || ev.finalStatus || ev.status || "",
          date: ev.date || ev.receivedAt || ev.archivedAt || r.createdAt,
          recordedBy: ev.recordedBy || ev.user || ev.evaluator || "Utilisateur",
        }))
      : [];
    const legacyFinals = [
      ...(r.evaluationHistory || []).filter((ev) => ev.stage === "clientFinal"),
      r.finalReturn,
      ...carriedFinals,
      priorFinal,
    ]
      .filter(Boolean)
      .sort((a, b) =>
        String(a.date || a.receivedAt || a.archivedAt || "").localeCompare(
          String(b.date || b.receivedAt || b.archivedAt || ""),
        ),
      );
    for (const ev of legacyFinals) {
      const date = ev.date || ev.receivedAt || ev.archivedAt || r.createdAt;
      const status = ev.decision || ev.finalStatus || ev.status || "";
      const actor = ev.recordedBy || ev.user || ev.evaluator || "Utilisateur";
      const alreadyPresent = finalHistory.some((old) => {
        const oldDate = old.date || old.receivedAt || old.archivedAt || "";
        const oldStatus = old.decision || old.finalStatus || old.status || "";
        const oldActor = old.recordedBy || old.user || old.evaluator || "";
        return (
          (ev.id && old.id && ev.id === old.id) ||
          (date &&
            oldDate === date &&
            status === oldStatus &&
            (!actor || !oldActor || actor === oldActor))
        );
      });
      if (alreadyPresent) continue;
      finalHistory.push({
        ...ev,
        stage: "finalReturn",
        version:
          Math.max(0, ...finalHistory.map((old) => Number(old.version) || 0)) +
          1,
        status,
        date,
        recordedBy: actor,
      });
    }
    r.finalReturnHistory = finalHistory;
    if (finalHistory.length)
      r.finalReturn = finalHistory
        .slice()
        .sort(
          (a, b) =>
            Number(a.version || 0) - Number(b.version || 0) ||
            String(a.date || "").localeCompare(String(b.date || "")),
        )
        .at(-1);

    r.clientSendHistory = Array.isArray(r.clientSendHistory)
      ? r.clientSendHistory
      : [];
    if (!r.clientSendHistory.length) {
      const oldSends = (state.batches || [])
        .filter(
          (b) =>
            (b.recordIds || []).includes(r.id) && (b.ftpUploadedAt || b.sentAt),
        )
        .sort((a, b) =>
          String(a.ftpUploadedAt || a.sentAt || "").localeCompare(
            String(b.ftpUploadedAt || b.sentAt || ""),
          ),
        );
      r.clientSendHistory = oldSends.map((b) => {
        const stage =
          batchStageKey(b) === "REEVALUATION" ? "internal2" : "internal1";
        return {
          id: `legacy-send-${b.id}`,
          sentAt: b.ftpUploadedAt || b.sentAt,
          exportMode: b.exportMode || "BOTH",
          fileName: b.exportFileName || b.downloadFileName || "",
          ftpDestination: b.ftpDestination || "",
          sentBy: b.createdBy || "Utilisateur",
          evaluationStage: stage,
          evaluationVersion: Number(r[stage]?.version) || 1,
          legacyBatchId: b.id,
        };
      });
    }
    r.sentToClientAt =
      r.sentToClientAt ||
      r.clientSendHistory
        .map((ev) => ev.sentAt)
        .filter(Boolean)
        .sort()
        .at(-1) ||
      null;
    r.labels = Array.isArray(r.labels) ? r.labels : [];
    if (r.clientReturns.length) r.client1 = r.client1 || r.clientReturns[0];
    syncRecordWorkflowLabels(r);
  });
}
migrateRecordCentricWorkflow();
// Compatibilité avec les fiches créées avant la confirmation « segment 1 = poste ».
state.records.forEach((r) => {
  if (!String(r.extension || "").trim() && r.sourceFilename) {
    const parsed = parseCallAudioName(r.sourceFilename);
    if (parsed.valid && parsed.extension) {
      r.extension = parsed.extension;
      r.rawSegment1 = r.rawSegment1 || parsed.rawSegment1;
    }
  }
});
saveState();
const app = {
  page: "dashboard",
  recordId: "QC-2026-000125",
  fromPage: "dashboard",
  recordTab: "internal1",
  settingsTab: "templates",
  selectedToSend: new Set(),
  pendingClientSend: null,
  filterRecords: {
    search: "",
    status: "all",
    campaign: "all",
    compliance: "all",
    archived: "active",
    callFrom: "",
    callTo: "",
    closedFrom: "",
    closedTo: "",
  },
  recordPage: 1,
  recordFiltersSig: "",
  recordQuerySig: "",
  recordList: { rows: [], total: 0, pages: 1, loaded: false, error: "" },
  filterSend: {
    status: "all",
    campaign: "all",
    callFrom: "",
    callTo: "",
    closedFrom: "",
    closedTo: "",
  },
  sendFiltersSig: "",
  sendPage: 1,
  sendQuerySig: "",
  sendList: { rows: [], total: 0, pages: 1, loaded: false, error: "" },
  debriefView: "active",
  agentScores: {},
  debriefActionTitles: { active: [], archived: [] },
  debriefFilters: { agent: "", dossier: "", action: "", note: "", score: "" },
  debriefPage: 1,
  debriefPageSize: 10,
  openDebriefId: null,
  userView: "active",
  deactivatedUsers: [],
  taskFilter: "all",
  agentId: null,
  expandedStages: new Set(stageNames),
};
const mainContent = document.getElementById("mainContent");
const modalRoot = document.getElementById("modalRoot");
const toastRoot = document.getElementById("toastRoot");
const searchInput = document.getElementById("globalSearch");
const searchResults = document.getElementById("globalSearchResults");
function ic(name, extra = "") {
  return `<svg class="icon ${extra}"><use href="#i-${name}"/></svg>`;
}
function esc(value = "") {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ],
  );
}
async function apiRequest(path, options = {}) {
  if (typeof window.fetch !== "function")
    throw new Error("API locale indisponible.");
  const method = String(options.method || "GET").toUpperCase();
  const headers = { ...(options.headers || {}) };
  if (
    options.body &&
    !(options.body instanceof FormData) &&
    typeof options.body !== "string"
  ) {
    headers["Content-Type"] = "application/json";
    options = { ...options, body: JSON.stringify(options.body) };
  } else if (typeof options.body === "string" && !headers["Content-Type"])
    headers["Content-Type"] = "application/json";
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && backend.csrfToken)
    headers["X-CSRF-Token"] = backend.csrfToken;
  const response = await window.fetch(path, {
    ...options,
    method,
    headers,
    credentials: "same-origin",
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch (_) {}
  if (!response.ok) {
    const error = new Error(
      payload.error || `Erreur API (${response.status}).`,
    );
    error.status = response.status;
    error.code = payload.code;
    error.payload = payload;
    throw error;
  }
  return payload;
}
async function uploadAudioToLocalStore(
  file,
  kind,
  recordId = "",
  clientId = "",
) {
  if (!backend.enabled || !backend.authenticated) return null;
  const send = async (allowSimilar) => {
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("kind", kind);
    if (recordId) form.append("recordId", recordId);
    if (clientId) form.append("clientId", clientId);
    if (allowSimilar) form.append("allowSimilar", "true");
    return apiRequest("/quality/api/audio", {
      method: "POST",
      headers: { "X-Audio-Kind": kind },
      body: form,
    });
  };
  let result;
  try {
    result = await send(false);
  } catch (error) {
    if (
      error.code === "DUPLICATE_CANDIDATE" &&
      confirm(
        `${error.message}\n\nVoulez-vous téléverser ce fichier malgré la similitude ?`,
      )
    )
      result = await send(true);
    else throw error;
  }
  const audio = result.audio || {};
  return {
    id: audio.id,
    objectId: audio.id,
    storage: "MINIO",
    fileName: audio.name,
    originalName: audio.name,
    mimeType: audio.mimeType,
    fileSize: audio.fileSize,
    sha256: audio.sha256,
    drive_file_id: "",
    drive_file_name: audio.name,
    drive_file_url: "",
    mime_type: audio.mimeType,
    file_size: audio.fileSize,
    date_upload: audio.createdAt,
    uploaded_by: backend.user?.name || "Utilisateur local",
    localUrl: "",
  };
}
function safeStateSnapshot() {
  state.users = demoUsers.map((user) => ({ ...user }));
  const snapshot = JSON.parse(
    JSON.stringify(state, (key, value) =>
      key === "localUrl" ? undefined : value,
    ),
  );
  if (backend.enabled) {
    delete snapshot.users;
    delete snapshot.roles;
    delete snapshot.userRoleAssignments;
  }
  return snapshot;
}
function pendingStorageKey(userId = backend.user?.id) {
  return `${PENDING_STATE_KEY}:${String(userId || "unknown")}`;
}
// ---- Fusion automatique après un conflit de version (409) : on rejoue UNIQUEMENT les changements de cet utilisateur sur l'état
// serveur le plus récent. Si quelqu'un a modifié le même élément, on s'arrête (bandeau « Modifications en attente »).
// L'enregistrement d'état ne sert plus qu'au circuit d'envoi client (fiches, journal, lots) : agents, grilles, libellés et dossier ont leurs routes.
const SYNC_COLLECTIONS = ["records", "events", "batches"];
const SYNC_SETTINGS = [];
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value === undefined ? null : value);
}
function captureSyncedKeys(source) {
  const out = {};
  for (const key of [...SYNC_COLLECTIONS, ...SYNC_SETTINGS])
    if (source[key] !== undefined)
      out[key] = JSON.parse(JSON.stringify(source[key]));
  return out;
}
// Renvoie {merged} (état serveur + changements locaux) ou {conflict:'description'}.
function computeRebase(base, local, remote) {
  const merged = JSON.parse(JSON.stringify(remote));
  for (const key of SYNC_COLLECTIONS) {
    const B = new Map((base[key] || []).map((item) => [item.id, item])),
      R = new Map((remote[key] || []).map((item) => [item.id, item]));
    merged[key] = [...(merged[key] || [])];
    for (const item of local[key] || []) {
      const b = B.get(item.id),
        r = R.get(item.id);
      if (!b) {
        // ajout local
        if (!r) merged[key].unshift(item);
        else if (stableJson(r) !== stableJson(item))
          return {
            conflict: `${key} « ${item.id} » existe déjà côté serveur avec un contenu différent`,
          };
      } else if (stableJson(b) !== stableJson(item)) {
        // modification locale
        if (!r)
          return {
            conflict: `${key} « ${item.id} » a été supprimé par un autre utilisateur`,
          };
        if (stableJson(r) === stableJson(b))
          merged[key] = merged[key].map((entry) =>
            entry.id === item.id ? item : entry,
          );
        else if (stableJson(r) !== stableJson(item))
          return {
            conflict: `${key} « ${item.id} » a été modifié par un autre utilisateur`,
          };
      }
    }
  }
  for (const key of SYNC_SETTINGS) {
    if (local[key] === undefined) continue;
    if (stableJson(base[key]) === stableJson(local[key])) continue;
    if (stableJson(remote[key]) === stableJson(base[key]))
      merged[key] = local[key];
    else if (stableJson(remote[key]) !== stableJson(local[key]))
      return {
        conflict: `le réglage « ${key} » a été modifié par un autre utilisateur`,
      };
  }
  return { merged };
}
async function saveWithRebase(data, saveId) {
  if (saveId !== backend.saveSequence || !backend.baseState) return null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const latest = await apiRequest("/quality/api/state");
    if (!latest.initialized) return null;
    const outcome = computeRebase(backend.baseState, data, latest.data);
    if (outcome.conflict) {
      const error = new Error(
        `Conflit : ${outcome.conflict}. Rechargez les données avant de réessayer.`,
      );
      error.status = 409;
      error.code = "REBASE_CONFLICT";
      throw error;
    }
    const body = captureSyncedKeys(outcome.merged);
    try {
      return await apiRequest("/quality/api/state", {
        method: "PUT",
        body: { version: latest.version, data: body },
      });
    } catch (error) {
      if (
        error.status === 409 &&
        error.code === "STATE_VERSION_CONFLICT" &&
        attempt < 2
      )
        continue;
      throw error;
    }
  }
  return null;
}

// Après un enregistrement réussi, le serveur reste la référence : il estampille, normalise et dérive des données que le navigateur
// ne connaît pas. On adopte donc sa copie canonique, tant qu'aucune modification plus récente n'est en attente (sinon on la
// perdrait); la prochaine sauvegarde renverra ainsi exactement ce que détient le serveur, sans faux « changement ».
async function adoptServerState(saveId) {
  try {
    const result = await apiRequest("/quality/api/state");
    if (saveId !== backend.saveSequence || !result.initialized) return;
    replaceStateFromServer(result.data, result.version);
    if (!modalRoot.classList.contains("open")) render();
  } catch (error) {
    console.warn(
      "Relecture de l’état serveur impossible après enregistrement",
      error,
    );
  }
}
function setSavingLock(on) {
  try {
    document.body.classList.toggle("is-saving", !!on);
  } catch (_) {}
}
function queueRemoteStateSave(snapshot) {
  if (!backend.authenticated || !backend.stateVersion || backend.syncBlocked)
    return;
  const data = JSON.parse(JSON.stringify(snapshot));
  delete data.users;
  delete data.roles;
  delete data.userRoleAssignments;
  delete data.tasks;
  delete data.debriefs;
  for (const key of [
    "agents",
    "labels",
    "criteriaByStage",
    "optionGroups",
    "driveFolderId",
    "driveConnected",
  ])
    delete data[key];
  const epoch = backend.saveEpoch;
  const saveId = ++backend.saveSequence;
  backend.pendingSnapshot = data;
  try {
    sessionStorage.setItem(
      pendingStorageKey(),
      JSON.stringify({
        version: backend.stateVersion,
        userId: backend.user?.id,
        data,
      }),
    );
  } catch (_) {}
  setSavingLock(true);
  backend.saveQueue = backend.saveQueue
    .catch(() => {})
    .then(async () => {
      try {
        if (
          epoch !== backend.saveEpoch ||
          !backend.authenticated ||
          !backend.stateVersion ||
          backend.syncBlocked
        )
          return;
        try {
          let result,
            merged = false;
          try {
            result = await apiRequest("/quality/api/state", {
              method: "PUT",
              body: { version: backend.stateVersion, data },
            });
          } catch (error) {
            if (
              !(error.status === 409 && error.code === "STATE_VERSION_CONFLICT")
            )
              throw error;
            result = await saveWithRebase(data, saveId);
            if (!result) throw error;
            merged = true;
          }
          backend.stateVersion = result.version;
          if (merged)
            toast(
              "Vos modifications ont été fusionnées avec celles d’un autre utilisateur.",
              "info",
            );
          if (saveId === backend.saveSequence) {
            backend.pendingSnapshot = null;
            try {
              sessionStorage.removeItem(pendingStorageKey());
            } catch (_) {}
            await adoptServerState(saveId);
          }
          refreshDashboardData().catch(() => {});
        } catch (error) {
          console.error("Enregistrement DB refusé :", error);
          toast(error.message, "error");
          const versionConflict =
            error.status === 409 &&
            (error.code === "STATE_VERSION_CONFLICT" ||
              error.code === "REBASE_CONFLICT");
          if (
            error.status >= 400 &&
            error.status < 500 &&
            !versionConflict &&
            error.status !== 401
          ) {
            // Refus de validation ou de droit (400, 403, 409 métier...) : la modification ne pourra jamais être acceptée telle quelle.
            // On l'abandonne et on reprend l'état du serveur, sinon chaque enregistrement suivant renverrait la même erreur.
            backend.saveEpoch++;
            backend.pendingSnapshot = null;
            try {
              sessionStorage.removeItem(pendingStorageKey());
            } catch (_) {}
            try {
              await reloadRemoteState();
              render();
              toast(
                "La modification a été refusée et abandonnée; les données du serveur ont été rechargées.",
                "warning",
              );
            } catch (reloadError) {
              console.error(reloadError);
            }
          } else if (error.status === 409 || error.status === 403) {
            backend.saveEpoch++;
            backend.syncBlocked = true;
            const unsynced = backend.pendingSnapshot || data;
            backend.pendingSnapshot = unsynced;
            try {
              sessionStorage.setItem(
                pendingStorageKey(),
                JSON.stringify({
                  version: backend.stateVersion,
                  userId: backend.user?.id,
                  data: unsynced,
                }),
              );
            } catch (_) {}
            render();
          }
        }
      } finally {
        if (saveId === backend.saveSequence) setSavingLock(false);
      }
    });
}
function saveState() {
  try {
    const snapshot = safeStateSnapshot();
    if (!backend.enabled)
      localStorage.setItem(DB_KEY, JSON.stringify(snapshot));
    if (backend.authenticated) queueRemoteStateSave(snapshot);
  } catch (err) {
    console.warn("Sauvegarde locale impossible", err);
  }
}
function downloadPendingSnapshot() {
  if (!backend.pendingSnapshot) {
    toast("Aucune modification non synchronisée à télécharger.", "warning");
    return;
  }
  const payload = JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      baseVersion: backend.stateVersion,
      data: backend.pendingSnapshot,
    },
    null,
    2,
  );
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `qualicontact-modifications-non-synchronisees-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  backend.pendingDownloaded = true;
  toast("Copie de récupération téléchargée.");
}
async function reloadServerStateAfterConflict() {
  if (!backend.pendingDownloaded) {
    toast(
      "Téléchargez d’abord la copie de récupération avant d’abandonner ces modifications.",
      "warning",
    );
    return;
  }
  if (
    !confirm(
      "Recharger la version DB et abandonner les modifications locales non synchronisées ?",
    )
  )
    return;
  backend.saveEpoch++;
  try {
    await reloadRemoteState();
    backend.syncBlocked = false;
    backend.pendingSnapshot = null;
    backend.pendingDownloaded = false;
    try {
      sessionStorage.removeItem(pendingStorageKey());
    } catch (_) {}
    await refreshDashboardData().catch(() => {});
    render();
    toast("Version DB rechargée.");
  } catch (error) {
    backend.syncBlocked = true;
    toast(error.message, "error");
  }
}
function toast(message, tone = "success") {
  const box = document.createElement("div");
  box.className = `toast ${tone === "warning" ? "warning" : tone === "error" ? "error" : ""}`;
  box.innerHTML = `${ic(tone === "error" ? "circle-alert" : tone === "warning" ? "info" : "circle-check")}<span>${esc(message)}</span>`;
  toastRoot.appendChild(box);
  setTimeout(() => {
    box.style.opacity = "0";
    box.style.transform = "translateY(6px)";
    setTimeout(() => box.remove(), 200);
  }, 3600);
}
function formatDate(value, opts = {}) {
  if (!value) return "—";
  const d = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: opts.long ? "long" : "2-digit",
    year: opts.year === false ? undefined : "numeric",
    ...(opts.time ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(d);
}
function initials(name = "") {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((x) => x[0])
      .join("")
      .toUpperCase() || "—"
  );
}
function currentTime() {
  return new Date().toISOString().slice(0, 19);
}
// Qualiticien d'une fiche : choisi à la création (facultatif); modifiable ensuite uniquement avec records_assign.
function assignableLoaded() {
  return Array.isArray(app.assignableUsers) && app.assignableUsers.length > 0;
}
function canAssignRecords() {
  return (
    !(backend.enabled && backend.authenticated) ||
    backend.permissions.has("records_assign")
  );
}
async function loadAssignableUsers() {
  if (backend.enabled && backend.authenticated) {
    const result = await apiRequest("/quality/api/qualiticians");
    app.assignableUsers = result.users || [];
  } else
    app.assignableUsers = demoUsers
      .filter((u) =>
        ["role-qualitician", "role-quality-lead"].includes(
          assignedRoleId(u.id),
        ),
      )
      .map((u) => ({ id: u.id, name: u.name }));
  return app.assignableUsers;
}
function assigneeSelectOptions(
  users,
  currentId = "",
  currentName = "",
  required = false,
) {
  const options = [
    {
      value: "",
      label: required ? "Choisir un qualiticien…" : "Non affecté",
      selected: !currentId && !currentName,
    },
  ];
  users.forEach((user) =>
    options.push({
      value: user.id,
      label: user.name,
      selected: user.id === currentId,
    }),
  );
  if (currentName && !users.some((user) => user.id === currentId))
    options.push({
      value: "__legacy__",
      label: `${currentName} (non référencé)`,
      selected: true,
    });
  return options;
}
function canManageRecords() {
  return (
    !(backend.enabled && backend.authenticated) ||
    backend.permissions.has("records_manage")
  );
}
// ---- Menu Fiches d'appel : en mode serveur, chaque action appelle sa route dédiée (le serveur attribue le numéro et écrit le journal).
const useRecordApi = () => backend.enabled && backend.authenticated;
function applyRecordResult(result) {
  const record = result.record;
  const index = state.records.findIndex((item) => item.id === record.id);
  if (index >= 0) state.records[index] = record;
  else state.records.unshift(record);
  for (const task of result.tasks || []) {
    const at = state.tasks.findIndex((item) => item.id === task.id);
    if (at >= 0) state.tasks[at] = task;
    else state.tasks.unshift(task);
  }
  for (const event of result.events || []) state.events.unshift(event);
  for (const label of result.labels || [])
    if (!state.labels.some((item) => item.id === label.id))
      state.labels.push(label);
  // La route a incrémenté la version globale : on l'adopte seulement si personne d'autre n'a enregistré entre-temps (sinon la prochaine sauvegarde fusionne).
  const version = result.stateVersion;
  if (version && version.before === backend.stateVersion)
    backend.stateVersion = version.after;
}
function recordApiCall(
  request,
  successMessage,
  afterApply = null,
  tone = "success",
) {
  backend.apiPending = (backend.apiPending || 0) + 1;
  return request
    .then((result) => {
      applyRecordResult(result);
      if (afterApply) afterApply(result);
      app.recordQuerySig = "";
      app.sendQuerySig = "";
      refreshSendKpi();
      refreshAgentScores();
      render();
      toast(successMessage, tone);
    })
    .catch((error) => toast(error.message, "error"))
    .finally(() => {
      backend.apiPending = Math.max(0, (backend.apiPending || 1) - 1);
    });
}
const RECORD_PAGE_SIZE = 10;
function recordListQuery(kind = "records") {
  const f = app.filterRecords;
  if (kind === "send") {
    const g = app.filterSend;
    const sendParams = new URLSearchParams({
      view: "active",
      page: String(app.sendPage),
      pageSize: String(RECORD_PAGE_SIZE),
    });
    for (const key of ["callFrom", "callTo", "closedFrom", "closedTo"])
      if (g[key]) sendParams.set(key, g[key]);
    for (const key of ["status", "campaign"])
      if (g[key] && g[key] !== "all") sendParams.set(key, g[key]);
    return sendParams.toString();
  }
  const params = new URLSearchParams({
    view: f.archived === "archived" && canManageRecords() ? "archived" : "active",
    page: String(app.recordPage),
    pageSize: String(RECORD_PAGE_SIZE),
  });
  for (const key of ["search", "callFrom", "callTo", "closedFrom", "closedTo"])
    if (f[key]) params.set(key, f[key]);
  for (const key of ["status", "campaign", "compliance"])
    if (f[key] && f[key] !== "all") params.set(key, f[key]);
  return params.toString();
}
// Deux listes paginées par le serveur (10 fiches par page) : « Fiches d’appel » (avec filtres) et « À envoyer au client ».
const RECORD_LISTS = {
  records: {
    page: "records",
    getPage: () => app.recordPage,
    setPage: (n) => (app.recordPage = n),
    setList: (list) => (app.recordList = list),
    getList: () => app.recordList,
    sig: () => `${app.recordFiltersSig}|${app.recordPage}`,
    setSig: (sig) => (app.recordQuerySig = sig),
  },
  send: {
    page: "send",
    getPage: () => app.sendPage,
    setPage: (n) => (app.sendPage = n),
    setList: (list) => (app.sendList = list),
    getList: () => app.sendList,
    sig: () => `${app.sendFiltersSig}|${app.sendPage}`,
    setSig: (sig) => (app.sendQuerySig = sig),
  },
};
const recordFetchTimers = {};
const recordFetchTokens = { records: 0, send: 0 };
// Récupère uniquement la page courante (10 fiches) filtrée et triée par le serveur.
function scheduleRecordPageFetch(delay = 0, kind = "records") {
  const list = RECORD_LISTS[kind];
  clearTimeout(recordFetchTimers[kind]);
  const token = ++recordFetchTokens[kind];
  recordFetchTimers[kind] = setTimeout(async () => {
    try {
      const result = await apiRequest(
        `/quality/api/records?${recordListQuery(kind)}`,
      );
      if (token !== recordFetchTokens[kind]) return;
      const rows = result.records || [];
      for (const row of rows) {
        const index = state.records.findIndex((r) => r.id === row.id);
        if (index >= 0) state.records[index] = row;
        else state.records.push(row);
      }
      const pagination = result.pagination || {};
      list.setPage(pagination.page || 1);
      list.setList({
        rows,
        total: pagination.total ?? rows.length,
        pages: pagination.pages || 1,
        loaded: true,
        error: "",
      });
    } catch (error) {
      if (token !== recordFetchTokens[kind]) return;
      list.setList({ ...list.getList(), loaded: true, error: error.message });
      console.warn("Liste des fiches indisponible", error);
    }
    if (app.page === list.page && !modalRoot.classList.contains("open")) {
      list.setSig(list.sig());
      render();
    }
  }, delay);
}
// ---- Paramètres : grilles d'évaluation et groupes d'options par routes dédiées (quality_settings).
function adoptRouteVersion(result) {
  const version = result.stateVersion;
  if (version && version.before === backend.stateVersion)
    backend.stateVersion = version.after;
}
function settingsApiCall(
  request,
  applyResult,
  successMessage,
  afterApply = null,
) {
  backend.apiPending = (backend.apiPending || 0) + 1;
  return request
    .then((result) => {
      applyResult(result);
      adoptRouteVersion(result);
      if (afterApply) afterApply(result);
      render();
      toast(successMessage);
    })
    .catch((error) => toast(error.message, "error"))
    .finally(() => {
      backend.apiPending = Math.max(0, (backend.apiPending || 1) - 1);
    });
}
async function refreshGridsFromServer() {
  if (
    !useRecordApi() ||
    !backend.permissions.has("quality_settings") ||
    backend.pendingSnapshot ||
    backend.apiPending ||
    backend.syncBlocked
  )
    return;
  try {
    const grids = await apiRequest("/quality/api/grids");
    if (backend.pendingSnapshot || backend.apiPending) return;
    state.criteriaByStage = {
      ...state.criteriaByStage,
      ...grids.criteriaByStage,
    };
    state.optionGroups = grids.optionGroups;
    if (app.page === "settings" && !modalRoot.classList.contains("open"))
      render();
  } catch (error) {
    console.warn("Grilles indisponibles", error);
  }
}
function archiveRecord(id) {
  const r = getRecord(id);
  if (!r || r.archived) return;
  if (!canManageRecords()) {
    toast("Votre rôle ne permet pas cette action (records_manage).", "warning");
    return;
  }
  if (
    !confirm(
      "Supprimer cette fiche ? Elle sera archivée : masquée des listes et des statistiques, mais son historique et son audio sont conservés et elle pourra être restaurée.",
    )
  )
    return;
  if (useRecordApi()) {
    recordApiCall(
      apiRequest(`/quality/api/records/${encodeURIComponent(id)}/archive`, {
        method: "POST",
        body: {},
      }),
      "Fiche archivée. Elle reste consultable avec le filtre « Fiches supprimées ».",
      () => {
        closeModal();
        app.page = "records";
      },
    );
    return;
  }
  r.archived = true;
  r.archivedAt = currentTime();
  r.archivedBy = backend.user?.name || "Sarah Ben Salem";
  addEvent(
    r.id,
    "Fiche supprimée (archivée)",
    `Indice ${recordIndexValue(r)} · ${r.agent}`,
    r.archivedBy,
    "Qualiticienne",
  );
  saveState();
  closeModal();
  app.page = "records";
  render();
  toast(
    "Fiche archivée. Elle reste consultable avec le filtre « Fiches supprimées ».",
  );
}
function restoreRecord(id) {
  const r = getRecord(id);
  if (!r || !r.archived) return;
  if (!canManageRecords()) {
    toast("Votre rôle ne permet pas cette action (records_manage).", "warning");
    return;
  }
  if (useRecordApi()) {
    recordApiCall(
      apiRequest(`/quality/api/records/${encodeURIComponent(id)}/restore`, {
        method: "POST",
        body: {},
      }),
      "Fiche restaurée.",
    );
    return;
  }
  r.archived = false;
  r.archivedAt = null;
  r.archivedBy = null;
  addEvent(
    r.id,
    "Fiche restaurée",
    `Indice ${recordIndexValue(r)} · ${r.agent}`,
    backend.user?.name || "Sarah Ben Salem",
    "Qualiticienne",
  );
  saveState();
  render();
  toast("Fiche restaurée.");
}
function getRecord(id) {
  return state.records.find((r) => r.id === id);
}
function recordIndexValue(record, fallback = "—") {
  const value = String(record?.recordIndex ?? "").trim();
  return value || fallback;
}
function taskDisplayTitle(title = "") {
  return String(title)
    .replace(/\s*[—-]\s*QC-\d{4}-\d+.*$/, "")
    .trim();
}
function taskRecordTab(task) {
  return task?.type === "REEVALUATION_2"
    ? "internal2"
    : ["RETOUR_CLIENT", "REPONSE_CLIENT"].includes(task?.type)
      ? "clientReturns"
      : "internal1";
}
function getClientReturns(record) {
  return Array.isArray(record?.clientReturns) ? record.clientReturns : [];
}
function latestClientReturn(record) {
  return (
    [...getClientReturns(record)].sort(
      (a, b) => Number(b.returnNumber || 0) - Number(a.returnNumber || 0),
    )[0] || null
  );
}
function recordCall1Status(record) {
  return (
    String(
      record?.clientCall1Status ||
        record?.call1Status ||
        latestClientReturn(record)?.call1Status ||
        "",
    ).trim() || "—"
  );
}
function nextClientReturnNumber(record) {
  return (
    Math.max(
      0,
      ...getClientReturns(record).map((ev) => Number(ev.returnNumber) || 0),
    ) + 1
  );
}
function finalReturnHistory(record) {
  return Array.isArray(record?.finalReturnHistory)
    ? record.finalReturnHistory
    : [];
}
function latestFinalReturn(record) {
  return (
    [...finalReturnHistory(record)]
      .sort(
        (a, b) =>
          Number(a.version || 0) - Number(b.version || 0) ||
          String(a.date || "").localeCompare(String(b.date || "")),
      )
      .at(-1) ||
    record?.finalReturn ||
    null
  );
}
function ensureWorkflowLabel(name, tone = "purple") {
  const key = String(name).trim().toLowerCase();
  let label = state.labels.find(
    (l) => String(l.name).trim().toLowerCase() === key,
  );
  if (!label) {
    const slug = key
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    label = { id: `lbl-${slug || Date.now()}`, name, tone };
    state.labels.push(label);
  }
  return label;
}
function ensureRecordLabel(record, name, tone = "purple") {
  if (!record) return null;
  record.labels = Array.isArray(record.labels) ? record.labels : [];
  const label = ensureWorkflowLabel(name, tone);
  if (label && !record.labels.includes(label.id)) record.labels.push(label.id);
  return label;
}
function syncRecordWorkflowLabels(record) {
  if (getClientReturns(record).length)
    ensureRecordLabel(record, "Retour client", "purple");
  if (
    record.internal2 ||
    (record.evaluationHistory || []).some((ev) => ev.stage === "internal2")
  )
    ensureRecordLabel(record, "Réévaluation", "amber");
  if (latestFinalReturn(record) || record.clientFinal)
    ensureRecordLabel(record, "Retour final", "green");
}
function recordSearchValues(record) {
  return [
    record?.id,
    record?.agent,
    record?.employeeCode,
    record?.agentCodeFromFilename,
    record?.client,
    record?.campaign,
    record?.responsible,
    record?.clientRef,
    record?.sourceFilename,
    record?.audio?.drive_file_name,
    record?.recordIndex,
    record?.baseName,
    record?.campaignCode,
    record?.clientCall1Status,
    record?.call1Status,
    record?.rawSegment1,
    record?.rawSegment6,
    record?.rawSegment7,
    record?.audio?.drive_file_id,
    record?.batchId,
    record?.internal2?.analysisPoleQualite,
    record?.internal2?.promiseStatus,
    record?.internal2?.donConformity,
    latestFinalReturn(record)?.status,
    ...getClientReturns(record).flatMap((ev) => [
      ev.call1Status,
      ev.finalStatus,
      ev.clientRemarks,
      ev.baseSnapshot,
      ev.recordIndexSnapshot,
    ]),
  ];
}
function latestClientSend(record) {
  return (
    [...(record?.clientSendHistory || [])].sort((a, b) =>
      String(b.sentAt || "").localeCompare(String(a.sentAt || "")),
    )[0] || null
  );
}
function hasBeenSentToClient(record) {
  return !!(
    record &&
    (record.sentToClientAt ||
      (record.clientSendHistory || []).length ||
      (state.batches || []).some(
        (b) =>
          (b.recordIds || []).includes(record.id) &&
          (b.ftpUploadedAt || b.sentAt),
      ))
  );
}
function latestInternalEvaluation(record) {
  if (!record) return null;
  return (
    [
      ["internal1", record.internal1],
      ["internal2", record.internal2],
    ]
      .filter(([, ev]) => ev && ev.status === "TERMINEE")
      .sort((a, b) =>
        String(a[1].date || "").localeCompare(String(b[1].date || "")),
      )
      .map(([stage, evaluation]) => ({ stage, evaluation }))
      .at(-1) || null
  );
}
function evaluationAlreadySent(
  record,
  latest = latestInternalEvaluation(record),
) {
  if (!record || !latest) return false;
  return (record.clientSendHistory || []).some(
    (send) =>
      send.evaluationStage === latest.stage &&
      Number(send.evaluationVersion || 0) >=
        Number(latest.evaluation.version || 1),
  );
}
function clientSendAllowed(record) {
  return !!(
    record &&
    state.records.some((item) => item.id === record.id && !item.archived)
  );
}
function clientSendAllowedRecords() {
  return state.records.filter((r) => !r.archived);
}
function evaluationFingerprint(record) {
  return ["internal1", "internal2"]
    .map((stage) => {
      const ev = record?.[stage];
      return `${stage}:${Number(ev?.version) || 0}:${ev?.date || ""}`;
    })
    .join("|");
}

function returnNeedsSynergyReview(record) {
  const returned = latestClientReturn(record);
  if (!returned) return false;
  const returnDate = returned.receivedAt || returned.date || "";
  const evalDate = record.internal2?.date || "";
  return !record.internal2 || String(evalDate) < String(returnDate);
}
function batchStageKey(batchOrStage) {
  const value =
    typeof batchOrStage === "string" ? batchOrStage : batchOrStage?.stage;
  return value === "REEVALUATION" ? "REEVALUATION" : "ECOUTE_1";
}
function getLabel(id) {
  return state.labels.find((l) => l.id === id);
}
function getAgent(idOrName) {
  return state.agents.find((a) => a.id === idOrName || a.name === idOrName);
}
function statusText(status) {
  return (
    {
      audio_recu: "Audio reçu",
      a_evaluer: "À évaluer",
      evaluation_1_terminee: "Évaluation #1 terminée",
      a_envoyer: "À envoyer au client",
      envoyee_client: "Envoyée au client",
      retour_client_recu: "Retour client reçu",
      reevaluation_2_a_faire: "Réévaluation à faire",
      evaluation_2_terminee: "Réévaluation terminée",
      retour_final_recu: "Retour final reçu",
      reponse_synergy_envoyee: "Réponse Synergy envoyée",
      evaluation_client_finale: "Évaluation finale reçue",
      cloture: "Clôturée",
      litige: "En litige",
    }[status] ||
    status ||
    "—"
  );
}
function statusTone(status) {
  return (
    {
      audio_recu: "gray",
      a_evaluer: "amber",
      evaluation_1_terminee: "blue",
      a_envoyer: "green",
      envoyee_client: "blue",
      retour_client_recu: "amber",
      reevaluation_2_a_faire: "red",
      evaluation_2_terminee: "purple",
      retour_final_recu: "green",
      reponse_synergy_envoyee: "blue",
      evaluation_client_finale: "purple",
      cloture: "green",
      litige: "red",
    }[status] || "gray"
  );
}
function badge(text, tone = "gray") {
  return `<span class="badge badge-${tone}">${esc(text)}</span>`;
}
function recordBadge(r) {
  return badge(statusText(r.status), statusTone(r.status));
}
function scoreTone(score) {
  if (score == null) return "gray";
  return score >= 85 ? "green" : score >= 75 ? "amber" : "red";
}
function scoreRing(score) {
  if (score == null) return '<span class="muted">—</span>';
  const tone = score >= 85 ? "" : score >= 75 ? "amber" : "red";
  return `<span class="score-ring ${tone}"><span>${score}</span></span>`;
}
function scoreFormat(score) {
  return score == null ? "—" : `${score} %`;
}
function labelChip(label) {
  const item = typeof label === "string" ? getLabel(label) : label;
  if (!item) return "";
  return `<span class="label-chip ${esc(item.tone || "blue")}">${esc(item.name)}</span>`;
}
function addEvent(
  recordId,
  action,
  detail = "",
  actor = "Sarah Ben Salem",
  role = "Qualiticienne",
) {
  state.events.unshift({
    id: `ev-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    recordId,
    action,
    detail,
    actor,
    role,
    at: currentTime(),
  });
}
function avatar(name, cls = "mini-avatar") {
  return `<span class="${cls}">${esc(initials(name))}</span>`;
}
function taskIsLate(task) {
  return task.status !== "TERMINE" && task.dueDate && task.dueDate < TODAY;
}
function getRecordTask(recordId) {
  return state.tasks.filter(
    (t) => !t.archived && t.recordId === recordId && t.status !== "TERMINE",
  );
}
function pageHeading(
  title,
  desc,
  actions = "",
  eyebrow = "QUALITY MANAGEMENT CRM",
) {
  return `<div class="page-heading"><div class="heading-copy"><div class="eyebrow">${esc(eyebrow)}</div><h1>${title}</h1><p>${desc}</p></div><div class="heading-actions">${actions}</div></div>`;
}
function kpiCard(label, value, icon, tone, change, foot) {
  return `<div class="kpi-card"><div class="kpi-top"><span class="kpi-label">${esc(label)}</span><span class="kpi-icon ${tone}">${ic(icon)}</span></div><div class="kpi-value-line"><strong class="kpi-value">${esc(value)}</strong>${change ? `<span class="kpi-change ${change.startsWith("-") ? "down" : ""}">${ic(change.startsWith("-") ? "arrow-down" : "arrow-up")}${esc(change.replace(/[+-]/g, ""))}</span>` : ""}</div><div class="kpi-foot">${foot}</div></div>`;
}
function hasNumericScore(value) {
  return (
    value !== null &&
    value !== undefined &&
    String(value).trim() !== "" &&
    Number.isFinite(Number(value))
  );
}
function isSynergy1Evaluated(record) {
  const evaluation = record?.internal1;
  if (!evaluation) return false;
  const status = String(evaluation.status || "").toUpperCase();
  const decision = String(
    evaluation.conformity || evaluation.decision || "",
  ).toUpperCase();
  return (
    ["TERMINEE", "TERMINE", "COMPLETED", "DONE"].includes(status) ||
    hasNumericScore(evaluation.score) ||
    ["CONFORME", "NON_CONFORME"].includes(decision)
  );
}
function synergy1Decision(record) {
  return String(
    record?.internal1?.conformity || record?.internal1?.decision || "",
  ).toUpperCase();
}
function normalizeAgentText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
function normalizeEmployeeCode(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/^(AGENT|AG)/, "");
}
function sameAgentIdentity(codeA, nameA, codeB, nameB) {
  const a = normalizeEmployeeCode(codeA),
    b = normalizeEmployeeCode(codeB);
  if (a && b) return a === b;
  const left = normalizeAgentText(nameA),
    right = normalizeAgentText(nameB);
  return !!(left && right && left === right);
}
function recordsForAgent(agent) {
  return (state.records || []).filter(
    (record) =>
      !record.archived &&
      sameAgentIdentity(
        agent?.id,
        agent?.name,
        record.employeeCode,
        record.agent,
      ),
  );
}
function debriefsForAgent(agent) {
  return (state.debriefs || []).filter(
    (debrief) =>
      !debrief.archived &&
      sameAgentIdentity(
        agent?.id,
        agent?.name,
        debrief.employeeCode,
        debrief.agent,
      ),
  );
}
function dashboardAgentMetrics() {
  const rows = [];
  const getRow = (code, name, team = "") => {
    let row = rows.find((item) =>
      sameAgentIdentity(item.employeeCode, item.name, code, name),
    );
    if (!row) {
      row = {
        employeeCode: String(code || ""),
        name: String(name || "Agent non renseigné"),
        team,
        records: [],
        debriefs: [],
        linkedRecordIds: new Set(),
      };
      rows.push(row);
    }
    if (!row.employeeCode && code) row.employeeCode = String(code);
    if ((!row.name || row.name === "Agent non renseigné") && name)
      row.name = String(name);
    if (!row.team && team) row.team = team;
    return row;
  };
  (state.agents || []).forEach((agent) =>
    getRow(agent.id, agent.name, agent.team),
  );
  (state.records || [])
    .filter((record) => !record.archived)
    .forEach((record) =>
      getRow(record.employeeCode, record.agent).records.push(record),
    );
  (state.debriefs || [])
    .filter((debrief) => !debrief.archived)
    .forEach((debrief) => {
      const row = getRow(debrief.employeeCode, debrief.agent);
      row.debriefs.push(debrief);
      (debrief.recordIds || []).forEach((id) => {
        if (getRecord(id)) row.linkedRecordIds.add(id);
      });
    });
  return rows
    .map((row) => {
      const evaluated = row.records.filter(isSynergy1Evaluated);
      const scores = evaluated
        .filter((record) => hasNumericScore(record.internal1?.score))
        .map((record) => Number(record.internal1.score))
        .filter(Number.isFinite);
      const decisions = evaluated
        .map(synergy1Decision)
        .filter((value) => ["CONFORME", "NON_CONFORME"].includes(value));
      const returns = row.records.flatMap(getClientReturns);
      const reviewRecords = row.records.filter(returnNeedsSynergyReview);
      const completedDebriefs = row.debriefs.filter(
        (debrief) =>
          debriefRatingStats(debrief).count === DEBRIEF_RUBRIC.length,
      );
      const debriefAverages = completedDebriefs
        .map((debrief) => debriefRatingStats(debrief).average)
        .filter(Number.isFinite);
      const actions = row.debriefs.flatMap((debrief) => debrief.actions || []);
      const openActions = actions.filter(
        (action) => action.status !== "TERMINE",
      );
      return {
        ...row,
        evaluatedCount: evaluated.length,
        scoreAverage: scores.length
          ? scores.reduce((sum, value) => sum + value, 0) / scores.length
          : null,
        conformityRate: decisions.length
          ? (decisions.filter((value) => value === "CONFORME").length /
              decisions.length) *
            100
          : null,
        returnCount: returns.length,
        returnRecordCount: row.records.filter(
          (record) => getClientReturns(record).length > 0,
        ).length,
        reviewRecordCount: reviewRecords.length,
        debriefCount: row.debriefs.length,
        completedDebriefCount: completedDebriefs.length,
        debriefAverage: debriefAverages.length
          ? debriefAverages.reduce((sum, value) => sum + value, 0) /
            debriefAverages.length
          : null,
        openActionCount: openActions.length,
        linkedRecordCount: row.linkedRecordIds.size,
      };
    })
    .sort(
      (a, b) =>
        b.evaluatedCount - a.evaluatedCount ||
        b.returnCount - a.returnCount ||
        a.name.localeCompare(b.name, "fr"),
    );
}
function qualityDashboardStats() {
  const records = (state.records || []).filter((r) => !r.archived);
  const evaluated = records.filter(isSynergy1Evaluated);
  const scores = evaluated
    .filter((record) => hasNumericScore(record.internal1?.score))
    .map((record) => Number(record.internal1.score))
    .filter(Number.isFinite);
  const decisions = evaluated
    .map(synergy1Decision)
    .filter((value) => ["CONFORME", "NON_CONFORME"].includes(value));
  const returnEntries = records.flatMap((record) => getClientReturns(record));
  const returnedRecords = records.filter(
    (record) => getClientReturns(record).length > 0,
  );
  const statusCounts = { DAM: 0, INDECIS: 0, OTHER: 0, UNKNOWN: 0 };
  let donorYes = 0,
    donorNo = 0;
  returnEntries.forEach((entry) => {
    const value = String(
      entry.finalStatus || entry.decision || "",
    ).toUpperCase();
    if (value === "DAM") statusCounts.DAM++;
    else if (["INDECIS", "INDECIS_ALT"].includes(value)) statusCounts.INDECIS++;
    else if (value) statusCounts.OTHER++;
    else statusCounts.UNKNOWN++;
    if (
      entry.alreadyDonor === true ||
      entry.alreadyDonor === "OUI" ||
      entry.alreadyDonor === "Oui"
    )
      donorYes++;
    else if (
      entry.alreadyDonor === false ||
      entry.alreadyDonor === "NON" ||
      entry.alreadyDonor === "Non"
    )
      donorNo++;
  });
  const debrief = debriefDashboardStats();
  const linkedIds = new Set(
    (state.debriefs || [])
      .filter((session) => !session.archived)
      .flatMap((session) => session.recordIds || []),
  );
  const linkedRecords = [...linkedIds].map(getRecord).filter(Boolean);
  const linkedReturnEntries = linkedRecords.flatMap(getClientReturns).length;
  return {
    recordCount: records.length,
    evaluatedCount: evaluated.length,
    unevaluatedCount: records.length - evaluated.length,
    scoreCount: scores.length,
    scoreAverage: scores.length
      ? scores.reduce((sum, value) => sum + value, 0) / scores.length
      : null,
    decisionCount: decisions.length,
    conformingCount: decisions.filter((value) => value === "CONFORME").length,
    nonconformingCount: decisions.filter((value) => value === "NON_CONFORME")
      .length,
    conformityRate: decisions.length
      ? (decisions.filter((value) => value === "CONFORME").length /
          decisions.length) *
        100
      : null,
    returnCount: returnEntries.length,
    returnedRecordCount: returnedRecords.length,
    returnToReviewCount: records.filter(returnNeedsSynergyReview).length,
    returnStatusCounts: statusCounts,
    donorYes,
    donorNo,
    debrief,
    linkedRecordCount: linkedRecords.length,
    linkedEvaluatedCount: linkedRecords.filter(isSynergy1Evaluated).length,
    linkedReturnCount: linkedReturnEntries,
    linkedReviewCount: linkedRecords.filter(returnNeedsSynergyReview).length,
  };
}
function dashboardProgressRow(label, count, total, tone) {
  const percentage = total
    ? Math.max(0, Math.min(100, (count / total) * 100))
    : 0;
  return `<div class="dashboard-progress-row"><div><span>${esc(label)}</span><strong>${count}<small> / ${total}</small></strong></div><div class="dashboard-progress-track"><i class="${tone}" style="width:${percentage.toFixed(1)}%"></i></div></div>`;
}
function dashboardStatTile(label, value, detail, tone = "blue") {
  return `<div class="dashboard-stat-tile ${tone}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(detail)}</small></div>`;
}
function renderDashboard() {
  const metrics =
    backend.enabled && backend.authenticated && backend.dashboardStats
      ? backend.dashboardStats
      : qualityDashboardStats();
  const agentMetrics =
    backend.enabled &&
    backend.authenticated &&
    backend.dashboardStats?.agentMetrics
      ? backend.dashboardStats.agentMetrics
      : dashboardAgentMetrics();
  const recent = [...(state.records || []).filter((r) => !r.archived)]
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
    .slice(0, 5);
  const activeTasks = (state.tasks || [])
    .filter((task) => !task.archived && task.status !== "TERMINE")
    .slice(0, 4);
  const greeting = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${TODAY}T12:00:00`));
  const currentUser =
    backend.enabled && backend.authenticated
      ? backend.user
      : demoUsers.find((user) => user.id === "u-sarah");
  const firstName = currentUser?.name?.trim().split(/\s+/)[0] || "Utilisateur";
  const maxRecords = Math.max(1, metrics.recordCount);
  const returnStatuses = metrics.returnStatusCounts;
  const linkedDebriefCount = metrics.debrief.sessionCount;
  const debriefAvg =
    metrics.debrief.average == null
      ? "—"
      : `${metrics.debrief.average.toFixed(1)} / 5`;
  const agentTable = agentMetrics.length
    ? `<div class="table-wrap"><table class="data-table dashboard-agent-table"><thead><tr><th>Agent</th><th>Fiches évaluées</th><th>Score Synergy #1</th><th>Retours client</th><th>À réévaluer</th><th>Débriefs notés / total</th><th>Note débrief</th><th>Actions ouvertes</th></tr></thead><tbody>${agentMetrics.map((row) => `<tr><td><span class="agent-cell">${avatar(row.name)}<span class="agent-cell-copy"><strong>${esc(row.name)}</strong><small>${esc(row.employeeCode || "Matricule non renseigné")}</small></span></span></td><td>${row.evaluatedCount} / ${Number.isFinite(row.recordCount) ? row.recordCount : (row.records || []).length}</td><td>${row.scoreAverage == null ? "—" : `${row.scoreAverage.toFixed(1)} %`}</td><td>${row.returnCount}<small class="role-scope-hint">${row.returnRecordCount} fiche(s)</small></td><td>${row.reviewRecordCount}</td><td>${row.completedDebriefCount} / ${row.debriefCount}</td><td>${row.debriefAverage == null ? "—" : `${row.debriefAverage.toFixed(1)} / 5`}</td><td>${row.openActionCount}</td></tr>`).join("")}</tbody></table></div>`
    : '<div class="empty-state"><strong>Aucun agent à synthétiser</strong><p>Les indicateurs par agent apparaîtront quand des fiches ou des débriefs seront présents.</p></div>';
  return `${pageHeading(`Bonjour ${esc(firstName)} <span class="wave-emoji">👋</span>`, `Statistiques calculées à partir des ${metrics.recordCount} fiches, retours client et débriefs actuellement enregistrés .`, `<button class="btn btn-secondary" data-action="export"><span>${ic("download")}</span>Exporter</button><button class="btn btn-primary" data-action="new-record">${ic("plus")} Nouvel enregistrement</button>`)}
    
    <div class="kpi-grid">
      ${kpiCard("Fiches évaluées", `${metrics.evaluatedCount} / ${metrics.recordCount}`, "clipboard", "blue", "", `${metrics.unevaluatedCount} fiche(s) sans évaluation Synergy #1 terminée`)}
      ${kpiCard("Score Synergy #1 moyen", metrics.scoreAverage == null ? "—" : `${metrics.scoreAverage.toFixed(1)} %`, "shield", "green", "", `${metrics.scoreCount} fiche(s) avec un score disponible`)}
      ${kpiCard("Retours client", String(metrics.returnCount), "message", "purple", "", `${metrics.returnedRecordCount} fiche(s) concernée(s) · ${metrics.returnToReviewCount} à réévaluer`)}
      ${kpiCard("Débriefs complets", `${metrics.debrief.completedCount} / ${linkedDebriefCount}`, "users", "amber", "", `Moyenne ${debriefAvg} · ${metrics.debrief.openActionCount} action(s) ouverte(s)`)}
    </div>
    <div class="dashboard-grid">
      <section class="panel"><div class="panel-header"><div class="panel-header-copy"><h2 class="panel-title">Cycle des fiches</h2><p class="panel-subtitle">Comptes calculés sur les dossiers du prototype</p></div><span class="badge badge-gray">${metrics.recordCount} fiche(s)</span></div>
        <div class="panel-body"><div class="cycle-chart">
          ${cycleRow("À évaluer", metrics.unevaluatedCount, maxRecords, "blue")}${cycleRow("Synergy #1 terminée", metrics.evaluatedCount, maxRecords, "mint")}${cycleRow("Envoyées au client", (state.records || []).filter((r) => !r.archived && hasBeenSentToClient(r)).length, maxRecords, "purple")}${cycleRow("Avec retour client", metrics.returnedRecordCount, maxRecords, "amber")}${cycleRow("À réévaluer", metrics.returnToReviewCount, maxRecords, "red")}${cycleRow("Dossiers clôturés", (state.records || []).filter((record) => !record.archived && !!(record.closedAt || record.status === "cloturee" || record.status === "closed")).length, maxRecords, "mint")}
        </div><div class="cycle-foot"><span>Évaluation Synergy #1</span><span><strong>${metrics.evaluatedCount} / ${metrics.recordCount}</strong> terminée(s)</span></div></div>
      </section>
      <section class="panel"><div class="panel-header"><div class="panel-header-copy"><h2 class="panel-title">Mes priorités</h2><p class="panel-subtitle">Les actions qui demandent votre attention</p></div><button class="panel-link" data-page="tasks">Voir les tâches</button></div>
        <div class="panel-body"><div class="priority-list">${
          activeTasks
            .map((task) => {
              const record = getRecord(task.recordId);
              return `<div class="priority-item" data-open-record="${esc(task.recordId)}" data-record-tab="${taskRecordTab(task)}"><i class="priority-dot ${task.priority === "URGENTE" ? "red" : task.priority === "HAUTE" ? "" : "blue"}"></i><div class="priority-copy"><strong>${esc(taskDisplayTitle(task.title))}</strong><span>Indice ${esc(recordIndexValue(record))} · ${esc(record?.agent || "")}</span></div><span class="priority-due ${taskIsLate(task) ? "late" : ""}">${taskIsLate(task) ? "En retard" : `Échéance ${formatDate(task.dueDate, { year: false })}`}</span></div>`;
            })
            .join("") ||
          '<div class="empty-state">Aucune priorité en attente.</div>'
        }</div></div>
      </section>
    </div>
    <div class="dashboard-insight-grid">
      <section class="panel"><div class="panel-header"><div><h2 class="panel-title">Résultats Synergy #1</h2><p class="panel-subtitle">Conformité sur les évaluations réellement enregistrées</p></div><span class="badge badge-blue">${metrics.scoreAverage == null ? "Score —" : `${metrics.scoreAverage.toFixed(1)} % moyen`}</span></div><div class="panel-body"><div class="dashboard-progress-list">${dashboardProgressRow("Évaluations terminées", metrics.evaluatedCount, metrics.recordCount, "blue")}${dashboardProgressRow("Décision conforme", metrics.conformingCount, metrics.decisionCount, "mint")}${dashboardProgressRow("Décision non conforme", metrics.nonconformingCount, metrics.decisionCount, "red")}</div><div class="dashboard-insight-foot">Taux de conformité : <strong>${metrics.conformityRate == null ? "—" : `${metrics.conformityRate.toFixed(1)} %`}</strong> · ${metrics.decisionCount} décision(s) renseignée(s)</div></div></section>
      <section class="panel"><div class="panel-header"><div><h2 class="panel-title">Retours client</h2><p class="panel-subtitle">Entrées conservées et fiches concernées</p></div><button class="panel-link" data-page="records">Voir les fiches</button></div><div class="panel-body"><div class="dashboard-stat-grid">${dashboardStatTile("DAM", String(returnStatuses.DAM), "entrées de retour", "green")}${dashboardStatTile("Indécis", String(returnStatuses.INDECIS), "entrées de retour", "amber")}${dashboardStatTile("Fiches concernées", String(metrics.returnedRecordCount), "avec au moins un retour", "blue")}${dashboardStatTile("À réévaluer", String(metrics.returnToReviewCount), "après le dernier retour", "red")}${dashboardStatTile("Donateur · Oui", String(metrics.donorYes), "réponses renseignées", "purple")}${dashboardStatTile("Donateur · Non", String(metrics.donorNo), "réponses renseignées", "purple")}</div><div class="dashboard-insight-foot">${returnStatuses.UNKNOWN} retour(s) sans statut final · ${returnStatuses.OTHER} avec un autre statut · ${Math.max(0, metrics.returnCount - metrics.donorYes - metrics.donorNo)} sans réponse donateur</div></div></section>
      <section class="panel"><div class="panel-header"><div><h2 class="panel-title">Débriefs liés aux fiches</h2><p class="panel-subtitle">Sessions, notes et dossiers associés</p></div><button class="panel-link" data-page="debriefs">Voir les débriefs</button></div><div class="panel-body"><div class="dashboard-stat-grid">${dashboardStatTile("Sessions complètes", `${metrics.debrief.completedCount} / ${metrics.debrief.sessionCount}`, `moyenne ${debriefAvg}`, "purple")}${dashboardStatTile("Agents évalués", String(metrics.debrief.agentCount), "avec formulaire complet", "green")}${dashboardStatTile("Fiches liées", String(metrics.linkedRecordCount), `${metrics.linkedEvaluatedCount} évaluée(s) Synergy #1`, "blue")}${dashboardStatTile("Retours sur fiches liées", String(metrics.linkedReturnCount), `${metrics.linkedReviewCount} fiche(s) à réévaluer`, "amber")}</div><div class="dashboard-insight-foot">Actions de suivi ouvertes : <strong>${metrics.debrief.openActionCount}</strong> · dont ${metrics.debrief.overdueActionCount} en retard</div></div></section>
    </div>
    <section class="panel table-panel dashboard-agent-panel"><div class="panel-header"><div><h2 class="panel-title">Statistiques croisées par agent</h2><p class="panel-subtitle">Synergy #1, retours client archivés, réévaluations à traiter et débriefs du même agent</p></div><button class="panel-link" data-page="agents">Voir les profils ${ic("arrow-right")}</button></div>${agentTable}</section>
    <section class="panel table-panel" style="margin-top:15px"><div class="panel-header"><div><h2 class="panel-title">Fiches récentes</h2><p class="panel-subtitle">Dernières fiches créées ou mises à jour</p></div><div class="table-header-actions"><button class="btn btn-secondary btn-small" data-page="records">Toutes les fiches ${ic("arrow-right")}</button></div></div><div class="table-wrap">${renderRecordsTable(recent, { compact: true })}</div><div class="table-footer"><span>Affichage de ${recent.length} fiche(s) · ${metrics.recordCount} au total</span><div class="pagination"><button data-page="records">${ic("chevron-right")}</button></div></div></section>`;
}
function cycleRow(label, count, max, tone) {
  return `<div class="cycle-row"><span class="cycle-label">${esc(label)}</span><div class="cycle-track"><div class="cycle-fill ${tone}" style="width:${max ? Math.min(100, Math.max(4, (count / max) * 100)) : 4}%"></div></div><span class="cycle-count">${count}</span></div>`;
}
function clientReturnStatusLabel(value) {
  return (
    { INDECIS: "Indécis", INDECIS_ALT: "Indécis", DAM: "DAM" }[value] ||
    value ||
    "—"
  );
}
function donorAnswerLabel(value) {
  return value === true || value === "OUI" || value === "Oui"
    ? "Oui"
    : value === false || value === "NON" || value === "Non"
      ? "Non"
      : "—";
}
function finalReturnStatusCode(value) {
  return ["VALIDE", "VALID"].includes(value)
    ? "VALIDE"
    : ["NON_VALIDE", "INVALID"].includes(value)
      ? "NON_VALIDE"
      : "";
}
function promiseStatusLabel(value) {
  return (
    {
      PROMESSE_VALIDE: "PROMESSE VALIDE",
      PROMESSE_NON_VALIDE: "PROMESSE Non VALIDE",
      VALID: "PROMESSE VALIDE",
      INVALID: "PROMESSE Non VALIDE",
    }[value] ||
    value ||
    "—"
  );
}
function donorConformityLabel(value) {
  return (
    { CONFORME: "Don conforme", NON_CONFORME: "Don non conforme" }[value] ||
    value ||
    "—"
  );
}
function finalReturnStatusLabel(value) {
  return (
    {
      VALIDE: "Valide",
      NON_VALIDE: "Non valide",
      VALID: "Valide",
      INVALID: "Non valide",
    }[value] ||
    value ||
    "—"
  );
}
// Statut initial du don (évaluation Synergy #1) : extra.donStatus + extra.cancelReason de crm_record_evaluations.
function qualityLabel(record) {
  const ev = record?.internal1;
  const don = ev?.donStatus || ev?.conformity;
  if (!don) return "";
  if (don === "CONFORME") return "CONFORME";
  const reason = { AGENT: "AGENT", PROD: "PRODUCTION", PRODUCTION: "PRODUCTION" }[
    String(ev.cancelReason || "").toUpperCase()
  ];
  return reason ? `NON CONFORME#${reason}` : "NON CONFORME";
}
function qualityCell(record) {
  const label = qualityLabel(record);
  if (!label) return '<span class="muted">—</span>';
  const tone = label === "CONFORME" ? "green" : "red";
  return `<span class="label-chip ${tone}">${esc(label)}</span>`;
}
function responseCell(title, primary, secondary = "", detail = "") {
  return `<div class="record-form-response">${title ? `<small class="record-response-label">${esc(title)}</small>` : ""}<strong>${esc(primary || "—")}</strong>${secondary ? `<small>${esc(secondary)}</small>` : ""}${detail ? `<small class="record-response-detail" title="${esc(detail)}">${esc(detail)}</small>` : ""}</div>`;
}
function renderRecordsTable(rows, opts = {}) {
  const sendMode = !!opts.sendMode;
  const selectionMode = sendMode;
  if (!rows.length)
    return `<div class="empty-state"><div class="empty-icon">${ic("clipboard")}</div><strong>Aucune fiche à afficher</strong><p>Ajustez les filtres ou créez un nouvel enregistrement audio.</p><button class="btn btn-primary btn-small" data-action="new-record">${ic("plus")} Nouvel enregistrement</button></div>`;
  return `<table class="data-table"><thead><tr>${selectionMode ? '<th style="width:35px"></th>' : ""}<th>Fiche</th><th>Date d’appel</th><th>Dossier</th><th>Agent</th><th>Indice</th><th>Qualité</th><th>Retour client</th><th>Réévaluation</th><th>Retour final</th><th>Statut</th></tr></thead><tbody>${rows
    .map((r) => {
      const returns = getClientReturns(r);
      const latest = latestClientReturn(r);
      const donor = donorAnswerLabel(latest?.alreadyDonor);
      const returnCell = latest
        ? responseCell(
            `Retour client · ${returns.length} entrée(s)`,
            clientReturnStatusLabel(latest.finalStatus || latest.decision),
            `Call 1 : ${latest.call1Status || "—"} · Déjà donateur : ${donor}`,
            latest.clientRemarks ||
              latest.remarks ||
              latest.comments ||
              latest.disagreements ||
              "",
          )
        : responseCell("Retour client", "—");
      const reevaluation = r.internal2
        ? responseCell(
            "Réévaluation",
            r.internal2.analysisPoleQualite || "Analyse non renseignée",
            `Promesse : ${promiseStatusLabel(r.internal2.promiseStatus || r.internal2.finalStatus)} · ${donorConformityLabel(r.internal2.donConformity || r.internal2.donStatus || r.internal2.conformity)}`,
          )
        : responseCell("Réévaluation", "—");
      const finalEntry =
        latestFinalReturn(r) ||
        (r.clientFinal
          ? {
              status: r.clientFinal.status || r.clientFinal.decision,
              date: r.clientFinal.date,
              legacy: true,
            }
          : null);
      const finalCell = finalEntry
        ? `<strong>${esc(finalReturnStatusLabel(finalEntry.status || finalEntry.decision))}</strong>`
        : '<span class="muted">—</span>';
      const selected = app.selectedToSend.has(r.id);
      const checkbox = sendMode
        ? `<td><input class="batch-select" type="checkbox" data-send-select="${esc(r.id)}" ${selected ? "checked" : ""} aria-label="Sélectionner l’indice ${esc(recordIndexValue(r))}"></td>`
        : "";
      return `<tr data-open-record="${esc(r.id)}">${checkbox}<td class="record-open-cell"><button class="icon-button record-action-button" type="button" data-action="open-record" data-record-id="${esc(r.id)}" onclick="return window.openQualiContactRecord(event,this.dataset.recordId)" title="Modifier la fiche" aria-label="Modifier la fiche ${esc(recordIndexValue(r))}">${ic("edit")}</button>${!selectionMode && !r.archived && canManageRecords() ? `<button class="icon-button record-action-button record-action-delete" type="button" data-action="archive-record" data-record-id="${esc(r.id)}" title="Supprimer la fiche" aria-label="Supprimer la fiche ${esc(recordIndexValue(r))}">${ic("trash")}</button>` : ""}</td><td>${formatDate(r.callDate)}</td><td><span class="record-source-index"><strong>${esc(r.baseName || "—")}</strong><small>${esc(r.campaign || "")}</small></span></td><td><span class="agent-cell">${avatar(r.agent)}<span class="agent-cell-copy"><strong>${esc(r.agent)}</strong><small>${r.employeeCode ? esc(r.employeeCode) : r.agentCodeFromFilename ? `Candidat ${esc(r.agentCodeFromFilename)}` : "À rattacher"}</small></span></span></td><td class="record-id">${esc(recordIndexValue(r))}</td><td>${qualityCell(r)}</td><td>${returnCell}</td><td>${reevaluation}</td><td>${finalCell}</td><td>${recordBadge(r)}</td></tr>`;
    })
    .join("")}</tbody></table>`;
}
function renderRecords() {
  const f = app.filterRecords;
  const showArchived = f.archived === "archived" && canManageRecords();
  const filtersSig = JSON.stringify(f);
  if (app.recordFiltersSig !== filtersSig) {
    app.recordFiltersSig = filtersSig;
    app.recordPage = 1;
  }
  // Filtres, tri et découpage en pages de 10 faits par le serveur.
  const querySig = `${filtersSig}|${app.recordPage}`;
  if (app.recordQuerySig !== querySig) {
    app.recordQuerySig = querySig;
    scheduleRecordPageFetch(f.search ? 250 : 0);
  }
  const pageRows = app.recordList.rows;
  const totalRows = app.recordList.total;
  const recordPages = app.recordList.pages;
  const recordPageButtons = Array.from({ length: recordPages }, (_, i) => i + 1)
    .filter((n) => n === 1 || n === recordPages || Math.abs(n - app.recordPage) <= 1)
    .map(
      (n, i, list) =>
        `${i && n - list[i - 1] > 1 ? "<span>…</span>" : ""}<button class="page-num${n === app.recordPage ? " active" : ""}" data-record-page="${n}">${n}</button>`,
    )
    .join("");
  const statuses = [
    ...new Set(state.records.filter((r) => !r.archived).map((r) => r.status)),
  ];
  const campaigns = [
    ...new Set(state.records.filter((r) => !r.archived).map((r) => r.campaign)),
  ];
  return `${pageHeading("Fiches d’appel", `Retrouvez, filtrez et ouvrez les ${state.records.filter((r) => !r.archived).length} fiches de démonstration. Chaque appel conserve son audio, ses évaluations et son historique.`, `<button class="btn btn-secondary" data-action="export">${ic("download")} Exporter</button><button class="btn btn-primary" data-action="new-record">${ic("plus")} Nouvel enregistrement</button>`)}
    <section class="panel table-panel"><div class="panel-header"><div><h2 class="panel-title">Toutes les fiches</h2><p class="panel-subtitle">Recherche par indice, agent, campagne, base, nom audio ou File ID</p></div><span class="badge badge-gray">${totalRows} résultat${totalRows === 1 ? "" : "s"}</span></div>
    <div class="filters-row"><button class="icon-button" type="button" data-action="clear-record-filters" title="Effacer tous les filtres" aria-label="Effacer tous les filtres">${ic("filter-x")}</button><label class="filter-search">${ic("search")}<input type="search" id="recordSearch" data-filter="search" value="${esc(f.search)}" placeholder="Indice, agent, base, campagne, nom audio…"></label><select class="filter-select" data-filter="status"><option value="all">Tous les statuts</option>${statuses.map((s) => `<option value="${esc(s)}" ${f.status === s ? "selected" : ""}>${esc(statusText(s))}</option>`).join("")}</select><select class="filter-select" data-filter="campaign"><option value="all">Toutes les campagnes</option>${campaigns.map((c) => `<option value="${esc(c)}" ${f.campaign === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select><select class="filter-select" data-filter="compliance"><option value="all">Toute conformité</option><option value="CONFORME" ${f.compliance === "CONFORME" ? "selected" : ""}>Conforme</option><option value="NON_CONFORME" ${f.compliance === "NON_CONFORME" ? "selected" : ""}>Non conforme</option></select>${canManageRecords() ? `<select class="filter-select" data-filter="archived"><option value="active" ${f.archived !== "archived" ? "selected" : ""}>Fiches actives</option><option value="archived" ${f.archived === "archived" ? "selected" : ""}>Fiches supprimées</option></select>` : ""}<label class="filter-date" style="display:inline-flex;gap:6px;align-items:center;font-size:13px">Date d’appel <input class="filter-select" type="date" data-filter="callFrom" value="${esc(f.callFrom)}" aria-label="Date d’appel – début"/> → <input class="filter-select" type="date" data-filter="callTo" value="${esc(f.callTo)}" aria-label="Date d’appel – fin"/></label><label class="filter-date" style="display:inline-flex;gap:6px;align-items:center;font-size:13px">Date de clôture <input class="filter-select" type="date" data-filter="closedFrom" value="${esc(f.closedFrom)}" aria-label="Date de clôture – début"/> → <input class="filter-select" type="date" data-filter="closedTo" value="${esc(f.closedTo)}" aria-label="Date de clôture – fin"/></label><span class="filter-count">${totalRows} fiche${totalRows === 1 ? "" : "s"}</span></div>
    <div class="table-wrap">${renderRecordsTable(pageRows)}</div><div class="table-footer"><span>${totalRows} fiche${totalRows === 1 ? "" : "s"} · page ${app.recordPage} / ${recordPages}</span><div class="pagination"><button data-record-page="${app.recordPage - 1}" ${app.recordPage <= 1 ? "disabled" : ""}>${ic("chevron-left")}</button>${recordPageButtons}<button data-record-page="${app.recordPage + 1}" ${app.recordPage >= recordPages ? "disabled" : ""}>${ic("chevron-right")}</button></div></div></section>`;
}
function renderSend() {
  const allowed = clientSendAllowedRecords();
  // Tri par date d’appel et découpage en pages de 10 faits par le serveur.
  const g = app.filterSend;
  const sendFiltersSig = JSON.stringify(g);
  if (app.sendFiltersSig !== sendFiltersSig) {
    app.sendFiltersSig = sendFiltersSig;
    app.sendPage = 1;
  }
  const querySig = `${sendFiltersSig}|${app.sendPage}`;
  if (app.sendQuerySig !== querySig) {
    app.sendQuerySig = querySig;
    scheduleRecordPageFetch(0, "send");
  }
  const records = app.sendList.rows;
  const totalRows = app.sendList.total;
  const sendPages = app.sendList.pages;
  const sendStatuses = [
    ...new Set(allowed.map((r) => r.status).filter(Boolean)),
  ];
  const sendCampaigns = [
    ...new Set(allowed.map((r) => r.campaign).filter(Boolean)),
  ];
  const sendDateFilter = (label, from, to) =>
    `<label class="filter-date" style="display:inline-flex;gap:6px;align-items:center;font-size:13px">${label} <input class="filter-select" type="date" data-send-filter="${from}" value="${esc(g[from])}" aria-label="${label} – début"/> → <input class="filter-select" type="date" data-send-filter="${to}" value="${esc(g[to])}" aria-label="${label} – fin"/></label>`;
  const sendFilters = `<div class="filters-row"><button class="icon-button" type="button" data-action="clear-send-filters" title="Effacer tous les filtres" aria-label="Effacer tous les filtres">${ic("filter-x")}</button><select class="filter-select" data-send-filter="status"><option value="all">Tous les statuts</option>${sendStatuses.map((v) => `<option value="${esc(v)}" ${g.status === v ? "selected" : ""}>${esc(statusText(v))}</option>`).join("")}</select><select class="filter-select" data-send-filter="campaign"><option value="all">Toutes les campagnes</option>${sendCampaigns.map((v) => `<option value="${esc(v)}" ${g.campaign === v ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>${sendDateFilter("Date d’appel", "callFrom", "callTo")}${sendDateFilter("Date de clôture", "closedFrom", "closedTo")}</div>`;
  const sendPageButtons = Array.from({ length: sendPages }, (_, i) => i + 1)
    .filter((n) => n === 1 || n === sendPages || Math.abs(n - app.sendPage) <= 1)
    .map(
      (n, i, list) =>
        `${i && n - list[i - 1] > 1 ? "<span>…</span>" : ""}<button class="page-num${n === app.sendPage ? " active" : ""}" data-send-page="${n}">${n}</button>`,
    )
    .join("");
  const selected = [...app.selectedToSend].filter((id) =>
    allowed.some((r) => r.id === id),
  );
  const sentCount = state.records.filter(
    (r) => !r.archived && hasBeenSentToClient(r),
  ).length;
  const pending = app.pendingClientSend;
  const actions = selected.length
    ? `<button class="btn btn-primary" data-action="prepare-client-send-export">${ic("download")} Préparer l’envoi (${selected.length})</button>`
    : "";
  return `${pageHeading("À envoyer au client", "Toutes les fiches sont disponibles. Sélectionnez celles à transmettre; le dépôt sur le FTP reste manuel.", actions)}
    <div class="step-strip send-workflow"><div class="step-item complete"><span class="step-number">${ic("circle-check")}</span><span class="step-copy"><strong>Fiches disponibles</strong><small>Tous statuts et toutes évaluations</small></span></div><div class="step-item current"><span class="step-number">2</span><span class="step-copy"><strong>Choix des fiches</strong><small>${totalRows} disponible${totalRows === 1 ? "" : "s"} · ${selected.length} sélectionnée${selected.length === 1 ? "" : "s"}</small></span></div><div class="step-item"><span class="step-number">3</span><span class="step-copy"><strong>Export et dépôt FTP</strong><small>Excel, ZIP audio ou les deux</small></span></div></div>
    ${pending ? `<div class="notice-inline send-pending-notice">${ic("info")}<span>Export prêt : <strong>${esc(pending.fileName)}</strong> · ${pending.recordIds.length} fiche(s). Déposez-le sur le FTP, puis confirmez le dépôt pour tracer chaque envoi dans sa fiche.</span><button class="btn btn-secondary btn-small" data-action="confirm-client-send-ftp">Confirmer le dépôt FTP</button></div>` : ""}
    <div class="page-split"><section class="panel table-panel"><div class="panel-header"><div><h2 class="panel-title">Toutes les fiches à transmettre</h2><p class="panel-subtitle">Date, dossier, agent, indice, réponses des formulaires et libellés d’étape.</p></div>${badge(`${totalRows} disponibles`, "blue")}</div>
      ${selected.length ? `<div class="batch-summary"><span><strong>${selected.length} fiche${selected.length === 1 ? "" : "s"} sélectionnée${selected.length === 1 ? "" : "s"}</strong> · les IDs techniques restent masqués au client</span><button class="btn btn-primary btn-small" data-action="prepare-client-send-export">Préparer le téléchargement ${ic("arrow-right")}</button></div>` : ""}
      ${sendFilters}
      <div class="table-wrap">${records.length ? renderRecordsTable(records, { sendMode: true }) : `<div class="empty-state"><div class="empty-icon">${ic("circle-check")}</div><strong>Aucune fiche à afficher</strong><p>Ajustez les filtres ou créez une nouvelle fiche.</p><button class="btn btn-secondary btn-small" data-page="records">Voir les fiches ${ic("arrow-right")}</button></div>`}</div>
      <div class="table-footer"><span>${totalRows} fiche${totalRows === 1 ? "" : "s"} sélectionnable${totalRows === 1 ? "" : "s"} · page ${app.sendPage} / ${sendPages}</span><div class="pagination"><button data-send-page="${app.sendPage - 1}" ${app.sendPage <= 1 ? "disabled" : ""}>${ic("chevron-left")}</button>${sendPageButtons}<button data-send-page="${app.sendPage + 1}" ${app.sendPage >= sendPages ? "disabled" : ""}>${ic("chevron-right")}</button></div></div><div class="table-footer" style="border-top:0"><span>Chaque envoi confirmé est tracé dans l’historique de sa fiche; aucun écran de lot n’est créé.</span></div></section>
      <div class="stack"><section class="side-card"><h3>Envoi client</h3><p>Le qualiticien choisit librement les fiches à transmettre. Les fiches déjà envoyées restent visibles; tout nouvel envoi est ajouté à leur historique.</p><div class="metric-list"><div class="metric-line"><span>Fiches disponibles</span><strong>${totalRows}</strong></div><div class="metric-line"><span>Fiches déjà transmises</span><strong>${sentCount}</strong></div><div class="metric-line"><span>Format disponible</span><strong>Excel / ZIP / les deux</strong></div><div class="metric-line"><span>Dépôt sur FTP</span><strong>Manuel</strong></div></div></section><section class="side-card"><h3>Historique conservé</h3><p>Ouvrez une fiche pour retrouver l’audio, toutes les réponses, les libellés, les envois et les retours datés.</p><button class="btn btn-secondary btn-small btn-full" data-page="records">Consulter les fiches ${ic("arrow-right")}</button></section></div></div>`;
}
function clientSendStem(id) {
  return `Envoi-client_${TODAY}_${safeArchiveName(id)}`;
}
function openClientSendExportModal() {
  const rows = [...app.selectedToSend]
    .map(getRecord)
    .filter((r) => r && clientSendAllowed(r));
  if (!rows.length) {
    toast("Sélectionnez au moins une fiche à transmettre.", "warning");
    return;
  }
  const sendId = `SEND-${TODAY.replaceAll("-", "")}-${String(Date.now()).slice(-6)}`;
  app.pendingClientSend = {
    id: sendId,
    recordIds: rows.map((r) => r.id),
    evaluationSnapshots: Object.fromEntries(
      rows.map((r) => [r.id, evaluationFingerprint(r)]),
    ),
    createdAt: currentTime(),
    downloadedAt: null,
    fileName: "",
    exportMode: null,
  };
  const body = `<input type="hidden" name="sendId" value="${esc(sendId)}"/><div class="notice-inline">${ic("send")}<span><strong>${rows.length} fiche(s) sélectionnée(s).</strong> Choisissez Excel, ZIP audio ou les deux. Aucun lot métier ne sera créé.</span></div><div class="form-grid" style="margin-top:13px">${field(
    "exportMode",
    "Contenu à télécharger",
    {
      select: [
        { value: "EXCEL", label: "Tableau Excel uniquement" },
        { value: "AUDIO_ZIP", label: "Enregistrements audio en ZIP" },
        {
          value: "BOTH",
          label: "Les deux : Excel + audios dans un ZIP",
          selected: true,
        },
      ],
      required: true,
    },
  )}</div><div style="margin-top:13px"><span class="form-label">Indices inclus</span><div class="label-row" style="margin-top:7px">${rows.map((r) => `<span class="label-chip">${esc(recordIndexValue(r))}</span>`).join("")}</div></div><div class="field-hint" style="margin-top:11px">Le tableau Excel reprend Date, Dossier (Nom de base), Agent, Indice, les réponses disponibles des formulaires et les libellés d’étape.</div>`;
  showModal({
    title: "Préparer l’envoi au client",
    description:
      "Après le téléchargement, déposez manuellement le fichier sur le FTP externe et confirmez-le ici.",
    body,
    form: "clientSendExport",
    submitText: "Préparer le téléchargement",
    wide: true,
    note: "Aucun transfert FTP automatique",
  });
}
async function downloadClientSendExport(form) {
  const fd = new FormData(form);
  const mode = fd.get("exportMode");
  const pending = app.pendingClientSend;
  if (!pending || pending.id !== fd.get("sendId")) {
    toast(
      "La sélection d’envoi a expiré. Recommencez depuis la liste.",
      "warning",
    );
    closeModal();
    return;
  }
  const rows = pending.recordIds
    .map(getRecord)
    .filter(
      (r) =>
        r &&
        clientSendAllowed(r) &&
        evaluationFingerprint(r) === pending.evaluationSnapshots?.[r.id],
    );
  if (!rows.length) {
    toast(
      "Aucune fiche sélectionnée n’est encore disponible. Recommencez la sélection.",
      "warning",
    );
    app.pendingClientSend = null;
    closeModal();
    render();
    return;
  }
  closeModal();
  toast("Préparation des fichiers à télécharger…", "warning");
  try {
    let audioResult = { files: [], missing: [] };
    let fileName = "";
    const stem = clientSendStem(pending.id);
    if (mode === "EXCEL") {
      fileName = `${stem}-retours-client.xlsx`;
      downloadBlob(createClientReturnWorkbook(rows), fileName);
    } else {
      audioResult = await collectBatchAudio(rows);
      const entries = [...audioResult.files];
      if (mode === "BOTH")
        entries.unshift({
          name: `${stem}-retours-client.xlsx`,
          data: new Uint8Array(
            await createClientReturnWorkbook(rows).arrayBuffer(),
          ),
        });
      entries.push({
        name: "LISEZ-MOI-manifeste.txt",
        data: clientSendManifest(rows, audioResult, pending.id),
      });
      fileName =
        mode === "BOTH" ? `${stem}-Excel-et-audios.zip` : `${stem}-audios.zip`;
      downloadBlob(makeZipBlob(entries), fileName);
    }
    pending.recordIds = rows.map((r) => r.id);
    pending.downloadedAt = currentTime();
    pending.exportMode = mode;
    pending.fileName = fileName;
    pending.audioCount = audioResult.files.length;
    pending.missingAudioCount = audioResult.missing.length;
    rows.forEach((r) =>
      addEvent(
        r.id,
        "Export de l’envoi préparé",
        `${pending.id} · ${mode} · ${fileName}`,
        "Sarah Ben Salem",
        "Qualiticienne",
      ),
    );
    saveState();
    render();
    if (mode !== "EXCEL" && audioResult.missing.length)
      toast(
        `${fileName} téléchargé; ${audioResult.missing.length} audio(s) non accessibles sont signalés dans le manifeste.`,
        "warning",
      );
    else
      toast(
        `${fileName} téléchargé. Déposez-le sur le FTP puis confirmez le dépôt.`,
        "success",
      );
  } catch (error) {
    console.error("Échec de préparation de l’envoi", error);
    toast(
      "Impossible de préparer le téléchargement. Vérifiez l’accès aux audios et réessayez.",
      "error",
    );
  }
}
function clientSendManifest(rows, result, sendId) {
  const lines = [
    `Référence interne de suivi : ${sendId}`,
    `Préparé le : ${currentTime()}`,
    "",
    "Audios inclus :",
  ];
  if (result.files.length)
    result.files.forEach((f) =>
      lines.push(
        `- Indice ${recordIndexValue(getRecord(f.record))} : ${f.name}`,
      ),
    );
  else lines.push("- Aucun fichier audio accessible");
  lines.push("", "Audios manquants :");
  if (result.missing.length)
    result.missing.forEach((f) => {
      const r = getRecord(f.record);
      lines.push(
        `- Indice ${recordIndexValue(r)} (${r?.baseName || "base non renseignée"}) : ${f.filename} — ${f.reason}`,
      );
    });
  else lines.push("- Aucun");
  lines.push(
    "",
    "Fiches sélectionnées :",
    ...rows.map(
      (r) =>
        `- ${recordIndexValue(r)} | ${r.baseName || ""} | ${r.audio?.drive_file_name || ""}`,
    ),
  );
  return lines.join("\r\n");
}
function openClientSendFtpModal() {
  const pending = app.pendingClientSend;
  if (!pending?.downloadedAt) {
    toast("Préparez et téléchargez d’abord l’export.", "warning");
    return;
  }
  const body = `<input type="hidden" name="sendId" value="${esc(pending.id)}"/><div class="notice-inline">${ic("info")}<span>Le CRM ne se connecte pas au FTP. Confirmez seulement après le dépôt manuel du fichier <strong>${esc(pending.fileName)}</strong>.</span></div><div class="form-grid" style="margin-top:13px">${field("ftpDestination", "Dossier / chemin FTP utilisé", { placeholder: "Ex. /retours/qualicontact/2026-09", span: true })}</div><label class="ftp-confirm-check"><input type="checkbox" name="ftpConfirmed" value="YES" required/><span>Je confirme que l’export sélectionné a été déposé sur le FTP externe.</span></label>`;
  showModal({
    title: "Confirmer le dépôt FTP",
    description: `Le dépôt manuel sera enregistré sur les ${pending.recordIds.length} fiche(s) concernée(s).`,
    body,
    form: "confirmClientSendFtp",
    submitText: "Confirmer le dépôt FTP",
    wide: true,
    note: `Téléchargé le ${formatDate(pending.downloadedAt, { time: true })}`,
  });
}
function confirmClientSendFtp(form) {
  const fd = new FormData(form);
  const pending = app.pendingClientSend;
  if (fd.get("ftpConfirmed") !== "YES") {
    toast("Confirmez le dépôt FTP avant de continuer.", "warning");
    return;
  }
  if (!pending || pending.id !== fd.get("sendId") || !pending.downloadedAt) {
    toast(
      "Aucun export prêt à confirmer. Recommencez la sélection et le téléchargement.",
      "warning",
    );
    closeModal();
    return;
  }
  const now = currentTime();
  const destination = (fd.get("ftpDestination") || "").trim();
  const sent = [];
  const skipped = [];
  pending.recordIds.forEach((id) => {
    const r = getRecord(id);
    if (
      !r ||
      !clientSendAllowed(r) ||
      evaluationFingerprint(r) !== pending.evaluationSnapshots?.[id]
    ) {
      if (r) skipped.push(recordIndexValue(r));
      return;
    }
    r.clientSendHistory = Array.isArray(r.clientSendHistory)
      ? r.clientSendHistory
      : [];
    const latestEvaluation = latestInternalEvaluation(r);
    const send = {
      id: `${pending.id}-${id}`,
      sentAt: now,
      exportMode: pending.exportMode,
      fileName: pending.fileName,
      ftpDestination: destination,
      sentBy: "Sarah Ben Salem",
      evaluationStage: latestEvaluation?.stage || "NONE",
      evaluationVersion: Number(latestEvaluation?.evaluation.version) || 0,
      deliveryMethod: "FTP_MANUAL",
    };
    r.clientSendHistory.push(send);
    r.sentToClientAt = now;
    if (!getClientReturns(r).length) r.status = "envoyee_client";
    addEvent(
      id,
      "Fiche envoyée au client",
      `${send.id} · ${pending.exportMode} · ${pending.fileName}${destination ? ` · ${destination}` : ""}`,
      "Sarah Ben Salem",
      "Qualiticienne",
    );
    sent.push(r);
  });
  saveState();
  closeModal();
  app.pendingClientSend = null;
  app.selectedToSend.clear();
  app.page = "send";
  render();
  if (skipped.length)
    toast(
      `${sent.length} fiche(s) envoyée(s). ${skipped.length} fiche(s) ignorée(s), car l’évaluation a changé entre-temps.`,
      "warning",
    );
  else
    toast(
      `Dépôt FTP confirmé manuellement. ${sent.length} fiche(s) et leurs versions Synergy #1 sont tracées.`,
      "success",
    );
}

function renderTasks() {
  const showArchivedTasks = app.taskFilter === "archived" && canManageTasks();
  const activeTasksList = state.tasks.filter((t) => !t.archived);
  let rows = state.tasks
    .filter((t) => (showArchivedTasks ? t.archived : !t.archived))
    .sort(
      (a, b) =>
        (a.status === "TERMINE" ? 1 : 0) - (b.status === "TERMINE" ? 1 : 0) ||
        (a.dueDate || "").localeCompare(b.dueDate || ""),
    );
  if (app.taskFilter === "open")
    rows = rows.filter((t) => t.status !== "TERMINE");
  if (app.taskFilter === "late") rows = rows.filter((t) => taskIsLate(t));
  if (app.taskFilter === "done")
    rows = rows.filter((t) => t.status === "TERMINE");
  const open = activeTasksList.filter((t) => t.status !== "TERMINE").length;
  const late = activeTasksList.filter(taskIsLate).length;
  return `${pageHeading("Tâches", "Planifiez et priorisez les évaluations, retours clients, réécoutes et débriefs.", '<button class="btn btn-primary" data-action="new-task">' + ic("plus") + " Nouvelle tâche</button>")}
    <div class="kpi-grid">${kpiCard("Tâches ouvertes", String(open), "check-square", "blue", "", "toutes priorités")}${kpiCard("En retard", String(late), "alert", "amber", "", "échéance dépassée")}${kpiCard("Terminées", "", "circle-check", "green", "", "cette semaine")}${kpiCard("Assignées à moi", "", "user", "purple", "", "")}</div>
    <section class="panel table-panel"><div class="panel-header"><div><h2 class="panel-title">Liste des tâches</h2><p class="panel-subtitle">La réception d’un retour client génère automatiquement une tâche de réévaluation.</p></div><select class="filter-select" id="taskFilter"><option value="all" ${app.taskFilter === "all" ? "selected" : ""}>Toutes les tâches</option><option value="open" ${app.taskFilter === "open" ? "selected" : ""}>À faire / en cours</option><option value="late" ${app.taskFilter === "late" ? "selected" : ""}>En retard</option><option value="done" ${app.taskFilter === "done" ? "selected" : ""}>Terminées</option>${canManageTasks() ? `<option value="archived" ${app.taskFilter === "archived" ? "selected" : ""}>Tâches supprimées</option>` : ""}</select></div>
    <div>${rows.map((t) => taskRow(t)).join("") || '<div class="empty-state"><div class="empty-icon">' + ic("check-square") + "</div><strong>Aucune tâche</strong><p>Les tâches à traiter apparaîtront ici.</p></div>"}</div><div class="table-footer"><span>${rows.length} tâche(s) affichée(s)</span><span>Filtres · échéance · assignation · statut</span></div></section>`;
}
function taskRow(t) {
  const done = t.status === "TERMINE";
  const record = getRecord(t.recordId);
  const targetTab = taskRecordTab(t);
  return `<div class="task-row"><button class="task-check ${done ? "done" : ""}" data-action="toggle-task" data-task-id="${esc(t.id)}" aria-label="${done ? "Réouvrir" : "Terminer"} la tâche">${done ? ic("circle-check") : ""}</button><div class="task-copy" data-open-record="${esc(t.recordId)}" data-record-tab="${taskRecordTab(t)}"><strong>${esc(taskDisplayTitle(t.title))}</strong><span>${esc(t.type.replaceAll("_", " "))} · ${t.recordId ? `Indice ${esc(recordIndexValue(record))}` : "Sans fiche"} · Assignée à ${esc(t.assignedTo)}</span></div><div class="task-meta"><span class="task-priority ${t.priority === "URGENTE" ? "urgent" : ""}">${esc(t.priority)}</span><span class="task-due ${taskIsLate(t) ? "late" : ""}">${done ? "Terminée" : taskIsLate(t) ? "En retard · " : ""}${formatDate(done ? t.completedAt || t.dueDate : t.dueDate)}</span>${canManageTasks() ? (t.archived ? `<button class="btn btn-secondary btn-small" type="button" data-action="restore-task" data-task-id="${esc(t.id)}">Restaurer</button>` : `<button class="icon-button record-action-button" type="button" data-action="edit-task" data-task-id="${esc(t.id)}" title="Modifier la tâche" aria-label="Modifier la tâche">${ic("edit")}</button><button class="icon-button record-action-button record-action-delete" type="button" data-action="archive-task" data-task-id="${esc(t.id)}" title="Supprimer la tâche" aria-label="Supprimer la tâche">${ic("trash")}</button>`) : ""}<button class="icon-button" data-action="open-task-record" data-task-id="${esc(t.id)}" data-record-id="${esc(t.recordId)}" data-record-tab="${targetTab}" aria-label="Ouvrir la fiche">${ic("chevron-right")}</button></div></div>`;
}
function debriefTableRow(d) {
  const rows = (d.recordIds || []).map(getRecord).filter(Boolean);
  const scored = rows
    .filter(
      (record) =>
        isSynergy1Evaluated(record) && hasNumericScore(record.internal1?.score),
    )
    .map((record) => Number(record.internal1.score))
    .filter(Number.isFinite);
  return {
    d,
    agent: d.agent || "",
    dossier: rows
      .map((record) => recordIndexValue(record, ""))
      .filter(Boolean)
      .join(", "),
    // Titres des actions (crm_debrief_actions) rattachées à ce débrief.
    actions: (d.actions || []).map((a) => a.title).filter(Boolean),
    note: debriefRatingStats(d).average,
    score: scored.length
      ? Math.round(scored.reduce((sum, value) => sum + value, 0) / scored.length)
      : null,
  };
}
function renderDebriefTable() {
  const showArchived = app.debriefView === "archived" && canManageDebriefs();
  const filters = app.debriefFilters;
  const norm = (value) =>
    String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const rows = state.debriefs
    .filter((d) => (showArchived ? d.archived : !d.archived))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .map(debriefTableRow)
    .filter(
      (row) =>
        norm(row.agent).includes(norm(filters.agent)) &&
        norm(row.dossier).includes(norm(filters.dossier)) &&
        (!filters.action || row.actions.includes(filters.action)) &&
        norm(row.note == null ? "" : row.note.toFixed(1)).includes(
          norm(filters.note),
        ) &&
        norm(row.score == null ? "" : row.score).includes(norm(filters.score)),
    );
  const pageSize = app.debriefPageSize;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  app.debriefPage = Math.min(Math.max(1, app.debriefPage), pages);
  const start = (app.debriefPage - 1) * pageSize;
  const visible = rows.slice(start, start + pageSize);
  const body = visible.length
    ? visible
        .map(
          (row) =>
            `<tr class="debrief-row" tabindex="0" data-debrief-open="${esc(row.d.id)}" style="cursor:pointer" title="Ouvrir le débrief ${esc(row.d.id)}"><td><span class="agent-cell">${avatar(row.agent)}<span class="agent-cell-copy"><strong>${esc(row.agent)}</strong><small>${esc(row.d.id)}</small></span></span></td><td>${esc(row.dossier || "—")}</td><td>${row.actions.length ? row.actions.map((title) => `<div>${esc(title)}</div>`).join("") : "—"}</td><td>${row.note == null ? "—" : `${row.note.toFixed(1)} / 5`}</td><td>${row.score == null ? "—" : `${row.score} %`}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="5" class="muted" style="text-align:center;padding:22px">Aucun débrief ne correspond aux filtres.</td></tr>';
  const pageButtons = Array.from({ length: pages }, (_, i) => i + 1)
    .filter((n) => n === 1 || n === pages || Math.abs(n - app.debriefPage) <= 1)
    .map(
      (n, i, list) =>
        `${i && n - list[i - 1] > 1 ? "<span>…</span>" : ""}<button class="page-num${n === app.debriefPage ? " active" : ""}" data-debrief-page="${n}">${n}</button>`,
    )
    .join("");
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Agent</th><th>N° dossier</th><th>Action</th><th>Note</th><th>Score</th></tr></thead><tbody>${body}</tbody></table></div><div class="table-footer"><span>${rows.length} débrief(s) · page ${app.debriefPage} / ${pages}</span><div class="pagination"><select class="filter-select" data-debrief-page-size>${[10, 25, 50].map((n) => `<option value="${n}" ${n === pageSize ? "selected" : ""}>${n} / page</option>`).join("")}</select><button data-debrief-page="${app.debriefPage - 1}" ${app.debriefPage <= 1 ? "disabled" : ""}>${ic("chevron-left")}</button>${pageButtons}<button data-debrief-page="${app.debriefPage + 1}" ${app.debriefPage >= pages ? "disabled" : ""}>${ic("chevron-right")}</button></div></div>`;
}
function renderDebriefs() {
  const showArchivedDebriefs =
    app.debriefView === "archived" && canManageDebriefs();
  const open = app.openDebriefId
    ? state.debriefs.find((d) => d.id === app.openDebriefId)
    : null;
  if (open)
    return `${pageHeading(`<button class="back-link" data-action="debrief-back">${ic("chevron-left")} Débriefs</button><br>Débrief ${esc(open.id)}`, `${esc(open.agent)} · ${formatDate(open.date)}`, "")}<div class="stack">${renderDebriefCard(open)}</div>`;
  const metrics = debriefDashboardStats();
  const filters = app.debriefFilters;
  // Titres distincts fournis par une requête SQL dédiée (GET /quality/api/debriefs/action-titles).
  const actionTitles =
    app.debriefActionTitles[showArchivedDebriefs ? "archived" : "active"];
  const actionFilterSelect = `<select class="filter-select" data-debrief-filter="action" aria-label="Filtrer par action"><option value="">Toutes les actions</option>${actionTitles.map((title) => `<option value="${esc(title)}" ${filters.action === title ? "selected" : ""}>${esc(title)}</option>`).join("")}</select>`;
  const filterInput = (key, label) =>
    `<input class="filter-select" type="search" data-debrief-filter="${key}" placeholder="${label}" aria-label="Filtrer par ${label}" value="${esc(filters[key])}"/>`;
  return `${pageHeading("Débriefs agents", "Évaluez les compétences de l’appel de 1 à 5 étoiles et définissez un suivi concret pour chaque agent.", '<button class="btn btn-primary" data-action="new-debrief">' + ic("plus") + " Nouveau débrief</button>")}
    <div class="kpi-grid">${kpiCard("Formulaires remplis", String(metrics.completedCount), "file-text", "blue", "", `${metrics.sessionCount} session(s) au total`)}${kpiCard("Moyenne des notes", metrics.average == null ? "—" : `${metrics.average.toFixed(1)} / 5`, "target", "purple", "", `${metrics.completedCount} formulaire(s) complet(s)`)}${kpiCard("Agents évalués", String(metrics.agentCount), "users", "green", "", `uniques · ${metrics.completedCount} formulaire(s) rempli(s)`)}${kpiCard("Actions de suivi", String(metrics.openActionCount), "check-square", metrics.overdueActionCount ? "amber" : "blue", "", `${metrics.overdueActionCount} en retard · ${metrics.actionCount} au total`)}</div>
    <section class="panel table-panel"><div class="panel-header"><div><h2 class="panel-title">Débriefs</h2><p class="panel-subtitle">Cliquez sur une ligne pour ouvrir le débrief.</p></div><div class="table-header-actions" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${filterInput("agent", "Agent")}${filterInput("dossier", "N° dossier")}${actionFilterSelect}${filterInput("note", "Note")}${filterInput("score", "Score")}${canManageDebriefs() ? `<select class="filter-select" data-filter="debriefView"><option value="active" ${!showArchivedDebriefs ? "selected" : ""}>Débriefs actifs</option><option value="archived" ${showArchivedDebriefs ? "selected" : ""}>Débriefs supprimés</option></select>` : ""}</div></div><div id="debriefTable">${renderDebriefTable()}</div></section>`;
}
const DEBRIEF_RUBRIC = [
  {
    key: "accroche",
    title: "Accroche & autorisation",
    hint: "Voix chaleureuse et assurée; présente clairement l’objet de l’appel, vérifie que la personne peut parler et respecte son choix.",
  },
  {
    key: "remerciement",
    title: "Remerciement après l’accord",
    hint: "Remercie naturellement le prospect après son accord, avec une formule sincère et professionnelle.",
  },
  {
    key: "script",
    title: "Maîtrise & narration du script",
    hint: "Connaît les points clés et déroule le message avec fluidité, conviction et un ton vivant plutôt qu’une récitation.",
  },
  {
    key: "decouverte",
    title: "Découverte, écoute & discernement",
    hint: "Pose la question découverte, écoute les associations ou modes de soutien cités et adapte la suite sans en faire un test de mémoire; ne déduit pas les capacités de l’âge ou de la voix et suspend la sollicitation si le prospect indique qu’un tiers gère ses affaires.",
  },
  {
    key: "appelDon",
    title: "Présentation de l’appel au don",
    hint: "Formule la demande clairement et avec assurance, sans culpabiliser ni exercer de pression.",
  },
  {
    key: "objections",
    title: "Réponse aux objections",
    hint: "Accueille l’objection, propose au besoin une alternative pertinente, puis respecte immédiatement la décision du prospect.",
  },
  {
    key: "confirmation",
    title: "Confirmation & coordonnées",
    hint: "En cas d’accord, récapitule le montant, le mode de don et les coordonnées; propose Internet uniquement avec l’accord du prospect, sinon reste au courrier et obtient un consentement explicite avant tout traitement.",
  },
  {
    key: "cloture",
    title: "Clôture professionnelle",
    hint: "Confirme la décision, remercie et prend congé avec courtoisie, sans ambiguïté ni insistance.",
  },
];
function debriefRatingStats(d) {
  const values = DEBRIEF_RUBRIC.map((item) =>
    Number(d?.ratings?.[item.key]),
  ).filter((value) => Number.isInteger(value) && value >= 1 && value <= 5);
  return {
    count: values.length,
    average: values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null,
  };
}
function debriefDashboardStats() {
  const sessions = (state.debriefs || []).filter(
    (debrief) => !debrief.archived,
  );
  const completed = sessions.filter(
    (d) => debriefRatingStats(d).count === DEBRIEF_RUBRIC.length,
  );
  const sessionAverages = completed.map((d) => debriefRatingStats(d).average);
  const actions = sessions.flatMap((d) =>
    Array.isArray(d.actions) ? d.actions : [],
  );
  const openActions = actions.filter((action) => action.status !== "TERMINE");
  const overdueActions = openActions.filter(
    (action) =>
      action.status === "EN_RETARD" ||
      !!(action.dueDate && action.dueDate < TODAY),
  );
  const uniqueAgents = [];
  completed.forEach((debrief) => {
    if (
      (debrief.employeeCode || debrief.agent) &&
      !uniqueAgents.some((existing) =>
        sameAgentIdentity(
          existing.employeeCode,
          existing.agent,
          debrief.employeeCode,
          debrief.agent,
        ),
      )
    )
      uniqueAgents.push(debrief);
  });
  return {
    sessionCount: sessions.length,
    completedCount: completed.length,
    average: sessionAverages.length
      ? sessionAverages.reduce((sum, value) => sum + value, 0) /
        sessionAverages.length
      : null,
    agentCount: uniqueAgents.length,
    actionCount: actions.length,
    openActionCount: openActions.length,
    overdueActionCount: overdueActions.length,
  };
}
function renderDebriefStars(score) {
  const filled = score == null ? 0 : Math.round(score);
  return `<span class="debrief-stars-display" aria-label="${score == null ? "Non noté" : `${score.toFixed(1)} sur 5 étoiles`}">${[1, 2, 3, 4, 5].map((value) => `<span class="${value <= filled ? "filled" : ""}" aria-hidden="true">★</span>`).join("")}</span>`;
}
function debriefAudioList(d) {
  return d?.audios?.length ? d.audios : d?.audio ? [d.audio] : [];
}
function renderDebriefAudio(d) {
  const list = debriefAudioList(d);
  return list
    .map((audio, index) => renderOneDebriefAudio(audio, index, list.length))
    .join("");
}
function renderOneDebriefAudio(audio, index = 0, total = 1) {
  if (!audio) return "";
  const fileSize =
    Number(audio.fileSize) > 0
      ? `${(Number(audio.fileSize) / 1024).toFixed(1)} Ko`
      : "Taille inconnue";
  const source =
    audio.localUrl ||
    (backend.enabled && backend.authenticated && audio.objectId
      ? `/quality/api/audio/${encodeURIComponent(audio.objectId)}`
      : "");
  const player = source
    ? `<audio class="debrief-audio-player" controls preload="metadata" src="${esc(source)}">Votre navigateur ne peut pas lire cet audio.</audio>`
    : `<div class="debrief-audio-unavailable">Audio non archivé dans S3 Bucket local.</div>`;
  return `<section class="debrief-audio-card"><div class="debrief-audio-head"><span class="debrief-audio-icon">${ic("headphones")}</span><span class="debrief-audio-copy"><strong>${total > 1 ? `Audio ${index + 1}/${total} · ` : ""}${esc(audio.fileName || "Audio du débrief")}</strong><small>${esc(fileSize)} · ${audio.sourceRecordId ? "audio de la fiche d’appel" : "enregistrement de la session"}</small></span><span class="label-chip ${audio.objectId ? "green" : "amber"}">${audio.objectId ? "S3 Bucket local" : "Démo locale"}</span></div>${player}<div class="debrief-audio-folder"><span>${audio.sourceRecordId ? "Fiche source" : audio.objectId ? "Préfixe de stockage" : "Dossier de démonstration"}</span><strong>${esc(audio.sourceRecordId ? `${audio.sourceRecordId} · ${audio.objectId || "démo"}` : audio.objectId ? `debrief/${audio.objectId}` : audio.driveFolderName || "—")}</strong></div><p>${audio.objectId ? "Le binaire est stocké dans S3 Bucket; les métadonnées restent dans DB." : "Fichier disponible uniquement dans la session de démonstration."}</p></section>`;
}
function renderDebriefCard(d) {
  const rows = (d.recordIds || []).map(getRecord).filter(Boolean);
  const scored = rows
    .filter(
      (record) =>
        isSynergy1Evaluated(record) && hasNumericScore(record.internal1?.score),
    )
    .map((record) => Number(record.internal1.score))
    .filter(Number.isFinite);
  const averageScore = scored.length
    ? Math.round(scored.reduce((sum, value) => sum + value, 0) / scored.length)
    : null;
  const rating = debriefRatingStats(d);
  const returns = rows.flatMap(getClientReturns);
  const rowsWithReturn = rows.filter(
    (record) => getClientReturns(record).length > 0,
  );
  const needsReview = rows.filter(returnNeedsSynergyReview).length;
  const decisions = rows.filter((record) =>
    ["CONFORME", "NON_CONFORME"].includes(synergy1Decision(record)),
  );
  const conformityCount = decisions.filter(
    (record) => synergy1Decision(record) === "CONFORME",
  ).length;
  return `<article class="debrief-card"><div class="debrief-top"><div class="debrief-agent">${avatar(d.agent)}<div><strong>${esc(d.agent)}</strong><small>${esc(d.employeeCode || "Matricule non renseigné")} · ${esc(d.owner || "Responsable non renseigné")}</small></div></div><span class="debrief-date">${formatDate(d.date)}</span>${d.archived ? `<span class="badge badge-red">Supprimé</span>` : ""}${canManageDebriefs() ? `<span style="display:inline-flex;gap:2px">${d.archived ? `<button class="btn btn-secondary btn-small" type="button" data-action="restore-debrief" data-debrief-id="${esc(d.id)}">Restaurer</button>` : `<button class="btn btn-secondary btn-small" type="button" data-action="link-record-modal" data-debrief-id="${esc(d.id)}">${ic("plus")} Lier une fiche</button><button class="icon-button record-action-button" type="button" data-action="edit-debrief" data-debrief-id="${esc(d.id)}" title="Modifier le débrief" aria-label="Modifier le débrief ${esc(d.id)}">${ic("edit")}</button><button class="icon-button record-action-button record-action-delete" type="button" data-action="archive-debrief" data-debrief-id="${esc(d.id)}" title="Supprimer le débrief" aria-label="Supprimer le débrief ${esc(d.id)}">${ic("trash")}</button>`}</span>` : ""}</div><div class="debrief-records">${rows.map((record) => `<span data-open-record="${esc(record.id)}" style="cursor:pointer" title="Indice de la fiche">${esc(recordIndexValue(record))}</span>`).join("") || "<span>Aucune fiche liée</span>"}<span style="background:#f5f6f8;color:#7f8998">${rows.length} appel(s)</span></div><div class="debrief-rating-summary"><span><strong>Note du débrief</strong><small>${rating.count ? `${rating.count}/${DEBRIEF_RUBRIC.length} critères notés` : "Aucune note saisie"}</small></span>${renderDebriefStars(rating.average)}<b>${rating.average == null ? "—" : `${rating.average.toFixed(1)} / 5`}</b></div><div class="metric-list" style="margin-top:0"><div class="metric-line"><span>Score Synergy #1 moyen · fiches liées</span><strong>${averageScore == null ? "À compléter" : `${averageScore} %`}</strong></div><div class="metric-line"><span>Décisions Synergy conformes</span><strong>${conformityCount} / ${decisions.length}</strong></div><div class="metric-line"><span>Retours client liés</span><strong>${returns.length} · ${rowsWithReturn.length} fiche(s)</strong></div><div class="metric-line"><span>Fiches à réévaluer après retour</span><strong>${needsReview}</strong></div></div>${renderDebriefAudio(d)}<div class="debrief-action-preview"><strong>À retenir :</strong> ${esc(d.note || "Session de suivi qualité.")} ${(d.actions || []).length ? `<br><strong>Prochaine action :</strong> ${esc(d.actions[0].title)} · ${formatDate(d.actions[0].dueDate)}` : ""}</div></article>`;
}
// Cartes classées par score moyen décroissant (meilleur score d'abord) ; sans score en dernier ; à égalité, ordre alphabétique.
function agentsByScore() {
  const score = (agent) => app.agentScores[agent.id]?.average;
  return [...state.agents].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    if (sa == null && sb == null) return String(a.name).localeCompare(String(b.name), "fr");
    if (sa == null) return 1;
    if (sb == null) return -1;
    return sb - sa || String(a.name).localeCompare(String(b.name), "fr");
  });
}
function renderAgents() {
  return `${pageHeading("Agents & progression", "Consultez le profil qualité, l’évolution des scores et le suivi de coaching de chaque agent.", '<button class="btn btn-secondary" data-action="export">' + ic("download") + " Exporter</button>")}<div class="filters-row" style="padding:0 0 13px"><label class="filter-search">${ic("search")}<input id="agentSearch" type="search" placeholder="Rechercher un agent ou un matricule…"></label><select class="filter-select"><option>Toutes les campagnes</option><option>Dons particuliers</option><option>Fidélisation</option></select><span class="filter-count">${state.agents.length} agents dans le jeu de démonstration</span></div><div class="agent-grid" id="agentGrid">${agentsByScore().map((a) => agentCard(a)).join("")}</div>`;
}
function agentCard(a) {
  const rows = recordsForAgent(a);
  const evaluated = rows.filter(isSynergy1Evaluated);
  // Moyenne des scores Synergy #1 de l'agent, calculée en SQL par le serveur (GET /quality/api/agents/scores).
  const score = app.agentScores[a.id]?.average ?? null;
  const returns = rows.reduce(
    (sum, record) => sum + getClientReturns(record).length,
    0,
  );
  const debriefs = debriefsForAgent(a).length;
  return `<article class="agent-card" data-agent-profile="${esc(a.id)}"><div class="agent-card-top"><span class="agent-avatar">${esc(a.initials || initials(a.name))}</span><div class="agent-card-info"><strong>${esc(a.name)}</strong><small>${esc(a.id)} · ${esc(a.team)}</small></div><span class="agent-score">${score == null ? "—" : `${score}%`}</span></div><div class="agent-card-stats"><div><strong>${evaluated.length}</strong><span>Fiches évaluées</span></div><div><strong>${returns}</strong><span>Retours client</span></div><div><strong>${debriefs}</strong><span>Débriefs</span></div></div><div class="agent-card-bottom"><span>Suivi lié par agent</span><b>Voir le profil ${ic("arrow-right")}</b></div></article>`;
}
function renderAgentProfile() {
  const a = getAgent(app.agentId) || state.agents[0];
  if (!a)
    return `${pageHeading("Profil qualité", "Aucun agent à afficher.", "", "SUIVI DE PROGRESSION")}`;
  const rows = recordsForAgent(a);
  const evaluated = rows.filter(isSynergy1Evaluated);
  const scored = evaluated
    .filter((record) => hasNumericScore(record.internal1?.score))
    .map((record) => Number(record.internal1.score))
    .filter(Number.isFinite);
  const averageScore = scored.length
    ? scored.reduce((sum, value) => sum + value, 0) / scored.length
    : null;
  const decisions = evaluated
    .map(synergy1Decision)
    .filter((value) => ["CONFORME", "NON_CONFORME"].includes(value));
  const conformityRate = decisions.length
    ? (decisions.filter((value) => value === "CONFORME").length /
        decisions.length) *
      100
    : null;
  const returns = rows.flatMap(getClientReturns);
  const recordsWithReturn = rows.filter(
    (record) => getClientReturns(record).length > 0,
  ).length;
  const reviewRecords = rows.filter(returnNeedsSynergyReview).length;
  const debriefs = debriefsForAgent(a).sort((left, right) =>
    String(right.date || "").localeCompare(String(left.date || "")),
  );
  const completeDebriefs = debriefs.filter(
    (debrief) => debriefRatingStats(debrief).count === DEBRIEF_RUBRIC.length,
  );
  const debriefAverages = completeDebriefs
    .map((debrief) => debriefRatingStats(debrief).average)
    .filter(Number.isFinite);
  const debriefAverage = debriefAverages.length
    ? debriefAverages.reduce((sum, value) => sum + value, 0) /
      debriefAverages.length
    : null;
  const linkedIds = new Set(
    debriefs.flatMap((debrief) => debrief.recordIds || []),
  );
  const linkedRows = [...linkedIds].map(getRecord).filter(Boolean);
  const linkedReturnCount = linkedRows.flatMap(getClientReturns).length;
  const linkedEvaluatedCount = linkedRows.filter(isSynergy1Evaluated).length;
  const openActions = debriefs
    .flatMap((debrief) => debrief.actions || [])
    .filter((action) => action.status !== "TERMINE");
  const scoreLabel =
    averageScore == null ? "—" : `${averageScore.toFixed(1)} %`;
  const debriefLabel =
    debriefAverage == null ? "—" : `${debriefAverage.toFixed(1)} / 5`;
  return `${pageHeading(`<button class="back-link" data-page="agents">${ic("chevron-left")} Agents</button><br>Profil qualité`, `${esc(a.name)} · ${esc(a.id)} · ${esc(a.team)}`, `<button class="btn btn-primary" data-action="new-debrief" data-agent-id="${esc(a.id)}">${ic("plus")} Planifier un débrief</button>`, "SUIVI DE PROGRESSION")}<div class="profile-head"><span class="profile-avatar">${esc(a.initials || initials(a.name))}</span><div class="profile-title"><h2>${esc(a.name)}</h2><p>${esc(a.id)} · ${esc(a.team)} · Agent depuis le ${formatDate(a.since)}</p><div class="profile-tags"><span class="label-chip green">Suivi actif</span><span class="label-chip">${rows.length} fiches liées</span></div></div><div class="profile-kpi" style="border:0;background:transparent;text-align:right"><span>Score Synergy #1 moyen</span><strong>${scoreLabel}</strong></div></div>
    <div class="profile-kpi-grid"><div class="profile-kpi"><span>Fiches évaluées</span><strong>${evaluated.length} / ${rows.length}</strong><small>Synergy #1 terminée</small></div><div class="profile-kpi"><span>Conformité Synergy #1</span><strong>${conformityRate == null ? "—" : `${conformityRate.toFixed(1)} %`}</strong><small>${decisions.length} décision(s) renseignée(s)</small></div><div class="profile-kpi"><span>Retours client</span><strong>${returns.length}</strong><small>${recordsWithReturn} fiche(s) · ${reviewRecords} à réévaluer</small></div><div class="profile-kpi"><span>Débriefs complets</span><strong>${completeDebriefs.length} / ${debriefs.length}</strong><small>Note moyenne ${debriefLabel}</small></div></div>
    <div class="dashboard-grid"><section class="panel"><div class="panel-header"><div><h2 class="panel-title">Évaluations & retours associés</h2><p class="panel-subtitle">Indicateurs calculés sur les fiches de cet agent</p></div></div><div class="panel-body"><div class="dashboard-progress-list">${dashboardProgressRow("Fiches évaluées Synergy #1", evaluated.length, rows.length, "blue")}${dashboardProgressRow("Décisions conformes", decisions.filter((value) => value === "CONFORME").length, decisions.length, "mint")}${dashboardProgressRow("Décisions non conformes", decisions.filter((value) => value === "NON_CONFORME").length, decisions.length, "red")}${dashboardProgressRow("Fiches avec retour client", recordsWithReturn, rows.length, "purple")}</div><div class="dashboard-insight-foot"><strong>${returns.length}</strong> retour(s) client au total · <strong>${reviewRecords}</strong> fiche(s) dont le retour exige une réévaluation.</div></div></section><section class="panel"><div class="panel-header"><div><h2 class="panel-title">Débriefs liés aux fiches</h2><p class="panel-subtitle">${linkedRows.length} fiche(s) associée(s) · ${linkedEvaluatedCount} évaluée(s) · ${linkedReturnCount} retour(s) client</p></div></div><div class="panel-body"><div class="dashboard-stat-grid">${dashboardStatTile("Sessions", String(debriefs.length), `${completeDebriefs.length} complètes`, "purple")}${dashboardStatTile("Note moyenne", debriefLabel, "sessions complètes", "green")}${dashboardStatTile("Fiches liées", String(linkedRows.length), `${linkedEvaluatedCount} Synergy #1 terminée(s)`, "blue")}${dashboardStatTile("Actions ouvertes", String(openActions.length), `${openActions.filter((action) => action.status === "EN_RETARD" || !!(action.dueDate && action.dueDate < TODAY)).length} en retard`, "amber")}</div></div></section></div>
    <section class="panel table-panel" style="margin-top:15px"><div class="panel-header"><div><h2 class="panel-title">Appels analysés</h2><p class="panel-subtitle">Historique des fiches évaluées, des retours reçus et des liens de débrief</p></div></div><div class="table-wrap">${renderRecordsTable(rows)}</div></section><div class="stack" style="margin-top:15px">${debriefs.map((debrief) => renderDebriefCard(debrief)).join("")}</div>`;
}
function renderPortal() {
  const portalClientIds =
    backend.enabled && backend.authenticated && backend.clientIds.length
      ? new Set(backend.clientIds.map(String))
      : null;
  const clientRecords = state.records
    .filter(
      (r) =>
        !r.archived &&
        (!backend.enabled
          ? r.clientId === "client-qc"
          : !portalClientIds ||
            portalClientIds.has(String(r.clientId || ""))) &&
        hasBeenSentToClient(r),
    )
    .sort((a, b) =>
      String(latestClientSend(b)?.sentAt || "").localeCompare(
        String(latestClientSend(a)?.sentAt || ""),
      ),
    );
  const waiting = clientRecords.filter((r) => {
    const send = latestClientSend(r);
    const ret = latestClientReturn(r);
    return (
      !ret ||
      String(ret.receivedAt || ret.date || "") < String(send?.sentAt || "")
    );
  }).length;
  const returnCount = clientRecords.reduce(
    (n, r) => n + getClientReturns(r).length,
    0,
  );
  return `${pageHeading("Espace client", "Fiches transmises, audio et retours successifs rattachés à chaque fiche.", '<button class="btn btn-secondary" data-action="client-role-info">' + ic("shield") + " Vue client</button>")}
  <div class="portal-banner">${ic("shield")}<div><strong>Vue client · Qualicontact</strong><p>Chaque fiche transmise reste liée à son historique; le serveur DB filtre les données selon le client affecté au profil.</p></div><span class="portal-brand">QUALICONTACT</span></div>
  <div class="portal-card-grid"><div class="portal-kpi"><span>Fiches reçues</span><strong>${clientRecords.length}</strong></div><div class="portal-kpi"><span>Fiches en attente de retour</span><strong>${waiting}</strong></div><div class="portal-kpi"><span>Retours enregistrés</span><strong>${returnCount}</strong></div></div>
  <section class="panel" style="padding:15px 16px;margin-bottom:14px"><div class="panel-header" style="padding:0 0 12px"><div><h2 class="panel-title">Fiches transmises</h2><p class="panel-subtitle">Ouvrez une fiche pour retrouver son enregistrement et son historique, puis ajouter un retour sans créer une session séparée.</p></div><span class="portal-brand">ACCÈS CLIENT</span></div>${clientRecords.map((r) => portalRecordRow(r)).join("") || '<div class="empty-state"><div class="empty-icon">' + ic("circle-check") + "</div><strong>Aucune fiche transmise</strong><p>Les fiches confirmées sur le FTP apparaîtront ici.</p></div>"}</section>
  <div class="notice-inline">${ic("info")}<span>Le lecteur audio et l’envoi de formulaires sont simulés ici. En production, l’accès audio passera par un endpoint sécurisé; aucun lien Drive public ne sera exposé.</span></div>`;
}
function renderPortalRecord(r) {
  if (
    (backend.enabled && backend.authenticated
      ? backend.clientIds.length &&
        !backend.clientIds.includes(String(r.clientId || ""))
      : r.clientId !== "client-qc") ||
    !hasBeenSentToClient(r)
  ) {
    app.page = "portal";
    return renderPortal();
  }
  const send = latestClientSend(r);
  const returns = [...getClientReturns(r)].sort(
    (a, b) => Number(b.returnNumber || 0) - Number(a.returnNumber || 0),
  );
  const entries = returns
    .map((ev) => {
      const donor =
        ev.alreadyDonor === true
          ? "Oui"
          : ev.alreadyDonor === false
            ? "Non"
            : "—";
      return `<article class="client-return-entry"><div class="client-return-entry-head"><div><strong>Retour client #${Number(ev.returnNumber) || 1}</strong><small>${formatDate(ev.receivedAt || ev.date, { time: true })}</small></div>${badge(clientReturnStatusLabel(ev.finalStatus || ev.decision || "Retour reçu"), "purple")}</div><div class="client-return-entry-facts">${fact("Nom de base", ev.baseSnapshot || ev.base || r.baseName)}${fact("Indice", ev.recordIndexSnapshot || ev.indexSnapshot || r.recordIndex)}${fact("Statut Call 1", ev.call1Status)}${fact("Statut final", clientReturnStatusLabel(ev.finalStatus || ev.decision || "—"))}${fact("Déjà donateur", donor)}</div>${ev.clientRemarks || ev.remarks || ev.comments || ev.disagreements ? `<div class="client-return-remarks"><strong>Remarques client</strong><p>${esc(ev.clientRemarks || ev.remarks || ev.comments || ev.disagreements)}</p></div>` : ""}</article>`;
    })
    .join("");
  return `${pageHeading(`<button class="back-link" data-action="record-back">${ic("chevron-left")} Retour à l’espace client</button><br>Indice ${esc(recordIndexValue(r))}`, `${esc(r.campaign)} · Appel du ${formatDate(r.callDate)}`, `<span class="badge badge-blue">Fiche transmise le ${formatDate(send?.sentAt)}</span>`, "ESPACE CLIENT")}<div class="portal-record-detail"><section class="record-card"><div class="record-card-header"><h3>Informations de la fiche</h3><span class="subtle">Fiche associée à cet enregistrement</span></div><div class="record-card-body"><div class="record-facts">${fact("Indice", recordIndexValue(r))}${fact("Nom de base", r.baseName)}${fact("Statut Call 1", recordCall1Status(r))}${fact("Campagne", r.campaign)}${fact("Date d’appel", formatDate(r.callDate))}</div></div></section><section class="record-card"><div class="record-card-header"><h3>Enregistrement audio</h3><span class="subtle">Lecture autorisée</span></div><div class="record-card-body" style="padding:10px">${renderAudioCard(r)}</div></section><section class="record-card"><div class="record-card-header"><h3>Retours client</h3><span class="subtle">${returns.length} entrée(s)</span></div><div class="record-card-body"><div class="client-returns-panel"><div class="client-returns-intro"><div><strong>${returns.length ? `${returns.length} retour${returns.length === 1 ? "" : "s"} conservé${returns.length === 1 ? "" : "s"}` : "Aucun retour saisi"}</strong><p>Chaque retour est rattaché à cette fiche et les entrées précédentes restent conservées.</p></div>${!backend.enabled || !backend.authenticated || backend.permissions.has("client_returns") ? `<button class="btn btn-primary btn-small" data-action="open-client-feedback" data-record-id="${esc(r.id)}">${ic("plus")} Ajouter le retour #${nextClientReturnNumber(r)}</button>` : ""}</div>${entries ? `<div class="client-return-list">${entries}</div>` : '<div class="empty-state"><strong>En attente du premier retour</strong><p>Les champs de retour s’afficheront ici après l’enregistrement.</p></div>'}</div></div></section><div class="notice-inline">${ic("shield")}<span>Les versions internes Synergy, les tâches et le journal complet ne sont pas exposés dans cet espace client.</span></div></div>`;
}
function portalRecordRow(r) {
  const send = latestClientSend(r);
  const ret = latestClientReturn(r);
  const retAt = ret?.receivedAt || ret?.date || "";
  const waiting = !ret || String(retAt) < String(send?.sentAt || "");
  const returnStatus = waiting
    ? badge(`Retour client #${getClientReturns(r).length + 1} attendu`, "amber")
    : badge(
        `${getClientReturns(r).length} retour${getClientReturns(r).length === 1 ? "" : "s"} enregistré${getClientReturns(r).length === 1 ? "" : "s"}`,
        "green",
      );
  return `<div class="portal-record-row"><div><strong class="record-id">${esc(recordIndexValue(r))}</strong><small>${esc(r.agent)} · ${formatDate(r.callDate)}</small></div><div><strong>${esc(r.campaign)}</strong><small>${returnStatus}</small></div><div><strong>Fiche transmise</strong><small>Envoyée le ${formatDate(send?.sentAt)}</small></div><button class="btn btn-secondary btn-small" data-action="portal-open-record" data-record-id="${esc(r.id)}" data-stage="clientReturns">${ic("headphones")} Ouvrir</button></div>`;
}

function renderSettings() {
  const tab = app.settingsTab;
  return `${pageHeading("Paramètres", "Configurez les grilles dynamiques, les connexions, les libellés et les accès du CRM.", backend.enabled ? "" : '<button class="btn btn-secondary" data-action="reset-demo">Réinitialiser la démo</button>', "ADMINISTRATION")}<div class="settings-tabs"><button class="settings-tab ${tab === "templates" ? "active" : ""}" data-settings-tab="templates">Grilles d’évaluation</button><button class="settings-tab ${tab === "drive" ? "active" : ""}" data-settings-tab="drive">Stockage audio local</button><button class="settings-tab ${tab === "groups" ? "active" : ""}" data-settings-tab="groups">Groupes d’options</button><button class="settings-tab ${tab === "agents" ? "active" : ""}" data-settings-tab="agents">Agents</button><button class="settings-tab ${tab === "labels" ? "active" : ""}" data-settings-tab="labels">Libellés</button><button class="settings-tab ${tab === "users" ? "active" : ""}" data-settings-tab="users">Utilisateurs & rôles</button></div>${tab === "templates" ? renderTemplateSettings() : tab === "drive" ? renderDriveSettings() : tab === "labels" ? renderLabelSettings() : tab === "groups" ? renderOptionGroupSettings() : tab === "agents" ? renderAgentSettings() : renderUserSettings()}`;
}
function renderTemplateSettings() {
  const criteria = state.criteriaByStage.internal1 || [];
  return `<div class="settings-grid"><section class="settings-card"><h3>Formulaires du workflow</h3><p>Synergy #1 conserve sa grille qualité configurée. Après un retour client, la réévaluation utilise les champs Pôle qualité, Promesse et Don; elle ne crée pas de session indépendante.</p><div class="stage-accordion"><div class="stage-accordion-head"><strong>Synergy #1</strong><span>${criteria.length} critère${criteria.length === 1 ? "" : "s"} · ${criteria.length ? "Configuré" : "À configurer"}</span></div><div class="stage-accordion-body">${criteria.length ? criteria.map((c) => `<div class="criterion-item"><span><strong>${esc(c.label)}</strong><small style="display:block;margin-top:3px">${esc(c.section || "Sans section")} · ${criterionTypeLabel(c.type)}${c.groupName ? ` « ${esc(c.groupName)} »` : ""}${c.description ? ` · ${esc(c.description)}` : ""} · poids ${Number(c.weight) || 1}</small></span><button class="icon-button" data-action="delete-criterion" data-stage="internal1" data-criterion-id="${esc(c.id)}" aria-label="Supprimer le critère">${ic("more")}</button></div>`).join("") : '<div class="criterion-empty">La grille Synergy #1 réelle doit être configurée ou saisie par un administrateur qualité.</div>'}<button class="criterion-add" data-action="add-criterion" data-stage="internal1">${ic("plus")} Ajouter un critère</button></div></div><div class="settings-callout">${ic("info")}<span>Les retours client, les réévaluations et les retours finaux sont archivés sur la fiche et chacun applique son libellé d’étape.</span></div></section><div class="stack"><section class="settings-card"><h3>Champs enregistrés</h3><p>Chaque réponse est datée/numérotée lorsque nécessaire et conservée avec les versions précédentes.</p><div class="metric-list"><div class="metric-line"><span>Synergy #1</span><strong>${criteria.length} critères</strong></div><div class="metric-line"><span>Réévaluation</span><strong>Analyse · Promesse · Don</strong></div><div class="metric-line"><span>Retour client</span><strong>Statut final · Donateur</strong></div><div class="metric-line"><span>Retour final</span><strong>Valide / Non valide</strong></div></div></section><section class="settings-card"><h3>Avant la mise en service</h3><p>${backend.enabled ? "Le serveur local applique les rôles et permissions aux requêtes API. DB conserve les données CRM et S3 Bucket les fichiers audio." : "La démo navigateur ne protège pas les APIs; connectez le serveur DB local et S3 Bucket pour activer le contrôle RBAC."}</p><button class="btn btn-secondary btn-small" data-settings-tab="drive">${backend.enabled ? "Voir le stockage audio local" : "Configurer le stockage local"} ${ic("arrow-right")}</button></section></div></div>`;
}
function renderDriveSettings() {
  const connected = backend.enabled && backend.authenticated;
  const minio = connected && backend.minioConfigured;
  return `<div class="settings-grid"><section class="settings-card"><h3>Stockage audio · S3 Bucket local</h3><p>Les binaires audio passent par le serveur local et sont conservés dans S3 Bucket. DB ne garde que les métadonnées, l’empreinte SHA-256 et les liens vers les fiches.</p><div class="connection-card"><span class="connection-icon">${ic("external")}</span><div><strong>${minio ? "S3 Bucket configuré" : connected ? "S3 Bucket non configuré" : "Serveur local non connecté"}</strong><small>${minio ? "Téléversement et lecture protégés par le serveur et les permissions API" : connected ? "Configurez le endpoint et les identifiants S3 Bucket dans l’environnement privé du serveur" : "Démarrez l’API locale pour activer le stockage S3 Bucket"}</small></div></div><div class="metric-list" style="margin-top:14px"><div class="metric-line"><span>Binaire</span><strong>S3 Bucket local</strong></div><div class="metric-line"><span>Métadonnées</span><strong>DB local</strong></div><div class="metric-line"><span>Déduplication</span><strong>SHA-256 · nom · taille</strong></div><div class="metric-line"><span>Accès audio</span><strong>Route authentifiée</strong></div></div><div class="notice-inline" style="margin-top:14px">${ic("shield")}<span>Ne saisissez aucun secret dans l’interface ou le chat. Les identifiants S3 Bucket et DB sont configurés uniquement dans l’environnement privé du serveur.</span></div></section><div class="stack"><section class="settings-card"><h3>DB local</h3><p>${connected ? "Connexion serveur active." : "La démo navigateur n’est pas reliée à la base."} La base CRM de cette installation démarre vide. Les fiches, workflows et historiques créés ensuite sont conservés côté serveur; aucun état du navigateur n’est importé.</p></section><section class="settings-card"><h3>Audios de cette installation</h3><p>Les nouveaux audios sont téléversés dans S3 Bucket et associés aux fiches ou débriefs créés dans ce CRM. Les accès sont contrôlés par l’API selon le rôle et le périmètre client.</p></section></div></div>`;
}
function renderLabelSettings() {
  return `<div class="settings-grid"><section class="settings-card"><h3>Libellés de suivi</h3><p>Les libellés restent informatifs et ne remplacent jamais l’état du workflow.</p><div class="label-manager-list">${state.labels.map((l) => `<div class="label-manager-item">${labelChip(l)}<button data-action="delete-label" data-label-id="${esc(l.id)}" title="Supprimer le libellé">${ic("circle-alert")}</button></div>`).join("")}</div><button class="btn btn-primary btn-small" style="margin-top:13px" data-action="new-label">${ic("plus")} Ajouter un libellé</button></section><section class="settings-card"><h3>Sur une fiche</h3><p>Une fiche peut porter plusieurs libellés. Ils sont accessibles depuis sa page principale.</p><div class="label-row" style="margin-top:14px">${state.labels
    .slice(0, 5)
    .map((l) => labelChip(l))
    .join(
      "",
    )}</div><div class="settings-callout">${ic("info")}<span>La suppression d’un libellé doit conserver l’historique de son usage dans la base de production.</span></div></section></div>`;
}

function criterionTypeLabel(type) {
  return (
    {
      ok_x: "OK / X",
      conformity: "Conformité",
      scale: "Échelle 1–5",
      select: "Liste déroulante",
      checkbox: "Cases à cocher",
    }[type] || "Texte libre"
  );
}
function optionGroupUsage(groupId) {
  return Object.values(state.criteriaByStage || {})
    .flat()
    .filter((c) => c.groupId === groupId).length;
}
function renderOptionGroupSettings() {
  const groups = state.optionGroups || [];
  return `<div class="settings-grid"><section class="settings-card"><h3>Groupes d’options</h3><p>Un groupe est une liste d’options réutilisable par les critères de type « Liste déroulante » ou « Cases à cocher ». Chaque option porte des points (0 à 100 %) utilisés dans le score.</p><div class="label-manager-list">${groups.length ? groups.map((g) => `<div class="criterion-item"><span><strong>${esc(g.name)}</strong><small style="display:block;margin-top:3px">${g.options.map((o) => `${esc(o.label)} (${Number(o.points)} %)`).join(" · ")} · utilisé par ${optionGroupUsage(g.id)} critère${optionGroupUsage(g.id) === 1 ? "" : "s"}</small></span><span style="display:flex;gap:6px"><button class="btn btn-secondary btn-small" data-action="edit-group" data-group-id="${esc(g.id)}">Modifier</button><button class="btn btn-secondary btn-small" data-action="delete-group" data-group-id="${esc(g.id)}">Supprimer</button></span></div>`).join("") : '<div class="criterion-empty">Aucun groupe défini. Créez un groupe pour l’utiliser dans un critère.</div>'}</div><button class="btn btn-primary btn-small" style="margin-top:13px" data-action="new-group">${ic("plus")} Ajouter un groupe</button></section><section class="settings-card"><h3>Calcul du score</h3><p>Liste déroulante : points de l’option choisie × poids du critère. Cases à cocher : somme des points des options cochées, plafonnée à 100 %, × poids du critère.</p><div class="settings-callout">${ic("info")}<span>Les options sont copiées dans le critère à sa création. Modifier un groupe ne change ni les critères existants ni les évaluations enregistrées.</span></div></section></div>`;
}
function openGroupModal(groupId = "") {
  const g = (state.optionGroups || []).find((x) => x.id === groupId);
  const text = g
    ? g.options.map((o) => `${o.label} | ${o.points}`).join("\n")
    : "";
  const body = `<input type="hidden" name="groupId" value="${esc(g?.id || "")}"/><div class="form-grid">${field("name", "Nom du groupe", { value: g?.name || "", placeholder: "Ex. Motifs de refus", required: true, span: true })}<div class="form-field span-2"><label>Options *</label><textarea name="options" class="form-control textarea" placeholder="Une option par ligne : Libellé | points&#10;Ex. Prix trop élevé | 0" required>${esc(text)}</textarea><span class="field-hint">Une option par ligne, au format « Libellé | points » (points de 0 à 100, 100 si omis).</span></div></div>`;
  showModal({
    title: g ? "Modifier le groupe" : "Nouveau groupe d’options",
    description:
      "Les critères réutilisent ce groupe pour leurs listes et cases à cocher.",
    body,
    form: "optionGroup",
    submitText: g ? "Enregistrer le groupe" : "Créer le groupe",
  });
}
function parseGroupOptions(text) {
  const options = [];
  const seen = new Set();
  for (const line of String(text || "").split("\n")) {
    const raw = line.trim();
    if (!raw) continue;
    const cut = raw.lastIndexOf("|");
    const label = (cut < 0 ? raw : raw.slice(0, cut)).trim();
    const pointsText = cut < 0 ? "" : raw.slice(cut + 1).trim();
    const points =
      pointsText === "" ? 100 : Number(pointsText.replace(",", "."));
    if (!label || !Number.isFinite(points) || points < 0 || points > 100)
      return {
        error: `Option invalide : « ${raw} ». Les points doivent être compris entre 0 et 100.`,
      };
    if (seen.has(label.toLowerCase()))
      return { error: `Option en double : « ${label} ».` };
    seen.add(label.toLowerCase());
    options.push({
      id: `opt-${options.length + 1}-${Date.now()}`,
      label,
      points,
    });
  }
  if (!options.length) return { error: "Ajoutez au moins une option." };
  return { options };
}
function saveOptionGroup(form) {
  const fd = new FormData(form);
  const name = String(fd.get("name") || "").trim();
  const id = String(fd.get("groupId") || "");
  const groups = state.optionGroups || (state.optionGroups = []);
  if (!name) {
    toast("Le nom du groupe est requis.", "warning");
    return;
  }
  if (
    groups.some(
      (g) => g.id !== id && g.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    toast("Un groupe porte déjà ce nom.", "warning");
    return;
  }
  const parsed = parseGroupOptions(fd.get("options"));
  if (parsed.error) {
    toast(parsed.error, "warning");
    return;
  }
  const existing = groups.find((g) => g.id === id);
  if (useRecordApi()) {
    const body = {
      name,
      options: parsed.options.map((option) => ({
        label: option.label,
        points: option.points,
      })),
    };
    settingsApiCall(
      apiRequest(
        existing
          ? `/quality/api/option-groups/${encodeURIComponent(id)}`
          : "/quality/api/option-groups",
        { method: existing ? "PATCH" : "POST", body },
      ),
      (result) => {
        const at = groups.findIndex((g) => g.id === result.group.id);
        if (at >= 0) groups[at] = result.group;
        else groups.push(result.group);
      },
      existing ? "Groupe mis à jour." : "Groupe créé.",
      () => {
        closeModal();
        app.page = "settings";
        app.settingsTab = "groups";
      },
    );
    return;
  }
  if (existing) {
    existing.name = name;
    existing.options = parsed.options;
  } else
    groups.push({ id: `grp-${Date.now()}`, name, options: parsed.options });
  saveState();
  closeModal();
  app.page = "settings";
  app.settingsTab = "groups";
  render();
  toast(existing ? "Groupe mis à jour." : "Groupe créé.");
}
function deleteOptionGroup(id) {
  const used = optionGroupUsage(id);
  if (used) {
    toast(
      `Ce groupe est utilisé par ${used} critère${used === 1 ? "" : "s"} et ne peut pas être supprimé.`,
      "warning",
    );
    return;
  }
  if (!confirm("Supprimer ce groupe d’options ?")) return;
  if (useRecordApi()) {
    settingsApiCall(
      apiRequest(`/quality/api/option-groups/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
      () => {
        state.optionGroups = (state.optionGroups || []).filter(
          (g) => g.id !== id,
        );
      },
      "Groupe supprimé.",
    );
    return;
  }
  state.optionGroups = (state.optionGroups || []).filter((g) => g.id !== id);
  saveState();
  render();
  toast("Groupe supprimé.");
}
function answerOptionLabels(c, value) {
  const byId = new Map((c.options || []).map((o) => [o.id, o.label]));
  return (Array.isArray(value) ? value : [value]).map(
    (v) => byId.get(v) || String(v),
  );
}
function normalizeAnswer(value, c) {
  if (c && (c.type === "select" || c.type === "checkbox"))
    return answerOptionLabels(c, value).join(", ");
  return (
    { conforme: "Conforme", non_conforme: "Non conforme", n_a: "N/A" }[value] ||
    String(value)
  );
}
function answerClass(value) {
  if (Array.isArray(value)) return "";
  return ["OK", "conforme"].includes(value)
    ? "ok"
    : ["X", "non_conforme"].includes(value)
      ? "ko"
      : "";
}
// Champ « Agent » : recherche à la frappe dans les noms d'agents (le matricule n'est ajouté qu'en cas d'homonymes) ou nom libre.
function agentChoiceLabel(agent) {
  const key = normalizeAgentText(agent.name);
  const duplicated =
    (state.agents || []).filter((a) => normalizeAgentText(a.name) === key)
      .length > 1;
  return duplicated ? `${agent.name} (${agent.id})` : agent.name;
}
function agentChoiceOptions() {
  return (state.agents || [])
    .slice()
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "fr"))
    .map((a) => `<option value="${esc(agentChoiceLabel(a))}"></option>`)
    .join("");
}
function resolveAgentInput(text, candidateCode = "") {
  const raw = String(text || "").trim();
  const agents = state.agents || [];
  const tagged = raw.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  if (tagged) {
    const byCode = agents.find(
      (a) =>
        normalizeEmployeeCode(a.id) &&
        normalizeEmployeeCode(a.id) === normalizeEmployeeCode(tagged[2]),
    );
    if (byCode) return { name: byCode.name, agent: byCode };
  }
  const name = normalizeAgentText(raw);
  const sameName = name
    ? agents.filter((a) => normalizeAgentText(a.name) === name)
    : [];
  if (sameName.length === 1)
    return { name: sameName[0].name, agent: sameName[0] };
  if (sameName.length > 1) {
    const code = normalizeEmployeeCode(candidateCode);
    const picked = code
      ? sameName.find((a) => normalizeEmployeeCode(a.id) === code)
      : null;
    if (picked) return { name: picked.name, agent: picked };
  }
  return { name: raw, agent: null };
}
function fillAgentMatricule(input) {
  const form = input.form;
  const field =
    form?.elements.namedItem("employeeCode") ||
    form?.elements.namedItem("agentCodeFromFilename");
  if (!field) return;
  const resolved = resolveAgentInput(input.value, field.value);
  if (resolved.agent) field.value = resolved.agent.id;
}
function agentChoiceFromFilename(name, code) {
  const agents = state.agents || [];
  const c = normalizeEmployeeCode(code);
  const found =
    (c && agents.find((a) => normalizeEmployeeCode(a.id) === c)) ||
    resolveAgentInput(name, code).agent;
  return found ? agentChoiceLabel(found) : String(name || "");
}
function agentLinkCounts(agent) {
  const records = (state.records || []).filter((r) =>
    sameAgentIdentity(agent.id, agent.name, r.employeeCode, r.agent),
  ).length;
  const debriefs = (state.debriefs || []).filter(
    (d) =>
      !d.archived &&
      sameAgentIdentity(agent.id, agent.name, d.employeeCode, d.agent),
  ).length;
  return { records, debriefs };
}
function agentInitials(name) {
  const words = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return (
    (words[0]?.[0] || "") + (words.length > 1 ? words[words.length - 1][0] : "")
  ).toUpperCase();
}
function validateAgentInput(agents, input, editingId = "") {
  const id = String(input.id || "").trim();
  const name = String(input.name || "").trim();
  if (!id) return { error: "Le matricule est obligatoire." };
  if (!name) return { error: "Le nom est obligatoire." };
  const key = normalizeEmployeeCode(id) || id.toUpperCase();
  if (
    agents.some(
      (a) =>
        a.id !== editingId &&
        (normalizeEmployeeCode(a.id) || String(a.id).toUpperCase()) === key,
    )
  )
    return {
      error: `Le matricule ${id} existe déjà : il identifie un seul agent.`,
    };
  return {
    agent: {
      id,
      name,
      team: String(input.team || "").trim(),
      since: String(input.since || "").trim(),
      initials: agentInitials(name),
    },
  };
}
function renderAgentSettings() {
  const agents = state.agents || [];
  return `<div class="settings-grid"><section class="settings-card" style="grid-column:1/-1"><h3>Agents</h3><p>Le matricule est la clé primaire d’un agent : il est unique et ne peut plus être modifié après la création. Un agent lié à une fiche ou à un débrief actif (non archivé) ne peut pas être supprimé.</p>${
    agents.length
      ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Matricule</th><th>Nom</th><th>Équipe</th><th>Date d’entrée</th><th>Fiches</th><th>Débriefs</th><th></th></tr></thead><tbody>${agents
          .map((a) => {
            const n = agentLinkCounts(a);
            return `<tr><td class="record-id">${esc(a.id)}</td><td><span class="agent-cell">${avatar(a.name)}<span class="agent-cell-copy"><strong>${esc(a.name)}</strong></span></span></td><td>${esc(a.team || "—")}</td><td>${a.since ? formatDate(a.since) : "—"}</td><td>${n.records}</td><td>${n.debriefs}</td><td class="record-open-cell"><button class="icon-button record-action-button" type="button" data-action="edit-agent" data-agent-id="${esc(a.id)}" title="Modifier l’agent" aria-label="Modifier l’agent ${esc(a.id)}">${ic("edit")}</button><button class="icon-button record-action-button record-action-delete" type="button" data-action="delete-agent" data-agent-id="${esc(a.id)}" title="Supprimer l’agent" aria-label="Supprimer l’agent ${esc(a.id)}">${ic("trash")}</button></td></tr>`;
          })
          .join("")}</tbody></table></div>`
      : '<div class="criterion-empty">Aucun agent. Ajoutez le premier agent pour pouvoir lier des fiches et des débriefs.</div>'
  }<button class="btn btn-primary btn-small" style="margin-top:13px" data-action="new-agent">${ic("plus")} Ajouter un agent</button></section></div>`;
}
function openAgentModal(agentId = "") {
  if (!canManageAgents()) {
    toast(
      "Votre rôle ne permet pas cette action (records_manage ou quality_settings).",
      "warning",
    );
    return;
  }
  const a = (state.agents || []).find((x) => x.id === agentId);
  const teams = [
    ...new Set((state.agents || []).map((x) => x.team).filter(Boolean)),
  ];
  const idField = a
    ? `<input type="hidden" name="agentId" value="${esc(a.id)}"/><div class="form-field"><label>Matricule</label><input value="${esc(a.id)}" disabled/><span class="field-hint">Clé primaire : non modifiable.</span></div>`
    : field("newAgentId", "Matricule", {
        placeholder: "Ex. AG-0418",
        required: true,
        hint: "Clé primaire : unique et non modifiable après la création.",
      });
  const body = `<div class="form-grid">${idField}${field("name", "Nom complet", { value: a?.name || "", placeholder: "Ex. Mohamed Trabelsi", required: true })}${field("team", "Équipe", { value: a?.team || "", placeholder: "Ex. Équipe Dons", list: "agentTeamOptions" })}${field("since", "Date d’entrée", { type: "date", value: a?.since || "" })}</div><datalist id="agentTeamOptions">${teams.map((t) => `<option value="${esc(t)}"></option>`).join("")}</datalist>`;
  showModal({
    title: a ? "Modifier l’agent" : "Nouvel agent",
    description: a
      ? "Mise à jour des informations de l’agent."
      : "Créez un agent identifié par son matricule.",
    body,
    form: "agent",
    submitText: a ? "Enregistrer l’agent" : "Créer l’agent",
  });
}
function saveAgent(form) {
  if (!canManageAgents()) {
    toast(
      "Votre rôle ne permet pas cette action (records_manage ou quality_settings).",
      "warning",
    );
    return;
  }
  const fd = new FormData(form);
  const editingId = String(fd.get("agentId") || "");
  const agents = state.agents || (state.agents = []);
  const checked = validateAgentInput(
    agents,
    {
      id: editingId || fd.get("newAgentId"),
      name: fd.get("name"),
      team: fd.get("team"),
      since: fd.get("since"),
    },
    editingId,
  );
  if (checked.error) {
    toast(checked.error, "warning");
    return;
  }
  const existing = agents.find((a) => a.id === editingId);
  if (useRecordApi()) {
    const body = existing
      ? {
          name: checked.agent.name,
          team: checked.agent.team,
          since: checked.agent.since,
        }
      : {
          id: checked.agent.id,
          name: checked.agent.name,
          team: checked.agent.team,
          since: checked.agent.since,
        };
    settingsApiCall(
      apiRequest(
        existing
          ? `/quality/api/agents/${encodeURIComponent(existing.id)}`
          : "/quality/api/agents",
        { method: existing ? "PATCH" : "POST", body },
      ),
      (result) => {
        const at = agents.findIndex((a) => a.id === result.agent.id);
        if (at >= 0) agents[at] = result.agent;
        else agents.push(result.agent);
      },
      existing ? "Agent mis à jour." : "Agent créé.",
      () => {
        closeModal();
        app.page = "settings";
        app.settingsTab = "agents";
      },
    );
    return;
  }
  if (existing) Object.assign(existing, checked.agent, { id: existing.id });
  else agents.push(checked.agent);
  saveState();
  closeModal();
  app.page = "settings";
  app.settingsTab = "agents";
  render();
  toast(existing ? "Agent mis à jour." : "Agent créé.");
}
function deleteAgent(id) {
  if (!canManageAgents()) {
    toast(
      "Votre rôle ne permet pas cette action (records_manage ou quality_settings).",
      "warning",
    );
    return;
  }
  const a = (state.agents || []).find((x) => x.id === id);
  if (!a) return;
  const n = agentLinkCounts(a);
  if (n.records || n.debriefs) {
    toast(
      `L’agent ${a.id} est lié à ${n.records} fiche(s) et ${n.debriefs} débrief(s) : suppression impossible.`,
      "warning",
    );
    return;
  }
  if (!confirm(`Supprimer l’agent ${a.name} (${a.id}) ?`)) return;
  if (useRecordApi()) {
    settingsApiCall(
      apiRequest(`/quality/api/agents/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
      () => {
        state.agents = state.agents.filter((x) => x.id !== id);
      },
      "Agent supprimé.",
    );
    return;
  }
  state.agents = state.agents.filter((x) => x.id !== id);
  saveState();
  render();
  toast("Agent supprimé.");
}
function getAccessRole(roleId) {
  return (state.roles || []).find((role) => role.id === roleId) || null;
}
function assignedRoleId(userId) {
  const assigned = state.userRoleAssignments?.[userId];
  return getAccessRole(assigned)
    ? assigned
    : DEFAULT_USER_ROLE_ASSIGNMENTS[userId] || "";
}
function assignedRole(userId) {
  return getAccessRole(assignedRoleId(userId));
}
function roleScopeLabel(role) {
  return role?.scope === "assigned_client"
    ? "Client affecté uniquement"
    : "Organisation";
}
function renderAccessRoleCard(role) {
  const activityLabels = ROLE_ACTIVITY_GROUPS.flatMap(
    (group) => group.activities,
  )
    .filter((activity) => role.activities.includes(activity.id))
    .map((activity) => activity.label);
  const assignedCount = demoUsers.filter(
    (user) => assignedRoleId(user.id) === role.id,
  ).length;
  return `<article class="access-role-card"><div class="access-role-head"><div><strong>${esc(role.name)}</strong><p>${esc(role.description || "Aucune description.")}</p></div>${badge(roleScopeLabel(role), role.scope === "assigned_client" ? "purple" : "blue")}</div><div class="access-role-meta"><span>${role.activities.length} activité(s) autorisée(s)</span><span>${assignedCount} utilisateur(s)</span></div><div class="access-role-chips">${
    activityLabels
      .slice(0, 3)
      .map((label) => `<span>${esc(label)}</span>`)
      .join("") || "<span>Aucune activité</span>"
  }${activityLabels.length > 3 ? `<span class="access-role-more">+${activityLabels.length - 3}</span>` : ""}</div><div class="access-role-actions"><button class="btn btn-secondary btn-small" data-action="edit-role" data-role-id="${esc(role.id)}">${ic("settings")} Modifier les activités</button>${role.system ? badge("Rôle système", "gray") : `<button class="role-delete-button" data-action="delete-role" data-role-id="${esc(role.id)}">Supprimer</button>`}</div></article>`;
}
function renderUserSettings() {
  const roles = state.roles || [];
  const assignments = state.userRoleAssignments || {};
  const showDeactivated = backend.enabled && app.userView === "inactive";
  const deactivatedRows = (app.deactivatedUsers || [])
    .map(
      (user) =>
        `<tr><td><span class="agent-cell">${avatar(user.name)}<span class="agent-cell-copy"><strong>${esc(user.name)}</strong><small>${esc(user.email || "")}</small></span></span></td><td>${badge("Désactivé", "red")}</td><td>${badge(roleScopeLabel(getAccessRole(user.roleId || assignments[user.id])), "gray")}</td><td><div class="user-row-actions"><button class="user-row-action" type="button" data-action="reactivate-user" data-user-id="${esc(user.id)}" aria-label="Réactiver ${esc(user.name)}">Réactiver</button></div></td></tr>`,
    )
    .join("");
  const userRows = demoUsers
    .map((user) => {
      const role = assignedRole(user.id);
      const roleId = role?.id || assignments[user.id] || "";
      const allowedRoles = roles.filter(
        (item) => !isClientDemoUser(user) || item.scope === "assigned_client",
      );
      const email = user.email || `${user.id}@demo.local`;
      const isActiveUser = backend.enabled
        ? user.id === backend.user?.id
        : user.id === "u-sarah";
      return `<tr><td><span class="agent-cell">${avatar(user.name)}<span class="agent-cell-copy"><strong>${esc(user.name)}</strong><small>${esc(email)}</small></span></span></td><td><select class="role-assignment-select" data-user-role="${esc(user.id)}" aria-label="Rôle de ${esc(user.name)}">${allowedRoles.map((item) => `<option value="${esc(item.id)}" ${item.id === roleId ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select></td><td>${badge(roleScopeLabel(role), role?.scope === "assigned_client" ? "purple" : "blue")}<small class="role-scope-hint">${role?.activities.length || 0} activité(s)</small></td><td><div class="user-row-actions"><button class="user-row-action" type="button" data-action="edit-user" data-user-id="${esc(user.id)}" aria-label="Modifier ${esc(user.name)}">Modifier</button><button class="user-row-action danger" type="button" data-action="delete-user" data-user-id="${esc(user.id)}" ${isActiveUser ? 'disabled title="Compte de démonstration actuellement connecté"' : ""} aria-label="Supprimer ${esc(user.name)}">Supprimer</button></div></td></tr>`;
    })
    .join("");
  return `<div class="role-admin-grid"><section class="settings-card role-directory-card"><div class="role-section-heading"><div><h3>Rôles & activités</h3><p>Cochez les activités autorisées pour chaque rôle.</p></div><button class="btn btn-primary btn-small" data-action="new-role">${ic("plus")} Créer un rôle</button></div><div class="access-role-list">${roles.map(renderAccessRoleCard).join("") || '<div class="empty-state"><strong>Aucun rôle configuré</strong><p>Créez un rôle et cochez ses activités.</p></div>'}</div></section><section class="settings-card role-users-card"><div class="role-section-heading"><div><h3>Utilisateurs</h3><p>${backend.enabled ? "Gérez les comptes DB et attribuez leurs rôles." : "Gérez les comptes de démonstration et attribuez leurs rôles."}</p></div><span style="display:flex;gap:8px;align-items:center">${backend.enabled ? `<select class="filter-select" data-filter="userView" aria-label="Filtrer les comptes"><option value="active" ${!showDeactivated ? "selected" : ""}>Comptes actifs</option><option value="inactive" ${showDeactivated ? "selected" : ""}>Comptes désactivés (${(app.deactivatedUsers || []).length})</option></select>` : ""}<button class="btn btn-primary btn-small" data-action="new-user">${ic("plus")} Ajouter un utilisateur</button></span></div><div class="table-wrap"><table class="data-table role-users-table"><thead><tr><th>Utilisateur</th><th>${showDeactivated ? "État" : "Rôle attribué"}</th><th>Portée</th><th>Actions</th></tr></thead><tbody>${showDeactivated ? deactivatedRows || '<tr><td colspan="4" class="muted">Aucun compte désactivé.</td></tr>' : userRows || '<tr><td colspan="4" class="muted">Aucun utilisateur.</td></tr>'}</tbody></table></div></section><div class="notice-inline role-security-note">${ic("shield")}<span>${backend.enabled ? "Les rôles, permissions et comptes sont enregistrés dans DB local. Chaque requête API est contrôlée côté serveur; les sessions utilisent un cookie HttpOnly et le journal d’audit est append-only. Les mots de passe sont hachés et ne sont jamais stockés dans le navigateur." : "Mode démonstration uniquement : les rôles locaux ne sécurisent pas les API. Utilisez le serveur DB local pour appliquer réellement le RBAC."}</span></div></div>`;
}
function renderRecord() {
  const r = getRecord(app.recordId);
  if (!r) {
    app.page = "records";
    return renderRecords();
  }
  if (app.fromPage === "portal") return renderPortalRecord(r);
  const returns = getClientReturns(r);
  const tab =
    app.recordTab === "client1"
      ? "clientReturns"
      : ["clientFinal", "compare"].includes(app.recordTab)
        ? "finalReturn"
        : app.recordTab;
  const tabs = [
    ["internal1", "Synergy #1"],
    [
      "clientReturns",
      `Retour client${returns.length ? ` (${returns.length})` : ""}`,
    ],
    ["internal2", "Réévaluation"],
    ["finalReturn", "Retour final"],
  ];
  const visibleTasks = getRecordTask(r.id);
  return `${pageHeading(`<button class="back-link" data-action="record-back">${ic("chevron-left")} Retour aux fiches</button><br>Indice ${esc(recordIndexValue(r))} <span class="record-heading-status">${recordBadge(r)}</span>`, `${esc(r.agent)} · ${esc(r.client)} · ${esc(r.campaign)} · Appel du ${formatDate(r.callDate, { time: false })}`, `<button class="btn btn-secondary" data-action="export-record" data-record-id="${esc(r.id)}">${ic("download")} Exporter</button><button class="btn btn-primary" data-action="new-task" data-record-id="${esc(r.id)}">${ic("plus")} Ajouter une tâche</button>`, "FICHE D’APPEL")}
    <div class="detail-tagbar"><span class="fact-label">LIBELLÉS</span><span class="label-row">${(r.labels || []).map((id) => labelChip(id)).join("") || '<span class="muted" style="font-size:12px">Aucun libellé</span>'}<button class="add-label" data-action="assign-label" data-record-id="${esc(r.id)}" title="Ajouter un libellé">${ic("plus")}</button></span></div>
    
    <div class="step-strip workflow-strip">${renderWorkflowStrip(r)}</div>
    <div class="record-layout">
      <div class="record-col record-col-left">
        <section class="record-card"><div class="record-card-header"><h3>Informations de la fiche</h3>${r.archived ? `<span class="badge badge-red">Fiche supprimée</span>${canManageRecords() ? `<button class="btn btn-secondary btn-small" data-action="restore-record" data-record-id="${esc(r.id)}">Restaurer</button>` : ""}` : ""}<button class="icon-button" data-action="edit-record" data-record-id="${esc(r.id)}" title="Modifier la fiche" aria-label="Modifier la fiche">${ic("edit")}</button></div><div class="record-card-body"><div class="record-facts">
          ${fact("Agent", r.agent)}${fact("Matricule agent", r.employeeCode)}${fact("Matricule candidat du nom", r.agentCodeFromFilename)}${fact("Civilité", r.agentCivility)}${fact("Client", r.client)}${fact("Campagne", r.campaign)}${fact("Code campagne", r.campaignCode)}${fact("Date et heure", `${formatDate(r.callDate)} · ${r.callTime}`)}${fact("Indice", recordIndexValue(r))}${fact("Nom de la base", r.baseName)}${fact("Statut Call 1", recordCall1Status(r))}${fact("Durée", r.duration)}${fact("Segment 6 brut", r.rawSegment6)}${fact("Segment 7 brut", r.rawSegment7)}${fact("N° de poste", r.extension)}${fact("Référence client", r.clientRef)}${fact("Promesse", r.amount != null ? `${r.amount} €` : "—")}${fact("Qualiticien", r.responsible || "Non affecté")}${fact("Créée le", formatDate(r.createdAt, { time: true }))}
        </div></div></section>
        <section class="record-card"><div class="record-card-header"><h3>Enregistrement audio</h3><span class="subtle">Stockage local</span></div><div class="record-card-body" style="padding:10px">${renderAudioCard(r)}</div></section>
      </div>
      <div class="record-col record-col-center">
        <section class="record-card"><div class="record-card-header"><h3>Évaluations & retours</h3><span class="subtle">Même fiche · historique conservé</span></div><div class="record-tabs">${tabs.map(([key, label]) => `<button class="record-tab ${tab === key ? "active" : ""}" data-record-tab="${key}">${label}</button>`).join("")}</div><div class="record-card-body" id="recordStageBody">${renderStage(r, tab)}</div></section>
      </div>
      <div class="record-col record-col-right">
        <section class="record-card workflow-history-card"><div class="record-card-header"><h3>Historique des étapes</h3><span class="subtle">Libellés colorés · réponses conservées</span></div><div class="record-card-body">${renderWorkflowHistory(r)}${canCloseRecord(r) ? `<div class="record-actions"><button class="btn btn-secondary btn-small btn-full" data-action="close-record" data-record-id="${esc(r.id)}">${ic("circle-check")} Clôturer le dossier</button></div>` : ""}</div></section>
        <section class="record-card"><div class="record-card-header"><h3>Tâches liées</h3><button class="panel-link" data-action="new-task" data-record-id="${esc(r.id)}">+ Ajouter</button></div><div class="record-card-body" style="padding-top:5px;padding-bottom:7px">${visibleTasks.length ? visibleTasks.map((t) => `<div class="mini-task-line"><span class="task-status-dot ${t.status === "TERMINE" ? "done" : taskIsLate(t) ? "late" : ""}"></span><span><strong>${esc(taskDisplayTitle(t.title))}</strong><small>${esc(t.assignedTo)} · ${formatDate(t.dueDate)}</small></span><button class="task-mini-check ${t.status === "TERMINE" ? "done" : ""}" data-action="toggle-task" data-task-id="${esc(t.id)}">${ic("circle-check")}</button></div>`).join("") : '<div class="empty-mini">Aucune tâche ouverte pour cette fiche.</div>'}</div></section>
        <details class="record-card record-audit-card"><summary class="record-card-header"><h3>Journal complet</h3><span class="subtle">Tous les événements horodatés</span></summary><div class="record-card-body"><div class="history-list">${renderHistory(r.id)}</div></div></details>
        <section class="record-card"><div class="record-card-header"><h3>Débriefs associés</h3><button class="panel-link" data-action="new-debrief" data-record-id="${esc(r.id)}">Créer un débrief</button></div><div class="record-card-body">${renderRecordDebriefs(r.id)}</div></section>
      </div>
    </div>`;
}
function fact(label, value) {
  return `<div class="fact"><span class="fact-label">${esc(label)}</span><span class="fact-value">${esc(value || "—")}</span></div>`;
}
function renderWorkflowStrip(r) {
  const returns = getClientReturns(r);
  const sendDone = hasBeenSentToClient(r);
  const items = [
    ["Audio reçu", !!r.audio?.drive_file_id],
    ["Synergy #1", !!r.internal1],
    ["Envoi client", sendDone],
    ["Retour client", returns.length > 0],
    ["Réévaluation", !!r.internal2],
    ["Retour final", !!latestFinalReturn(r)],
  ];
  return items
    .map(
      ([label, done], i) =>
        `<div class="step-item ${done ? "complete" : i === items.findIndex((x) => !x[1]) ? "current" : ""}"><span class="step-number">${done ? ic("circle-check") : i + 1}</span><span class="step-copy"><strong>${label}</strong><small>${label === "Retour client" && returns.length ? `${returns.length} retour${returns.length === 1 ? "" : "s"} conservé${returns.length === 1 ? "" : "s"}` : done ? "Étape validée" : i === items.findIndex((x) => !x[1]) ? "En attente" : "À venir"}</small></span></div>`,
    )
    .join("");
}
function renderWorkflowHistory(r) {
  const entries = [];
  const add = (date, stage, result, tone, detail = "", tab = "") =>
    entries.push({
      date: date || r.createdAt || "",
      stage,
      result,
      tone,
      detail,
      tab,
    });
  if (r.audio)
    add(
      r.audio.date_upload || r.createdAt,
      "Audio reçu",
      "Ajouté",
      "blue",
      r.audio.drive_file_name || "Enregistrement audio",
    );
  const evaluations = (stage, current) =>
    [
      ...(r.evaluationHistory || []).filter((ev) => ev.stage === stage),
      ...(current ? [current] : []),
    ].sort(
      (a, b) =>
        Number(a.version || 0) - Number(b.version || 0) ||
        String(a.date || "").localeCompare(String(b.date || "")),
    );
  for (const ev of evaluations("internal1", r.internal1)) {
    const conforms = (ev.conformity || ev.donStatus) === "CONFORME";
    add(
      ev.date,
      "Synergy #1",
      conforms ? "Conforme" : "À revoir",
      conforms ? "green" : "red",
      `Version ${Number(ev.version) || 1} · ${scoreFormat(ev.score)}`,
      "internal1",
    );
  }
  [...(r.clientSendHistory || [])].forEach((send, index) => {
    const mode =
      send.exportMode === "EXCEL"
        ? "Excel"
        : send.exportMode === "AUDIO_ZIP"
          ? "ZIP audio"
          : send.exportMode === "BOTH"
            ? "Excel + ZIP"
            : send.exportMode || "Envoi";
    add(
      send.sentAt,
      "Envoi client",
      `Envoi #${index + 1}`,
      "blue",
      `${mode} · ${send.ftpDestination ? `FTP ${send.ftpDestination}` : "Dépôt FTP manuel"}`,
      "clientReturns",
    );
  });
  for (const ev of [...getClientReturns(r)].sort(
    (a, b) => Number(a.returnNumber || 0) - Number(b.returnNumber || 0),
  )) {
    add(
      ev.receivedAt || ev.date,
      `Retour client #${Number(ev.returnNumber) || 1}`,
      clientReturnStatusLabel(ev.finalStatus || ev.decision || "Reçu"),
      "purple",
      `Call 1 : ${ev.call1Status || "—"} · Déjà donateur : ${donorAnswerLabel(ev.alreadyDonor)}${ev.clientRemarks ? ` · ${ev.clientRemarks}` : ""}`,
      "clientReturns",
    );
  }
  for (const ev of evaluations("internal2", r.internal2)) {
    const result = promiseStatusLabel(
      ev.promiseStatus || ev.finalStatus || ev.decision,
    );
    const tone =
      (ev.donConformity || ev.donStatus || ev.conformity) === "NON_CONFORME"
        ? "red"
        : "amber";
    add(
      ev.date,
      `Réévaluation · v${Number(ev.version) || 1}`,
      result,
      tone,
      `${donorConformityLabel(ev.donConformity || ev.donStatus || ev.conformity)}${ev.analysisPoleQualite ? ` · ${ev.analysisPoleQualite}` : ""}`,
      "internal2",
    );
  }
  for (const ev of [...finalReturnHistory(r)].sort(
    (a, b) =>
      Number(a.version || 0) - Number(b.version || 0) ||
      String(a.date || "").localeCompare(String(b.date || "")),
  )) {
    const result = finalReturnStatusLabel(ev.status || ev.decision);
    const tone =
      finalReturnStatusCode(ev.status || ev.decision) === "VALIDE"
        ? "green"
        : "red";
    add(
      ev.date || ev.receivedAt,
      `Retour final · v${Number(ev.version) || 1}`,
      result,
      tone,
      ev.recordedBy || ev.user || "Réponse archivée",
      "finalReturn",
    );
  }
  entries.sort((a, b) =>
    String(a.date || "").localeCompare(String(b.date || "")),
  );
  if (!entries.length)
    return '<div class="empty-mini">Aucune étape n’est encore enregistrée.</div>';
  return `<div class="workflow-history">${entries.map((entry) => `<article class="workflow-history-item"><span class="workflow-history-marker ${esc(entry.tone)}"></span><div class="workflow-history-copy"><div class="workflow-history-head">${badge(entry.stage, entry.tone)}${badge(entry.result, entry.tone)}</div><small>${formatDate(entry.date, { time: true })}</small>${entry.detail ? `<p title="${esc(entry.detail)}">${esc(entry.detail)}</p>` : ""}${entry.tab ? `<button class="workflow-history-link" data-record-tab="${esc(entry.tab)}">Voir l’étape ${ic("arrow-right")}</button>` : ""}</div></article>`).join("")}</div>`;
}
function workflowSteps(r) {
  return state.events
    .filter((e) => e.recordId === r.id)
    .sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")))
    .slice(-8);
}
function renderTimeline(r) {
  const events = workflowSteps(r);
  if (!events.length)
    return '<div class="empty-mini">Aucun événement enregistré.</div>';
  return events
    .map(
      (e) =>
        `<div class="timeline-item done"><span class="timeline-marker">${ic("circle-check")}</span><div class="timeline-copy"><strong>${esc(e.action)}</strong><small>${formatDate(e.at, { time: true })} · ${esc(e.actor || "—")}</small>${e.detail ? `<small>${esc(e.detail)}</small>` : ""}</div><span class="timeline-status">Historique</span></div>`,
    )
    .join("");
}

function renderClientSendHistory(r) {
  const history = [...(r.clientSendHistory || [])].sort((a, b) =>
    String(a.sentAt || "").localeCompare(String(b.sentAt || "")),
  );
  if (!history.length)
    return '<div class="empty-mini">Aucun envoi client enregistré.</div>';
  return `<div class="record-send-history">${history
    .map((send, index) => {
      const mode =
        send.exportMode === "EXCEL"
          ? "Excel uniquement"
          : send.exportMode === "AUDIO_ZIP"
            ? "ZIP audio"
            : send.exportMode === "BOTH"
              ? "Excel + ZIP audio"
              : send.exportMode || "Format historique";
      return `<div class="record-send-entry"><div class="record-send-entry-head"><strong>Envoi #${index + 1}</strong>${badge(mode, "blue")}</div><small>${formatDate(send.sentAt, { time: true })} · ${send.evaluationStage === "internal2" ? "Réévaluation" : send.evaluationStage === "internal1" ? "Synergy #1" : "Sans évaluation"} · version ${Number(send.evaluationVersion) || "—"}</small>${send.fileName ? `<small>${esc(send.fileName)}</small>` : ""}<small>${send.ftpDestination ? `FTP · ${esc(send.ftpDestination)}` : "Dépôt FTP externe"} · ${esc(send.sentBy || "—")}</small></div>`;
    })
    .join("")}</div>`;
}
function renderHistory(recordId) {
  const events = state.events
    .filter((e) => e.recordId === recordId)
    .sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  if (!events.length)
    return (
      '<div class="empty-state" style="padding:18px"><div class="empty-icon">' +
      ic("history") +
      "</div><strong>Aucun événement</strong><p>Les actions réalisées sur la fiche s’afficheront ici.</p></div>"
    );
  return events
    .map(
      (e) =>
        `<div class="history-item"><span class="history-dot"></span><div class="history-copy"><strong>${esc(e.action)}</strong><p>${esc(e.detail || "")}</p><small>${formatDate(e.at, { time: true })} · ${esc(e.actor)} · ${esc(e.role)}</small></div></div>`,
    )
    .join("");
}
function renderRecordCompleteHistory(r) {
  const evaluationBlock = (stage, title) => {
    const ev = stage === "internal1" ? r.internal1 : r.internal2;
    return `<section class="record-history-group"><div class="record-history-group-head"><strong>${title}</strong>${ev ? `<span>${scoreFormat(ev.score)} · ${formatDate(ev.date, { time: true })}</span>` : "<span>Non renseignée</span>"}</div>${ev ? renderEvaluationSummary(r, stage) : `<div class="empty-mini">${stage === "internal1" ? "Aucune version Synergy #1 enregistrée." : "Aucune réévaluation enregistrée."}</div>`}</section>`;
  };
  return `<div class="record-complete-history">${evaluationBlock("internal1", "Synergy #1")}${evaluationBlock("internal2", "Réévaluation · Pôle qualité")}<section class="record-history-group"><div class="record-history-group-head"><strong>Retour final</strong><span>${finalReturnHistory(r).length} version(s)</span></div>${renderFinalReturn(r)}</section><section class="record-history-group"><div class="record-history-group-head"><strong>Envois au client</strong><span>${(r.clientSendHistory || []).length} trace(s)</span></div>${renderClientSendHistory(r)}</section><section class="record-history-group"><div class="record-history-group-head"><strong>Retours client successifs</strong><span>${getClientReturns(r).length} entrée(s)</span></div>${renderClientReturns(r)}</section></div>`;
}
function renderRecordDebriefs(recordId) {
  const r = getRecord(recordId);
  const matches = (state.debriefs || []).filter(
    (d) => !d.archived && (d.recordIds || []).includes(recordId),
  );
  const manage = canManageDebriefs();
  const linkable = r && manage ? debriefsLinkableToRecord(r).length : 0;
  const actions = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="btn btn-secondary btn-small" data-action="new-debrief" data-record-id="${esc(recordId)}">${ic("plus")} Créer un débrief</button>${linkable ? `<button class="btn btn-secondary btn-small" data-action="link-debrief-modal" data-record-id="${esc(recordId)}">Lier à un débrief existant</button>` : ""}</div>`;
  if (!matches.length)
    return `<div class="empty-state" style="padding:16px"><div class="empty-icon">${ic("users")}</div><strong>Aucun débrief associé</strong><p>Ajoutez cette fiche à une session de coaching agent.</p>${actions}</div>`;
  return (
    matches
      .map(
        (d) =>
          `<div class="metric-line"><span><strong style="display:block">${esc(d.agent)}</strong><small style="display:block;margin-top:3px;color:#9ba4b1">${esc(d.id)} · ${formatDate(d.date)}</small></span><span style="display:inline-flex;gap:6px;align-items:center">${badge("Session", "blue")}${manage ? `<button class="btn btn-secondary btn-small" type="button" data-action="unlink-debrief" data-debrief-id="${esc(d.id)}" data-record-id="${esc(recordId)}">Dissocier</button>` : ""}</span></div>`,
      )
      .join("") + actions
  );
}
function renderAudioCard(r) {
  const a = r.audio || {};
  const audioUrl =
    a.localUrl ||
    (backend.enabled && backend.authenticated && a.objectId
      ? `/quality/api/audio/${encodeURIComponent(a.objectId)}`
      : "");
  const hasLocal = !!audioUrl;
  const ext = (a.drive_file_name || "Audio appel")
    .split(".")
    .pop()
    .toUpperCase();
  const size = a.file_size
    ? `${(a.file_size / 1048576).toFixed(1)} Mo`
    : "Taille inconnue";
  const bars = [
    5, 11, 18, 9, 14, 22, 12, 8, 20, 12, 25, 16, 8, 17, 11, 22, 9, 14, 20, 7,
    15, 23, 12, 19, 8, 16, 24, 11, 15, 7, 18, 13, 22, 9, 16, 21, 12, 6, 17, 10,
    20, 14, 8, 19, 12, 24, 11, 17, 7, 16, 21, 10, 14, 19, 8, 15, 23, 11,
  ];
  return `<div class="audio-card"><div class="audio-head"><span class="audio-file-icon">${ic("file-audio")}</span><div class="audio-file-copy"><strong title="${esc(a.drive_file_name || "Audio non renseigné")}">${esc(a.drive_file_name || "Audio non renseigné")}</strong><small>${esc(ext)} · ${esc(size)} · ${a.objectId ? "S3 Bucket sécurisé" : hasLocal ? "Fichier local" : "Référence historique"}</small></div>${backend.enabled && a.objectId ? '<span class="badge badge-green">S3 Bucket</span>' : `<button class="audio-skip" data-action="open-drive" data-record-id="${esc(r.id)}" title="Référence audio historique">${ic("external")}</button>`}</div>
    <div class="audio-wave" aria-hidden="true">${bars.map((h) => `<i style="height:${h}px"></i>`).join("")}</div>
    <div class="audio-controls"><button class="audio-skip" data-action="audio-back" data-record-id="${esc(r.id)}" aria-label="Reculer de 5 secondes">${ic("skip-back")}</button><button class="audio-round" data-action="audio-toggle" data-record-id="${esc(r.id)}" aria-label="Lecture ou pause">${ic("play")}</button><button class="audio-skip" data-action="audio-forward" data-record-id="${esc(r.id)}" aria-label="Avancer de 5 secondes">${ic("skip-forward")}</button><span class="audio-time" data-audio-current>00:00</span><input class="audio-progress" type="range" min="0" max="100" value="0" data-audio-seek aria-label="Progression de l’audio"><span class="audio-time" data-audio-duration>${esc(r.duration || "00:00")}</span><select class="audio-speed" data-audio-speed aria-label="Vitesse de lecture"><option>0.5</option><option selected>1</option><option>1.25</option><option>1.5</option><option>2</option></select></div>
    <div class="audio-demo-note">${a.objectId ? "Audio servi par le serveur local après contrôle de session et de permission." : hasLocal ? "Fichier sélectionné dans cette session · lecture locale." : "Audio historique sans binaire disponible dans ce navigateur."}</div>${hasLocal ? `<audio class="audio-element" data-audio-element preload="metadata" src="${esc(audioUrl)}"></audio>` : ""}</div>`;
}
// Source de l'audio d'une fiche : URL locale (démo), sinon le lecteur sécurisé du serveur (MinIO) pour l'audio enregistré.
function callAudioSource(r) {
  const a = r?.audio || {};
  return (
    a.localUrl ||
    (backend.enabled && backend.authenticated && a.objectId
      ? `/quality/api/audio/${encodeURIComponent(a.objectId)}`
      : a.drive_file_url || "")
  );
}
function renderEvaluationAudio(r) {
  const a = r.audio || {};
  const src = callAudioSource(r);
  return `<div class="evaluation-audio-inline"><span class="audio-file-icon">${ic("headphones")}</span><div class="evaluation-audio-copy"><strong>Écouter l’enregistrement</strong><small>${esc(a.drive_file_name || "Audio non renseigné")}</small></div>${src ? `<audio controls preload="metadata" src="${esc(src)}" aria-label="Écouter ${esc(a.drive_file_name || "l’appel")}"></audio>` : `<span class="audio-unavailable">${ic("info")} Audio non archivé dans S3 Bucket local</span>`}</div>`;
}
function renderStage(r, stage) {
  if (stage === "clientReturns" || stage === "client1")
    return renderClientReturns(r);
  if (stage === "finalReturn" || stage === "clientFinal")
    return renderFinalReturn(r);
  if (stage === "internal1") {
    if (r.internal1) return renderEvaluationSummary(r, "internal1");
    return renderStageEmpty(
      r,
      "internal1",
      "L’évaluation Synergy #1 n’a pas encore été enregistrée.",
    );
  }
  if (stage === "internal2") {
    if (r.internal2) return renderEvaluationSummary(r, "internal2");
    if (!getClientReturns(r).length)
      return `<div class="stage-empty"><span class="empty-icon">${ic("headphones")}</span><strong>Réévaluation dans la même fiche</strong><p>Le formulaire s’ouvre après l’enregistrement d’un retour client sur cette fiche.</p></div>`;
    return renderStageEmpty(
      r,
      "internal2",
      "Le retour client est conservé ci-dessus. Réécoutez l’enregistrement et documentez votre analyse directement dans cette fiche.",
    );
  }
  return "";
}
function renderClientReturns(r) {
  const returns = [...getClientReturns(r)].sort(
    (a, b) => Number(b.returnNumber || 0) - Number(a.returnNumber || 0),
  );
  const canReceive = true;
  const entries = returns
    .map((ev) => {
      const n = Number(ev.returnNumber) || 1;
      const donor = donorAnswerLabel(ev.alreadyDonor);
      const channel =
        ev.sourceChannel === "PORTAL"
          ? "Portail client"
          : ev.sourceChannel === "EMAIL"
            ? "E-mail"
            : "Saisie CRM";
      return `<article class="client-return-entry"><div class="client-return-entry-head"><div><strong>Retour client #${n}</strong><small>${formatDate(ev.receivedAt || ev.date, { time: true })} · ${esc(ev.recordedBy || ev.user || "—")} · ${channel}</small></div>${badge(clientReturnStatusLabel(ev.finalStatus || ev.decision || "Retour reçu"), "purple")}</div><div class="client-return-entry-facts">${fact("Nom de base", ev.baseSnapshot || ev.base || r.baseName)}${fact("Indice", ev.recordIndexSnapshot || ev.indexSnapshot || r.recordIndex)}${fact("Statut Call 1", ev.call1Status)}${fact("Statut final", clientReturnStatusLabel(ev.finalStatus || ev.decision || "—"))}${fact("Déjà donateur", donor)}</div>${ev.clientRemarks || ev.remarks || ev.comments || ev.disagreements ? `<div class="client-return-remarks"><strong>Remarques du client</strong><p>${esc(ev.clientRemarks || ev.remarks || ev.comments || ev.disagreements)}</p></div>` : '<div class="client-return-remarks muted">Aucune remarque détaillée enregistrée pour cette ancienne entrée.</div>'}</article>`;
    })
    .join("");
  return `<div class="client-returns-panel"><div class="client-returns-intro"><div><strong>${returns.length ? `${returns.length} retour${returns.length === 1 ? "" : "s"} client conservé${returns.length === 1 ? "" : "s"}` : "Aucun retour client saisi"}</strong><p>Chaque retour est ajouté à cette fiche avec sa date, son auteur et ses valeurs. Les entrées précédentes ne sont pas écrasées.</p></div><button class="btn btn-primary btn-small" data-action="open-client-feedback" data-record-id="${esc(r.id)}">${ic("plus")} Ajouter le retour #${nextClientReturnNumber(r)}</button></div>${entries ? `<div class="client-return-list">${entries}</div>` : `<div class="empty-state"><div class="empty-icon">${ic("message")}</div><strong>La fiche est prête à recevoir un retour</strong><p>Saisissez ici les valeurs du retour reçu : #1, #2, #3… sans créer de nouvelle fiche.</p></div>`}${returns.length ? `<div class="record-actions">${returnNeedsSynergyReview(r) ? `<button class="btn btn-secondary btn-small" data-action="begin-evaluation" data-stage="internal2" data-record-id="${esc(r.id)}">${ic("headphones")} Évaluer le retour dans cette fiche</button>` : ""}${clientSendAllowed(r) ? `<button class="btn btn-soft btn-small" data-action="prepare-client-send" data-record-id="${esc(r.id)}">${ic("send")} Préparer un nouvel envoi</button>` : ""}</div>` : ""}</div>`;
}

function renderStageEmpty(r, stage, description) {
  const hasCriteria =
    stage === "internal2" || (state.criteriaByStage[stage] || []).length > 0;
  const actionLabel =
    stage === "internal2" ? "Démarrer la réévaluation" : "Démarrer Synergy #1";
  return `<div class="stage-empty"><span class="empty-icon">${ic(stage === "internal2" ? "headphones" : "clipboard")}</span><strong>${esc(stageTitles[stage])} — à réaliser</strong><p>${esc(description)}</p>${hasCriteria ? `<button class="btn btn-primary btn-small" data-action="begin-evaluation" data-stage="${stage}" data-record-id="${esc(r.id)}">${ic("plus")} ${actionLabel}</button>` : `<button class="btn btn-secondary btn-small" data-settings-tab="templates" data-page="settings">${ic("settings")} Configurer la grille</button><div class="field-hint" style="margin-top:8px">Aucun critère métier n’a été inventé.</div>`}</div>`;
}
function renderEvaluationSummary(r, stage) {
  const ev = stage === "internal1" ? r.internal1 : r.internal2;
  if (stage === "internal2") {
    const tone =
      ev.donConformity === "CONFORME"
        ? ""
        : ev.donConformity === "NON_CONFORME"
          ? "red"
          : "amber";
    return `<div class="eval-summary"><span class="eval-summary-icon ${tone}">${ic(ev.donConformity === "CONFORME" ? "circle-check" : "circle-alert")}</span><div class="eval-summary-copy"><strong>Réévaluation · Pôle qualité</strong><small>Version ${ev.version || 1} · ${esc(ev.evaluator || "—")} · ${formatDate(ev.date, { time: true })}</small></div><strong class="eval-score ${tone}">${donorConformityLabel(ev.donConformity || ev.donStatus || ev.conformity)}</strong></div><div class="record-facts" style="margin-bottom:10px">${fact("Promesse", promiseStatusLabel(ev.promiseStatus || ev.finalStatus || ev.decision))}${fact("Don", donorConformityLabel(ev.donConformity || ev.donStatus || ev.conformity))}</div>${ev.analysisPoleQualite ? `<div class="internal-note"><strong>ANALYSE POLE QUALITE</strong><br>${esc(ev.analysisPoleQualite)}</div>` : ""}${renderEvaluationHistory(r, stage)}<div class="record-actions"><button class="btn btn-secondary btn-small" data-action="begin-evaluation" data-stage="internal2" data-record-id="${esc(r.id)}">${ic("plus")} Nouvelle version</button></div>`;
  }
  const tone =
    ev.conformity === "CONFORME"
      ? ""
      : ev.conformity === "NON_CONFORME"
        ? "red"
        : "amber";
  const title = "Évaluation initiale Synergy #1";
  const answers = Object.keys(ev.answers || {}).length;
  const criteria = state.criteriaByStage.internal1 || [];
  const statusLabel =
    finalCallStatusOptions.find((x) => x[0] === ev.finalStatus)?.[1] ||
    ev.finalStatus ||
    ev.decision ||
    "—";
  const donStatus = ev.donStatus || ev.conformity || "NON_CONFORME";
  const detailRows = criteria
    .filter((c) => ev.answers && ev.answers[c.id] != null)
    .map(
      (c) =>
        `<div class="saved-criterion"><span><strong>${esc(c.label)}</strong><small>${esc(c.description || "")}</small></span><b class="answer-pill ${answerClass(ev.answers[c.id])}">${esc(normalizeAnswer(ev.answers[c.id], c))}</b>${ev.answerComments?.[c.id] ? `<p>${esc(ev.answerComments[c.id])}</p>` : ""}</div>`,
    )
    .join("");
  return `<div class="eval-summary"><span class="eval-summary-icon ${tone}">${ic(ev.conformity === "CONFORME" ? "circle-check" : "circle-alert")}</span><div class="eval-summary-copy"><strong>${title}</strong><small>Version ${ev.version || 1} · ${esc(ev.evaluator || "—")} · ${formatDate(ev.date, { time: true })}</small></div><strong class="eval-score ${tone}">${scoreFormat(ev.score)}</strong></div><div class="record-facts" style="margin-bottom:10px"><div class="fact"><span class="fact-label">DON</span><span class="fact-value">${badge(donStatus === "CONFORME" ? "CONFORME" : "NON CONFORME", donStatus === "CONFORME" ? "green" : "red")}</span></div><div class="fact"><span class="fact-label">Statut final</span><span class="fact-value">${esc(statusLabel)}</span></div><div class="fact"><span class="fact-label">Montant</span><span class="fact-value">${ev.amount == null ? "—" : `${esc(ev.amount)} €`}</span></div><div class="fact"><span class="fact-label">À annuler</span><span class="fact-value">${esc(cancelReasonOptions.find((x) => x[0] === ev.cancelReason)?.[1] || "Aucune")}</span></div><div class="fact"><span class="fact-label">Critères renseignés</span><span class="fact-value">${answers} / ${criteria.length}</span></div><div class="fact"><span class="fact-label">Évaluateur</span><span class="fact-value">${esc(ev.evaluator || "—")}</span></div></div>${detailRows ? `<div class="saved-criteria-list"><div class="saved-criteria-heading">Critères qualité & justifications</div>${detailRows}</div>` : ""}${ev.remark || ev.comments ? `<div class="internal-note"><strong>Remarque</strong><br>${esc(ev.remark || ev.comments)}</div>` : ""}${ev.observations ? `<p class="eval-text"><strong>Observations :</strong> ${esc(ev.observations)}</p>` : ""}${renderEvaluationHistory(r, stage)}${!answers ? '<div class="notice-inline" style="margin-top:10px">' + ic("info") + "<span>Cette ancienne fiche de démonstration ne contient pas de réponses enregistrées par critère.</span></div>" : ""}<div class="record-actions"><button class="btn btn-secondary btn-small" data-action="open-final-return" data-record-id="${esc(r.id)}">${ic("message")} Retour final</button><button class="btn btn-secondary btn-small" data-action="begin-evaluation" data-stage="internal1" data-record-id="${esc(r.id)}">${ic("plus")} Nouvelle version</button></div>`;
}
function renderEvaluationHistory(r, stage) {
  const history = (r.evaluationHistory || [])
    .filter((e) => e.stage === stage)
    .sort((a, b) => (b.version || 0) - (a.version || 0));
  if (!history.length) return "";
  return `<details class="evaluation-history"><summary>Historique conservé · ${history.length} version${history.length === 1 ? "" : "s"} précédente${history.length === 1 ? "" : "s"}</summary><div class="evaluation-history-list">${history
    .map((ev) => {
      const criteria = ev.criteriaSnapshot || [];
      const answers = criteria
        .filter((c) => ev.answers && ev.answers[c.id] != null)
        .map(
          (c) =>
            `<div class="history-answer"><span>${esc(c.label)}</span><b class="answer-pill ${answerClass(ev.answers[c.id])}">${esc(normalizeAnswer(ev.answers[c.id], c))}</b>${ev.answerComments?.[c.id] ? `<small>${esc(ev.answerComments[c.id])}</small>` : ""}</div>`,
        )
        .join("");
      const final =
        finalCallStatusOptions.find((x) => x[0] === ev.finalStatus)?.[1] ||
        ev.finalStatus ||
        ev.decision ||
        "—";
      const donor =
        ev.alreadyDonor === true || ev.alreadyDonor === "OUI"
          ? "Oui"
          : ev.alreadyDonor === false || ev.alreadyDonor === "NON"
            ? "Non"
            : "—";
      const resultSummary =
        stage === "internal2" &&
        (ev.analysisPoleQualite || ev.promiseStatus || ev.donConformity)
          ? `<div>Promesse : <strong>${esc(promiseStatusLabel(ev.promiseStatus || ev.finalStatus || ev.decision))}</strong> · ${esc(donorConformityLabel(ev.donConformity || ev.donStatus || ev.conformity))}</div>${ev.analysisPoleQualite ? `<p><b>ANALYSE POLE QUALITE :</b> ${esc(ev.analysisPoleQualite)}</p>` : ""}`
          : stage === "internal2"
            ? `<div>Ancienne réévaluation : DON <strong>${esc(ev.donStatus || ev.conformity || "—")}</strong> · Décision <strong>${esc(final)}</strong></div>`
            : stage === "internal1"
              ? `<div>DON : <strong>${esc(ev.donStatus || ev.conformity || "—")}</strong> · Statut final : <strong>${esc(final)}</strong></div>`
              : (stage === "client1" || stage === "clientFinal") &&
                  ev.call1Status
                ? `<div>Statut Call 1 : <strong>${esc(ev.call1Status)}</strong> · Statut final : <strong>${esc(ev.finalStatus || ev.decision || "—")}</strong> · Déjà donateur : <strong>${donor}</strong></div>`
                : stage === "client1" || stage === "clientFinal"
                  ? `<div>Ancienne réponse client conservée.</div>`
                  : `<div>Décision : <strong>${esc(ev.decision || ev.status || "—")}</strong></div>`;
      return `<details class="evaluation-history-version"><summary>Version ${ev.version || 1} · ${formatDate(ev.date || ev.archivedAt, { time: true })} · ${scoreFormat(ev.score)}</summary><div class="history-version-body"><div>Auteur / évaluateur : <strong>${esc(ev.evaluator || ev.user || "—")}</strong></div>${resultSummary}${answers ? `<div class="history-answer-list">${answers}</div>` : ""}${ev.remark || ev.comments ? `<p><b>Remarque :</b> ${esc(ev.remark || ev.comments)}</p>` : ""}${ev.observations ? `<p><b>Observations :</b> ${esc(ev.observations)}</p>` : ""}</div></details>`;
    })
    .join("")}</div></details>`;
}
function renderFinalReturn(r) {
  const history = [...finalReturnHistory(r)].sort(
    (a, b) =>
      Number(a.version || 0) - Number(b.version || 0) ||
      String(a.date || "").localeCompare(String(b.date || "")),
  );
  const legacy =
    !history.length && r.clientFinal
      ? `<article class="client-return-entry"><div class="client-return-entry-head"><div><strong>Retour final historique</strong><small>${formatDate(r.clientFinal.date, { time: true })} · ${esc(r.clientFinal.user || "—")}</small></div>${badge(finalReturnStatusLabel(r.clientFinal.status || r.clientFinal.decision), "gray")}</div><p class="client-return-remarks">Cette réponse ancienne est conservée telle qu’elle était enregistrée.</p></article>`
      : "";
  const entries = history
    .slice()
    .reverse()
    .map(
      (entry) =>
        `<article class="client-return-entry"><div class="client-return-entry-head"><div><strong>Retour final · version ${Number(entry.version) || 1}</strong><small>${formatDate(entry.date, { time: true })} · ${esc(entry.recordedBy || "Sarah Ben Salem")}</small></div>${badge(finalReturnStatusLabel(entry.status || entry.decision), finalReturnStatusCode(entry.status || entry.decision) === "VALIDE" ? "green" : "red")}</div><div class="client-return-entry-facts">${fact("Décision finale", finalReturnStatusLabel(entry.status || entry.decision))}${fact("Enregistré par", entry.recordedBy || "Sarah Ben Salem")}</div></article>`,
    )
    .join("");
  return `<div class="client-returns-panel"><div class="client-returns-intro"><div><strong>${history.length ? `${history.length} réponse${history.length === 1 ? "" : "s"} finale${history.length === 1 ? "" : "s"} conservée${history.length === 1 ? "" : "s"}` : "Aucun retour final enregistré"}</strong><p>La décision est ajoutée à l’archive de cette fiche. Une nouvelle réponse crée une version sans écraser la précédente.</p></div><button class="btn btn-primary btn-small" data-action="open-final-return-modal" data-record-id="${esc(r.id)}">${ic("plus")} ${history.length ? "Nouvelle réponse finale" : "Saisir le retour final"}</button></div>${entries || legacy ? `<div class="client-return-list">${entries}${legacy}</div>` : `<div class="empty-state"><div class="empty-icon">${ic("message")}</div><strong>La fiche est prête pour le retour final</strong><p>Choisissez Valide ou Non valide; la réponse et son libellé seront conservés dans cette fiche.</p></div>`}</div>`;
}
function openFinalReturnModal(recordId) {
  const r = getRecord(recordId);
  if (!r) return;
  const current = latestFinalReturn(r);
  const status = finalReturnStatusCode(
    current?.status || current?.decision || "",
  );
  const next =
    Math.max(0, ...finalReturnHistory(r).map((ev) => Number(ev.version) || 0)) +
    1;
  const body = `<input type="hidden" name="recordId" value="${esc(recordId)}"/><div class="eval-context"><div class="eval-context-left">${ic("message")}<span><strong>Indice ${esc(recordIndexValue(r))} · ${esc(r.agent)}</strong><small>Retour final · version ${next}</small></span></div>${badge(`Version ${next}`, "green")}</div><div class="form-grid"><div class="form-field"><label>Retour final *</label><select name="finalReturnStatus" required><option value="">Choisir…</option><option value="VALIDE" ${status === "VALIDE" ? "selected" : ""}>Valide</option><option value="NON_VALIDE" ${status === "NON_VALIDE" ? "selected" : ""}>Non valide</option></select></div></div><div class="notice-inline" style="margin-top:12px">${ic("info")}<span>La réponse sera datée, archivée et associée au libellé « Retour final ».</span></div>`;
  showModal({
    title: "Retour final",
    description: "Enregistrez la décision finale sur cette fiche.",
    body,
    form: "finalReturn",
    submitText: "Enregistrer le retour final",
    note: "Les versions précédentes sont conservées",
  });
}
function saveFinalReturn(form) {
  const fd = new FormData(form);
  const r = getRecord(fd.get("recordId"));
  if (!r) return;
  const status = String(fd.get("finalReturnStatus") || "");
  if (!["VALIDE", "NON_VALIDE"].includes(status)) {
    toast("Choisissez Valide ou Non valide.", "warning");
    return;
  }
  if (useRecordApi()) {
    recordApiCall(
      apiRequest(
        `/quality/api/records/${encodeURIComponent(r.id)}/final-returns`,
        { method: "POST", body: { status } },
      ),
      "Retour final archivé dans la fiche.",
      () => {
        closeModal();
        app.recordId = r.id;
        app.page = "record";
        app.recordTab = "finalReturn";
      },
    );
    return;
  }
  const history = finalReturnHistory(r);
  const entry = {
    id: `final-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    stage: "finalReturn",
    version: Math.max(0, ...history.map((ev) => Number(ev.version) || 0)) + 1,
    status,
    date: currentTime(),
    recordedBy: "Sarah Ben Salem",
  };
  r.finalReturnHistory = [...history, entry];
  r.finalReturn = entry;
  r.status = "retour_final_recu";
  ensureRecordLabel(r, "Retour final", "green");
  syncRecordWorkflowLabels(r);
  addEvent(
    r.id,
    "Retour final enregistré",
    `Version ${entry.version} · ${finalReturnStatusLabel(status)}`,
    entry.recordedBy,
    "Qualiticienne",
  );
  saveState();
  closeModal();
  app.recordId = r.id;
  app.page = "record";
  app.recordTab = "finalReturn";
  render();
  toast("Retour final archivé dans la fiche.");
}
function canCloseRecord(r) {
  return !!(
    r?.internal1 &&
    getClientReturns(r).length &&
    r.internal2 &&
    !returnNeedsSynergyReview(r) &&
    !r.closedAt
  );
}
function emptyCRMState() {
  return {
    records: [],
    batches: [],
    tasks: [],
    agents: [],
    debriefs: [],
    users: [],
    roles: [],
    userRoleAssignments: {},
    criteriaByStage: {
      internal1: [],
      client1: [],
      internal2: [],
      clientFinal: [],
    },
    optionGroups: [],
    labels: [],
    events: [],
    driveFolderId: "",
    driveConnected: false,
  };
}
function showAuthScreen(mode = "login", message = "") {
  const root = document.getElementById("authRoot");
  const shell = document.querySelector(".app-shell");
  if (shell) shell.hidden = true;
  if (!root) return;
  document.body.classList.remove("app-starting");
  document.body.classList.add("auth-mode");
  root.hidden = false;
  if (mode === "changePassword")
    root.innerHTML = `<section class="auth-card"><div class="auth-brand"><span class="brand-mark"><span>Q</span><i></i></span><div><strong>QUALI<span>CONTACT</span></strong><small>BASE LOCALE · POSTGRESQL</small></div></div><h1>Créer votre mot de passe</h1><p>Le mot de passe provisoire doit être remplacé avant d’accéder au CRM.</p>${message ? `<div class="auth-error">${esc(message)}</div>` : ""}<form data-form="authChangePassword"><label>Nouveau mot de passe<input name="password" type="password" minlength="12" autocomplete="new-password" required/></label><small>12 caractères minimum. Le mot de passe est haché côté serveur.</small><button class="btn btn-primary btn-full" type="submit">Enregistrer le mot de passe</button></form><button class="auth-link" type="button" data-action="auth-logout">Se déconnecter</button></section>`;
  else if (mode === "error")
    root.innerHTML = `<section class="auth-card"><div class="auth-brand"><span class="brand-mark"><span>Q</span><i></i></span><div><strong>QUALI<span>CONTACT</span></strong><small>BASE LOCALE · POSTGRESQL</small></div></div><h1>Service local indisponible</h1><p>${esc(message || "Impossible de joindre le serveur local.")}</p><div class="notice-inline"><span>Les données ne sont pas basculées vers le stockage navigateur en cas d’erreur serveur.</span></div><button class="btn btn-primary btn-full" type="button" data-action="auth-retry">Réessayer</button></section>`;
  else if (mode === "loading")
    root.innerHTML = `<section class="auth-card auth-loading"><div class="brand-mark"><span>Q</span><i></i></div><h1>Connexion au CRM local…</h1><p>Vérification de la session et des droits.</p></section>`;
  else
    root.innerHTML = `<section class="auth-card"><div class="auth-brand"><span class="brand-mark"><span>Q</span><i></i></span><div><strong>QUALI<span>CONTACT</span></strong><small>BASE LOCALE · POSTGRESQL + MINIO</small></div></div><h1>Connexion</h1><p>Connectez-vous avec votre compte QualiContact.</p>${message ? `<div class="auth-error">${esc(message)}</div>` : ""}<form data-form="authLogin"><label>Adresse e-mail<input name="email" type="email" autocomplete="username" required/></label><label>Mot de passe<input name="password" type="password" autocomplete="current-password" required/></label><button class="btn btn-primary btn-full" type="submit">Se connecter</button></form><div class="auth-footnote">Authentification locale · les permissions sont contrôlées côté serveur à chaque requête API.</div></section>`;
}
function authPagePermissionCodes(page) {
  return (
    {
      dashboard: ["dashboard", "api_dashboard_read"],
      records: [
        "records_view",
        "records_manage",
        "synergy1",
        "client_returns",
        "reevaluation",
        "final_return",
      ],
      send: ["client_send"],
      debriefs: ["debriefs"],
      agents: ["agents"],
      tasks: ["tasks"],
      portal: ["portal"],
      settings: ["quality_settings", "users_roles", "records_manage"],
      record: [
        "records_view",
        "records_manage",
        "synergy1",
        "client_returns",
        "reevaluation",
        "final_return",
      ],
      agentProfile: ["agents"],
    }[page] || ["dashboard", "api_dashboard_read"]
  );
}
function canOpenPage(page) {
  if (!backend.enabled || !backend.authenticated) return true;
  if (
    backend.clientIds.length &&
    !backend.permissions.has("records_view") &&
    !["portal", "record"].includes(page)
  )
    return false;
  if (page === "dashboard")
    return (
      backend.permissions.has("dashboard") &&
      backend.permissions.has("api_dashboard_read")
    );
  if (page === "record" && app.fromPage === "portal")
    return backend.permissions.has("portal");
  if (page === "settings") return canOpenSettingsTab(app.settingsTab);
  return authPagePermissionCodes(page).some((code) =>
    backend.permissions.has(code),
  );
}
function canManageAgents() {
  return (
    !(backend.enabled && backend.authenticated) ||
    backend.permissions.has("records_manage") ||
    backend.permissions.has("quality_settings")
  );
}
function canOpenSettingsTab(tab) {
  if (!backend.enabled || !backend.authenticated) return true;
  if (tab === "users") return backend.permissions.has("users_roles");
  if (tab === "agents") return canManageAgents();
  return backend.permissions.has("quality_settings");
}
function firstAllowedSettingsTab() {
  return (
    ["templates", "groups", "agents", "labels", "drive", "users"].find(
      canOpenSettingsTab,
    ) || "templates"
  );
}
function replaceStateFromServer(data, version) {
  const currentRoles = Array.isArray(state.roles) ? state.roles : [];
  const currentAssignments = state.userRoleAssignments || {};
  const currentUsers = demoUsers.map((user) => ({ ...user }));
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, emptyCRMState(), data || {});
  state.users = currentUsers;
  state.roles = currentRoles;
  state.userRoleAssignments = currentAssignments;
  state.records = Array.isArray(state.records) ? state.records : [];
  state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
  state.agents = Array.isArray(state.agents) ? state.agents : [];
  state.debriefs = Array.isArray(state.debriefs) ? state.debriefs : [];
  state.labels = Array.isArray(state.labels) ? state.labels : [];
  state.events = Array.isArray(state.events) ? state.events : [];
  backend.stateVersion = Number(version) || 0;
  backend.stateInitialized = backend.stateVersion > 0;
  backend.dashboardStats = null;
  backend.baseState = captureSyncedKeys(state);
}
async function reloadRemoteState() {
  const result = await apiRequest("/quality/api/state");
  if (!result.initialized) {
    backend.stateVersion = 0;
    backend.stateInitialized = false;
    return result;
  }
  replaceStateFromServer(result.data, result.version);
  return result;
}
// KPI du menu « À envoyer au client » : fiches non archivées et non clôturées, comptées par le serveur.
async function refreshSendKpi() {
  if (!useRecordApi() || backend.sendKpiLoading) return;
  backend.sendKpiLoading = true;
  try {
    const result = await apiRequest("/quality/api/records/kpi");
    backend.sendCount = Number(result.toSend) || 0;
    syncSendNavCount();
  } catch (error) {
    console.warn("KPI « À envoyer au client » indisponible", error);
    if (backend.sendCount === undefined) backend.sendCount = 0;
  } finally {
    backend.sendKpiLoading = false;
  }
}
function syncSendNavCount() {
  const sendNav = document.querySelector('[data-nav-count="send"]');
  if (!sendNav) return;
  const count = backend.sendCount || 0;
  sendNav.textContent = String(count);
  sendNav.hidden =
    !count ||
    (backend.enabled &&
      backend.authenticated &&
      !backend.permissions.has("client_send"));
}
async function refreshAgentScores() {
  if (!useRecordApi()) return;
  try {
    app.agentScores =
      (await apiRequest("/quality/api/agents/scores")).scores || {};
    if (app.page === "agents" && !modalRoot.classList.contains("open"))
      render();
  } catch (error) {
    console.warn("Scores des agents indisponibles", error);
  }
}
async function refreshDashboardData() {
  if (
    !backend.enabled ||
    !backend.authenticated ||
    !backend.permissions.has("api_dashboard_read")
  )
    return null;
  const result = await apiRequest("/quality/api/dashboard/summary");
  backend.dashboardStats = result.summary || null;
  return backend.dashboardStats;
}
async function loadAccessDirectory() {
  if (!backend.permissions.has("users_roles")) return;
  const directory = await apiRequest("/quality/api/admin/access");
  state.roles = directory.roles || [];
  state.userRoleAssignments = directory.userRoleAssignments || {};
  const directoryUsers = (directory.users || []).map((user) =>
    normalizeDemoUser({ ...user, role: user.role || "Utilisateur interne" }),
  );
  app.deactivatedUsers = directoryUsers.filter((user) => user.active === false);
  demoUsers.splice(
    0,
    demoUsers.length,
    ...directoryUsers.filter((user) => user.active !== false),
  );
  if (backend.user && !demoUsers.some((user) => user.id === backend.user.id))
    demoUsers.unshift(
      normalizeDemoUser({
        id: backend.user.id,
        name: backend.user.name,
        email: backend.user.email,
        role: "Utilisateur interne",
      }),
    );
  state.users = demoUsers.map((user) => ({ ...user }));
  backend.accessLoaded = true;
}
function installCurrentUserDirectory() {
  if (backend.permissions.has("users_roles")) return;
  const user = backend.user;
  if (!user) return;
  demoUsers.splice(
    0,
    demoUsers.length,
    normalizeDemoUser({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.roles?.[0]?.name || "Utilisateur",
      accountType: user.clientIds?.length ? "client" : "internal",
      clientId: user.clientIds?.[0] || "",
    }),
  );
  state.users = demoUsers.map((item) => ({ ...item }));
  state.roles = (user.roles || []).map((role) => ({
    id: role.id,
    name: role.name,
    description: "",
    scope: role.scope,
    activities: [...backend.permissions],
    system: true,
  }));
  state.userRoleAssignments = Object.fromEntries(
    (user.roles || []).map((role) => [user.id, role.id]),
  );
}
function clearWorkspaceState() {
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, emptyCRMState());
}
async function loadAuthenticatedWorkspace(user) {
  try {
    localStorage.setItem(BACKEND_LOCK_KEY, "1");
  } catch (_) {}
  backend.user = user;
  backend.permissions = new Set(user.permissions || []);
  backend.clientIds = (user.clientIds || []).map(String);
  backend.authenticated = true;
  backend.syncBlocked = false;
  backend.pendingSnapshot = null;
  backend.pendingDownloaded = false;
  if (user.mustChangePassword) {
    showAuthScreen("changePassword");
    return;
  }
  installCurrentUserDirectory();
  if (backend.permissions.has("users_roles")) await loadAccessDirectory();
  const remote = await reloadRemoteState();
  if (remote.initialized) {
    try {
      const pending = JSON.parse(
        sessionStorage.getItem(pendingStorageKey()) || "null",
      );
      if (
        pending?.userId === backend.user?.id &&
        pending?.data &&
        typeof pending.data === "object"
      ) {
        backend.pendingSnapshot = pending.data;
        backend.syncBlocked = true;
      }
    } catch (_) {}
    app.page = canOpenPage("dashboard")
      ? "dashboard"
      : ["records", "tasks", "agents", "debriefs", "portal"].find(
          canOpenPage,
        ) || "dashboard";
    await refreshDashboardData().catch((error) => {
      console.warn("API Dashboard indisponible", error);
      backend.dashboardStats = null;
    });
  } else {
    backend.stateVersion = 0;
    backend.stateInitialized = false;
    Object.assign(state, emptyCRMState());
  }
  const root = document.getElementById("authRoot");
  if (root) root.hidden = true;
  const shell = document.querySelector(".app-shell");
  if (shell) shell.hidden = false;
  document.body.classList.remove("app-starting");
  document.body.classList.add("auth-mode");
  syncCurrentDemoUserHeader();
  render();
}
async function initializeEmptyStateOnServer() {
  if (!backend.permissions.has("users_roles"))
    throw new Error("Seul un administrateur peut initialiser la base CRM.");
  if (
    !confirm(
      "Initialiser QualiContact avec une base CRM vide ? Aucune donnée historique ne sera importée.",
    )
  )
    return;
  await apiRequest("/quality/api/state/initialize-empty", {
    method: "POST",
    body: {},
  });
  await reloadRemoteState();
  await refreshDashboardData().catch(() => {});
  render();
  toast("Base CRM vide initialisée. Vous pouvez commencer à créer les fiches.");
}
async function initializeBackendAuth() {
  let backendPreviouslyConfigured = false;
  try {
    backendPreviouslyConfigured =
      localStorage.getItem(BACKEND_LOCK_KEY) === "1";
  } catch (_) {}
  if (typeof window.fetch !== "function") {
    if (backendPreviouslyConfigured) {
      backend.enabled = true;
      clearWorkspaceState();
      showAuthScreen(
        "error",
        "Le serveur local est requis pour afficher les données de ce CRM.",
      );
      return;
    }
    document.body.classList.remove("app-starting");
    render();
    return;
  }
  showAuthScreen("loading");
  try {
    const response = await window.fetch("/quality/api/auth/status", {
      credentials: "same-origin",
    });
    const type = response.headers?.get?.("content-type") || "";
    if (response.status === 404 || !type.includes("application/json")) {
      if (backendPreviouslyConfigured) {
        backend.enabled = true;
        clearWorkspaceState();
        showAuthScreen(
          "error",
          "Le serveur DB local est indisponible. Les données navigateur restent masquées.",
        );
        return;
      }
      document.body.classList.remove("app-starting");
      const root = document.getElementById("authRoot");
      if (root) root.hidden = true;
      render();
      return;
    }
    if (!response.ok)
      throw new Error(
        "Le serveur DB local ne répond pas. Vérifiez le service et sa configuration.",
      );
    const status = await response.json();
    backend.minioConfigured = !!status.minioConfigured;
    if (!status.authRequired) {
      if (backendPreviouslyConfigured) {
        backend.enabled = true;
        clearWorkspaceState();
        showAuthScreen(
          "error",
          "Le service d’authentification local est indisponible. Les données navigateur restent masquées.",
        );
        return;
      }
      document.body.classList.remove("app-starting");
      const root = document.getElementById("authRoot");
      if (root) root.hidden = true;
      render();
      return;
    }
    backend.enabled = true;
    try {
      localStorage.setItem(BACKEND_LOCK_KEY, "1");
    } catch (_) {}
    document.body.classList.add("auth-mode");
    document.body.classList.remove("app-starting");
    const csrf = await apiRequest("/quality/api/auth/csrf");
    backend.csrfToken = csrf.csrfToken || "";
    try {
      const session = await apiRequest("/quality/api/auth/me");
      await loadAuthenticatedWorkspace(session.user);
    } catch (error) {
      if (error.status === 401) {
        showAuthScreen("login");
        return;
      }
      throw error;
    }
  } catch (error) {
    if (backend.enabled || backendPreviouslyConfigured) {
      backend.enabled = true;
      clearWorkspaceState();
      showAuthScreen("error", error.message);
    } else {
      document.body.classList.remove("app-starting");
      const root = document.getElementById("authRoot");
      if (root) root.hidden = true;
      render();
    }
  }
}
async function loginToLocalBackend(form) {
  const fd = new FormData(form);
  try {
    const result = await apiRequest("/quality/api/auth/login", {
      method: "POST",
      body: {
        email: String(fd.get("email") || "").trim(),
        password: String(fd.get("password") || ""),
      },
    });
    await loadAuthenticatedWorkspace(result.user);
  } catch (error) {
    showAuthScreen("login", error.message);
  }
}
async function changeLocalPassword(form) {
  const fd = new FormData(form);
  try {
    await apiRequest("/quality/api/auth/change-password", {
      method: "POST",
      body: { password: String(fd.get("password") || "") },
    });
    backend.user = { ...backend.user, mustChangePassword: false };
    await loadAuthenticatedWorkspace(backend.user);
    toast("Mot de passe mis à jour.");
  } catch (error) {
    showAuthScreen("changePassword", error.message);
  }
}
async function logoutLocalBackend() {
  backend.saveEpoch++;
  try {
    if (backend.authenticated)
      await apiRequest("/quality/api/auth/logout", {
        method: "POST",
        body: {},
      });
  } catch (error) {
    console.warn("Déconnexion API :", error.message);
  }
  backend.authenticated = false;
  backend.user = null;
  backend.permissions = new Set();
  backend.clientIds = [];
  backend.stateVersion = 0;
  backend.stateInitialized = false;
  backend.dashboardStats = null;
  backend.accessLoaded = false;
  backend.syncBlocked = false;
  backend.pendingSnapshot = null;
  backend.pendingDownloaded = false;
  clearWorkspaceState();
  showAuthScreen("login");
}
function renderStorageSetup() {
  const admin = backend.permissions.has("users_roles");
  return `${pageHeading("Initialisation DB local", "La base CRM est vide. Cette installation commence sans importer de données historiques.", "", "STOCKAGE LOCAL")}<section class="panel storage-setup-panel"><div class="panel-body"><span class="empty-icon">${ic("shield")}</span><h2>Démarrer avec une base vide</h2><p>Initialisez l’espace QualiContact sans fiches, retours ni historiques préchargés. Les audios ajoutés ensuite seront stockés dans S3 Bucket local.</p>${admin ? `<div class="storage-setup-actions"><button class="btn btn-primary" data-action="init-empty-state">Initialiser une base CRM vide</button></div><small>Les utilisateurs, les rôles et les permissions sont déjà gérés séparément côté serveur.</small>` : '<div class="notice-inline"><span>Un administrateur doit initialiser la base CRM avant votre première utilisation.</span></div>'}</div></section>`;
}
function render() {
  if (["batches", "feedback", "reevaluation"].includes(app.page))
    app.page = "records";
  if (backend.enabled && backend.authenticated && backend.stateVersion === 0) {
    document.getElementById("breadcrumbCurrent").textContent =
      "Initialisation DB";
    document.querySelectorAll(".nav-link").forEach((el) => {
      el.hidden = true;
      el.classList.remove("active");
    });
    mainContent.innerHTML = renderStorageSetup();
    syncCurrentDemoUserHeader();
    return;
  }
  if (backend.enabled && backend.authenticated && !canOpenPage(app.page)) {
    app.page =
      [
        "dashboard",
        "records",
        "tasks",
        "agents",
        "debriefs",
        "portal",
        "settings",
      ].find(canOpenPage) || "dashboard";
  }
  if (
    backend.enabled &&
    backend.authenticated &&
    app.page === "settings" &&
    !canOpenSettingsTab(app.settingsTab)
  )
    app.settingsTab = firstAllowedSettingsTab();
  const title = pageTitles[app.page] || pageTitles.dashboard;
  document.getElementById("breadcrumbCurrent").textContent = title;
  document.querySelectorAll(".nav-link").forEach((el) => {
    const allowed =
      !backend.enabled ||
      !backend.authenticated ||
      canOpenPage(el.dataset.page);
    el.hidden = !allowed;
    el.classList.toggle(
      "active",
      allowed &&
        (el.dataset.page === app.page ||
          (app.page === "record" &&
            el.dataset.page ===
              (app.fromPage === "portal" ? "portal" : "records")) ||
          (app.page === "agentProfile" && el.dataset.page === "agents")),
    );
  });
  if (app.page === "dashboard") mainContent.innerHTML = renderDashboard();
  else if (app.page === "records") mainContent.innerHTML = renderRecords();
  else if (app.page === "send") mainContent.innerHTML = renderSend();
  else if (app.page === "tasks") mainContent.innerHTML = renderTasks();
  else if (app.page === "debriefs") mainContent.innerHTML = renderDebriefs();
  else if (app.page === "agents") mainContent.innerHTML = renderAgents();
  else if (app.page === "agentProfile")
    mainContent.innerHTML = renderAgentProfile();
  else if (app.page === "portal") mainContent.innerHTML = renderPortal();
  else if (app.page === "settings") mainContent.innerHTML = renderSettings();
  else if (app.page === "record") mainContent.innerHTML = renderRecord();
  else mainContent.innerHTML = renderDashboard();
  if (
    backend.enabled &&
    backend.authenticated &&
    backend.syncBlocked &&
    backend.pendingSnapshot
  )
    mainContent.insertAdjacentHTML(
      "afterbegin",
      `<div class="notice-inline sync-conflict-banner"><span><strong>Modifications en attente</strong><br>DB a refusé la dernière sauvegarde (conflit de version ou droits modifiés). Vos changements restent en mémoire; téléchargez une copie de récupération avant de recharger les données serveur.</span><button class="btn btn-secondary btn-small" data-action="download-pending-changes">Télécharger la copie</button><button class="btn btn-primary btn-small" data-action="reload-server-state">Recharger DB</button></div>`,
    );
  if (backend.enabled && backend.authenticated) {
    document.querySelectorAll("[data-page]").forEach((el) => {
      if (el.closest(".main-content"))
        el.hidden = !canOpenPage(el.dataset.page);
    });
    document
      .querySelectorAll("[data-settings-tab]")
      .forEach(
        (el) => (el.hidden = !canOpenSettingsTab(el.dataset.settingsTab)),
      );
    document.querySelectorAll("[data-record-tab]").forEach((el) => {
      const permission = {
        internal1: "synergy1",
        clientReturns: "client_returns",
        internal2: "reevaluation",
        finalReturn: "final_return",
      }[el.dataset.recordTab];
      el.hidden =
        !!permission &&
        !backend.permissions.has(permission) &&
        !backend.permissions.has("records_view");
    });
    document.querySelectorAll("[data-action]").forEach((el) => {
      const permission = permissionForAction(el);
      if (permission && !backend.permissions.has(permission)) el.hidden = true;
    });
  }
  syncSendNavCount();
  if (backend.sendCount === undefined) refreshSendKpi();
  syncCurrentDemoUserHeader();
  bindAudio();
}
function goPage(page) {
  if (["batches", "feedback", "reevaluation"].includes(page)) page = "records";
  if (
    backend.enabled &&
    backend.authenticated &&
    page === "settings" &&
    !canOpenSettingsTab(app.settingsTab)
  )
    app.settingsTab = firstAllowedSettingsTab();
  if (backend.enabled && backend.authenticated && !canOpenPage(page)) {
    toast("Votre rôle ne permet pas d’accéder à cette section.", "warning");
    return;
  }
  if (page !== "record") app.fromPage = page;
  app.page = page;
  if (page === "record" && !app.recordId) app.recordId = state.records[0]?.id;
  closeSidebar();
  if (page === "agents") refreshAgentScores();
  if (page === "send") {
    app.sendQuerySig = "";
    refreshSendKpi();
  }
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (page === "records") {
    app.recordQuerySig = "";
    render();
  }
  if (page === "settings") refreshGridsFromServer();
  if (page === "tasks") refreshTasksFromServer();
  if (page === "debriefs") {
    app.openDebriefId = null;
    refreshDebriefsFromServer();
  }
}
function openRecord(id, tab = "internal1") {
  if (!id || !getRecord(id)) {
    console.warn("Ouverture de fiche impossible : identifiant introuvable", id);
    toast(
      "Cette fiche n’est plus disponible. Actualisez la liste et réessayez.",
      "warning",
    );
    return;
  }
  if (tab === "compare" || tab === "clientFinal") tab = "finalReturn";
  if (tab === "client1") tab = "clientReturns";
  searchResults.classList.remove("open");
  app.fromPage = app.page === "record" ? app.fromPage : app.page;
  app.recordId = id;
  app.recordTab = tab;
  app.page = "record";
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
  refreshRecordDebriefs(id);
}
window.openQualiContactRecord = (event, id, tab = "internal1") => {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  try {
    openRecord(id, tab);
  } catch (error) {
    console.error("Ouverture de fiche impossible", error);
    toast("La fiche n’a pas pu s’ouvrir. Réessayez depuis la liste.", "error");
  }
  return false;
};
function openFinalReturn(id) {
  openRecord(id || app.recordId, "finalReturn");
}
function openComparison(id) {
  openFinalReturn(id);
}
function showModal({
  title,
  description = "",
  body = "",
  form = "none",
  submitText = "Enregistrer",
  wide = false,
  note = "",
  cancelText = "Annuler",
}) {
  modalRoot.innerHTML = `<div class="modal ${wide ? "modal-wide" : ""} modal-${esc(form)}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-header"><div><h2>${title}</h2>${description ? `<p>${description}</p>` : ""}</div><button class="modal-close" type="button" data-action="close-modal" aria-label="Fermer">×</button></div><form data-form="${form}"><div class="modal-body">${body}</div><div class="modal-footer"><span class="footer-note">${note}</span><div style="display:flex;gap:7px"><button class="btn btn-secondary btn-small" type="button" data-action="close-modal">${cancelText}</button>${form !== "none" ? `<button class="btn btn-primary btn-small" type="submit">${submitText}</button>` : ""}</div></div></form></div>`;
  modalRoot.classList.add("open");
  setTimeout(
    () =>
      modalRoot
        .querySelector("input:not([type=hidden]),select,button")
        ?.focus(),
    30,
  );
}
function closeModal() {
  modalRoot.classList.remove("open");
  modalRoot.innerHTML = "";
  backend.temporaryPassword = "";
}
function field(name, label, options = {}) {
  const cls = options.span ? "form-field span-2" : "form-field";
  let input = "";
  if (options.select) {
    input = `<select name="${esc(name)}" ${options.required ? "required" : ""}>${options.select.map((o) => `<option value="${esc(o.value)}" ${o.selected ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`;
  } else if (options.textarea) {
    input = `<textarea name="${esc(name)}" placeholder="${esc(options.placeholder || "")}" ${options.required ? "required" : ""}></textarea>`;
  } else if (options.type === "file") {
    input = `<input type="file" name="${esc(name)}" accept="${esc(options.accept || "*/*")}" ${options.required ? "required" : ""}/>`;
  } else {
    input = `<input name="${esc(name)}" type="${esc(options.type || "text")}" value="${esc(options.value ?? "")}" placeholder="${esc(options.placeholder || "")}" ${options.required ? "required" : ""} ${options.min ? `min="${esc(options.min)}"` : ""} ${options.max ? `max="${esc(options.max)}"` : ""} ${options.step ? `step="${esc(options.step)}"` : ""} ${options.list ? `list="${esc(options.list)}"` : ""}/>`;
  }
  return `<div class="${cls}"><label>${esc(label)}${options.required ? " *" : ""}</label>${input}${options.hint ? `<span class="field-hint">${esc(options.hint)}</span>` : ""}</div>`;
}
function parseCallAudioName(filename) {
  const stem = String(filename || "").replace(/\.[^.]+$/, "");
  const parts = stem.split("#");
  if (parts.length < 8) return { valid: false, filename, parts };
  const rawAgent = (parts[1] || "").trim();
  let agentCivility = "";
  let agentPart = rawAgent;
  const civilityMatch = agentPart.match(/\s+(F|M|MME|MLLE|MADAME|MONSIEUR)$/i);
  if (civilityMatch) {
    agentCivility = civilityMatch[1].toUpperCase();
    agentPart = agentPart.slice(0, civilityMatch.index).trim();
  }
  const agentPrefix = agentPart.match(/^(\d+)\s*(.*)$/);
  const employeeCode = agentPrefix?.[1] || "";
  const agentName = (agentPrefix?.[2] || agentPart).trim();
  const dateRaw = (parts[2] || "").trim();
  const dateCandidate = /^\d{8}$/.test(dateRaw)
    ? `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`
    : "";
  const dateObj = dateCandidate ? new Date(`${dateCandidate}T00:00:00Z`) : null;
  const callDate =
    dateObj &&
    Number.isFinite(dateObj.getTime()) &&
    dateObj.toISOString().slice(0, 10) === dateCandidate
      ? dateCandidate
      : "";
  const timeRaw = (parts[3] || "").trim();
  const timeCandidate = /^\d{6}$/.test(timeRaw)
    ? `${timeRaw.slice(0, 2)}:${timeRaw.slice(2, 4)}:${timeRaw.slice(4, 6)}`
    : /^\d{4}$/.test(timeRaw)
      ? `${timeRaw.slice(0, 2)}:${timeRaw.slice(2, 4)}`
      : "";
  const timeParts = timeCandidate.split(":").map(Number);
  const callTime =
    timeCandidate &&
    timeParts[0] < 24 &&
    timeParts[1] < 60 &&
    (timeParts[2] === undefined || timeParts[2] < 60)
      ? timeCandidate
      : "";
  const baseName = (parts[7] || "").trim();
  const campaignCode = (baseName.match(/^([A-Z]+)/i) || [])[1] || "";
  const extension = (parts[0] || "").trim();
  const warnings = [];
  if (!extension) warnings.push("N° de poste non reconnu");
  if (!agentName) warnings.push("Agent non reconnu");
  if (!callDate) warnings.push("Date non reconnue");
  if (!callTime) warnings.push("Heure non reconnue");
  if (!baseName) warnings.push("Base non reconnue");
  return {
    valid: true,
    recognized: warnings.length === 0,
    warnings,
    filename,
    parts,
    rawSegment1: extension,
    extension,
    rawAgent,
    agentName,
    employeeCode,
    agentCivility,
    callDate,
    callTime,
    recordIndex: (parts[4] || "").trim(),
    rawSegment6: (parts[5] || "").trim(),
    rawSegment7: (parts[6] || "").trim(),
    baseName,
    campaignCode,
    extraParts: parts
      .slice(8)
      .map((value, i) => ({ segment: 9 + i, value: value.trim() })),
  };
}
function updateFilenameParsePreview(file, form) {
  const parsed = parseCallAudioName(file?.name || "");
  const preview = form.querySelector("#filenameParsePreview");
  if (!preview) return;
  if (parsed.valid) {
    const set = (name, value) => {
      const el = form.elements.namedItem(name);
      if (el) el.value = value ?? "";
    };
    set("campaign", parsed.campaignCode);
    set("campaignCode", parsed.campaignCode);
    set(
      "agentName",
      agentChoiceFromFilename(parsed.agentName, parsed.employeeCode),
    );
    set("employeeCode", parsed.employeeCode);
    set(
      "agentCivility",
      {
        F: "F",
        M: "M",
        MME: "Mme",
        MLLE: "Mme",
        MADAME: "Mme",
        MONSIEUR: "Mr",
      }[parsed.agentCivility] || "",
    );
    set("callDate", parsed.callDate);
    set("callTime", parsed.callTime);
    set("recordIndex", parsed.recordIndex);
    set("baseName", parsed.baseName);
    set("extension", parsed.extension);
    set("rawSegment1", parsed.rawSegment1);
    set("rawSegment6", parsed.rawSegment6);
    set("rawSegment7", parsed.rawSegment7);
    if (!parsed.callDate) form.elements.namedItem("callDate").value = "";
    if (!parsed.callTime) form.elements.namedItem("callTime").value = "";
    const raw = form.elements.namedItem("filenameParts");
    if (raw) raw.value = JSON.stringify(parsed.parts);
    const extras = parsed.extraParts
      .map(
        (x) =>
          `<span class="parse-extra">Segment ${x.segment} : <b>${x.value ? esc(x.value) : "(vide)"}</b></span>`,
      )
      .join("");
    preview.className = `filename-parse parsed${parsed.recognized ? "" : " unparsed-warning"}`;
    preview.innerHTML = `<div class="filename-parse-head">${ic(parsed.recognized ? "circle-check" : "info")}<strong>${parsed.recognized ? "Informations détectées depuis le nom du fichier" : "Format partiellement reconnu — vérification requise"}</strong><small>${esc(file.name)}</small></div><div class="filename-parse-grid"><span>Agent <b>${esc(parsed.agentName || "À compléter")}</b></span><span>Matricule candidat <b>${esc(parsed.employeeCode || "—")}</b></span><span>Civilité <b>${esc(parsed.agentCivility || "—")}</b></span><span>Date / heure <b>${esc(parsed.callDate || "—")} · ${esc(parsed.callTime || "—")}</b></span><span>Indice <b>${esc(parsed.recordIndex || "—")}</b></span><span>Base / campagne <b>${esc(parsed.baseName || "—")} / ${esc(parsed.campaignCode || "—")}</b></span><span>N° de poste <b>${esc(parsed.extension || "—")}</b></span><span>Segment 6 brut <b>${esc(parsed.rawSegment6 || "—")}</b></span><span>Segment 7 brut <b>${esc(parsed.rawSegment7 || "—")}</b></span></div>${parsed.warnings.length ? `<div class="filename-parse-warnings">À corriger : ${parsed.warnings.map(esc).join(" · ")}</div>` : ""}${extras ? `<div class="filename-parse-extra"><span>Segments supplémentaires conservés sans interprétation (aucune signification supposée) :</span>${extras}</div>` : ""}<div class="filename-parse-foot">Vérifiez les champs préremplis avant de créer la fiche. Le préfixe numérique du nom d’agent est proposé comme matricule, mais reste modifiable.</div>`;
  } else {
    [
      "campaign",
      "campaignCode",
      "agentName",
      "employeeCode",
      "agentCivility",
      "callDate",
      "callTime",
      "recordIndex",
      "baseName",
      "extension",
      "rawSegment1",
      "rawSegment6",
      "rawSegment7",
    ].forEach((name) => {
      const el = form.elements.namedItem(name);
      if (el) el.value = "";
    });
    const raw = form.elements.namedItem("filenameParts");
    if (raw) raw.value = JSON.stringify(parsed.parts || []);
    preview.className = "filename-parse unparsed";
    preview.innerHTML = `${ic("info")}<span><strong>Convention non reconnue.</strong> Le nom doit contenir des segments séparés par « # ». Les champs restent modifiables ; aucun segment n’est interprété automatiquement.</span>`;
  }
  preview.hidden = false;
  const durationField = form.elements.namedItem("duration");
  try {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      if (
        durationField &&
        (!durationField.value || durationField.value === "00:00")
      )
        durationField.value = secondsToClock(audio.duration);
      URL.revokeObjectURL(url);
    };
    audio.onerror = () => URL.revokeObjectURL(url);
    audio.src = url;
  } catch (_) {}
}
function updateDebriefFilenameFields(file, form) {
  let previous = {};
  try {
    previous = JSON.parse(form.dataset.debriefFilenameAutofill || "{}");
  } catch (_) {}
  Object.entries(previous).forEach(([name, entry]) => {
    const input = form.elements.namedItem(name);
    if (input && String(input.value) === String(entry.applied))
      input.value = entry.before;
  });
  form.dataset.debriefFilenameAutofill = "{}";
  const parsed = parseCallAudioName(file?.name || "");
  const rawParts = form.elements.namedItem("debriefFilenameParts");
  if (rawParts) rawParts.value = JSON.stringify(parsed.parts || []);
  if (!file || !parsed.valid) return;
  const changes = {};
  const apply = (name, value) => {
    if (value == null || String(value) === "") return;
    const input = form.elements.namedItem(name);
    if (!input) return;
    changes[name] = {
      before: String(input.value ?? ""),
      applied: String(value),
    };
    input.value = String(value);
  };
  const normalizeName = (value) =>
    String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const digits = (value) => String(value || "").replace(/\D/g, "");
  const matchedAgent = state.agents.find(
    (agent) =>
      (parsed.employeeCode &&
        digits(agent.id) === digits(parsed.employeeCode)) ||
      (parsed.agentName &&
        normalizeName(agent.name) === normalizeName(parsed.agentName)),
  );
  apply("agentName", parsed.agentName);
  apply("debriefFilenameAgent", parsed.agentName);
  if (parsed.agentName || parsed.employeeCode) {
    const agentIdInput = form.elements.namedItem("agentId");
    if (agentIdInput) {
      changes.agentId = {
        before: String(agentIdInput.value ?? ""),
        applied: String(matchedAgent?.id || ""),
      };
      agentIdInput.value = matchedAgent?.id || "";
    }
  }
  if (parsed.callDate) apply("date", parsed.callDate);
  apply("debriefFilenameEmployeeCode", parsed.employeeCode);
  apply("debriefFilenameCivility", parsed.agentCivility);
  apply("debriefSessionTime", parsed.callTime);
  apply("debriefExtension", parsed.extension);
  apply("debriefSourceIndex", parsed.recordIndex);
  apply("debriefBaseName", parsed.baseName);
  apply("debriefCampaignCode", parsed.campaignCode);
  apply("debriefProspectNumber", parsed.rawSegment7);
  form.dataset.debriefFilenameAutofill = JSON.stringify(changes);
}
async function openNewRecord() {
  let assignable = [];
  try {
    assignable = await loadAssignableUsers();
  } catch (error) {
    app.assignableUsers = [];
    toast(
      "Liste des qualiticiens indisponible : la fiche sera créée sans affectation.",
      "warning",
    );
  }
  const campaigns = [
    "Dons particuliers",
    "Fidélisation",
    "Collecte ponctuelle",
  ];
  const firstAgent = state.agents[0];
  const clients = demoClientOptions();
  const selectedClientId =
    backend.clientIds[0] || clients[0]?.id || "client-qc";
  const body = `<div class="upload-drop">${ic("upload")}<strong>Sélectionner un fichier audio</strong><span>MP3, WAV, M4A, OGG et autres formats audio courants · les champs de fiche sont lus dans le nom séparé par #</span><input id="newAudioFile" type="file" name="audioFile" accept="audio/*,.mp3,.wav,.m4a,.ogg,.aac,.flac" required/></div><input type="hidden" name="filenameParts" value="[]"/><div id="filenameParsePreview" class="filename-parse" hidden></div><div class="form-grid" style="margin-top:14px">${field("clientId", "Client *", { select: clients.map((client) => ({ value: client.id, label: client.name, selected: client.id === selectedClientId })), required: true })}<div class="form-field"><label>Campagne *</label><input name="campaign" list="campaignOptions" value="${esc(firstAgent ? "Dons particuliers" : "")}" required/><datalist id="campaignOptions">${campaigns.map((c) => `<option value="${esc(c)}"></option>`).join("")}<option value="LRO"></option></datalist></div><div class="form-field"><label>Agent *</label><input name="agentName" list="agentOptions" placeholder="Tapez pour rechercher un agent ou saisissez un nom" autocomplete="off" required/><datalist id="agentOptions">${agentChoiceOptions()}</datalist><span class="field-hint">Choisissez un agent de la liste, ou saisissez un nom libre.</span></div>${field("responsibleId", "Qualiticien", { select: assigneeSelectOptions(assignable, "", "", true), required: true, hint: "Obligatoire. Un qualiticien ne voit que les fiches qui lui sont affectées; seuls l’administrateur et le responsable qualité pourront le modifier ensuite." })}${field("employeeCode", "Matricule candidat", { placeholder: "Lu depuis le nom de fichier" })}${field("agentCivility", "Civilité", { select: ["M", "F", "Mme", "Mr"].map((v) => ({ value: v, label: v })) })}${field("callDate", "Date de l’appel", { type: "date", value: TODAY, required: true })}${field("callTime", "Heure de l’appel", { type: "time", step: "1", value: "10:30:00", required: true })}${field("recordIndex", "Indice", { placeholder: "Ex. 798", hint: "Index de recherche extrait du nom de fichier" })}${field("baseName", "Nom de la base", { placeholder: "Ex. LRO6076P" })}${field("campaignCode", "Code campagne", { placeholder: "Ex. LRO" })}${field("rawSegment6", "Segment 6 brut", { placeholder: "Segment conservé, non interprété" })}${field("rawSegment7", "Segment 7 brut", { placeholder: "Segment conservé, non interprété" })}${field("duration", "Durée audio", { type: "text", placeholder: "Renseignée depuis les métadonnées audio" })}${field("extension", "N° de poste", { placeholder: "À compléter si nécessaire" })}</div><div class="notice-inline" style="margin-top:13px">${ic("info")}<span><strong>${backend.enabled ? "Stockage local :" : "Démo locale :"}</strong> ${backend.enabled ? "le fichier audio sera téléversé dans S3 Bucket via le serveur local; DB ne conserve que les métadonnées." : "le lecteur utilise le fichier choisi dans cette session."}</span></div>`;
  showModal({
    title: "Nouvel enregistrement",
    description:
      "L’audio préremplit automatiquement les informations identifiables dans son nom.",
    body,
    form: "newRecord",
    submitText: "Créer la fiche",
    wide: true,
    note: backend.enabled
      ? "Audio stocké sur S3 Bucket local"
      : "Audio de démonstration local",
  });
}
async function openTaskModal(recordId = "") {
  let assignable = [];
  try {
    assignable = await loadAssignableUsers();
  } catch (error) {
    app.assignableUsers = [];
    toast(
      "Liste des utilisateurs indisponible : la tâche sera à assigner.",
      "warning",
    );
  }
  const preselectedRecord = getRecord(recordId);
  const recordOptions = [
    { value: "", label: "Aucun indice associé" },
    ...state.records
      .filter((r) => !r.archived)
      .map((r) => ({
        value: r.id,
        label: `Indice ${recordIndexValue(r)} · ${r.agent}`,
        selected: r.id === recordId,
      })),
  ];
  const types = TASK_TYPES;
  const body = `<div class="form-grid">${field("title", "Intitulé", { placeholder: "Décrire l’action à réaliser", required: true, span: true })}${field("type", "Type de tâche", { select: types.map((x, i) => ({ value: x[0], label: x[1], selected: (recordId && x[0] === "REEVALUATION_2") || (!recordId && i === 0) })), required: true })}${field("recordId", "Indice associé", { select: recordOptions })}${field("assignedTo", "Utilisateur assigné", { select: taskAssigneeOptions(assignable, preselectedRecord?.responsibleId || "", preselectedRecord?.responsible || "") })}${field("dueDate", "Échéance", { type: "date", value: TODAY, required: true })}${field(
    "priority",
    "Priorité",
    {
      select: [
        { value: "BASSE", label: "Basse" },
        { value: "NORMALE", label: "Normale", selected: true },
        { value: "HAUTE", label: "Haute" },
        { value: "URGENTE", label: "Urgente" },
      ],
      required: true,
    },
  )}</div>`;
  showModal({
    title: "Nouvelle tâche",
    description: "Assignez une action, une priorité et une échéance.",
    body,
    form: "newTask",
    submitText: "Créer la tâche",
  });
}
function openDebriefModal(recordId = "", agentId = "") {
  const selectedRecord = getRecord(recordId);
  const agents = state.agents;
  const selectedAgent =
    getAgent(agentId) || getAgent(selectedRecord?.employeeCode);
  const initialAgentName = selectedRecord?.agent || selectedAgent?.name || "";
  const pointerAudio = !!(
    selectedRecord?.audio?.objectId || selectedRecord?.audio?.localUrl
  );
  const initialAgentId =
    selectedAgent?.id || selectedRecord?.employeeCode || "";
  const ratingRows = DEBRIEF_RUBRIC.map(
    (item) =>
      `<fieldset class="debrief-score-row"><legend>${esc(item.title)}</legend><p>${esc(item.hint)}</p><div class="debrief-stars" role="radiogroup" aria-label="${esc(item.title)} · note de 1 à 5 étoiles">${[1, 2, 3, 4, 5].map((value) => `<label title="${value} étoile${value > 1 ? "s" : ""}"><input type="radio" name="rating_${esc(item.key)}" value="${value}" required aria-label="${value} sur 5"/><span aria-hidden="true">★</span></label>`).join("")}</div></fieldset>`,
  ).join("");
  const body = `<div class="form-grid debrief-basics">${field("agentName", "Agent", { value: initialAgentName, placeholder: "Prérempli depuis le nom de l’enregistrement", required: true, list: "debriefAgentOptions" })}${field("date", "Date du débrief", { type: "date", value: TODAY, required: true })}${field("owner", "Responsable de la session", { select: demoUsers.filter((u) => assignedRole(u.id)?.activities.includes("debriefs")).map((u) => ({ value: u.name, label: u.name, selected: u.name === "Sarah Ben Salem" })), required: true })}</div><datalist id="debriefAgentOptions">${agents.map((agent) => `<option value="${esc(agent.name)}"></option>`).join("")}</datalist><input type="hidden" name="agentId" value="${esc(initialAgentId)}"/>${pointerAudio ? `<section class="record-card"><div class="record-card-header"><h3>Enregistrement audio</h3><span class="subtle">Fiche ${esc(recordIndexValue(selectedRecord))} · écoutez avant de remplir le débrief</span></div><div class="record-card-body" style="padding:10px">${renderAudioCard(selectedRecord)}</div></section><input type="hidden" name="sourceRecordId" value="${esc(selectedRecord.id)}"/>` : `<div class="form-field debrief-audio-upload"><label for="debriefAudioFile">Enregistrement audio du débrief *</label><input id="debriefAudioFile" type="file" name="debriefAudioFile" accept="audio/*,.mp3,.wav,.m4a,.ogg,.aac,.flac,.opus" required/><span class="field-hint">Obligatoire. Le fichier sera associé à cette session. ${backend.enabled ? "Le binaire sera stocké dans S3 Bucket local; DB ne conservera que ses métadonnées." : "Aucun fichier n’est conservé après fermeture de la session de démonstration."}</span></div><details class="debrief-filename-fields" open><summary>Informations extraites du nom de l’enregistrement · modifiables</summary><p class="debrief-filename-hint">Même découpage que pour une fiche d’appel : les champs reconnus sont préremplis et modifiables. Les autres segments ne sont pas affichés; le nom original reste conservé pour traçabilité.</p><div class="form-grid">${field("debriefFilenameEmployeeCode", "Matricule du fichier", { placeholder: "Préfixe numérique du segment 2" })}${field("debriefFilenameCivility", "Civilité détectée", { placeholder: "F / M / Mme" })}${field("debriefSessionTime", "Heure du débrief", { type: "time", step: "1" })}${field("debriefExtension", "N° de poste · segment 1")}${field("debriefSourceIndex", "Indice source · segment 5")}${field("debriefBaseName", "Nom de base · segment 8")}${field("debriefCampaignCode", "Code campagne déduit de la base")}${field("debriefProspectNumber", "Numéro de prospect · segment 7")}</div></details>`}<input type="hidden" name="debriefFilenameAgent" value=""/><input type="hidden" name="debriefFilenameParts" value="[]"/>${recordId ? `<input type="hidden" name="recordId" value="${esc(recordId)}"/>` : ""}<section class="debrief-rating-panel"><div class="debrief-rating-heading"><div><h3>Évaluation de l’appel</h3><p>Choisissez une note par compétence.</p></div><span>1 = à travailler · 5 = très bien maîtrisé</span></div><div class="debrief-score-list">${ratingRows}</div></section><div class="form-grid debrief-followup"><div class="form-field span-2"><label>Points forts & observations</label><textarea name="note" placeholder="Ex. Accroche claire, script bien maîtrisé, écoute attentive…"></textarea></div>${field("actionTitle", "Action de progression", { placeholder: "Ex. S’entraîner à reformuler la demande" })}${field("actionDue", "Échéance de l’action", { type: "date", value: TODAY })}</div><div class="notice-inline debrief-safety-note">${ic("shield")}<span>Le coaching privilégie l’écoute, le consentement explicite et une clôture respectueuse. L’âge ou la voix ne suffisent pas à évaluer la capacité d’une personne.</span></div>`;
  showModal({
    title: "Créer un débrief agent",
    description:
      "Évaluez les points clés de l’appel avec une note de 1 à 5 étoiles, puis ajoutez une observation ou une action de suivi.",
    body,
    form: "newDebrief",
    submitText: "Enregistrer le débrief",
    wide: true,
    note: "8 compétences · notation par étoiles",
  });
  if (pointerAudio) bindAudio(modalRoot);
}
function openCriterionModal(stage) {
  const body = `<input type="hidden" name="stage" value="${esc(stage)}"/><div class="form-grid">${field("section", "Section du formulaire", { placeholder: "Section à définir", required: true })}${field("label", "Libellé du critère", { placeholder: "Saisir le libellé exact de la grille", required: true, span: true })}${field("description", "Aide / précision", { placeholder: "Texte affiché sous le critère", span: true })}${field(
    "type",
    "Type de réponse",
    {
      select: [
        { value: "ok_x", label: "OK / X + justification", selected: true },
        { value: "conformity", label: "Conforme / Non conforme / N/A" },
        { value: "scale", label: "Échelle (de 1 à N)" },
        { value: "select", label: "Liste déroulante (groupe d’options)" },
        { value: "checkbox", label: "Cases à cocher (groupe d’options)" },
        { value: "text", label: "Texte libre" },
      ],
      required: true,
    },
  )}${field("groupId", "Groupe d’options", { select: [{ value: "", label: "— Aucun —", selected: true }, ...(state.optionGroups || []).map((g) => ({ value: g.id, label: g.name }))], hint: "Obligatoire pour « Liste déroulante » et « Cases à cocher ». Les groupes se créent dans Paramètres › Groupes d’options." })}${field("scaleSize", "Taille de l’échelle", { type: "number", value: "5", min: "2", hint: "Échelle seulement : de 2 à 10 réponses. La réponse 5 sur une échelle de 7 vaut 5/7." })}${field("weight", "Poids du critère", { type: "number", value: "1", min: "-1", required: true, hint: "Poids négatif (-1) = négation : une réponse OK retire un point au score." })}</div><div class="settings-callout">${ic("info")}<span>Saisissez uniquement un critère validé de la grille réelle. Aucun libellé n’est suggéré par l’application.</span></div>`;
  showModal({
    title: `Ajouter à ${stageTitles[stage]}`,
    description:
      "Ce critère sera ajouté au formulaire dynamique de démonstration.",
    body,
    form: "newCriterion",
    submitText: "Ajouter le critère",
  });
}
function openLabelModal() {
  const body = `<div class="form-grid">${field("name", "Nom du libellé", { placeholder: "Ex. À réécouter", required: true })}${field(
    "tone",
    "Couleur",
    {
      select: [
        { value: "blue", label: "Bleu", selected: true },
        { value: "green", label: "Vert" },
        { value: "amber", label: "Ambre" },
        { value: "red", label: "Rouge" },
        { value: "purple", label: "Violet" },
      ],
      required: true,
    },
  )}</div>`;
  showModal({
    title: "Nouveau libellé",
    description:
      "Les libellés complètent le statut sans remplacer le workflow.",
    body,
    form: "newLabel",
    submitText: "Créer le libellé",
  });
}
function openRoleModal(roleId = "") {
  const existing = roleId ? getAccessRole(roleId) : null;
  if (roleId && !existing) return;
  const selected = new Set(existing?.activities || []);
  const idInput = existing
    ? `<input type="hidden" name="roleId" value="${esc(existing.id)}"/>`
    : "";
  const groups = ROLE_ACTIVITY_GROUPS.map(
    (group) =>
      `<fieldset class="role-activity-group"><legend>${esc(group.name)}</legend><div class="role-activity-options">${group.activities.map((activity) => `<label class="role-activity-option"><input type="checkbox" name="activityIds" value="${esc(activity.id)}" ${selected.has(activity.id) ? "checked" : ""}/><span><strong>${esc(activity.label)}</strong><small>${esc(activity.hint)}</small></span></label>`).join("")}</div></fieldset>`,
  ).join("");
  const body = `${idInput}<div class="form-grid role-form-basics">${field("roleName", "Nom du rôle", { value: existing?.name || "", placeholder: "Ex. Superviseur de campagne", required: true })}${field(
    "roleScope",
    "Portée des fiches",
    {
      select: [
        {
          value: "organization",
          label: "Organisation / clients autorisés",
          selected: !existing || existing.scope !== "assigned_client",
        },
        {
          value: "assigned_client",
          label: "Client affecté uniquement",
          selected: existing?.scope === "assigned_client",
        },
      ],
      required: true,
    },
  )}${field("roleDescription", "Description (facultatif)", { value: existing?.description || "", placeholder: "Décrire la mission de ce rôle", span: true })}</div><div class="role-activities-intro"><strong>Activités autorisées</strong><span>Cochez chaque activité à laquelle ce rôle doit accéder.</span></div><div class="role-activity-groups">${groups}</div><div class="notice-inline role-modal-note">${ic("shield")}<span>La portée client n’est pas une permission de voir tous les dossiers : le serveur local filtre les données et contrôle chaque requête API.</span></div>`;
  showModal({
    title: existing
      ? `Modifier le rôle « ${esc(existing.name)} »`
      : "Créer un rôle",
    description:
      "Définissez les activités accessibles et la portée des fiches.",
    body,
    form: "accessRole",
    submitText: existing ? "Enregistrer les accès" : "Créer le rôle",
    wide: true,
    note: "Cochez uniquement les droits nécessaires.",
  });
}
function saveAccessRole(form) {
  const fd = new FormData(form);
  const roleId = String(fd.get("roleId") || "");
  const existing = roleId ? getAccessRole(roleId) : null;
  const name = String(fd.get("roleName") || "").trim();
  const description = String(fd.get("roleDescription") || "").trim();
  const scope = String(fd.get("roleScope") || "");
  const activities = [...new Set(fd.getAll("activityIds").map(String))].filter(
    (id) => ROLE_ACTIVITY_IDS.includes(id),
  );
  if (!name) {
    toast("Saisissez un nom de rôle.", "warning");
    return;
  }
  if (
    (state.roles || []).some(
      (role) =>
        role.id !== roleId &&
        role.name.trim().toLocaleLowerCase("fr") ===
          name.toLocaleLowerCase("fr"),
    )
  ) {
    toast("Un rôle porte déjà ce nom.", "warning");
    return;
  }
  if (!["organization", "assigned_client"].includes(scope)) {
    toast("Choisissez la portée des fiches.", "warning");
    return;
  }
  if (!activities.length) {
    toast("Cochez au moins une activité pour créer ce rôle.", "warning");
    return;
  }
  if (
    scope === "assigned_client" &&
    (!activities.includes("portal") ||
      activities.some(
        (id) => !["portal", "client_returns", "final_return"].includes(id),
      ))
  ) {
    toast(
      "Un rôle client doit inclure le portail et peut uniquement autoriser les retours client ou finaux sur les fiches de son client.",
      "warning",
    );
    return;
  }
  if (backend.enabled && backend.authenticated) {
    const request = existing
      ? apiRequest(
          `/quality/api/admin/roles/${encodeURIComponent(existing.id)}`,
          { method: "PUT", body: { name, description, scope, activities } },
        )
      : apiRequest("/quality/api/admin/roles", {
          method: "POST",
          body: { name, description, scope, activities },
        });
    request
      .then(loadAccessDirectory)
      .then(() => {
        closeModal();
        app.settingsTab = "users";
        app.page = "settings";
        render();
        toast(
          existing ? "Accès du rôle mis à jour dans DB." : "Rôle créé dans DB.",
        );
      })
      .catch((error) => toast(error.message, "error"));
    return;
  }
  if (existing) {
    existing.name = name;
    existing.description = description;
    existing.scope = scope;
    existing.activities = activities;
  } else {
    state.roles.push({
      id: `role-custom-${Date.now()}`,
      name,
      description,
      scope,
      activities,
      system: false,
    });
  }
  saveState();
  closeModal();
  app.settingsTab = "users";
  app.page = "settings";
  render();
  toast(
    existing ? "Accès du rôle mis à jour." : "Rôle créé avec ses activités.",
  );
}
function assignUserRole(userId, roleId) {
  const user = demoUsers.find((item) => item.id === userId);
  const role = getAccessRole(roleId);
  if (!user || !role) {
    toast("Utilisateur ou rôle introuvable.", "warning");
    return;
  }
  if (isClientDemoUser(user) && role.scope !== "assigned_client") {
    toast(
      "Un compte client doit rester limité à son client affecté.",
      "warning",
    );
    render();
    return;
  }
  if (role.scope === "assigned_client" && !user.clientId) {
    toast(
      "Aucun client n’est affecté à ce compte. Modifiez l’utilisateur avant de choisir ce rôle.",
      "warning",
    );
    render();
    return;
  }
  if (backend.enabled && backend.authenticated) {
    apiRequest(`/quality/api/admin/users/${encodeURIComponent(userId)}`, {
      method: "PUT",
      body: {
        name: user.name,
        email: user.email,
        accountType: isClientDemoUser(user) ? "client" : "internal",
        clientId: user.clientId || "",
        roleId,
        active: user.active !== false,
      },
    })
      .then(loadAccessDirectory)
      .then(() => {
        render();
        toast(`Rôle « ${role.name} » attribué dans DB.`);
      })
      .catch((error) => {
        toast(error.message, "error");
        render();
      });
    return;
  }
  state.userRoleAssignments = state.userRoleAssignments || {};
  state.userRoleAssignments[userId] = roleId;
  saveState();
  render();
  toast(`Rôle « ${role.name} » attribué.`);
}
function deleteAccessRole(roleId) {
  const role = getAccessRole(roleId);
  if (!role) return;
  if (role.system) {
    toast("Les rôles système ne peuvent pas être supprimés.", "warning");
    return;
  }
  if (Object.values(state.userRoleAssignments || {}).includes(roleId)) {
    toast(
      "Ce rôle est attribué à un utilisateur. Réattribuez d’abord un autre rôle.",
      "warning",
    );
    return;
  }
  if (!confirm(`Supprimer le rôle « ${role.name} » ?`)) return;
  if (backend.enabled && backend.authenticated) {
    apiRequest(`/quality/api/admin/roles/${encodeURIComponent(roleId)}`, {
      method: "DELETE",
      body: {},
    })
      .then(loadAccessDirectory)
      .then(() => {
        render();
        toast("Rôle supprimé de DB.");
      })
      .catch((error) => toast(error.message, "error"));
    return;
  }
  state.roles = state.roles.filter((item) => item.id !== roleId);
  saveState();
  render();
  toast("Rôle supprimé.");
}
function demoClientOptions() {
  const clients = new Map();
  (state.records || []).forEach((record) => {
    if (record.clientId)
      clients.set(record.clientId, record.client || record.clientId);
  });
  (state.batches || []).forEach((batch) => {
    if (batch.clientId)
      clients.set(batch.clientId, batch.client || batch.clientId);
  });
  if (!clients.size) clients.set("client-qc", "Qualicontact");
  return [...clients.entries()].map(([id, name]) => ({ id, name }));
}
function demoUserRoleOptions(accountType, selectedRoleId = "") {
  const roles = (state.roles || []).filter(
    (role) => accountType !== "client" || role.scope === "assigned_client",
  );
  const validSelection = roles.some((role) => role.id === selectedRoleId);
  const fallbackId =
    accountType === "client" ? "role-client-user" : "role-qualitician";
  const preferredId = validSelection
    ? selectedRoleId
    : roles.some((role) => role.id === fallbackId)
      ? fallbackId
      : roles[0]?.id || "";
  return [
    { value: "", label: "Choisir un rôle", selected: !preferredId },
    ...roles.map((role) => ({
      value: role.id,
      label: role.name,
      selected: role.id === preferredId,
    })),
  ];
}
function openDemoUserModal(userId = "") {
  const existing = userId ? demoUsers.find((user) => user.id === userId) : null;
  if (userId && !existing) return;
  const accountType = existing
    ? isClientDemoUser(existing)
      ? "client"
      : "internal"
    : "internal";
  const isActiveUser = existing?.id === "u-sarah";
  const assignedId = existing ? assignedRoleId(existing.id) : "";
  const roleOptions = demoUserRoleOptions(accountType, assignedId);
  const selectedRole =
    roleOptions.find((option) => option.selected)?.value || "";
  const clients = demoClientOptions();
  const clientId = clients.some((client) => client.id === existing?.clientId)
    ? existing.clientId
    : clients[0]?.id || "";
  const clientRequired =
    accountType === "client" ||
    getAccessRole(selectedRole)?.scope === "assigned_client";
  const clientField = `<div class="form-field user-client-field" data-user-client-field ${clientRequired ? "" : "hidden"}><label for="demoUserClient">Client affecté *</label><select id="demoUserClient" name="clientId" ${clientRequired ? "required" : ""}>${clients.map((client) => `<option value="${esc(client.id)}" ${client.id === clientId ? "selected" : ""}>${esc(client.name)}</option>`).join("")}</select><span class="field-hint">La portée du rôle client est limitée à ce client.</span></div>`;
  const typeOptions = isActiveUser
    ? [{ value: "internal", label: "Compte interne", selected: true }]
    : [
        {
          value: "internal",
          label: "Compte interne",
          selected: accountType === "internal",
        },
        {
          value: "client",
          label: "Compte client",
          selected: accountType === "client",
        },
      ];
  const typeMarkup = `<div class="form-field"><label for="demoUserType">Type de compte *</label><select id="demoUserType" name="accountType" data-user-account-type required>${typeOptions.map((option) => `<option value="${esc(option.value)}" ${option.selected ? "selected" : ""}>${esc(option.label)}</option>`).join("")}</select>${isActiveUser ? '<span class="field-hint">Type verrouillé pour le compte connecté à cette démo.</span>' : ""}</div>`;
  const roleMarkup = `<div class="form-field"><label for="demoUserRole">Rôle attribué *</label><select id="demoUserRole" name="userRoleId" data-user-role-choice required>${roleOptions.map((option) => `<option value="${esc(option.value)}" ${option.selected ? "selected" : ""}>${esc(option.label)}</option>`).join("")}</select></div>`;
  const body = `${existing ? `<input type="hidden" name="userId" value="${esc(existing.id)}"/>` : ""}<div class="form-grid demo-user-form-grid">${field("name", "Nom complet", { value: existing?.name || "", placeholder: "Ex. Amira Ben Salem", required: true })}${field("email", "Adresse e-mail", { type: "email", value: existing?.email || "", placeholder: "nom@entreprise.tn", required: true })}${typeMarkup}${roleMarkup}${clientField}</div><div class="notice-inline demo-user-notice">${ic("info")}<span>${backend.enabled ? "Le compte est créé dans DB. Un mot de passe provisoire unique sera affiché une seule fois et devra être remplacé à la première connexion." : "Compte de démonstration local uniquement; aucune authentification réelle."}</span></div>`;
  showModal({
    title: existing
      ? `Modifier l’utilisateur « ${esc(existing.name)} »`
      : "Ajouter un utilisateur",
    description: "Renseignez le profil et les droits de démonstration.",
    body,
    form: "demoUser",
    submitText: existing
      ? "Enregistrer les changements"
      : "Ajouter l’utilisateur",
    wide: false,
    note: "Profil de démonstration",
  });
}
function updateDemoUserForm(form) {
  if (!form) return;
  const accountType = String(
    form.elements.namedItem("accountType")?.value || "internal",
  );
  const roleSelect = form.elements.namedItem("userRoleId");
  if (!roleSelect) return;
  const currentRoleId = String(roleSelect.value || "");
  const options = demoUserRoleOptions(accountType, currentRoleId);
  roleSelect.innerHTML = options
    .map(
      (option) =>
        `<option value="${esc(option.value)}" ${option.selected ? "selected" : ""}>${esc(option.label)}</option>`,
    )
    .join("");
  const clientRequired =
    accountType === "client" ||
    getAccessRole(roleSelect.value)?.scope === "assigned_client";
  const clientField = form.querySelector("[data-user-client-field]");
  const clientSelect = form.elements.namedItem("clientId");
  if (clientField) clientField.hidden = !clientRequired;
  if (clientSelect) clientSelect.required = clientRequired;
}
function showTemporaryPassword(user, password) {
  backend.temporaryPassword = String(password);
  const body = `<div class="temporary-password-panel"><p>Le compte <strong>${esc(user?.email || "")}</strong> a été créé. Copiez ce mot de passe provisoire maintenant; il ne sera pas conservé ni réaffiché.</p><code>${esc(password)}</code><button type="button" class="btn btn-secondary btn-small" data-action="copy-temporary-password">Copier le mot de passe</button><small>L’utilisateur devra choisir un nouveau mot de passe à sa première connexion.</small></div>`;
  showModal({
    title: "Compte local créé",
    description: "Identifiants temporaires affichés une seule fois.",
    body,
    form: "none",
    submitText: "Fermer",
  });
}
function saveDemoUser(form) {
  const fd = new FormData(form);
  const userId = String(fd.get("userId") || "");
  const existing = userId ? demoUsers.find((user) => user.id === userId) : null;
  if (userId && !existing) {
    toast(
      "Utilisateur introuvable. Actualisez la liste et réessayez.",
      "warning",
    );
    return;
  }
  const name = String(fd.get("name") || "").trim();
  const email = String(fd.get("email") || "")
    .trim()
    .toLowerCase();
  const accountType = String(fd.get("accountType") || "internal");
  const roleId = String(fd.get("userRoleId") || "");
  const role = getAccessRole(roleId);
  const clientId = String(fd.get("clientId") || "");
  if (!name) {
    toast("Saisissez le nom complet de l’utilisateur.", "warning");
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    toast("Saisissez une adresse e-mail valide.", "warning");
    return;
  }
  if (!["internal", "client"].includes(accountType)) {
    toast("Choisissez un type de compte valide.", "warning");
    return;
  }
  if (
    demoUsers.some(
      (user) =>
        user.id !== userId &&
        String(user.email || "")
          .trim()
          .toLowerCase() === email,
    )
  ) {
    toast(
      "Cette adresse e-mail est déjà utilisée par un autre utilisateur.",
      "warning",
    );
    return;
  }
  if (existing?.id === "u-sarah" && accountType !== "internal") {
    toast(
      "Le type du compte de démonstration actuellement connecté ne peut pas être changé.",
      "warning",
    );
    return;
  }
  if (!role) {
    toast("Choisissez un rôle attribué.", "warning");
    return;
  }
  if (accountType === "client" && role.scope !== "assigned_client") {
    toast(
      "Un compte client doit recevoir un rôle de portée « Client affecté uniquement ».",
      "warning",
    );
    return;
  }
  const needsClient =
    accountType === "client" || role.scope === "assigned_client";
  const validClient = demoClientOptions().some(
    (client) => client.id === clientId,
  );
  if (needsClient && !validClient) {
    toast("Choisissez le client affecté à ce compte.", "warning");
    return;
  }
  if (backend.enabled && backend.authenticated) {
    const payload = {
      name,
      email,
      accountType,
      clientId: needsClient ? clientId : "",
      roleId,
      active: existing?.active !== false,
    };
    const request = existing
      ? apiRequest(
          `/quality/api/admin/users/${encodeURIComponent(existing.id)}`,
          { method: "PUT", body: payload },
        )
      : apiRequest("/quality/api/admin/users", {
          method: "POST",
          body: payload,
        });
    request
      .then(async (result) => {
        await loadAccessDirectory();
        closeModal();
        app.page = "settings";
        app.settingsTab = "users";
        render();
        if (result.temporaryPassword)
          showTemporaryPassword(result.user, result.temporaryPassword);
        else
          toast(
            existing
              ? "Utilisateur mis à jour dans DB."
              : "Utilisateur ajouté dans DB.",
          );
      })
      .catch((error) => toast(error.message, "error"));
    return;
  }
  const user = existing || {
    id: `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
  };
  user.name = name;
  user.email = email;
  user.accountType = accountType;
  user.clientId = needsClient ? clientId : "";
  user.initials = initials(name);
  user.role =
    accountType === "client"
      ? "Utilisatrice client"
      : existing?.role && existing.role !== "Utilisatrice client"
        ? existing.role
        : "Utilisateur interne";
  if (!existing) demoUsers.push(user);
  state.userRoleAssignments = state.userRoleAssignments || {};
  state.userRoleAssignments[user.id] = role.id;
  saveState();
  closeModal();
  app.page = "settings";
  app.settingsTab = "users";
  render();
  toast(
    existing
      ? "Utilisateur modifié."
      : "Utilisateur ajouté à la démonstration.",
  );
}
function reactivateUser(userId) {
  const user = (app.deactivatedUsers || []).find((item) => item.id === userId);
  if (!user) return;
  if (
    !confirm(
      `Réactiver le compte « ${user.name} » ? Il retrouvera ses accès et son rôle.`,
    )
  )
    return;
  apiRequest(
    `/quality/api/admin/users/${encodeURIComponent(userId)}/reactivate`,
    { method: "POST", body: {} },
  )
    .then(loadAccessDirectory)
    .then(() => {
      app.page = "settings";
      app.settingsTab = "users";
      render();
      toast("Compte réactivé.");
    })
    .catch((error) => toast(error.message, "error"));
}
function deleteDemoUser(userId) {
  const index = demoUsers.findIndex((user) => user.id === userId);
  if (index < 0) return;
  const user = demoUsers[index];
  if (user.id === "u-sarah") {
    toast(
      "Le compte de démonstration actuellement connecté ne peut pas être supprimé.",
      "warning",
    );
    return;
  }
  if (demoUsers.length <= 1) {
    toast("Conservez au moins un utilisateur.", "warning");
    return;
  }
  if (
    !confirm(
      `Supprimer « ${user.name} » de la liste des comptes de démonstration ? Les fiches, tâches et historiques existants ne seront pas supprimés.`,
    )
  )
    return;
  if (backend.enabled && backend.authenticated) {
    apiRequest(`/quality/api/admin/users/${encodeURIComponent(userId)}`, {
      method: "DELETE",
      body: {},
    })
      .then(loadAccessDirectory)
      .then(() => {
        app.page = "settings";
        app.settingsTab = "users";
        render();
        toast(
          "Compte désactivé : il n’a plus accès à l’application. Retrouvez-le dans « Comptes désactivés » pour le réactiver; les historiques sont conservés.",
        );
      })
      .catch((error) => toast(error.message, "error"));
    return;
  }
  demoUsers.splice(index, 1);
  if (state.userRoleAssignments) delete state.userRoleAssignments[userId];
  saveState();
  app.page = "settings";
  app.settingsTab = "users";
  render();
  toast(
    "Utilisateur supprimé de la démonstration; les données historiques restent conservées.",
  );
}
function syncCurrentDemoUserHeader() {
  const user =
    backend.enabled && backend.authenticated
      ? {
          id: backend.user?.id,
          name: backend.user?.name || "Utilisateur",
          role: backend.user?.roles?.[0]?.name || "Profil local",
        }
      : demoUsers.find((item) => item.id === "u-sarah");
  if (!user) return;
  const nameParts = String(user.name || "Utilisateur")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const shortName =
    nameParts.length > 1
      ? `${nameParts[0]} ${nameParts[nameParts.length - 1][0]}.`
      : nameParts[0] || "Utilisateur";
  const header = document.querySelector(".topbar-user");
  if (header) {
    const avatarEl = header.querySelector(".avatar");
    const nameEl = header.querySelector("strong");
    const roleEl = header.querySelector("small");
    if (avatarEl) avatarEl.textContent = initials(user.name);
    if (nameEl) nameEl.textContent = shortName;
    if (roleEl) roleEl.textContent = user.role;
  }
  const profile = document.querySelector(".user-profile");
  if (profile) {
    const avatarEl = profile.querySelector(".avatar");
    const nameEl = profile.querySelector("strong");
    const roleEl = profile.querySelector("small");
    if (avatarEl) avatarEl.textContent = initials(user.name);
    if (nameEl) nameEl.textContent = user.name;
    if (roleEl) roleEl.textContent = user.role;
  }
  const actions = document.querySelector(".topbar-actions");
  if (
    actions &&
    backend.enabled &&
    backend.authenticated &&
    !actions.querySelector('[data-action="auth-logout"]')
  ) {
    const button = document.createElement("button");
    button.className = "icon-button auth-logout-button";
    button.dataset.action = "auth-logout";
    button.type = "button";
    button.title = "Se déconnecter";
    button.setAttribute("aria-label", "Se déconnecter");
    button.innerHTML = ic("log-out");
    actions.appendChild(button);
  }
  if (actions && !backend.authenticated)
    actions.querySelector('[data-action="auth-logout"]')?.remove();
}

function openAssignLabel(recordId) {
  const r = getRecord(recordId);
  if (!r) return;
  const body = `<input type="hidden" name="recordId" value="${esc(recordId)}"/><div class="debrief-select-list">${state.labels.map((l) => `<label class="debrief-select-row"><input type="checkbox" name="labelIds" value="${esc(l.id)}" ${(r.labels || []).includes(l.id) ? "checked" : ""}/><span>${labelChip(l)}</span></label>`).join("") || '<p class="muted">Aucun libellé disponible.</p>'}</div>`;
  showModal({
    title: "Libellés de la fiche",
    description: `Choisissez plusieurs libellés pour l’indice ${esc(recordIndexValue(r))}.`,
    body,
    form: "assignLabels",
    submitText: "Enregistrer",
  });
}
async function openEditRecord(recordId) {
  const r = getRecord(recordId);
  if (!r) return;
  let assignable = [];
  if (canAssignRecords()) {
    try {
      assignable = await loadAssignableUsers();
    } catch (error) {
      app.assignableUsers = [];
      toast("Liste des qualiticiens indisponible.", "warning");
    }
  }
  const agents = state.agents;
  const body = `<input type="hidden" name="recordId" value="${esc(recordId)}"/><div class="form-field" style="margin-bottom:14px"><label>Remplacer l’audio</label><input type="file" name="newAudioFile" accept="audio/*,.mp3,.wav,.m4a,.ogg,.aac,.flac,.opus,.wma"/><span class="field-hint">Audio actuel : ${esc(r.audio?.drive_file_name || "non renseigné")}. Laissez vide pour le conserver. L’ancien fichier reste conservé côté stockage.</span></div><div class="form-grid">${field("campaign", "Campagne", { value: r.campaign, required: true })}${field("campaignCode", "Code campagne", { value: r.campaignCode })}<div class="form-field"><label>Agent *</label><input name="agentName" list="agentOptions" value="${esc((agents.find((a) => a.id === r.employeeCode) ? agentChoiceLabel(agents.find((a) => a.id === r.employeeCode)) : r.agent) || "")}" placeholder="Tapez pour rechercher un agent ou saisissez un nom" autocomplete="off" required/><datalist id="agentOptions">${agentChoiceOptions()}</datalist><span class="field-hint">Choisissez un agent de la liste, ou saisissez un nom libre.</span></div>${canAssignRecords() ? field("responsibleId", "Qualiticien", { select: assigneeSelectOptions(assignable, r.responsibleId || "", r.responsible || "", !!(r.responsibleId || r.responsible)), required: !!(r.responsibleId || r.responsible) }) : `<div class="form-field"><label>Qualiticien</label><input value="${esc(r.responsible || "Non affecté")}" disabled/><span class="field-hint">Seuls l’administrateur et le responsable qualité peuvent modifier l’affectation.</span></div>`}${field("agentCivility", "Civilité", { value: r.agentCivility })}${field("agentCodeFromFilename", "Matricule candidat du nom", { value: r.agentCodeFromFilename })}${field("callDate", "Date de l’appel", { type: "date", value: r.callDate, required: true })}${field("callTime", "Heure de l’appel", { type: "time", step: "1", value: r.callTime })}${field("duration", "Durée", { value: r.duration })}${field("recordIndex", "Indice", { value: r.recordIndex })}${field("baseName", "Nom de la base", { value: r.baseName })}${field("clientCall1Status", "Statut Call 1", { value: r.clientCall1Status || r.call1Status || latestClientReturn(r)?.call1Status || "" })}${field("rawSegment6", "Segment 6 brut", { value: r.rawSegment6 })}${field("rawSegment7", "Segment 7 brut", { value: r.rawSegment7 })}${field("extension", "N° de poste", { value: r.extension })}${field("clientRef", "Référence client", { value: r.clientRef })}${field("amount", "Montant de la promesse", { type: "number", min: "0", value: r.amount })}</div><div class="notice-inline" style="margin-top:12px">${ic("info")}<span>Les métadonnées extraites restent éditables. La liste complète des segments du nom original est conservée séparément et n’est pas interprétée.</span></div>`;
  showModal({
    title: `Modifier l’indice ${esc(recordIndexValue(r))}`,
    description: "Mise à jour des informations de la fiche.",
    body,
    form: "editRecord",
    submitText: "Enregistrer les changements",
    wide: true,
  });
}
const finalCallStatusOptions = [
  ["DAM", "DAM"],
  ["INDECIS", "INDECIS"],
  ["REFUS", "REFUS"],
  ["RAPPEL", "RAPPEL"],
  ["ARG", "ARG"],
  ["HORS_CIBLE", "HORS CIBLE"],
  ["ANNULE", "ANNULE"],
  ["PROMESSE_AVEC_MONTANT", "Promesse de don avec montant"],
  ["INDECIS_ALT", "Indécis"],
];
const cancelReasonOptions = [
  ["AUCUNE", "Aucune"],
  ["PROD", "PROD"],
  ["AGENT", "AGENT"],
];
function internalResultFields(stage, record) {
  if (stage === "internal2") {
    const ev = record?.internal2 || "";
    const promiseValue = ev.promiseStatus || "";
    const donorValue = ev.donConformity || "";
    return `<div class="reevaluation-form"><div class="form-field span-2"><label>ANALYSE POLE QUALITE *</label><textarea name="analysisPoleQualite" required placeholder="Saisir l’analyse du Pôle qualité">${esc(ev.analysisPoleQualite || "")}</textarea></div><div class="form-grid"><div class="form-field"><label>Promesse *</label><select name="promiseStatus" required><option value="">Choisir…</option><option value="PROMESSE_VALIDE" ${promiseValue === "PROMESSE_VALIDE" ? "selected" : ""}>PROMESSE VALIDE</option><option value="PROMESSE_NON_VALIDE" ${promiseValue === "PROMESSE_NON_VALIDE" ? "selected" : ""}>PROMESSE Non VALIDE</option></select></div><div class="form-field"><label>Don *</label><select name="reevaluationDonStatus" required><option value="">Choisir…</option><option value="CONFORME" ${donorValue === "CONFORME" ? "selected" : ""}>Don conforme</option><option value="NON_CONFORME" ${donorValue === "NON_CONFORME" ? "selected" : ""}>Don non conforme</option></select></div></div></div>`;
  }
  return `<div class="evaluation-result-grid"><div class="form-field"><label>MONTANT</label><input type="text" inputmode="decimal" name="amount" value="${esc(record?.amount ?? "")}" placeholder="Ex. 15€"/></div><div class="form-field"><label>DON *</label><select name="donStatus" required><option value="">Choisir…</option><option value="CONFORME">CONFORME</option><option value="NON_CONFORME">NON CONFORME</option></select></div><div class="form-field"><label>STATUT FINAL *</label><select name="finalStatus" required><option value="">Choisir…</option>${finalCallStatusOptions.map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join("")}</select></div><div class="form-field"><label>ANNULER</label><select name="cancelReason">${cancelReasonOptions.map(([value, label], i) => `<option value="${esc(value)}" ${i === 0 ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></div><div class="form-field span-2"><label>REMARQUE</label><textarea name="remark" placeholder="Remarque..."></textarea></div><div class="form-field span-2"><label>OBSERVATIONS</label><textarea name="observations" placeholder="Observations détaillées..."></textarea></div></div>`;
}
function clientReturnFields(record, existing, title = "Retour client") {
  const latest = latestClientReturn(record);
  const baseSnapshot =
    record.baseName || latest?.baseSnapshot || latest?.base || "";
  const recordIndexSnapshot =
    recordIndexValue(record, "") ||
    latest?.recordIndexSnapshot ||
    latest?.indexSnapshot ||
    "";
  const call1Status =
    record.clientCall1Status || record.call1Status || latest?.call1Status || "";
  const donorValue =
    existing?.alreadyDonor === true || existing?.alreadyDonor === "OUI"
      ? "OUI"
      : existing?.alreadyDonor === false || existing?.alreadyDonor === "NON"
        ? "NON"
        : "";
  const statusValue = existing?.finalStatus || existing?.decision || "";
  const selectedStatus =
    statusValue === "INDECIS_ALT" ? "INDECIS" : statusValue;
  return `<div class="client-return-sheet span-2"><input type="hidden" name="baseSnapshot" value="${esc(baseSnapshot)}"/><input type="hidden" name="recordIndexSnapshot" value="${esc(recordIndexSnapshot)}"/><input type="hidden" name="call1StatusSnapshot" value="${esc(call1Status)}"/><div class="client-return-sheet-head"><strong>${esc(title)}</strong><span>Les informations de l’appel sont reprises de cette fiche</span></div><div class="form-grid client-return-fields">${field("receivedAt", "Date et heure de réception", { type: "datetime-local", value: localDateTimeInputValue(), required: true })}${field(
    "clientFinalStatus",
    "Statut final",
    {
      select: [
        { value: "", label: "Choisir…", selected: !selectedStatus },
        { value: "DAM", label: "DAM", selected: selectedStatus === "DAM" },
        {
          value: "INDECIS",
          label: "Indécis",
          selected: selectedStatus === "INDECIS",
        },
      ],
      required: true,
    },
  )}${field("alreadyDonor", "Déjà donateur", {
    select: [
      { value: "", label: "Choisir…", selected: donorValue === "" },
      { value: "OUI", label: "Oui", selected: donorValue === "OUI" },
      { value: "NON", label: "Non", selected: donorValue === "NON" },
    ],
    required: true,
  })}${field("clientRemarks", "Remarques client", { textarea: true, span: true, placeholder: "Remarques figurant dans le retour reçu" })}</div></div>`;
}
function localDateTimeInputValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
function openClientReturnModal(recordId) {
  const r = getRecord(recordId);
  if (!r) return;
  const next = nextClientReturnNumber(r);
  const source =
    app.page === "portal" || app.fromPage === "portal" ? "PORTAL" : "EMAIL";
  const body = `<input type="hidden" name="recordId" value="${esc(recordId)}"/><input type="hidden" name="sourceChannel" value="${source}"/><div class="eval-context"><div class="eval-context-left">${ic("message")}<span><strong>Indice ${esc(recordIndexValue(r))} · ${esc(r.agent)}</strong><small>${esc(r.baseName || "Nom de base non renseigné")} · Statut Call 1 : ${esc(recordCall1Status(r))}</small><small>Retour client #${next} · ajouté à la même fiche</small></span></div>${badge(`#${next}`, "purple")}</div>${clientReturnFields(r, null, "Retour client #" + next)}<div class="notice-inline" style="margin-top:12px">${ic("info")}<span>Nom de base, indice et Statut Call 1 sont repris des Informations de l’appel. Le retour sera horodaté et ajouté à l’historique sans écraser les entrées précédentes.</span></div>`;
  showModal({
    title: `Ajouter le retour client #${next}`,
    description: `Indice ${esc(recordIndexValue(r))} · Nom de base et Statut Call 1 sont déjà rattachés à cette fiche.`,
    body,
    form: "clientReturn",
    submitText: "Enregistrer le retour",
    wide: true,
    note:
      source === "PORTAL"
        ? "Source : portail client"
        : "Source : retour reçu · saisie CRM",
  });
}

function openEvaluationModal(recordId, stage) {
  const r = getRecord(recordId);
  if (!r) return;
  if (stage === "clientReturns" || stage === "clientReturn") {
    openClientReturnModal(recordId);
    return;
  }
  if (!["internal1", "internal2"].includes(stage)) {
    toast(
      "Les retours client se saisissent dans l’historique de la fiche.",
      "warning",
    );
    return;
  }
  if (stage === "internal2" && !getClientReturns(r).length) {
    toast(
      "Enregistrez d’abord un retour client sur cette fiche pour ouvrir la réévaluation.",
      "warning",
    );
    return;
  }
  const criteria =
    stage === "internal1" ? state.criteriaByStage.internal1 || [] : [];
  if (stage === "internal1" && !criteria.length) {
    toast(
      "La grille Synergy #1 doit être configurée avant l’évaluation.",
      "warning",
    );
    app.settingsTab = "templates";
    goPage("settings");
    return;
  }
  const grouped = {};
  criteria.forEach((c) =>
    (grouped[c.section || "Critères qualité"] =
      grouped[c.section || "Critères qualité"] || []).push(c),
  );
  const questionHtml = Object.entries(grouped)
    .map(
      ([section, list]) =>
        `<div class="eval-section-title">${esc(section)}</div><div class="evaluation-criteria-grid">${list.map((c) => renderEvalQuestion(c)).join("")}</div>`,
    )
    .join("");
  const body = `<input type="hidden" name="recordId" value="${esc(recordId)}"/><input type="hidden" name="stage" value="${esc(stage)}"/><div class="eval-context"><div class="eval-context-left">${ic(stage === "internal2" ? "headphones" : "clipboard")}<span><strong>Indice ${esc(recordIndexValue(r))} · ${esc(r.agent)}</strong><small>${esc(stageTitles[stage])} · ${esc(r.campaign)}</small></span></div><span class="badge badge-blue">${stage === "internal2" ? "Formulaire qualité" : `${criteria.length} critère(s)`}</span></div>${renderEvaluationAudio(r)}${questionHtml}${stage === "internal1" ? `<div class="eval-section-title" style="margin-top:17px">Résultat & Observations</div>` : ""}${internalResultFields(stage, r)}`;
  const description =
    stage === "internal2"
      ? "Renseignez l’analyse du Pôle qualité, le statut de la promesse et la conformité du don. La réponse sera versionnée sur cette fiche."
      : "Réécoutez l’audio et complétez la grille Synergy #1 configurée. Les versions restent attachées à cette fiche.";
  showModal({
    title: stageTitles[stage],
    description,
    body,
    form: "evaluation",
    submitText:
      stage === "internal2"
        ? "Enregistrer la réévaluation"
        : "Enregistrer évaluation",
    wide: true,
    note:
      stage === "internal2"
        ? "Les réponses et le libellé seront archivés sur cette fiche"
        : `${criteria.length} critère(s) chargé(s) · qualiticienne`,
  });
}

function renderEvalQuestion(c) {
  const name = `answer_${c.id}`;
  let control = "";
  if (c.type === "ok_x")
    control = `<div class="choice-row ok-x-row"><label class="ok-x-choice"><input type="radio" name="${esc(name)}" value="OK" required/><span>OK</span></label><label class="ok-x-choice"><input type="radio" name="${esc(name)}" value="X"/><span>X</span></label></div><textarea name="justification_${esc(c.id)}" class="criterion-justification" placeholder="Justification (facultative)..."></textarea>`;
  else if (c.type === "text")
    control = `<textarea name="${esc(name)}" class="form-control textarea" placeholder="Réponse" required></textarea>`;
  else if (c.type === "scale")
    control = `<div class="choice-row">${Array.from({ length: criterionScaleSize(c) }, (_, i) => i + 1).map((n) => `<label class="choice-chip"><input type="radio" name="${esc(name)}" value="${n}" required/>${n}</label>`).join("")}</div>`;
  else if (c.type === "select")
    control = `<select name="${esc(name)}" class="form-control" required><option value="">Choisir…</option>${(c.options || []).map((o) => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join("")}</select>`;
  else if (c.type === "checkbox")
    control = `<div class="choice-row">${(c.options || []).map((o) => `<label class="choice-chip"><input type="checkbox" name="${esc(name)}" value="${esc(o.id)}"/>${esc(o.label)}</label>`).join("")}</div>`;
  else
    control = `<div class="choice-row"><label class="choice-chip"><input type="radio" name="${esc(name)}" value="conforme" required/>Conforme</label><label class="choice-chip"><input type="radio" name="${esc(name)}" value="non_conforme"/>Non conforme</label><label class="choice-chip"><input type="radio" name="${esc(name)}" value="n_a"/>N/A</label></div>`;
  return `<article class="eval-criterion-card"><div class="eval-criterion-head"><strong>${esc(c.label)}</strong><small>${esc(c.description || "")}</small></div>${control}</article>`;
}
function optionAnswerPoints(c, value) {
  const byId = new Map(
    (c.options || []).map((o) => [o.id, Number(o.points) || 0]),
  );
  if (c.type === "select") return byId.has(value) ? byId.get(value) : null;
  const ids = (Array.isArray(value) ? value : [value]).filter((v) =>
    byId.has(v),
  );
  return ids.length
    ? Math.min(
        100,
        ids.reduce((sum, v) => sum + byId.get(v), 0),
      )
    : null;
}
// Taille d'une échelle (nombre de réponses possibles, de 1 à N) ; 5 par défaut pour les anciens critères.
function criterionScaleSize(c) {
  const size = Number(c?.scaleSize);
  return Number.isInteger(size) && size >= 2 ? size : 5;
}
// Points apportés par une réponse (null : critère ignoré — sans réponse, texte, N/A, option inconnue).
// OK / X : « OK » vaut le poids ; « X » vaut 0 si le poids est positif, et +1 si le poids est -1 (négation : X est la bonne réponse).
// Autres types : fraction de réussite (0 à 1) × poids.
function criterionPoints(c, value, weight) {
  if (value == null || value === "" || value === "n_a") return null;
  switch (c.type) {
    case "ok_x":
    case "conformity":
      if (["OK", "conforme"].includes(value)) return weight;
      return weight < 0 ? -weight : 0;
    case "scale":
      return (Number(value) / criterionScaleSize(c)) * weight; // ex. 5 sur une échelle de 10 = 5/10
    case "select":
    case "checkbox": {
      const points = optionAnswerPoints(c, value);
      return points == null ? null : (points / 100) * weight;
    }
    default:
      return null; // texte libre
  }
}
// Score général : Σ points ÷ Σ |poids|, en %.
// Ex. OK (poids 1), OK (poids -1), échelle de 10 à 5 (poids 1) : (1 − 1 + 0,5) / 3 = 17 %.
function scoreFromAnswers(criteria, answers) {
  let earned = 0,
    max = 0;
  criteria.forEach((c) => {
    const weight = Number(c.weight) || 1;
    const points = criterionPoints(c, answers[c.id], weight);
    if (points == null) return;
    earned += points;
    max += Math.abs(weight);
  });
  return max
    ? Math.min(100, Math.max(0, Math.round((earned / max) * 100)))
    : null;
}
function archiveEvaluationVersion(r, stage) {
  r.evaluationHistory = Array.isArray(r.evaluationHistory)
    ? r.evaluationHistory
    : [];
  const previous = r[stage];
  if (stage === "internal2" && previous && r.responseSentAt)
    previous.sharedWithClientAt = r.responseSentAt;
  if (previous) {
    const archived = JSON.parse(JSON.stringify(previous));
    archived.stage = stage;
    archived.archivedAt = currentTime();
    r.evaluationHistory.push(archived);
  }
  return previous ? (Number(previous.version) || 1) + 1 : 1;
}
function evaluationCriteriaSnapshot(criteria) {
  return criteria.map((c) => ({
    id: c.id,
    section: c.section || "",
    label: c.label,
    description: c.description || "",
    type: c.type,
    weight: Number(c.weight) || 1,
    ...(c.type === "scale" ? { scaleSize: criterionScaleSize(c) } : {}),
    ...(c.options
      ? {
          groupId: c.groupId || "",
          groupName: c.groupName || "",
          options: c.options.map((o) => ({ ...o })),
        }
      : {}),
  }));
}
function saveClientReturn(form) {
  const fd = new FormData(form);
  const r = getRecord(fd.get("recordId"));
  if (!r) return;
  const previous = latestClientReturn(r);
  const baseSnapshot = String(
    fd.get("baseSnapshot") ||
      r.baseName ||
      previous?.baseSnapshot ||
      previous?.base ||
      "",
  ).trim();
  const recordIndexSnapshot = String(
    fd.get("recordIndexSnapshot") ||
      r.recordIndex ||
      previous?.recordIndexSnapshot ||
      previous?.indexSnapshot ||
      "",
  ).trim();
  const call1Status = String(
    fd.get("call1StatusSnapshot") ||
      r.clientCall1Status ||
      r.call1Status ||
      previous?.call1Status ||
      "",
  ).trim();
  const finalStatus = String(fd.get("clientFinalStatus") || "").trim();
  const donorRaw = String(fd.get("alreadyDonor") || "");
  const remarks = String(fd.get("clientRemarks") || "").trim();
  if (
    !["DAM", "INDECIS"].includes(finalStatus) ||
    (donorRaw !== "OUI" && donorRaw !== "NON")
  ) {
    toast(
      "Choisissez le Statut final (DAM ou Indécis) et Déjà donateur (Oui ou Non).",
      "warning",
    );
    return;
  }
  const rawReceivedAt = String(fd.get("receivedAt") || "");
  const parsedDate = rawReceivedAt ? new Date(rawReceivedAt) : new Date();
  if (Number.isNaN(parsedDate.getTime())) {
    toast("La date de réception est invalide.", "warning");
    return;
  }
  if (useRecordApi()) {
    recordApiCall(
      apiRequest(
        `/quality/api/records/${encodeURIComponent(r.id)}/client-returns`,
        {
          method: "POST",
          body: {
            finalStatus,
            alreadyDonor: donorRaw === "OUI",
            receivedAt: rawReceivedAt ? parsedDate.toISOString() : null,
            clientRemarks: remarks,
            baseSnapshot,
            recordIndexSnapshot,
            call1Status,
          },
        },
      ),
      `Retour client #${nextClientReturnNumber(r)} ajouté à la fiche ${recordIndexValue(r)}.`,
      () => {
        closeModal();
        app.recordId = r.id;
        app.page = "record";
        app.recordTab = "clientReturns";
      },
    );
    return;
  }
  const receivedAt = parsedDate.toISOString().slice(0, 19);
  const returns = getClientReturns(r);
  const returnNumber = nextClientReturnNumber(r);
  const fromPortal =
    fd.get("sourceChannel") === "PORTAL" ||
    app.page === "portal" ||
    app.fromPage === "portal";
  const actor = fromPortal ? "Nadia Kacem" : "Sarah Ben Salem";
  const role = fromPortal ? "Utilisatrice client" : "Qualiticienne";
  const entry = {
    id: `return-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    stage: "clientReturn",
    returnNumber,
    receivedAt,
    recordedAt: currentTime(),
    sourceChannel: fromPortal ? "PORTAL" : "EMAIL",
    recordedBy: actor,
    baseSnapshot,
    recordIndexSnapshot,
    call1Status,
    finalStatus,
    alreadyDonor: donorRaw === "OUI",
    clientRemarks: remarks,
  };
  r.clientReturns = [...returns, entry].sort(
    (a, b) => Number(a.returnNumber) - Number(b.returnNumber),
  );
  ensureRecordLabel(r, "Retour client", "purple");
  r.client1 = r.client1 || entry;
  r.status = "retour_client_recu";
  if (r.closedAt) {
    r.closedAt = null;
    r.closedBy = null;
    addEvent(
      r.id,
      "Dossier rouvert",
      `Nouveau retour client #${returnNumber} reçu après clôture.`,
      "Sarah Ben Salem",
      "Qualiticienne",
    );
  }
  addEvent(
    r.id,
    `Retour client #${returnNumber} enregistré`,
    `${formatDate(receivedAt, { time: true })} · ${baseSnapshot || "—"} / ${recordIndexSnapshot || "—"} · Statut Call 1 : ${call1Status || "—"} · ${finalStatus} · Déjà donateur : ${entry.alreadyDonor ? "Oui" : "Non"}${remarks ? ` · ${remarks}` : ""}`,
    actor,
    role,
  );
  createAutoReevaluationTask(r);
  saveState();
  closeModal();
  app.recordId = r.id;
  app.page = "record";
  app.recordTab = "clientReturns";
  render();
  toast(
    `Retour client #${returnNumber} ajouté à la fiche ${recordIndexValue(r)}.`,
  );
}
function submitEvaluation(recordId, stage, evaluation) {
  recordApiCall(
    apiRequest(
      `/quality/api/records/${encodeURIComponent(recordId)}/evaluations`,
      { method: "POST", body: { stage, evaluation } },
    ),
    `${stageTitles[stage]} enregistrée avec succès.`,
    () => {
      closeModal();
      app.recordId = recordId;
      app.page = "record";
      app.recordTab = stage;
    },
  );
}
function saveEvaluation(form) {
  const fd = new FormData(form);
  const recordId = fd.get("recordId");
  const stage = fd.get("stage");
  const r = getRecord(recordId);
  if (!r) return;
  if (!["internal1", "internal2"].includes(stage)) {
    toast(
      "Utilisez le formulaire correspondant à l’étape de la fiche.",
      "warning",
    );
    return;
  }
  if (stage === "internal2" && !getClientReturns(r).length) {
    toast(
      "Enregistrez d’abord un retour client avant la réévaluation.",
      "warning",
    );
    return;
  }
  const now = currentTime();
  const evaluator = "Sarah Ben Salem";
  let evaluation;
  if (stage === "internal2") {
    const analysisPoleQualite = String(
      fd.get("analysisPoleQualite") || "",
    ).trim();
    const promiseStatus = String(fd.get("promiseStatus") || "");
    const donConformity = String(fd.get("reevaluationDonStatus") || "");
    if (
      !analysisPoleQualite ||
      !["PROMESSE_VALIDE", "PROMESSE_NON_VALIDE"].includes(promiseStatus) ||
      !["CONFORME", "NON_CONFORME"].includes(donConformity)
    ) {
      toast(
        "Renseignez l’analyse du Pôle qualité, le statut de la promesse et la conformité du don.",
        "warning",
      );
      return;
    }
    if (useRecordApi()) {
      submitEvaluation(recordId, stage, {
        analysisPoleQualite,
        promiseStatus,
        donConformity,
      });
      return;
    }
    evaluation = {
      stage,
      status: "TERMINEE",
      version: archiveEvaluationVersion(r, stage),
      date: now,
      evaluator,
      score: null,
      conformity: donConformity,
      decision: promiseStatus,
      finalStatus: promiseStatus,
      donStatus: donConformity,
      promiseStatus,
      donConformity,
      analysisPoleQualite,
      answers: {},
      answerComments: {},
      criteriaSnapshot: [],
      templateVersion: 1,
    };
    r.internal2 = evaluation;
    r.status = "evaluation_2_terminee";
    ensureRecordLabel(r, "Réévaluation", "amber");
    addEvent(
      r.id,
      "Réévaluation du Pôle qualité enregistrée",
      `Version ${evaluation.version} · ${promiseStatusLabel(promiseStatus)} · ${donorConformityLabel(donConformity)} · ${analysisPoleQualite}`,
      evaluator,
    );
    completeTaskType(r.id, "REEVALUATION_2");
  } else {
    const criteria = state.criteriaByStage.internal1 || [];
    const answers = {};
    const answerComments = {};
    criteria.forEach((c) => {
      const value =
        c.type === "checkbox"
          ? fd.getAll(`answer_${c.id}`)
          : fd.get(`answer_${c.id}`);
      if (Array.isArray(value) ? value.length : value != null && value !== "")
        answers[c.id] = value;
      const comment = fd.get(`justification_${c.id}`);
      if (comment) answerComments[c.id] = comment;
    });
    if (criteria.length && criteria.some((c) => answers[c.id] == null)) {
      toast("Répondez à chaque critère avant de terminer.", "warning");
      return;
    }
    const score = scoreFromAnswers(criteria, answers);
    const amountText = String(fd.get("amount") || "")
      .replace(/[€\s]/g, "")
      .replace(",", ".");
    const evaluationAmount = amountText === "" ? null : Number(amountText);
    if (
      amountText !== "" &&
      (!Number.isFinite(evaluationAmount) || evaluationAmount < 0)
    ) {
      toast("Le montant doit être un nombre positif (ex. 15€).", "warning");
      return;
    }
    const conformity = fd.get("donStatus");
    const finalStatus = fd.get("finalStatus");
    if (useRecordApi()) {
      submitEvaluation(recordId, stage, {
        score,
        donStatus: conformity,
        finalStatus,
        amount: evaluationAmount,
        cancelReason: fd.get("cancelReason"),
        remark: fd.get("remark"),
        observations: fd.get("observations"),
        answers,
        answerComments,
        criteriaSnapshot: evaluationCriteriaSnapshot(criteria),
      });
      return;
    }
    evaluation = {
      stage,
      status: "TERMINEE",
      version: archiveEvaluationVersion(r, stage),
      date: now,
      evaluator,
      score,
      conformity,
      decision: finalStatus,
      finalStatus,
      donStatus: conformity,
      amount: evaluationAmount,
      cancelReason: fd.get("cancelReason"),
      remark: fd.get("remark"),
      comments: fd.get("remark"),
      observations: fd.get("observations"),
      answers,
      answerComments,
      criteriaSnapshot: evaluationCriteriaSnapshot(criteria),
      templateVersion: 1,
    };
    r.internal1 = evaluation;
    r.status = "evaluation_1_terminee";
    addEvent(
      r.id,
      "Évaluation Synergy #1 terminée",
      `Version ${evaluation.version} · ${score == null ? "Score non calculé" : `${score} %`} · Don ${conformity} · ${finalStatus}`,
      evaluator,
    );
    completeTaskType(r.id, "EVALUATION_1");
  }
  syncRecordWorkflowLabels(r);
  saveState();
  closeModal();
  app.recordId = recordId;
  app.page = "record";
  app.recordTab = stage;
  render();
  toast(`${stageTitles[stage]} enregistrée avec succès.`);
}
function completeTaskType(recordId, type) {
  if (backend.enabled) return;
  const t = state.tasks.find(
    (x) =>
      !x.archived &&
      x.recordId === recordId &&
      x.type === type &&
      x.status !== "TERMINE",
  );
  if (t) {
    t.status = "TERMINE";
    t.completedAt = currentTime();
  }
}
function createAutoReevaluationTask(r) {
  if (backend.enabled) return;
  const exists = state.tasks.some(
    (t) =>
      !t.archived &&
      t.recordId === r.id &&
      t.type === "REEVALUATION_2" &&
      t.status !== "TERMINE",
  );
  if (exists) return;
  const due = new Date(`${TODAY}T12:00:00`);
  due.setDate(due.getDate() + 2);
  const dueDate = due.toISOString().slice(0, 10);
  state.tasks.unshift({
    id: `task-${Date.now()}`,
    type: "REEVALUATION_2",
    auto: true,
    title: "Réévaluation après retour client",
    recordId: r.id,
    assignedTo: r.responsible || "À assigner",
    assignedToId: r.responsibleId || "",
    priority: "HAUTE",
    createdAt: currentTime(),
    dueDate,
    status: "A_FAIRE",
  });
}
function stageFromAction(action) {
  const id = action.dataset.recordId || app.recordId;
  const stage = action.dataset.stage;
  openEvaluationModal(id, stage);
}
function createNewRecord(form) {
  const fd = new FormData(form);
  const file = form.querySelector("[name=audioFile]").files[0];
  const clientId = String(
    fd.get("clientId") || demoClientOptions()[0]?.id || "client-qc",
  );
  const selectedClient = demoClientOptions().find(
    (client) => client.id === clientId,
  );
  if (!file) {
    toast("Sélectionnez un fichier audio.", "warning");
    return;
  }
  if (!selectedClient) {
    toast("Choisissez un client valide pour cette fiche.", "warning");
    return;
  }
  const normalized = file.name.trim().toLowerCase();
  const duplicate = state.records.find(
    (r) =>
      r.audio?.drive_file_name?.trim().toLowerCase() === normalized &&
      Number(r.audio?.file_size) === file.size,
  );
  if (duplicate) {
    closeModal();
    toast(
      `Ce fichier semble déjà associé à l’indice ${recordIndexValue(duplicate)}. Aucun doublon créé.`,
      "warning",
    );
    openRecord(duplicate.id);
    return;
  }
  const parsed = parseCallAudioName(file.name);
  const codeFromFilename = (fd.get("employeeCode") || "").trim();
  const assigneeId = String(fd.get("responsibleId") || "");
  const assignee = assigneeId
    ? (app.assignableUsers || []).find((user) => user.id === assigneeId) || null
    : null;
  const resolvedAgent = resolveAgentInput(
    fd.get("agentName"),
    codeFromFilename,
  );
  const agentName = resolvedAgent.name;
  if (!assignee) {
    toast(
      assignableLoaded()
        ? "Choisissez le qualiticien de la fiche (obligatoire)."
        : "La liste des qualiticiens est indisponible : impossible de créer la fiche pour le moment.",
      "warning",
    );
    return;
  }
  if (!agentName) {
    toast("Le nom de l’agent est obligatoire.", "warning");
    return;
  }
  const linkedAgent = resolvedAgent.agent;
  const callDate = fd.get("callDate") || TODAY;
  if (useRecordApi()) {
    // Le serveur attribue le numéro de fiche : l'audio est d'abord téléversé sous un identifiant provisoire, puis rattaché à la création.
    const draftId = `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const filenameParts = (() => {
      try {
        return JSON.parse(fd.get("filenameParts") || "[]");
      } catch (_) {
        return parsed.parts || [];
      }
    })();
    const campaignCode = (
      fd.get("campaignCode") ||
      parsed.campaignCode ||
      ""
    ).trim();
    const text = (name) => String(fd.get(name) || "").trim();
    uploadAudioToLocalStore(file, "call_record", draftId, clientId)
      .then((stored) =>
        recordApiCall(
          apiRequest("/quality/api/records", {
            method: "POST",
            body: {
              clientId,
              client: selectedClient.name,
              campaign: text("campaign") || campaignCode || "À rattacher",
              campaignCode,
              agentName,
              agentId: linkedAgent?.id || "",
              agentCivility: text("agentCivility"),
              agentCodeFromFilename: codeFromFilename,
              callDate,
              callTime: String(fd.get("callTime") || ""),
              duration: text("duration"),
              extension: text("extension"),
              clientRef: text("clientRef"),
              recordIndex: text("recordIndex"),
              baseName: text("baseName"),
              rawSegment1: String(
                parsed.rawSegment1 || fd.get("rawSegment1") || "",
              ).trim(),
              rawSegment6: text("rawSegment6"),
              rawSegment7: text("rawSegment7"),
              sourceFilename: file.name,
              filenameParts,
              amount: fd.get("amount") ? Number(fd.get("amount")) : null,
              clientCall1Status: text("clientCall1Status"),
              responsibleId: assignee.id,
              audioId: stored.id,
            },
          }),
          parsed.recognized
            ? "Fiche créée. Les informations reconnues ont été préremplies."
            : "Fiche créée ; vérifiez manuellement les éléments non reconnus dans le nom de l’audio.",
          (result) => {
            closeModal();
            app.fromPage = "records";
            app.recordId = result.record.id;
            app.page = "record";
            app.recordTab = "internal1";
          },
          "warning",
        ),
      )
      .catch((error) => toast(error.message, "error"));
    return;
  }
  const sequence =
    Math.max(
      0,
      ...state.records.map((r) => Number((r.id.match(/(\d+)$/) || [])[1]) || 0),
    ) + 1;
  const id = `QC-${new Date(`${callDate}T12:00:00`).getFullYear()}-${String(sequence).padStart(6, "0")}`;
  const finish = (audio) => {
    const filenameParts = (() => {
      try {
        return JSON.parse(fd.get("filenameParts") || "[]");
      } catch (_) {
        return parsed.parts || [];
      }
    })();
    const campaignCode = (
      fd.get("campaignCode") ||
      parsed.campaignCode ||
      ""
    ).trim();
    const duration = (fd.get("duration") || "").trim() || "00:00";
    const r = {
      id,
      clientId,
      client: selectedClient.name,
      campaign: (fd.get("campaign") || campaignCode || "À rattacher").trim(),
      campaignCode,
      agent: agentName,
      employeeCode: linkedAgent?.id || "",
      agentCodeFromFilename: codeFromFilename,
      agentCivility: (fd.get("agentCivility") || "").trim(),
      callDate,
      callTime: fd.get("callTime") || "",
      duration,
      durationSeconds: durationToSeconds(duration),
      extension: (fd.get("extension") || "").trim(),
      clientRef: (fd.get("clientRef") || "").trim(),
      recordIndex: (fd.get("recordIndex") || "").trim(),
      baseName: (fd.get("baseName") || "").trim(),
      rawSegment1: (parsed.rawSegment1 || fd.get("rawSegment1") || "").trim(),
      rawSegment6: (fd.get("rawSegment6") || "").trim(),
      rawSegment7: (fd.get("rawSegment7") || "").trim(),
      sourceFilename: file.name,
      filenameParts,
      amount: fd.get("amount") ? Number(fd.get("amount")) : null,
      clientCall1Status: (fd.get("clientCall1Status") || "").trim(),
      responsible: assignee?.name || "",
      responsibleId: assignee?.id || "",
      createdAt: currentTime(),
      status: "audio_recu",
      batchId: null,
      audio,
      internal1: null,
      client1: null,
      internal2: null,
      responseSentAt: null,
      clientFinal: null,
      closedAt: null,
      labels: [],
    };
    state.records.unshift(r);
    addEvent(
      id,
      "Audio téléversé",
      `${file.name} · ${backend.enabled ? "S3 Bucket local" : "fichier local de démonstration"}`,
      backend.user?.name || "Sarah Ben Salem",
      backend.user?.roles?.[0]?.name || "Qualiticienne",
    );
    addEvent(
      id,
      "Fiche créée",
      `Indice ${recordIndexValue(r)} · base ${r.baseName || "—"} · campagne ${r.campaignCode || r.campaign}`,
      backend.user?.name || "Sarah Ben Salem",
      backend.user?.roles?.[0]?.name || "Qualiticienne",
    );
    if (!backend.enabled)
      state.tasks.unshift({
        id: `task-${Date.now()}-eval`,
        type: "EVALUATION_1",
        title: "Évaluer l’appel",
        recordId: id,
        assignedTo: r.responsible || "À assigner",
        assignedToId: r.responsibleId || "",
        auto: true,
        priority: "NORMALE",
        createdAt: currentTime(),
        dueDate: TODAY,
        status: "A_FAIRE",
      });
    saveState();
    closeModal();
    app.fromPage = "records";
    app.recordId = id;
    app.page = "record";
    app.recordTab = "internal1";
    render();
    toast(
      parsed.recognized
        ? "Fiche créée. Les informations reconnues ont été préremplies."
        : "Fiche créée ; vérifiez manuellement les éléments non reconnus dans le nom de l’audio.",
      "warning",
    );
  };
  if (backend.enabled && backend.authenticated) {
    uploadAudioToLocalStore(file, "call_record", id, clientId)
      .then(finish)
      .catch((error) => toast(error.message, "error"));
    return;
  }
  let localUrl = "";
  try {
    localUrl = URL.createObjectURL(file);
  } catch (_) {}
  finish({
    drive_file_id: `DEMO-${Date.now()}`,
    drive_file_name: file.name,
    drive_file_url: "",
    mime_type: file.type || "application/octet-stream",
    file_size: file.size,
    date_upload: currentTime(),
    uploaded_by: "Sarah Ben Salem",
    localUrl,
  });
}
// ---- Menu Tâches : en mode serveur, chaque action appelle sa route dédiée (aucune sauvegarde de l'état complet).
const useTaskApi = () => backend.enabled && backend.authenticated;
function applyTaskResult(result) {
  const task = result.task;
  const index = state.tasks.findIndex((item) => item.id === task.id);
  if (index >= 0) state.tasks[index] = task;
  else state.tasks.unshift(task);
  for (const event of result.events || []) state.events.unshift(event);
}
async function refreshTasksFromServer() {
  if (!useTaskApi() || !backend.permissions.has("tasks")) return;
  try {
    const active =
      (await apiRequest("/quality/api/tasks?view=active")).tasks || [];
    const archived = canManageTasks()
      ? (await apiRequest("/quality/api/tasks?view=archived")).tasks || []
      : [];
    state.tasks = [...active, ...archived];
    if (app.page === "tasks" && !modalRoot.classList.contains("open")) render();
  } catch (error) {
    console.warn("Liste des tâches indisponible", error);
  }
}
function taskApiCall(request, successMessage, closeAfter = false) {
  backend.apiPending = (backend.apiPending || 0) + 1;
  return request
    .then((result) => {
      applyTaskResult(result);
      if (closeAfter) closeModal();
      render();
      toast(successMessage);
    })
    .catch((error) => toast(error.message, "error"))
    .finally(() => {
      backend.apiPending = Math.max(0, (backend.apiPending || 1) - 1);
    });
}
function createTask(form) {
  const fd = new FormData(form);
  const recordId = fd.get("recordId") || null;
  if (useTaskApi()) {
    const assignee = String(fd.get("assignedTo") || "");
    taskApiCall(
      apiRequest("/quality/api/tasks", {
        method: "POST",
        body: {
          title: fd.get("title"),
          type: fd.get("type"),
          recordId,
          assignedToId: assignee === "__legacy__" ? "" : assignee,
          priority: fd.get("priority"),
          dueDate: fd.get("dueDate"),
        },
      }),
      "Tâche créée et assignée.",
      true,
    );
    return;
  }
  const task = {
    id: `task-${Date.now()}`,
    type: fd.get("type"),
    title: fd.get("title"),
    recordId,
    assignedTo: (
      resolveTaskAssignee(fd.get("assignedTo")) || { name: "À assigner" }
    ).name,
    assignedToId: (resolveTaskAssignee(fd.get("assignedTo")) || { id: "" }).id,
    priority: fd.get("priority"),
    createdAt: currentTime(),
    dueDate: fd.get("dueDate"),
    status: "A_FAIRE",
  };
  state.tasks.unshift(task);
  if (recordId)
    addEvent(
      recordId,
      "Tâche créée",
      `${task.title} · échéance ${formatDate(task.dueDate)}`,
      task.assignedTo,
      "Qualiticienne",
    );
  saveState();
  closeModal();
  render();
  toast("Tâche créée et assignée.");
}
// ---- Menu Débriefs : en mode serveur, chaque action appelle sa route dédiée (aucune sauvegarde de l'état complet).
const useDebriefApi = () => backend.enabled && backend.authenticated;
function applyDebriefResult(result) {
  const debrief = result.debrief;
  const index = state.debriefs.findIndex((item) => item.id === debrief.id);
  if (index >= 0) state.debriefs[index] = debrief;
  else state.debriefs.unshift(debrief);
  for (const event of result.events || []) state.events.unshift(event);
}
function debriefApiCall(
  request,
  successMessage,
  closeAfter = false,
  afterRender = null,
) {
  backend.apiPending = (backend.apiPending || 0) + 1;
  return request
    .then((result) => {
      applyDebriefResult(result);
      if (closeAfter) closeModal();
      if (afterRender) afterRender(result);
      render();
      toast(successMessage);
    })
    .catch((error) => toast(error.message, "error"))
    .finally(() => {
      backend.apiPending = Math.max(0, (backend.apiPending || 1) - 1);
    });
}
async function refreshDebriefsFromServer() {
  if (!useDebriefApi() || !backend.permissions.has("debriefs")) return;
  try {
    const active =
      (await apiRequest("/quality/api/debriefs?view=active")).debriefs || [];
    const archived =
      (await apiRequest("/quality/api/debriefs?view=archived")).debriefs || [];
    state.debriefs = [...active, ...archived];
    const [activeTitles, archivedTitles] = await Promise.all(
      ["active", "archived"].map((view) =>
        apiRequest(`/quality/api/debriefs/action-titles?view=${view}`)
          .then((result) => result.titles || [])
          .catch(() => []),
      ),
    );
    app.debriefActionTitles = { active: activeTitles, archived: archivedTitles };
    if (app.page === "debriefs" && !modalRoot.classList.contains("open"))
      render();
  } catch (error) {
    console.warn("Liste des débriefs indisponible", error);
  }
}
async function refreshRecordDebriefs(recordId) {
  if (!useDebriefApi() || !backend.permissions.has("debriefs")) return;
  try {
    const result = await apiRequest(
      `/quality/api/debriefs?recordId=${encodeURIComponent(recordId)}`,
    );
    for (const debrief of result.debriefs || []) {
      const index = state.debriefs.findIndex((item) => item.id === debrief.id);
      if (index >= 0) state.debriefs[index] = debrief;
      else state.debriefs.unshift(debrief);
    }
    if (
      app.page === "record" &&
      app.recordId === recordId &&
      !modalRoot.classList.contains("open")
    )
      render();
  } catch (error) {
    console.warn("Débriefs de la fiche indisponibles", error);
  }
}
function canManageDebriefs() {
  return (
    !(backend.enabled && backend.authenticated) ||
    backend.permissions.has("debriefs")
  );
}
function renderDebriefRecordChoices(agent, checkedIds = []) {
  if (!agent)
    return '<div class="field-hint">Choisissez un agent de la liste pour voir ses fiches.</div>';
  const checked = new Set(checkedIds);
  const rows = state.records.filter(
    (r) =>
      sameAgentIdentity(agent.id, agent.name, r.employeeCode, r.agent) &&
      (!r.archived || checked.has(r.id)),
  );
  if (!rows.length)
    return '<div class="field-hint">Aucune fiche pour cet agent.</div>';
  return rows
    .map(
      (r) =>
        `<label style="display:flex;gap:8px;align-items:center;padding:4px 0"><input type="checkbox" name="recordIds" value="${esc(r.id)}" ${checked.has(r.id) ? "checked" : ""}/><span>Indice ${esc(recordIndexValue(r))} · ${esc(formatDate(r.callDate))} · ${esc(r.campaign || "")}</span></label>`,
    )
    .join("");
}
function refreshDebriefRecordChoices(form) {
  const box = form?.querySelector("#debriefRecordChoices");
  if (!box) return;
  const checked = [
    ...form.querySelectorAll('input[name="recordIds"]:checked'),
  ].map((input) => input.value);
  box.innerHTML = renderDebriefRecordChoices(
    resolveAgentInput(form.elements.namedItem("agentName").value).agent,
    checked,
  );
}
function openEditDebriefModal(id) {
  const d = state.debriefs.find((x) => x.id === id);
  if (!d) return;
  if (!canManageDebriefs()) {
    toast("Votre rôle ne permet pas cette action (debriefs).", "warning");
    return;
  }
  const agent =
    (state.agents || []).find((a) =>
      sameAgentIdentity(a.id, a.name, d.employeeCode, d.agent),
    ) || null;
  const owners = demoUsers
    .filter((u) => assignedRole(u.id)?.activities.includes("debriefs"))
    .map((u) => u.name);
  if (d.owner && !owners.includes(d.owner)) owners.unshift(d.owner);
  const first = (d.actions || [])[0] || null;
  const body = `<input type="hidden" name="debriefId" value="${esc(d.id)}"/><div class="form-field" style="margin-bottom:14px"><label>Remplacer l’audio</label><input type="file" name="debriefAudioFile" accept="audio/*,.mp3,.wav,.m4a,.ogg,.aac,.flac,.opus"/><span class="field-hint">Audio actuel : ${esc(d.audio?.fileName || d.audio?.drive_file_name || "non renseigné")}. Laissez vide pour le conserver. L’ancien fichier reste conservé côté stockage.</span></div>
    <div class="form-grid"><div class="form-field"><label>Agent *</label><input name="agentName" list="agentOptions" value="${esc(agent ? agentChoiceLabel(agent) : d.agent || "")}" placeholder="Tapez pour rechercher un agent" autocomplete="off" required/><datalist id="agentOptions">${agentChoiceOptions()}</datalist><span class="field-hint">Un agent du référentiel est obligatoire.</span></div>${field("date", "Date du débrief", { type: "date", value: d.date || TODAY, required: true })}${field("owner", "Responsable de la session", { select: owners.map((name) => ({ value: name, label: name, selected: name === d.owner })), required: true })}
    <div class="form-field span-2"><label>Fiches liées</label><div id="debriefRecordChoices" class="debrief-select-list">${renderDebriefRecordChoices(agent, d.recordIds || [])}</div></div>
    <div class="form-field span-2"><label>Points forts & observations</label><textarea name="note">${esc(d.note || "")}</textarea></div>${field("actionTitle", "Action de progression", { value: first?.title || "", placeholder: "Ex. S’entraîner à reformuler la demande" })}${field("actionDue", "Échéance de l’action", { type: "date", value: first?.dueDate || TODAY })}</div>
    <div class="notice-inline">${ic("info")}<span>Les notes en étoiles de l’évaluation ne sont pas modifiables. Chaque modification est tracée.</span></div>`;
  showModal({
    title: `Modifier le débrief ${esc(d.id)}`,
    description:
      "Agent, fiches liées, audio, date, responsable, observations et action de suivi.",
    body,
    form: "editDebrief",
    submitText: "Enregistrer les changements",
    wide: true,
  });
}
function saveDebriefEdit(form) {
  const fd = new FormData(form);
  const d = state.debriefs.find((x) => x.id === fd.get("debriefId"));
  if (!d) return;
  if (!canManageDebriefs()) {
    toast("Votre rôle ne permet pas cette action (debriefs).", "warning");
    return;
  }
  const agent = resolveAgentInput(fd.get("agentName")).agent;
  if (!agent) {
    toast("Choisissez un agent du référentiel pour ce débrief.", "warning");
    return;
  }
  const recordIds = [...new Set(fd.getAll("recordIds"))].filter((id) => {
    const r = getRecord(id);
    return (
      r && sameAgentIdentity(agent.id, agent.name, r.employeeCode, r.agent)
    );
  });
  const previous = d.recordIds || [];
  const agentChanged =
    normalizeEmployeeCode(d.employeeCode || d.agentId) !==
    normalizeEmployeeCode(agent.id);
  const dropped = previous.filter((id) => !recordIds.includes(id));
  if (
    agentChanged &&
    dropped.length &&
    !confirm(
      `Le changement d’agent dissocie ${dropped.length} fiche(s) qui n’appartiennent pas à ${agent.name}. Continuer ?`,
    )
  )
    return;
  const owner = String(fd.get("owner") || "").trim();
  const date = String(fd.get("date") || TODAY);
  const note = String(fd.get("note") || "").trim();
  const actionTitle = String(fd.get("actionTitle") || "").trim();
  const actions = (d.actions || []).map((a) => ({ ...a }));
  if (actionTitle) {
    if (actions[0])
      actions[0] = {
        ...actions[0],
        title: actionTitle,
        dueDate: fd.get("actionDue") || TODAY,
      };
    else
      actions.unshift({
        title: actionTitle,
        dueDate: fd.get("actionDue") || TODAY,
        status: "EN_COURS",
        owner: `${agent.name} + ${owner}`,
      });
  } else if (actions[0]) actions.shift();
  const audioFile = form.querySelector('[name="debriefAudioFile"]')?.files?.[0];
  if (audioFile) {
    const type = String(audioFile.type || "").toLowerCase();
    if (
      !type.startsWith("audio/") &&
      !/\.(mp3|wav|m4a|ogg|aac|flac|opus|aiff|wma)$/i.test(audioFile.name || "")
    ) {
      toast(
        "Le fichier choisi ne semble pas être un audio. Sélectionnez un fichier audio.",
        "warning",
      );
      return;
    }
  }
  const finish = (stored) => {
    const changed = [];
    const set = (field, value) => {
      if (JSON.stringify(d[field]) !== JSON.stringify(value)) {
        d[field] = value;
        changed.push(field);
      }
    };
    set("agent", agent.name);
    set("agentId", agent.id);
    set("employeeCode", agent.id);
    set("date", date);
    set("owner", owner);
    set("recordIds", recordIds);
    set("note", note);
    set("actions", actions);
    if (audioFile) {
      let localUrl = "";
      if (!stored)
        try {
          localUrl = URL.createObjectURL(audioFile);
        } catch (_) {}
      const folder = `${d.id}_${safeArchiveName(agent.name).replace(/\s+/g, "_")}_${date}`;
      const base = {
        fileName: audioFile.name,
        mimeType: audioFile.type || "application/octet-stream",
        fileSize: Number(audioFile.size) || 0,
        driveFolderName: folder,
        dateUpload: currentTime(),
        uploadedBy: backend.user?.name || owner,
      };
      set(
        "audio",
        stored
          ? {
              ...base,
              objectId: stored.id,
              storage: "MINIO",
              sha256: stored.sha256,
              localUrl: "",
              driveParentFolderId: null,
              driveFolderId: null,
              driveFileId: null,
              driveStatus: "STORED_MINIO",
            }
          : {
              ...base,
              localUrl,
              driveParentFolderId: state.driveFolderId || null,
              driveFolderId: null,
              driveFileId: null,
              driveStatus: "DEMO_NOT_UPLOADED",
            },
      );
    }
    if (!changed.length) {
      closeModal();
      toast("Aucun changement à enregistrer.", "warning");
      return;
    }
    const actor = backend.user?.name || owner;
    recordIds
      .filter((id) => !previous.includes(id))
      .forEach((id) =>
        addEvent(
          id,
          "Fiche associée à un débrief",
          `${d.id} · ${d.agent}`,
          actor,
          "Qualiticienne",
        ),
      );
    previous
      .filter((id) => !recordIds.includes(id))
      .forEach((id) =>
        addEvent(
          id,
          "Fiche dissociée d’un débrief",
          `${d.id} · ${d.agent}`,
          actor,
          "Qualiticienne",
        ),
      );
    if (!backend.enabled)
      d.modifications = [
        ...(d.modifications || []),
        { at: currentTime(), by: actor, fields: changed },
      ];
    saveState();
    closeModal();
    render();
    toast("Débrief mis à jour.");
  };
  if (useDebriefApi()) {
    const body = {};
    const set = (key, value, current) => {
      if (String(value ?? "") !== String(current ?? "")) body[key] = value;
    };
    if (agentChanged) body.agentId = agent.id;
    set("date", date, d.date);
    set("owner", owner, d.owner);
    set("note", note, d.note || "");
    const first = (d.actions || [])[0] || null;
    const dueDate = String(fd.get("actionDue") || TODAY);
    if (actionTitle) {
      if (!first || first.title !== actionTitle || first.dueDate !== dueDate)
        body.action = { title: actionTitle, dueDate };
    } else if (first) body.action = null;
    const toLink = recordIds.filter((id) => !previous.includes(id)),
      toUnlink = previous.filter((id) => !recordIds.includes(id));
    if (toLink.length) body.linkRecordIds = toLink;
    if (toUnlink.length) body.unlinkRecordIds = toUnlink;
    backend.apiPending = (backend.apiPending || 0) + 1;
    const upload = audioFile
      ? uploadAudioToLocalStore(audioFile, "debrief", d.id, "").then(
          (stored) => {
            body.audioId = stored.id;
          },
        )
      : Promise.resolve();
    upload
      .then(() => {
        if (!Object.keys(body).length) {
          closeModal();
          toast("Aucun changement à enregistrer.", "warning");
          return;
        }
        return apiRequest(`/quality/api/debriefs/${encodeURIComponent(d.id)}`, {
          method: "PATCH",
          body,
        }).then((result) => {
          applyDebriefResult(result);
          closeModal();
          render();
          toast("Débrief mis à jour.");
        });
      })
      .catch((error) => toast(error.message, "error"))
      .finally(() => {
        backend.apiPending = Math.max(0, (backend.apiPending || 1) - 1);
      });
    return;
  }
  finish(null);
}
function archiveDebrief(id) {
  const d = state.debriefs.find((x) => x.id === id);
  if (!d || d.archived) return;
  if (!canManageDebriefs()) {
    toast("Votre rôle ne permet pas cette action (debriefs).", "warning");
    return;
  }
  if (
    !confirm(
      "Supprimer ce débrief ? Il sera archivé : masqué des listes et des statistiques, mais conservé avec ses notes et son audio, et restaurable.",
    )
  )
    return;
  if (useDebriefApi()) {
    debriefApiCall(
      apiRequest(`/quality/api/debriefs/${encodeURIComponent(id)}/archive`, {
        method: "POST",
        body: {},
      }),
      "Débrief archivé. Il reste consultable avec le filtre « Débriefs supprimés ».",
    );
    return;
  }
  d.archived = true;
  d.archivedAt = currentTime();
  d.archivedBy = backend.user?.name || "Sarah Ben Salem";
  (d.recordIds || []).forEach((recordId) =>
    addEvent(
      recordId,
      "Débrief supprimé (archivé)",
      `${d.id} · ${d.agent}`,
      d.archivedBy,
      "Qualiticienne",
    ),
  );
  saveState();
  render();
  toast(
    "Débrief archivé. Il reste consultable avec le filtre « Débriefs supprimés ».",
  );
}
function restoreDebrief(id) {
  const d = state.debriefs.find((x) => x.id === id);
  if (!d || !d.archived) return;
  if (!canManageDebriefs()) {
    toast("Votre rôle ne permet pas cette action (debriefs).", "warning");
    return;
  }
  if (useDebriefApi()) {
    debriefApiCall(
      apiRequest(`/quality/api/debriefs/${encodeURIComponent(id)}/restore`, {
        method: "POST",
        body: {},
      }),
      "Débrief restauré.",
    );
    return;
  }
  d.archived = false;
  d.archivedAt = null;
  d.archivedBy = null;
  (d.recordIds || []).forEach((recordId) =>
    addEvent(
      recordId,
      "Débrief restauré",
      `${d.id} · ${d.agent}`,
      backend.user?.name || "Sarah Ben Salem",
      "Qualiticienne",
    ),
  );
  saveState();
  render();
  toast("Débrief restauré.");
}
// Liens fiche ↔ débrief : même règle que le serveur (matricule, ou nom quand un matricule manque).
function debriefMatchesRecord(d, r) {
  return (
    !!d &&
    !!r &&
    sameAgentIdentity(
      d.agentId || d.employeeCode,
      d.agent,
      r.employeeCode,
      r.agent,
    )
  );
}
function debriefsLinkableToRecord(r) {
  return (state.debriefs || []).filter(
    (d) =>
      !d.archived &&
      debriefMatchesRecord(d, r) &&
      !(d.recordIds || []).includes(r.id),
  );
}
function recordsLinkableToDebrief(d) {
  return (state.records || []).filter(
    (r) =>
      !r.archived &&
      debriefMatchesRecord(d, r) &&
      !(d.recordIds || []).includes(r.id),
  );
}
function linkDebriefRecords(debriefId, add = [], remove = []) {
  const d = (state.debriefs || []).find((x) => x.id === debriefId);
  if (!d || d.archived) return false;
  if (!canManageDebriefs()) {
    toast("Votre rôle ne permet pas cette action (debriefs).", "warning");
    return false;
  }
  const invalid = add.filter((id) => !debriefMatchesRecord(d, getRecord(id)));
  if (invalid.length) {
    toast(
      "Cette fiche n’appartient pas à l’agent du débrief : lien impossible.",
      "warning",
    );
    return false;
  }
  const previous = d.recordIds || [];
  const next = [
    ...new Set([...previous.filter((id) => !remove.includes(id)), ...add]),
  ];
  if (
    next.length === previous.length &&
    next.every((id) => previous.includes(id))
  )
    return false;
  d.recordIds = next;
  const actor = backend.user?.name || "Sarah Ben Salem";
  next
    .filter((id) => !previous.includes(id))
    .forEach((id) =>
      addEvent(
        id,
        "Fiche associée à un débrief",
        `${d.id} · ${d.agent}`,
        actor,
        "Qualiticienne",
      ),
    );
  previous
    .filter((id) => !next.includes(id))
    .forEach((id) =>
      addEvent(
        id,
        "Fiche dissociée d’un débrief",
        `${d.id} · ${d.agent}`,
        actor,
        "Qualiticienne",
      ),
    );
  if (!backend.enabled)
    d.modifications = [
      ...(d.modifications || []),
      { at: currentTime(), by: actor, fields: ["recordIds"] },
    ];
  saveState();
  render();
  return true;
}
function openLinkDebriefModal(recordId) {
  const r = getRecord(recordId);
  if (!r) return;
  if (!canManageDebriefs()) {
    toast("Votre rôle ne permet pas cette action (debriefs).", "warning");
    return;
  }
  const options = debriefsLinkableToRecord(r);
  if (!options.length) {
    toast(
      "Aucun débrief actif disponible pour l’agent de cette fiche. Créez un débrief.",
      "warning",
    );
    return;
  }
  const body = `<input type="hidden" name="recordId" value="${esc(r.id)}"/><div class="form-grid">${field("debriefId", "Débrief", { select: options.map((d) => ({ value: d.id, label: `${d.id} · ${formatDate(d.date)} · ${d.agent}` })), required: true, span: true })}</div>`;
  showModal({
    title: `Lier la fiche ${esc(recordIndexValue(r))} à un débrief`,
    description: "Choisissez un débrief existant du même agent.",
    body,
    form: "linkRecordDebrief",
    submitText: "Lier la fiche",
  });
}
function openLinkRecordModal(debriefId) {
  const d = (state.debriefs || []).find((x) => x.id === debriefId);
  if (!d || d.archived) return;
  if (!canManageDebriefs()) {
    toast("Votre rôle ne permet pas cette action (debriefs).", "warning");
    return;
  }
  const rows = recordsLinkableToDebrief(d);
  if (!rows.length) {
    toast(
      "Aucune autre fiche disponible pour l’agent de ce débrief.",
      "warning",
    );
    return;
  }
  const list = rows
    .map(
      (r) =>
        `<label style="display:flex;gap:8px;align-items:center;padding:4px 0"><input type="checkbox" name="recordIds" value="${esc(r.id)}"/><span>Indice ${esc(recordIndexValue(r))} · ${esc(formatDate(r.callDate))} · ${esc(r.campaign || "")}</span></label>`,
    )
    .join("");
  const body = `<input type="hidden" name="debriefId" value="${esc(d.id)}"/><div class="form-field"><label>Fiches de ${esc(d.agent)}</label><div class="debrief-select-list">${list}</div></div>`;
  showModal({
    title: `Lier des fiches au débrief ${esc(d.id)}`,
    description: "Cochez les fiches existantes à associer à ce débrief.",
    body,
    form: "linkDebriefRecords",
    submitText: "Lier les fiches",
  });
}
// Association de fiches : l’édition des notes s’ouvre avant l’enregistrement; l’audio des nouvelles fiches rejoint la liste du débrief.
function openDebriefScoreModal(debriefId, recordIds) {
  const d = (state.debriefs || []).find((x) => x.id === debriefId);
  if (!d || d.archived) return;
  const rows = recordIds.map(getRecord).filter(Boolean);
  const ratingRows = DEBRIEF_RUBRIC.map(
    (item) =>
      `<fieldset class="debrief-score-row"><legend>${esc(item.title)}</legend><p>${esc(item.hint)}</p><div class="debrief-stars" role="radiogroup" aria-label="${esc(item.title)} · note de 1 à 5 étoiles">${[1, 2, 3, 4, 5].map((value) => `<label title="${value} étoile${value > 1 ? "s" : ""}"><input type="radio" name="rating_${esc(item.key)}" value="${value}" ${Number(d.ratings?.[item.key]) === value ? "checked" : ""} required aria-label="${value} sur 5"/><span aria-hidden="true">★</span></label>`).join("")}</div></fieldset>`,
  ).join("");
  const added = rows
    .map(
      (r) =>
        `<div class="metric-line"><span><strong>Indice ${esc(recordIndexValue(r))}</strong><small style="display:block;color:#9ba4b1">${esc(formatDate(r.callDate))} · ${esc(r.campaign || "")}</small></span><span>${r.audio?.objectId || r.audio?.localUrl ? `${ic("headphones")} ${esc(r.audio.drive_file_name || r.audio.fileName || "audio")}` : "Pas d’audio"}</span></div>`,
    )
    .join("");
  showModal({
    title: `Mettre à jour la note · débrief ${esc(d.id)}`,
    description:
      "Vérifiez ou modifiez les notes avant d’enregistrer. Les audios des fiches ajoutées rejoindront la liste des audios du débrief.",
    body: `<input type="hidden" name="debriefId" value="${esc(d.id)}"/>${rows.map((r) => `<input type="hidden" name="recordIds" value="${esc(r.id)}"/>`).join("")}<div class="form-field"><label>Fiches ajoutées (${rows.length})</label><div class="metric-list">${added}</div></div><section class="debrief-rating-panel"><div class="debrief-rating-heading"><div><h3>Évaluation de l’appel</h3><p>Modifiez la note par compétence si nécessaire.</p></div><span>1 = à travailler · 5 = très bien maîtrisé</span></div><div class="debrief-score-list">${ratingRows}</div></section>`,
    form: "debriefScoreLink",
    submitText: "Enregistrer et ajouter les audios",
    wide: true,
  });
}
function saveDebriefScoreLink(form) {
  const fd = new FormData(form);
  const d = (state.debriefs || []).find((x) => x.id === fd.get("debriefId"));
  if (!d) return;
  const ids = fd.getAll("recordIds").map(String);
  const ratings = {};
  for (const item of DEBRIEF_RUBRIC) {
    const score = Number(fd.get(`rating_${item.key}`));
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      toast(`Attribuez une note de 1 à 5 pour « ${item.title} ».`, "warning");
      return;
    }
    ratings[item.key] = score;
  }
  if (useDebriefApi()) {
    debriefApiCall(
      apiRequest(`/quality/api/debriefs/${encodeURIComponent(d.id)}`, {
        method: "PATCH",
        body: { ratings, linkRecordIds: ids },
      }),
      "Notes enregistrées, fiche(s) et audio(s) ajoutés au débrief.",
      true,
    );
    return;
  }
  const before = debriefAudioList(d).map((a) => ({ ...a }));
  if (!linkDebriefRecords(d.id, ids, [])) return;
  const audios = before;
  for (const id of ids) {
    const r = getRecord(id);
    const a = r?.audio;
    if (!a || !(a.objectId || a.localUrl)) continue;
    audios.push({
      fileName: a.drive_file_name || a.fileName || "Audio de la fiche",
      mimeType: a.mime_type || a.mimeType || "audio/mpeg",
      fileSize: Number(a.file_size || a.fileSize) || 0,
      objectId: a.objectId,
      localUrl: a.objectId ? "" : a.localUrl || "",
      sourceRecordId: r.id,
      driveStatus: "LINKED_RECORD_AUDIO",
    });
  }
  d.audios = audios;
  d.audio = audios[0] || d.audio;
  d.ratings = ratings;
  saveState();
  closeModal();
  render();
  toast("Notes enregistrées, fiche(s) et audio(s) ajoutés au débrief.");
}
function unlinkDebriefRecord(debriefId, recordId) {
  if (!confirm("Dissocier cette fiche du débrief ?")) return;
  if (useDebriefApi()) {
    debriefApiCall(
      apiRequest(
        `/quality/api/debriefs/${encodeURIComponent(debriefId)}/records/${encodeURIComponent(recordId)}`,
        { method: "DELETE" },
      ),
      "Fiche dissociée du débrief.",
    );
    return;
  }
  if (linkDebriefRecords(debriefId, [], [recordId]))
    toast("Fiche dissociée du débrief.");
}
function createDebrief(form) {
  const fd = new FormData(form);
  const agentName = String(fd.get("agentName") || "").trim();
  const employeeCodeFromFilename = String(
    fd.get("debriefFilenameEmployeeCode") || "",
  ).trim();
  if (!agentName) {
    toast(
      "Le nom de l’agent est requis. Choisissez un fichier audio ou saisissez le nom de l’agent.",
      "warning",
    );
    return;
  }
  const normalizeAgentName = (value) =>
    String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const digits = (value) => String(value || "").replace(/\D/g, "");
  const hintedAgent = getAgent(fd.get("agentId"));
  const linkedAgent =
    state.agents.find(
      (item) => normalizeAgentName(item.name) === normalizeAgentName(agentName),
    ) ||
    state.agents.find(
      (item) =>
        employeeCodeFromFilename &&
        digits(item.id) === digits(employeeCodeFromFilename),
    ) ||
    (hintedAgent &&
    normalizeAgentName(hintedAgent.name) === normalizeAgentName(agentName)
      ? hintedAgent
      : null);
  if (!linkedAgent) {
    toast(
      "Le nom est prérempli dans Agent, mais aucun agent du référentiel ne correspond. Choisissez un agent suggéré ou vérifiez le nom et le matricule avant d’enregistrer.",
      "warning",
    );
    return;
  }
  const agent = linkedAgent;
  const audioInput = form.querySelector?.('[name="debriefAudioFile"]');
  const audioFile = audioInput?.files?.[0];
  const sourceRecord = getRecord(String(fd.get("sourceRecordId") || ""));
  const pointerAudio =
    sourceRecord?.audio?.objectId || sourceRecord?.audio?.localUrl
      ? sourceRecord.audio
      : null;
  if (!audioFile && !pointerAudio) {
    toast(
      "Joignez l’enregistrement audio de la session de débrief.",
      "warning",
    );
    return;
  }
  const audioType = String(
    audioFile?.type || pointerAudio?.mime_type || "",
  ).toLowerCase();
  const audioName = String(
    audioFile?.name ||
      pointerAudio?.drive_file_name ||
      pointerAudio?.fileName ||
      "",
  );
  if (
    audioFile &&
    !audioType.startsWith("audio/") &&
    !/\.(mp3|wav|m4a|ogg|aac|flac|opus|aiff|wma)$/i.test(audioName)
  ) {
    toast(
      "Le fichier choisi ne semble pas être un audio. Sélectionnez un fichier audio.",
      "warning",
    );
    return;
  }
  const ratings = {};
  for (const item of DEBRIEF_RUBRIC) {
    const score = Number(fd.get(`rating_${item.key}`));
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      toast(
        `Attribuez une note de 1 à 5 étoiles pour « ${item.title} ».`,
        "warning",
      );
      return;
    }
    ratings[item.key] = score;
  }
  const requestedRecordIds = [
    ...fd.getAll("recordIds"),
    String(fd.get("recordId") || ""),
  ].filter(Boolean);
  const uniqueRequested = [...new Set(requestedRecordIds)];
  const recordIds = uniqueRequested.filter((id) => {
    const linkedRecord = getRecord(id);
    return (
      !!linkedRecord &&
      sameAgentIdentity(
        linkedAgent.id,
        linkedAgent.name,
        linkedRecord.employeeCode,
        linkedRecord.agent,
      )
    );
  });
  const skippedRecords = uniqueRequested
    .filter((id) => getRecord(id) && !recordIds.includes(id))
    .map((id) => recordIndexValue(getRecord(id)));
  const actionTitle = String(fd.get("actionTitle") || "").trim();
  const owner = String(fd.get("owner") || "").trim();
  const sessionDate = String(fd.get("date") || TODAY);
  const newId = `DB-2026-${String(state.debriefs.length + 35).padStart(3, "0")}`;
  const actions = actionTitle
    ? [
        {
          title: actionTitle,
          dueDate: fd.get("actionDue") || TODAY,
          status: "EN_COURS",
          owner: `${agent.name || "Agent"} + ${owner}`,
        },
      ]
    : [];
  const agentFolder = safeArchiveName(agent.name || "Agent").replace(
    /\s+/g,
    "_",
  );
  const driveFolderName = `${newId}_${agentFolder}_${sessionDate}`;
  const finish = (stored) => {
    let localUrl = "";
    if (!stored && audioFile)
      try {
        localUrl = URL.createObjectURL(audioFile);
      } catch (_) {}
    const audio = pointerAudio
      ? {
          fileName: audioName,
          mimeType: audioType || "application/octet-stream",
          fileSize: Number(pointerAudio.file_size || pointerAudio.fileSize) || 0,
          objectId: pointerAudio.objectId || undefined,
          storage: pointerAudio.objectId ? "MINIO" : undefined,
          sha256: pointerAudio.sha256,
          localUrl: pointerAudio.objectId ? "" : pointerAudio.localUrl || "",
          sourceRecordId: sourceRecord.id,
          driveFolderName,
          driveStatus: "LINKED_RECORD_AUDIO",
          dateUpload: currentTime(),
          uploadedBy: backend.user?.name || owner,
        }
      : stored
      ? {
          fileName: audioName,
          mimeType: audioType || "application/octet-stream",
          fileSize: Number(audioFile.size) || 0,
          objectId: stored.id,
          storage: "MINIO",
          sha256: stored.sha256,
          localUrl: "",
          driveFolderName,
          driveParentFolderId: null,
          driveFolderId: null,
          driveFileId: null,
          driveStatus: "STORED_MINIO",
          dateUpload: currentTime(),
          uploadedBy: backend.user?.name || owner,
        }
      : {
          fileName: audioName,
          mimeType: audioType || "application/octet-stream",
          fileSize: Number(audioFile.size) || 0,
          localUrl,
          driveFolderName,
          driveParentFolderId: state.driveFolderId || null,
          driveFolderId: null,
          driveFileId: null,
          driveStatus: "DEMO_NOT_UPLOADED",
          dateUpload: currentTime(),
          uploadedBy: owner,
        };
    let rawFilenameSegments = [];
    try {
      rawFilenameSegments = JSON.parse(fd.get("debriefFilenameParts") || "[]");
    } catch (_) {}
    const filenameMetadata = {
      rawFilename: audioName,
      rawSegments: rawFilenameSegments,
      agentName: String(fd.get("debriefFilenameAgent") || "").trim(),
      employeeCode: employeeCodeFromFilename,
      agentCivility: String(fd.get("debriefFilenameCivility") || "").trim(),
      extension: String(fd.get("debriefExtension") || "").trim(),
      sessionTime: String(fd.get("debriefSessionTime") || "").trim(),
      sourceRecordIndex: String(fd.get("debriefSourceIndex") || "").trim(),
      prospectNumber: String(fd.get("debriefProspectNumber") || "").trim(),
      baseName: String(fd.get("debriefBaseName") || "").trim(),
      campaignCode: String(fd.get("debriefCampaignCode") || "").trim(),
    };
    const d = {
      id: newId,
      agent: agent.name || "Agent non défini",
      agentId: linkedAgent?.id || null,
      employeeCode: linkedAgent?.id || employeeCodeFromFilename || "",
      date: sessionDate,
      owner: backend.user?.name || owner,
      recordIds,
      note: String(fd.get("note") || "").trim(),
      ratings,
      rubricVersion: 1,
      actions,
      audio,
      filenameMetadata,
    };
    state.debriefs.unshift(d);
    recordIds.forEach((recordId) =>
      addEvent(
        recordId,
        "Fiche associée à un débrief",
        `${newId} · ${d.agent}`,
        d.owner,
        "Qualiticienne",
      ),
    );
    saveState();
    closeModal();
    app.page = "debriefs";
    render();
    toast(
      (backend.enabled
        ? "Débrief créé et audio stocké dans S3 Bucket local."
        : `Débrief ${newId} créé en mode démonstration.`) +
        (skippedRecords.length
          ? ` Fiche(s) non liée(s) car elles n’appartiennent pas à ${agent.name} : ${skippedRecords.join(", ")}.`
          : ""),
      "warning",
    );
  };
  if (useDebriefApi()) {
    // l'audio est téléversé sous un identifiant provisoire; le serveur attribue l'identifiant du débrief et rattache l'audio
    const draftId = `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    let rawParts = [];
    try {
      rawParts = JSON.parse(fd.get("debriefFilenameParts") || "[]");
    } catch (_) {}
    const metadata = {
      rawFilename: audioName,
      rawSegments: rawParts,
      agentName: String(fd.get("debriefFilenameAgent") || "").trim(),
      employeeCode: employeeCodeFromFilename,
      agentCivility: String(fd.get("debriefFilenameCivility") || "").trim(),
      extension: String(fd.get("debriefExtension") || "").trim(),
      sessionTime: String(fd.get("debriefSessionTime") || "").trim(),
      sourceRecordIndex: String(fd.get("debriefSourceIndex") || "").trim(),
      prospectNumber: String(fd.get("debriefProspectNumber") || "").trim(),
      baseName: String(fd.get("debriefBaseName") || "").trim(),
      campaignCode: String(fd.get("debriefCampaignCode") || "").trim(),
    };
    backend.apiPending = (backend.apiPending || 0) + 1;
    (pointerAudio?.objectId
      ? Promise.resolve(null)
      : uploadAudioToLocalStore(audioFile, "debrief", draftId, "")
    )
      .then((stored) =>
        apiRequest("/quality/api/debriefs", {
          method: "POST",
          body: {
            agentId: agent.id,
            date: sessionDate,
            note: String(fd.get("note") || "").trim(),
            ratings,
            recordIds,
            action: actionTitle
              ? {
                  title: actionTitle,
                  dueDate: String(fd.get("actionDue") || TODAY),
                }
              : null,
            ...(stored
              ? { audioId: stored.id, filenameMetadata: metadata }
              : { sourceRecordId: sourceRecord.id }),
          },
        }),
      )
      .then((result) => {
        applyDebriefResult(result);
        closeModal();
        app.page = "debriefs";
        render();
        toast(
          `Débrief ${result.debrief.id} créé et audio stocké.` +
            (skippedRecords.length
              ? ` Fiche(s) non liée(s) car elles n’appartiennent pas à ${agent.name} : ${skippedRecords.join(", ")}.`
              : ""),
          "warning",
        );
      })
      .catch((error) => toast(error.message, "error"))
      .finally(() => {
        backend.apiPending = Math.max(0, (backend.apiPending || 1) - 1);
      });
    return;
  }
  finish(null);
}
function createCriterion(form) {
  const fd = new FormData(form);
  const stage = fd.get("stage");
  if (!stageNames.includes(stage)) return;
  const list =
    state.criteriaByStage[stage] || (state.criteriaByStage[stage] = []);
  const type = fd.get("type");
  const extra = {};
  if (type === "select" || type === "checkbox") {
    const group = (state.optionGroups || []).find(
      (g) => g.id === fd.get("groupId"),
    );
    if (!group) {
      toast(
        "Choisissez un groupe d’options pour ce type de réponse.",
        "warning",
      );
      return;
    }
    extra.groupId = group.id;
    extra.groupName = group.name;
    extra.options = group.options.map((o) => ({ ...o }));
  }
  if (useRecordApi()) {
    settingsApiCall(
      apiRequest("/quality/api/criteria", {
        method: "POST",
        body: {
          stage,
          section: String(fd.get("section") || "").trim(),
          label: String(fd.get("label") || "").trim(),
          type,
          description: fd.get("description") || "",
          weight: Number(fd.get("weight")) || 1,
          ...(type === "scale" ? { scaleSize: Number(fd.get("scaleSize")) || 5 } : {}),
          groupId: extra.groupId || "",
        },
      }),
      (result) => {
        (
          state.criteriaByStage[result.stage] ||
          (state.criteriaByStage[result.stage] = [])
        ).push(result.criterion);
      },
      "Critère ajouté à la grille dynamique.",
      () => {
        closeModal();
        app.page = "settings";
        app.settingsTab = "templates";
      },
    );
    return;
  }
  list.push({
    id: `crit-${Date.now()}`,
    section: fd.get("section").trim(),
    label: fd.get("label").trim(),
    type,
    description: fd.get("description") || "",
    weight: Number(fd.get("weight")) || 1,
    ...(type === "scale" ? { scaleSize: Number(fd.get("scaleSize")) || 5 } : {}),
    ...extra,
  });
  saveState();
  closeModal();
  app.page = "settings";
  app.settingsTab = "templates";
  render();
  toast("Critère ajouté à la grille dynamique.");
}
function createLabel(form) {
  const fd = new FormData(form);
  if (
    state.labels.some(
      (l) => l.name.toLowerCase() === fd.get("name").trim().toLowerCase(),
    )
  ) {
    toast("Ce libellé existe déjà.", "warning");
    return;
  }
  if (useRecordApi()) {
    settingsApiCall(
      apiRequest("/quality/api/labels", {
        method: "POST",
        body: {
          name: String(fd.get("name") || "").trim(),
          tone: fd.get("tone"),
        },
      }),
      (result) => {
        state.labels.push(result.label);
      },
      "Libellé créé.",
      () => closeModal(),
    );
    return;
  }
  state.labels.push({
    id: `lbl-${Date.now()}`,
    name: fd.get("name").trim(),
    tone: fd.get("tone"),
  });
  saveState();
  closeModal();
  render();
  toast("Libellé créé.");
}
function assignLabels(form) {
  const fd = new FormData(form);
  const r = getRecord(fd.get("recordId"));
  if (!r) return;
  if (useRecordApi()) {
    recordApiCall(
      apiRequest(`/quality/api/records/${encodeURIComponent(r.id)}/labels`, {
        method: "PUT",
        body: { labelIds: fd.getAll("labelIds") },
      }),
      "Libellés de la fiche mis à jour.",
      () => closeModal(),
    );
    return;
  }
  r.labels = fd.getAll("labelIds");
  syncRecordWorkflowLabels(r);
  addEvent(
    r.id,
    "Libellés mis à jour",
    r.labels
      .map((id) => getLabel(id)?.name)
      .filter(Boolean)
      .join(", ") || "Aucun libellé",
  );
  saveState();
  closeModal();
  render();
  toast("Libellés de la fiche mis à jour.");
}
function editRecordViaApi(form, fd, r) {
  const body = {};
  const send = (key, value) => {
    if (String(r[key] ?? "") !== String(value ?? "")) body[key] = value;
  };
  const text = (name) => String(fd.get(name) || "").trim();
  const chosen = resolveAgentInput(
    fd.get("agentName"),
    fd.get("agentCodeFromFilename"),
  );
  if (
    (chosen.name || r.agent).trim() !== r.agent ||
    (chosen.agent?.id || "") !== (r.employeeCode || "")
  ) {
    body.agentName = (chosen.name || r.agent).trim();
    if (chosen.agent?.id) body.agentId = chosen.agent.id;
  }
  for (const key of [
    "campaign",
    "campaignCode",
    "agentCivility",
    "agentCodeFromFilename",
    "recordIndex",
    "baseName",
    "clientCall1Status",
    "rawSegment6",
    "rawSegment7",
  ])
    send(key, text(key));
  send("callDate", fd.get("callDate"));
  send("callTime", String(fd.get("callTime") || ""));
  send("duration", String(fd.get("duration") || ""));
  send("extension", String(fd.get("extension") || ""));
  send("clientRef", String(fd.get("clientRef") || ""));
  const amount = fd.get("amount") ? Number(fd.get("amount")) : null;
  if (
    Number(r.amount ?? NaN) !== Number(amount ?? NaN) &&
    !(r.amount == null && amount == null)
  )
    body.amount = amount;
  if (
    canAssignRecords() &&
    fd.has("responsibleId") &&
    fd.get("responsibleId") !== "__legacy__"
  ) {
    const wantedId = String(fd.get("responsibleId") || "");
    if (wantedId !== String(r.responsibleId || ""))
      body.responsibleId = wantedId;
  }
  const newAudio = form.querySelector("[name=newAudioFile]")?.files?.[0];
  const upload = newAudio
    ? uploadAudioToLocalStore(newAudio, "call_record", r.id, r.clientId).then(
        (stored) => {
          body.audioId = stored.id;
        },
      )
    : Promise.resolve();
  upload
    .then(() => {
      if (!Object.keys(body).length) {
        closeModal();
        toast("Aucune modification à enregistrer.", "info");
        return;
      }
      return recordApiCall(
        apiRequest(`/quality/api/records/${encodeURIComponent(r.id)}`, {
          method: "PATCH",
          body,
        }),
        "Informations de la fiche mises à jour.",
        () => closeModal(),
      );
    })
    .catch((error) => toast(error.message, "error"));
}
function editRecord(form) {
  const fd = new FormData(form);
  const r = getRecord(fd.get("recordId"));
  if (!r) return;
  if (useRecordApi()) {
    editRecordViaApi(form, fd, r);
    return;
  }
  const before = `${r.agent} · ${r.campaign} · index ${r.recordIndex || "—"}`;
  const chosenAgent = resolveAgentInput(
    fd.get("agentName"),
    fd.get("agentCodeFromFilename"),
  );
  r.agent = (chosenAgent.name || r.agent).trim();
  r.employeeCode = chosenAgent.agent?.id || "";
  r.campaign = (fd.get("campaign") || "").trim();
  r.campaignCode = (fd.get("campaignCode") || "").trim();
  r.agentCivility = (fd.get("agentCivility") || "").trim();
  r.agentCodeFromFilename = (fd.get("agentCodeFromFilename") || "").trim();
  r.callDate = fd.get("callDate");
  r.callTime = fd.get("callTime");
  r.duration = fd.get("duration");
  r.durationSeconds = durationToSeconds(r.duration);
  r.recordIndex = (fd.get("recordIndex") || "").trim();
  r.baseName = (fd.get("baseName") || "").trim();
  r.clientCall1Status = (fd.get("clientCall1Status") || "").trim();
  r.rawSegment6 = (fd.get("rawSegment6") || "").trim();
  r.rawSegment7 = (fd.get("rawSegment7") || "").trim();
  if (
    canAssignRecords() &&
    fd.has("responsibleId") &&
    fd.get("responsibleId") !== "__legacy__"
  ) {
    const wantedId = String(fd.get("responsibleId") || "");
    const wanted = wantedId
      ? (app.assignableUsers || []).find((user) => user.id === wantedId) || null
      : null;
    if (
      String(wanted?.id || "") !== String(r.responsibleId || "") ||
      (!wanted && r.responsible)
    ) {
      const beforeName = r.responsible || "Non affecté";
      r.responsibleId = wanted?.id || "";
      r.responsible = wanted?.name || "";
      const followed = syncAutoTasksWithRecord(r);
      addEvent(
        r.id,
        "Qualiticien modifié",
        `${beforeName} → ${r.responsible || "Non affecté"}${followed ? ` · ${followed} tâche(s) automatique(s) réassignée(s)` : ""}`,
        backend.user?.name || "Sarah Ben Salem",
        "Qualiticienne",
      );
    }
  }
  r.extension = fd.get("extension");
  r.clientRef = fd.get("clientRef");
  r.amount = fd.get("amount") ? Number(fd.get("amount")) : null;
  addEvent(
    r.id,
    "Informations de la fiche modifiées",
    `${before} → ${r.agent} · ${r.campaign} · index ${r.recordIndex || "—"}`,
    "Sarah Ben Salem",
    "Qualiticienne",
  );
  const finish = () => {
    saveState();
    closeModal();
    render();
    toast("Informations de la fiche mises à jour.");
  };
  const newAudio = form.querySelector("[name=newAudioFile]")?.files?.[0];
  if (!newAudio) {
    finish();
    return;
  }
  const applyAudio = (audio) => {
    const previous = r.audio?.drive_file_name || "—";
    r.audio = audio;
    addEvent(
      r.id,
      "Audio remplacé",
      `${previous} → ${audio.drive_file_name}`,
      backend.user?.name || "Sarah Ben Salem",
      "Qualiticienne",
    );
    finish();
  };
  if (backend.enabled && backend.authenticated) {
    uploadAudioToLocalStore(newAudio, "call_record", r.id, r.clientId)
      .then(applyAudio)
      .catch((error) => toast(error.message, "error"));
    return;
  }
  let localUrl = "";
  try {
    localUrl = URL.createObjectURL(newAudio);
  } catch (_) {}
  applyAudio({
    drive_file_id: `DEMO-${Date.now()}`,
    drive_file_name: newAudio.name,
    drive_file_url: "",
    mime_type: newAudio.type || "application/octet-stream",
    file_size: newAudio.size,
    date_upload: currentTime(),
    uploaded_by: "Sarah Ben Salem",
    localUrl,
  });
}
function saveDriveSettings(form) {
  const fd = new FormData(form);
  if (useRecordApi()) {
    settingsApiCall(
      apiRequest("/quality/api/settings/drive", {
        method: "PUT",
        body: { driveFolderId: String(fd.get("driveFolder") || "").trim() },
      }),
      (result) => {
        state.driveFolderId = result.driveFolderId;
        state.driveConnected = result.driveConnected;
      },
      "Paramètre de stockage enregistré.",
    );
    return;
  }
  state.driveFolderId = fd.get("driveFolder").trim();
  state.driveConnected = !!state.driveFolderId;
  saveState();
  render();
  toast(
    state.driveConnected
      ? "Dossier Drive enregistré en mode démo."
      : "ID de dossier effacé. Aucun connecteur OAuth n’est actif.",
    state.driveConnected ? "warning" : "success",
  );
}
function confirmCloseRecord(id) {
  const r = getRecord(id);
  if (!r) return;
  if (!canCloseRecord(r)) {
    toast(
      "La fiche doit avoir au moins un retour client et une réévaluation postérieure au dernier retour avant clôture.",
      "warning",
    );
    return;
  }
  const latest = latestClientReturn(r);
  const body = `<div class="notice-inline">${ic("circle-check")}<span>La fiche conservera son audio, ses évaluations Synergy, tous les envois, les retours successifs et le journal complet.</span></div><div class="metric-list"><div class="metric-line"><span>Synergy #1</span><strong>${scoreFormat(r.internal1.score)}</strong></div><div class="metric-line"><span>Retours client conservés</span><strong>${getClientReturns(r).length}</strong></div><div class="metric-line"><span>Dernier retour</span><strong>#${Number(latest?.returnNumber) || 1} · ${esc(clientReturnStatusLabel(latest?.finalStatus || latest?.decision || "reçu"))}</strong></div><div class="metric-line"><span>Réévaluation</span><strong>${promiseStatusLabel(r.internal2.promiseStatus || r.internal2.finalStatus || r.internal2.decision)}</strong></div></div>`;
  showModal({
    title: "Clôturer le dossier",
    description: `L’indice ${esc(recordIndexValue(r))} passera au statut « Clôturée ».`,
    body,
    form: "closeRecord",
    submitText: "Clôturer définitivement",
    note: "Action tracée dans le journal",
  });
  modalRoot
    .querySelector("form")
    ?.insertAdjacentHTML(
      "afterbegin",
      `<input type="hidden" name="recordId" value="${esc(id)}"/>`,
    );
}
function closeRecord(id) {
  const r = getRecord(id);
  if (!r || !canCloseRecord(r)) return;
  if (useRecordApi()) {
    recordApiCall(
      apiRequest(`/quality/api/records/${encodeURIComponent(id)}/close`, {
        method: "POST",
        body: {},
      }),
      "Dossier clôturé. L’historique est conservé.",
      () => {
        closeModal();
        app.recordTab = "clientReturns";
      },
    );
    return;
  }
  r.closedAt = currentTime();
  r.closedBy = "Sarah Ben Salem";
  r.status = "cloture";
  const latest = latestClientReturn(r);
  addEvent(
    r.id,
    "Dossier clôturé",
    `Après la réévaluation · dernier retour client #${Number(latest?.returnNumber) || 1}`,
    "Sarah Ben Salem",
    "Qualiticienne",
  );
  saveState();
  closeModal();
  app.recordTab = "clientReturns";
  render();
  toast("Dossier clôturé. L’historique est conservé.");
}
const TASK_TYPES = [
  ["EVALUATION_1", "Évaluation #1"],
  ["CONTROLE", "Contrôle"],
  ["RETOUR_CLIENT", "Retour client"],
  ["REEVALUATION_2", "Réévaluation #2"],
  ["REPONSE_CLIENT", "Réponse client"],
  ["DEBRIEF", "Débrief"],
  ["SUIVI_AGENT", "Suivi agent"],
];
function canManageTasks() {
  return (
    !(backend.enabled && backend.authenticated) ||
    backend.permissions.has("tasks_manage")
  );
}
// L'assigné d'une tâche est stocké par nom; « À assigner » (valeur vide) = personne.
function taskAssigneeOptions(users, currentId = "", currentName = "") {
  const name = currentName === "À assigner" ? "" : currentName;
  const options = [
    { value: "", label: "À assigner", selected: !currentId && !name },
  ];
  users.forEach((user) =>
    options.push({
      value: user.id,
      label: user.name,
      selected: user.id === currentId || (!currentId && user.name === name),
    }),
  );
  if (
    (currentId || name) &&
    !users.some(
      (user) => user.id === currentId || (!currentId && user.name === name),
    )
  )
    options.push({
      value: "__legacy__",
      label: `${name || currentId} (non référencé)`,
      selected: true,
    });
  return options;
}
function resolveTaskAssignee(value) {
  const id = String(value || "");
  if (!id) return { name: "À assigner", id: "" };
  const user = (app.assignableUsers || []).find((u) => u.id === id);
  return user ? { name: user.name, id: user.id } : null;
}
// Les tâches automatiques (auto:true) encore ouvertes suivent le qualiticien de leur fiche.
function syncAutoTasksWithRecord(r) {
  if (backend.enabled) return 0;
  const assignee = r.responsible || "À assigner";
  const assigneeId = r.responsibleId || "";
  let count = 0;
  (state.tasks || []).forEach((task) => {
    if (
      task.recordId === r.id &&
      task.auto === true &&
      task.status !== "TERMINE" &&
      !task.archived &&
      (task.assignedTo !== assignee ||
        String(task.assignedToId || "") !== assigneeId)
    ) {
      task.assignedTo = assignee;
      task.assignedToId = assigneeId;
      count++;
    }
  });
  return count;
}
async function openEditTaskModal(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  if (!canManageTasks()) {
    toast("Votre rôle ne permet pas cette action (tasks_manage).", "warning");
    return;
  }
  let assignable = [];
  try {
    assignable = await loadAssignableUsers();
  } catch (error) {
    app.assignableUsers = [];
    toast("Liste des utilisateurs indisponible.", "warning");
  }
  const recordOptions = [
    { value: "", label: "Aucun indice associé" },
    ...state.records
      .filter((r) => !r.archived || r.id === t.recordId)
      .map((r) => ({
        value: r.id,
        label: `Indice ${recordIndexValue(r)} · ${r.agent}`,
        selected: r.id === t.recordId,
      })),
  ];
  const types = TASK_TYPES.some((x) => x[0] === t.type)
    ? TASK_TYPES
    : [...TASK_TYPES, [t.type, String(t.type).replaceAll("_", " ")]];
  const body = `<input type="hidden" name="taskId" value="${esc(t.id)}"/><div class="form-grid">${field("title", "Intitulé", { value: t.title || "", required: true, span: true })}${field("type", "Type de tâche", { select: types.map((x) => ({ value: x[0], label: x[1], selected: x[0] === t.type })), required: true })}${field("recordId", "Indice associé", { select: recordOptions })}${field("assignedTo", "Utilisateur assigné", { select: taskAssigneeOptions(assignable, t.assignedToId || "", t.assignedTo || "") })}${field("dueDate", "Échéance", { type: "date", value: t.dueDate || TODAY, required: true })}${field(
    "priority",
    "Priorité",
    {
      select: [
        ["BASSE", "Basse"],
        ["NORMALE", "Normale"],
        ["HAUTE", "Haute"],
        ["URGENTE", "Urgente"],
      ].map((x) => ({
        value: x[0],
        label: x[1],
        selected: x[0] === t.priority,
      })),
      required: true,
    },
  )}${field("status", "Statut", {
    select: [
      ["A_FAIRE", "À faire"],
      ["EN_COURS", "En cours"],
      ["TERMINE", "Terminée"],
    ].map((x) => ({ value: x[0], label: x[1], selected: x[0] === t.status })),
    required: true,
  })}</div>`;
  showModal({
    title: "Modifier la tâche",
    description: "Intitulé, fiche liée, assigné, échéance, priorité et statut.",
    body,
    form: "editTask",
    submitText: "Enregistrer la tâche",
  });
}
function saveTaskEdit(form) {
  const fd = new FormData(form);
  const t = state.tasks.find((x) => x.id === fd.get("taskId"));
  if (!t) return;
  if (!canManageTasks()) {
    toast("Votre rôle ne permet pas cette action (tasks_manage).", "warning");
    return;
  }
  const title = String(fd.get("title") || "").trim();
  const dueDate = String(fd.get("dueDate") || "");
  if (useTaskApi()) {
    if (!title) {
      toast("L’intitulé de la tâche est obligatoire.", "warning");
      return;
    }
    const body = {};
    const set = (key, value, current) => {
      if (String(value ?? "") !== String(current ?? "")) body[key] = value;
    };
    set("title", title, t.title);
    set("type", String(fd.get("type") || t.type), t.type);
    set(
      "recordId",
      String(fd.get("recordId") || "") || null,
      t.recordId || null,
    );
    if (fd.get("assignedTo") !== "__legacy__")
      set(
        "assignedToId",
        String(fd.get("assignedTo") || ""),
        t.assignedToId || "",
      );
    set("dueDate", dueDate, t.dueDate);
    set("priority", String(fd.get("priority") || t.priority), t.priority);
    set("status", String(fd.get("status") || t.status), t.status);
    if (!Object.keys(body).length) {
      closeModal();
      toast("Aucun changement à enregistrer.", "warning");
      return;
    }
    taskApiCall(
      apiRequest(`/quality/api/tasks/${encodeURIComponent(t.id)}`, {
        method: "PATCH",
        body,
      }),
      "Tâche mise à jour.",
      true,
    );
    return;
  }
  if (!title) {
    toast("L’intitulé de la tâche est obligatoire.", "warning");
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    toast("L’échéance est obligatoire.", "warning");
    return;
  }
  const before = `${taskDisplayTitle(t.title)} · ${t.assignedTo || "À assigner"} · ${formatDate(t.dueDate)}`;
  const status = String(fd.get("status") || t.status);
  t.title = title;
  t.type = String(fd.get("type") || t.type);
  t.recordId = String(fd.get("recordId") || "") || null;
  if (fd.get("assignedTo") !== "__legacy__") {
    const chosen = resolveTaskAssignee(fd.get("assignedTo")) || {
      name: "À assigner",
      id: "",
    };
    t.assignedTo = chosen.name;
    t.assignedToId = chosen.id;
  }
  t.dueDate = dueDate;
  t.priority = String(fd.get("priority") || t.priority);
  if (status !== t.status) {
    t.status = status;
    t.completedAt = status === "TERMINE" ? currentTime() : null;
  }
  if (t.recordId)
    addEvent(
      t.recordId,
      "Tâche modifiée",
      `${before} → ${taskDisplayTitle(t.title)} · ${t.assignedTo} · ${formatDate(t.dueDate)}`,
      backend.user?.name || "Sarah Ben Salem",
      "Qualiticienne",
    );
  saveState();
  closeModal();
  render();
  toast("Tâche mise à jour.");
}
function archiveTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t || t.archived) return;
  if (!canManageTasks()) {
    toast("Votre rôle ne permet pas cette action (tasks_manage).", "warning");
    return;
  }
  if (
    !confirm(
      "Supprimer cette tâche ? Elle sera archivée : masquée des listes et des compteurs, mais restaurable.",
    )
  )
    return;
  if (useTaskApi()) {
    taskApiCall(
      apiRequest(`/quality/api/tasks/${encodeURIComponent(id)}/archive`, {
        method: "POST",
        body: {},
      }),
      "Tâche archivée. Elle reste consultable avec le filtre « Tâches supprimées ».",
    );
    return;
  }
  t.archived = true;
  t.archivedAt = currentTime();
  t.archivedBy = backend.user?.name || "Sarah Ben Salem";
  if (t.recordId)
    addEvent(
      t.recordId,
      "Tâche supprimée (archivée)",
      taskDisplayTitle(t.title),
      t.archivedBy,
      "Qualiticienne",
    );
  saveState();
  render();
  toast(
    "Tâche archivée. Elle reste consultable avec le filtre « Tâches supprimées ».",
  );
}
function restoreTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t || !t.archived) return;
  if (!canManageTasks()) {
    toast("Votre rôle ne permet pas cette action (tasks_manage).", "warning");
    return;
  }
  if (useTaskApi()) {
    taskApiCall(
      apiRequest(`/quality/api/tasks/${encodeURIComponent(id)}/restore`, {
        method: "POST",
        body: {},
      }),
      "Tâche restaurée.",
    );
    return;
  }
  t.archived = false;
  t.archivedAt = null;
  t.archivedBy = null;
  if (t.recordId)
    addEvent(
      t.recordId,
      "Tâche restaurée",
      taskDisplayTitle(t.title),
      backend.user?.name || "Sarah Ben Salem",
      "Qualiticienne",
    );
  saveState();
  render();
  toast("Tâche restaurée.");
}
function toggleTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t || t.archived) return;
  if (useTaskApi()) {
    const next = t.status === "TERMINE" ? "A_FAIRE" : "TERMINE";
    taskApiCall(
      apiRequest(`/quality/api/tasks/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: { status: next },
      }),
      next === "TERMINE" ? "Tâche terminée." : "Tâche réouverte.",
    );
    return;
  }
  if (t.status === "TERMINE") {
    t.status = "A_FAIRE";
    t.completedAt = null;
  } else {
    t.status = "TERMINE";
    t.completedAt = currentTime();
    if (t.recordId)
      addEvent(
        t.recordId,
        "Tâche terminée",
        taskDisplayTitle(t.title),
        "Sarah Ben Salem",
        "Qualiticienne",
      );
  }
  saveState();
  render();
  toast(t.status === "TERMINE" ? "Tâche terminée." : "Tâche réouverte.");
}
function deleteLabel(id) {
  const target = getLabel(id);
  const name = String(target?.name || "")
    .trim()
    .toLowerCase();
  if (["retour client", "réévaluation", "retour final"].includes(name)) {
    toast(
      `Le libellé « ${target.name} » est requis par une étape du workflow.`,
      "warning",
    );
    return;
  }
  if (
    !confirm(
      "Supprimer ce libellé de la démonstration ? Les fiches conservent les autres libellés.",
    )
  )
    return;
  if (useRecordApi()) {
    settingsApiCall(
      apiRequest(`/quality/api/labels/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
      () => {
        state.labels = state.labels.filter((l) => l.id !== id);
        state.records.forEach(
          (r) => (r.labels = (r.labels || []).filter((x) => x !== id)),
        );
      },
      "Libellé supprimé.",
    );
    return;
  }
  state.labels = state.labels.filter((l) => l.id !== id);
  state.records.forEach(
    (r) => (r.labels = (r.labels || []).filter((x) => x !== id)),
  );
  saveState();
  render();
  toast("Libellé supprimé.");
}
function deleteCriterion(stage, id) {
  if (!confirm("Supprimer ce critère de la grille de démonstration ?")) return;
  if (useRecordApi()) {
    settingsApiCall(
      apiRequest(`/quality/api/criteria/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
      () => {
        state.criteriaByStage[stage] = (
          state.criteriaByStage[stage] || []
        ).filter((c) => c.id !== id);
      },
      "Critère supprimé. Les versions historiques déjà évaluées restent archivées.",
    );
    return;
  }
  state.criteriaByStage[stage] = (state.criteriaByStage[stage] || []).filter(
    (c) => c.id !== id,
  );
  saveState();
  render();
  toast(
    "Critère supprimé de la configuration locale. Les versions historiques de production doivent rester archivées.",
  );
}
function exportCsv(rows, filename) {
  if (!rows.length) {
    toast("Aucune donnée à exporter.", "warning");
    return;
  }
  const columns = [
    ["Date d’appel", "callDate"],
    ["Date de clôture", "closedAt"],
    ["Dossier (Nom de base)", "baseName"],
    ["Agent", "agent"],
    ["Indice", "recordIndex"],
    ["Client", "client"],
    ["Campagne", "campaign"],
    ["Code campagne", "campaignCode"],
    ["Matricule agent", "employeeCode"],
    ["Durée", "duration"],
    ["Nom audio", "sourceFilename"],
    ["N° de poste", "extension"],
    ["Référence client", "clientRef"],
    ["Statut fiche", "status"],
    ["Synergy #1 · score", "internal1.score"],
    ["Synergy #1 · conformité", "internal1.conformity"],
    ["Synergy #1 · statut final", "internal1.finalStatus"],
    ["Réévaluation · analyse", "internal2.analysisPoleQualite"],
    ["Réévaluation · promesse", "internal2.promiseStatus"],
    ["Réévaluation · don", "internal2.donConformity"],
    ["Retours client · historique", "clientReturns"],
    ["Retour final · historique", "finalReturnHistory"],
    ["Libellés", "labels"],
  ];
  const cellValue = (r, key) => {
    if (key === "clientReturns")
      return getClientReturns(r).map((ev) => ({
        numero: ev.returnNumber,
        date: ev.receivedAt,
        call1: ev.call1Status,
        statutFinal: clientReturnStatusLabel(ev.finalStatus || ev.decision),
        dejaDonateur: donorAnswerLabel(ev.alreadyDonor),
        remarques: ev.clientRemarks || ev.remarks || ev.comments || "",
      }));
    if (key === "finalReturnHistory")
      return finalReturnHistory(r).map((ev) => ({
        version: ev.version,
        date: ev.date,
        statut: finalReturnStatusLabel(ev.status || ev.decision),
      }));
    if (key === "labels")
      return (r.labels || [])
        .map((id) => getLabel(id)?.name)
        .filter(Boolean)
        .join(", ");
    return key.split(".").reduce((value, part) => value?.[part], r);
  };
  const csv = [
    columns.map(([label]) => label).join(";"),
    ...rows.map((r) =>
      columns
        .map(([, key]) => {
          const value = cellValue(r, key);
          return `"${String(value && typeof value === "object" ? JSON.stringify(value) : (value ?? "")).replaceAll('"', '""')}"`;
        })
        .join(";"),
    ),
  ].join("\r\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  toast("Export CSV préparé localement.");
}
function zipBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new TextEncoder().encode(String(value ?? ""));
}
function zipCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zipStamp(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}
function makeZipBlob(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  let centralSize = 0;
  const stamp = zipStamp();
  for (const entry of entries) {
    const name = new TextEncoder().encode(
      String(entry.name).replaceAll("\\", "/"),
    );
    const data = zipBytes(entry.data);
    const crc = zipCrc32(data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, stamp.time, true);
    lv.setUint16(12, stamp.date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    localParts.push(local, data);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, stamp.time, true);
    cv.setUint16(14, stamp.date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centralParts.push(central);
    centralSize += central.length;
    offset += local.length + data.length;
  }
  const centralOffset = offset;
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralOffset, true);
  ev.setUint16(20, 0, true);
  return new Blob([...localParts, ...centralParts, end], {
    type: "application/zip",
  });
}
function xmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
function excelColumn(index) {
  let n = index + 1,
    out = "";
  while (n) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}
function createClientReturnWorkbook(rows) {
  const headers = [
    "Date",
    "Dossier",
    "Agent",
    "Indice",
    "Retours client · historique",
    "ANALYSE POLE QUALITE",
    "Promesse",
    "Don",
    "Retour final",
    "Libellés",
    "État de la fiche",
  ];
  const data = [
    ["Fiches Qualicontact"],
    headers,
    ...rows.map((r) => {
      const returns = [...getClientReturns(r)].sort(
        (a, b) => Number(a.returnNumber || 0) - Number(b.returnNumber || 0),
      );
      const returnText = returns
        .map((ev) => {
          const donor =
            ev.alreadyDonor === true || ev.alreadyDonor === "OUI"
              ? "Oui"
              : ev.alreadyDonor === false || ev.alreadyDonor === "NON"
                ? "Non"
                : "—";
          return `#${Number(ev.returnNumber) || 1} · Call 1 : ${ev.call1Status || "—"} · Statut final : ${clientReturnStatusLabel(ev.finalStatus || ev.decision)} · Déjà donateur : ${donor}${ev.clientRemarks || ev.remarks || ev.comments ? ` · Remarques : ${ev.clientRemarks || ev.remarks || ev.comments}` : ""}`;
        })
        .join("\n");
      const finalEntries = finalReturnHistory(r);
      const finalText =
        finalEntries
          .map(
            (entry) =>
              `v${Number(entry.version) || 1} : ${finalReturnStatusLabel(entry.status || entry.decision)}`,
          )
          .join("\n") ||
        (r.clientFinal
          ? `Historique : ${finalReturnStatusLabel(r.clientFinal.status || r.clientFinal.decision)}`
          : "");
      const labels = (r.labels || [])
        .map((id) => getLabel(id)?.name)
        .filter(Boolean)
        .join(", ");
      return [
        r.callDate || "",
        r.closedAt ? String(r.closedAt).slice(0, 10) : "",
        r.baseName || "",
        r.agent || "",
        recordIndexValue(r, ""),
        returnText,
        r.internal2?.analysisPoleQualite || "",
        promiseStatusLabel(r.internal2?.promiseStatus || ""),
        donorConformityLabel(
          r.internal2?.donConformity || r.internal2?.donStatus || "",
        ),
        finalText,
        labels,
        statusText(r.status),
      ];
    }),
  ];
  const sheetRows = data
    .map(
      (row, ri) =>
        `<row r="${ri + 1}">${row
          .map((value, ci) => {
            const ref = `${excelColumn(ci)}${ri + 1}`;
            if (value == null || value === "") return `<c r="${ref}"/>`;
            if (typeof value === "number")
              return `<c r="${ref}"><v>${value}</v></c>`;
            return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
          })
          .join("")}</row>`,
    )
    .join("");
  const lastRow = data.length;
  const lastCol = excelColumn(headers.length - 1);
  const widths = [14, 24, 24, 12, 58, 48, 25, 22, 25, 40, 24];
  const cols = widths
    .map(
      (width, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`,
    )
    .join("");
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastCol}${lastRow}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${sheetRows}</sheetData><autoFilter ref="A2:${lastCol}${lastRow}"/><pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`;
  const files = [
    {
      name: "[Content_Types].xml",
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    },
    {
      name: "_rels/.rels",
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    },
    {
      name: "xl/workbook.xml",
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Fiches" sheetId="1" r:id="rId1"/></sheets></workbook>',
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    },
    { name: "xl/worksheets/sheet1.xml", data: worksheet },
  ];
  return makeZipBlob(files);
}
function safeArchiveName(value) {
  return (
    String(value || "audio")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\.\.+/g, "_")
      .trim() || "audio"
  );
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function collectBatchAudio(rows) {
  const files = [];
  const missing = [];
  const used = new Set();
  for (const r of rows) {
    const a = r.audio || {};
    const src = callAudioSource(r);
    const fallbackAudioName = `${safeArchiveName(r.baseName || "audio")}_${safeArchiveName(recordIndexValue(r, "indice-non-renseigne"))}.audio`;
    const original = safeArchiveName(a.drive_file_name || fallbackAudioName);
    if (!src) {
      missing.push({
        record: r.id,
        filename: original,
        reason: "Fichier audio non accessible dans cette démonstration",
      });
      continue;
    }
    try {
      const response = await fetch(src);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.length) throw new Error("fichier vide");
      let name = original;
      if (used.has(name)) {
        const dot = name.lastIndexOf(".");
        name =
          dot > 0
            ? `${name.slice(0, dot)}_${files.length + 1}${name.slice(dot)}`
            : `${name}_${files.length + 1}`;
      }
      used.add(name);
      files.push({
        record: r.id,
        name: `Enregistrements/${name}`,
        data: bytes,
      });
    } catch (error) {
      missing.push({
        record: r.id,
        filename: original,
        reason: `Téléchargement impossible (${error.message || "accès refusé"})`,
      });
    }
  }
  return { files, missing };
}
function bindAudio(root = document) {
  root.querySelectorAll(".audio-card").forEach((card) => {
    const audio = card.querySelector("[data-audio-element]");
    if (!audio || audio.dataset.bound) return;
    audio.dataset.bound = "1";
    audio.addEventListener("timeupdate", () => {
      const current = card.querySelector("[data-audio-current]");
      const seek = card.querySelector("[data-audio-seek]");
      const duration = card.querySelector("[data-audio-duration]");
      if (current) current.textContent = secondsToClock(audio.currentTime);
      if (seek && audio.duration)
        seek.value = Math.round((audio.currentTime / audio.duration) * 100);
      if (duration && Number.isFinite(audio.duration))
        duration.textContent = secondsToClock(audio.duration);
    });
    audio.addEventListener("loadedmetadata", () => {
      const d = card.querySelector("[data-audio-duration]");
      if (d) d.textContent = secondsToClock(audio.duration);
    });
    audio.addEventListener("ended", () => {
      const btn = card.querySelector('[data-action="audio-toggle"]');
      if (btn) btn.innerHTML = ic("play");
    });
  });
}
function secondsToClock(v) {
  if (!Number.isFinite(v)) return "00:00";
  const n = Math.max(0, Math.floor(v));
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}
function durationToSeconds(value) {
  const p = String(value || "")
    .split(":")
    .map(Number);
  if (p.some((x) => !Number.isFinite(x) || x < 0)) return null;
  if (p.length === 2 && p[1] < 60) return p[0] * 60 + p[1];
  if (p.length === 3 && p[1] < 60 && p[2] < 60)
    return p[0] * 3600 + p[1] * 60 + p[2];
  return null;
}
function audioAction(action, id, scope = document) {
  const audio = scope.querySelector("[data-audio-element]");
  if (!audio) {
    toast("Aucun flux audio local n’est associé à cette fiche.", "warning");
    return;
  }
  if (action === "audio-toggle") {
    if (audio.paused) {
      audio
        .play()
        .then(() => {
          const btn = scope.querySelector('[data-action="audio-toggle"]');
          if (btn) btn.innerHTML = ic("pause");
        })
        .catch(() =>
          toast("Impossible de lire ce format dans le navigateur.", "warning"),
        );
    } else {
      audio.pause();
      const btn = scope.querySelector('[data-action="audio-toggle"]');
      if (btn) btn.innerHTML = ic("play");
    }
  } else if (action === "audio-back")
    audio.currentTime = Math.max(0, audio.currentTime - 5);
  else if (action === "audio-forward")
    audio.currentTime = Math.min(
      audio.duration || Infinity,
      audio.currentTime + 5,
    );
}
function openDrive(id) {
  const r = getRecord(id);
  toast(
    r?.audio?.objectId
      ? "L’audio est disponible dans le lecteur sécurisé de la fiche."
      : "Aucun objet S3 Bucket local n’est associé à cet ancien enregistrement.",
    "warning",
  );
}
function closeSidebar() {
  document.getElementById("sidebar").classList.remove("open");
  document.querySelector(".sidebar-scrim").classList.remove("open");
}
function openSidebar() {
  document.getElementById("sidebar").classList.add("open");
  document.querySelector(".sidebar-scrim").classList.add("open");
}
function updateGlobalSearch(q) {
  if (!q.trim()) {
    searchResults.classList.remove("open");
    searchResults.innerHTML = "";
    return;
  }
  const term = q.toLowerCase();
  const matches = state.records
    .filter(
      (r) =>
        !r.archived &&
        recordSearchValues(r).some((x) =>
          String(x || "")
            .toLowerCase()
            .includes(term),
        ),
    )
    .slice(0, 7);
  searchResults.innerHTML = matches.length
    ? matches
        .map(
          (r) =>
            `<button class="search-result" data-open-record="${esc(r.id)}"><span class="result-icon">${ic("clipboard")}</span><span class="search-result-copy"><strong>Indice ${esc(recordIndexValue(r))} · ${esc(r.agent)}</strong><small>${esc(r.campaign)} · ${esc(statusText(r.status))}</small></span>${ic("chevron-right")}</button>`,
        )
        .join("")
    : `<div class="search-empty">Aucune fiche ne correspond à « ${esc(q)} ».</div>`;
  searchResults.classList.add("open");
}
function handleSubmit(event) {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  const type = form.dataset.form;
  if (
    backend.syncBlocked &&
    !["accessRole", "demoUser", "clientSendExport"].includes(type)
  ) {
    toast(
      "La synchronisation est suspendue. Téléchargez la copie de récupération ou rechargez DB avant de modifier les données.",
      "warning",
    );
    return;
  }
  switch (type) {
    case "authLogin":
      loginToLocalBackend(form);
      break;
    case "authChangePassword":
      changeLocalPassword(form);
      break;
    case "newRecord":
      createNewRecord(form);
      break;
    case "clientSendExport":
      downloadClientSendExport(form);
      break;
    case "confirmClientSendFtp":
      confirmClientSendFtp(form);
      break;
    case "clientReturn":
      saveClientReturn(form);
      break;
    case "finalReturn":
      saveFinalReturn(form);
      break;
    case "newTask":
      createTask(form);
      break;
    case "newDebrief":
      createDebrief(form);
      break;
    case "newCriterion":
      createCriterion(form);
      break;
    case "newLabel":
      createLabel(form);
      break;
    case "optionGroup":
      saveOptionGroup(form);
      break;
    case "agent":
      saveAgent(form);
      break;
    case "editDebrief":
      saveDebriefEdit(form);
      break;
    case "editTask":
      saveTaskEdit(form);
      break;
    case "linkRecordDebrief": {
      const fd = new FormData(form);
      openDebriefScoreModal(String(fd.get("debriefId") || ""), [
        String(fd.get("recordId") || ""),
      ]);
      break;
    }
    case "linkDebriefRecords": {
      const fd = new FormData(form);
      const ids = fd.getAll("recordIds");
      if (!ids.length) {
        toast("Cochez au moins une fiche.", "warning");
        break;
      }
      openDebriefScoreModal(String(fd.get("debriefId") || ""), ids);
      break;
    }
    case "debriefScoreLink":
      saveDebriefScoreLink(form);
      break;
    case "accessRole":
      saveAccessRole(form);
      break;
    case "demoUser":
      saveDemoUser(form);
      break;
    case "assignLabels":
      assignLabels(form);
      break;
    case "editRecord":
      editRecord(form);
      break;
    case "evaluation":
      saveEvaluation(form);
      break;
    case "saveDrive":
      saveDriveSettings(form);
      break;
    case "closeRecord":
      closeRecord(new FormData(form).get("recordId"));
      break;
    default:
      break;
  }
}
function permissionForAction(actionEl) {
  const action = actionEl?.dataset?.action;
  const fixed = {
    export: "api_dashboard_export",
    "export-record": "records_view",
    "new-record": "records_manage",
    "edit-record": "records_manage",
    "archive-record": "records_manage",
    "restore-record": "records_manage",
    "edit-task": "tasks_manage",
    "archive-task": "tasks_manage",
    "restore-task": "tasks_manage",
    "edit-debrief": "debriefs",
    "archive-debrief": "debriefs",
    "restore-debrief": "debriefs",
    "link-debrief-modal": "debriefs",
    "link-record-modal": "debriefs",
    "unlink-debrief": "debriefs",
    "new-task": "tasks",
    "toggle-task": "tasks",
    "new-debrief": "debriefs",
    "new-criterion": "quality_settings",
    "add-criterion": "quality_settings",
    "delete-criterion": "quality_settings",
    "new-label": "quality_settings",
    "delete-label": "quality_settings",
    "new-group": "quality_settings",
    "edit-group": "quality_settings",
    "delete-group": "quality_settings",
    "save-drive": "quality_settings",
    "new-role": "users_roles",
    "edit-role": "users_roles",
    "delete-role": "users_roles",
    "new-user": "users_roles",
    "edit-user": "users_roles",
    "delete-user": "users_roles",
    "reactivate-user": "users_roles",
    "assign-label": "records_manage",
    "prepare-client-send": "client_send",
    "prepare-client-send-export": "client_send",
    "confirm-client-send-ftp": "client_send",
    "close-record": "final_return",
    "open-task-record": "tasks",
    "open-drive": "records_view",
    "client-role-info": "portal",
    "portal-open-record": "portal",
    "open-client-feedback": "client_returns",
    "reset-demo": "users_roles",
  };
  if (action === "begin-evaluation")
    return actionEl.dataset.stage === "internal2" ? "reevaluation" : "synergy1";
  if (action === "open-final-return-modal") return "final_return";
  if (action === "init-empty-state") return "users_roles";
  return fixed[action] || "";
}
function handleAction(actionEl) {
  const action = actionEl.dataset.action;
  const id =
    actionEl.dataset.recordId || actionEl.dataset.openRecord || app.recordId;
  if (
    backend.syncBlocked &&
    [
      "toggle-task",
      "delete-criterion",
      "delete-label",
      "delete-group",
      "archive-record",
      "restore-record",
      "delete-agent",
      "archive-debrief",
      "restore-debrief",
      "archive-task",
      "restore-task",
    ].includes(action)
  ) {
    toast(
      "La synchronisation est suspendue. Téléchargez la copie de récupération ou rechargez DB avant de modifier les données.",
      "warning",
    );
    return;
  }
  const requiredPermission = permissionForAction(actionEl);
  if (
    backend.enabled &&
    backend.authenticated &&
    requiredPermission &&
    !backend.permissions.has(requiredPermission)
  ) {
    toast(
      `Votre rôle ne permet pas cette action (${requiredPermission}).`,
      "warning",
    );
    return;
  }
  switch (action) {
    case "download-pending-changes":
      downloadPendingSnapshot();
      break;
    case "reload-server-state":
      reloadServerStateAfterConflict();
      break;

    case "new-record":
      openNewRecord();
      break;
    case "portal-open-record":
      openRecord(id, actionEl.dataset.stage || "clientReturns");
      break;
    case "new-task":
      openTaskModal(actionEl.dataset.recordId || "");
      break;
    case "debrief-back":
      app.openDebriefId = null;
      render();
      break;
    case "new-debrief":
      openDebriefModal(
        actionEl.dataset.recordId || "",
        actionEl.dataset.agentId || "",
      );
      break;
    case "new-label":
      openLabelModal();
      break;
    case "edit-task":
      openEditTaskModal(actionEl.dataset.taskId);
      break;
    case "archive-task":
      archiveTask(actionEl.dataset.taskId);
      break;
    case "restore-task":
      restoreTask(actionEl.dataset.taskId);
      break;
    case "edit-debrief":
      openEditDebriefModal(actionEl.dataset.debriefId);
      break;
    case "archive-debrief":
      archiveDebrief(actionEl.dataset.debriefId);
      break;
    case "restore-debrief":
      restoreDebrief(actionEl.dataset.debriefId);
      break;
    case "link-debrief-modal":
      openLinkDebriefModal(actionEl.dataset.recordId);
      break;
    case "link-record-modal":
      openLinkRecordModal(actionEl.dataset.debriefId);
      break;
    case "unlink-debrief":
      unlinkDebriefRecord(
        actionEl.dataset.debriefId,
        actionEl.dataset.recordId,
      );
      break;
    case "new-agent":
      openAgentModal();
      break;
    case "edit-agent":
      openAgentModal(actionEl.dataset.agentId);
      break;
    case "delete-agent":
      deleteAgent(actionEl.dataset.agentId);
      break;
    case "new-group":
      openGroupModal();
      break;
    case "edit-group":
      openGroupModal(actionEl.dataset.groupId);
      break;
    case "delete-group":
      deleteOptionGroup(actionEl.dataset.groupId);
      break;
    case "new-role":
      openRoleModal();
      break;
    case "edit-role":
      openRoleModal(actionEl.dataset.roleId);
      break;
    case "delete-role":
      deleteAccessRole(actionEl.dataset.roleId);
      break;
    case "new-user":
      openDemoUserModal();
      break;
    case "edit-user":
      openDemoUserModal(actionEl.dataset.userId);
      break;
    case "reactivate-user":
      reactivateUser(actionEl.dataset.userId);
      break;
    case "delete-user":
      deleteDemoUser(actionEl.dataset.userId);
      break;
    case "add-criterion":
      openCriterionModal(actionEl.dataset.stage);
      break;
    case "delete-label":
      deleteLabel(actionEl.dataset.labelId);
      break;
    case "delete-criterion":
      deleteCriterion(actionEl.dataset.stage, actionEl.dataset.criterionId);
      break;
    case "assign-label":
      openAssignLabel(actionEl.dataset.recordId);
      break;
    case "archive-record":
      archiveRecord(actionEl.dataset.recordId);
      break;
    case "restore-record":
      restoreRecord(actionEl.dataset.recordId);
      break;
    case "edit-record":
      openEditRecord(actionEl.dataset.recordId);
      break;
    case "begin-evaluation":
      stageFromAction(actionEl);
      break;
    case "open-record":
      openRecord(
        actionEl.dataset.recordId || id,
        actionEl.dataset.recordTab || "internal1",
      );
      break;
    case "open-client-feedback":
      openEvaluationModal(id, "clientReturns");
      break;
    case "prepare-client-send":
      if (clientSendAllowed(getRecord(id))) {
        app.selectedToSend.clear();
        app.selectedToSend.add(id);
        app.page = "send";
        app.fromPage = "record";
        render();
      } else
        toast(
          "Cette fiche n’est plus disponible dans la liste d’envoi.",
          "warning",
        );
      break;
    case "prepare-client-send-export":
      openClientSendExportModal();
      break;
    case "confirm-client-send-ftp":
      openClientSendFtpModal();
      break;
    case "close-record":
      confirmCloseRecord(id);
      break;
    case "toggle-task":
      toggleTask(actionEl.dataset.taskId);
      break;
    case "open-task-record": {
      const task = state.tasks.find((t) => t.id === actionEl.dataset.taskId);
      openRecord(
        actionEl.dataset.recordId || task?.recordId,
        actionEl.dataset.recordTab || taskRecordTab(task),
      );
      break;
    }
    case "open-drive":
      openDrive(id);
      break;
    case "audio-toggle":
    case "audio-back":
    case "audio-forward":
      audioAction(action, id, actionEl.closest(".audio-card") || document);
      break;
    case "close-modal":
      closeModal();
      break;
    case "open-sidebar":
      openSidebar();
      break;
    case "close-sidebar":
      closeSidebar();
      break;
    case "record-back": {
      const back = app.fromPage || "records";
      app.page = back;
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
      break;
    }
    case "open-final-return":
      openFinalReturn(actionEl.dataset.recordId || app.recordId);
      break;
    case "open-final-return-modal":
      openFinalReturnModal(actionEl.dataset.recordId || app.recordId);
      break;
    case "open-comparison":
      openFinalReturn(actionEl.dataset.recordId || app.recordId);
      break;
    case "clear-send-filters":
      Object.assign(app.filterSend, {
        status: "all",
        campaign: "all",
        callFrom: "",
        callTo: "",
        closedFrom: "",
        closedTo: "",
      });
      render();
      break;
    case "clear-record-filters":
      Object.assign(app.filterRecords, {
        search: "",
        status: "all",
        campaign: "all",
        compliance: "all",
        callFrom: "",
        callTo: "",
        closedFrom: "",
        closedTo: "",
      });
      render();
      break;
    case "export":
      if (backend.enabled && backend.authenticated)
        apiRequest("/quality/api/dashboard/export")
          .then((result) =>
            exportCsv(
              result.summary?.agentMetrics || [],
              "qualicontact-statistiques-agents.csv",
            ),
          )
          .catch((error) => toast(error.message, "error"));
      else
        exportCsv(
          state.records.filter((r) => !r.archived),
          "qualicontact-fiches-demo.csv",
        );
      break;
    case "export-record": {
      const r = getRecord(actionEl.dataset.recordId);
      if (r)
        exportCsv(
          [r],
          `${safeArchiveName(r.baseName || "base")}_${safeArchiveName(recordIndexValue(r, "indice-non-renseigne"))}.csv`,
        );
      break;
    }
    case "notifications":
      toast(
        "Aucune notification nouvelle dans cette démonstration.",
        "warning",
      );
      break;
    case "client-role-info":
      toast(
        backend.enabled
          ? "Vue client locale : chaque requête API est filtrée par rôle et client affecté."
          : "Vue de démonstration locale; aucune isolation API réelle n’est active.",
        "warning",
      );
      break;
    case "user-menu":
      if (backend.enabled && backend.authenticated) logoutLocalBackend();
      else
        toast(
          "Session de démonstration · Sarah Ben Salem · Qualiticienne",
          "warning",
        );
      break;
    case "auth-logout":
      logoutLocalBackend();
      break;
    case "auth-retry":
      initializeBackendAuth();
      break;
    case "copy-temporary-password":
      if (backend.temporaryPassword && navigator.clipboard?.writeText)
        navigator.clipboard
          .writeText(backend.temporaryPassword)
          .then(() => toast("Mot de passe copié."))
          .catch(() =>
            toast(
              "Copie impossible; sélectionnez le texte affiché.",
              "warning",
            ),
          );
      else toast("La copie automatique n’est pas disponible.", "warning");
      break;
    case "init-empty-state":
      initializeEmptyStateOnServer().catch((error) =>
        toast(error.message, "error"),
      );
      break;
    case "reset-demo":
      if (backend.enabled && backend.authenticated)
        toast(
          "La base DB n’est jamais réinitialisée depuis le navigateur. Utilisez une procédure de sauvegarde/restauration administrateur.",
          "warning",
        );
      else if (
        confirm(
          "Réinitialiser toutes les modifications locales et restaurer les données de démonstration ?",
        )
      ) {
        localStorage.removeItem(DB_KEY);
        window.location.reload();
      }
      break;
    default:
      break;
  }
}

document.addEventListener("click", (event) => {
  if (event.target === modalRoot) {
    closeModal();
    return;
  }
  if (!searchResults.contains(event.target) && event.target !== searchInput)
    searchResults.classList.remove("open");
  const sendPager = event.target.closest("[data-send-page]");
  if (sendPager) {
    if (!sendPager.disabled) {
      app.sendPage = Number(sendPager.dataset.sendPage) || 1;
      render();
    }
    return;
  }
  const recordPager = event.target.closest("[data-record-page]");
  if (recordPager) {
    if (!recordPager.disabled) {
      app.recordPage = Number(recordPager.dataset.recordPage) || 1;
      render();
    }
    return;
  }
  const debriefPager = event.target.closest("[data-debrief-page]");
  if (debriefPager && !debriefPager.disabled) {
    app.debriefPage = Number(debriefPager.dataset.debriefPage) || 1;
    document.getElementById("debriefTable").innerHTML = renderDebriefTable();
    return;
  }
  const debriefRow = event.target.closest("[data-debrief-open]");
  if (debriefRow) {
    app.openDebriefId = debriefRow.dataset.debriefOpen;
    render();
    return;
  }
  const pageButton = event.target.closest("[data-page]");
  if (pageButton) {
    event.preventDefault();
    const page = pageButton.dataset.page;
    if (pageButton.dataset.settingsTab)
      app.settingsTab = pageButton.dataset.settingsTab;
    goPage(page);
    return;
  }
  const settingTab = event.target.closest("[data-settings-tab]");
  if (settingTab) {
    if (
      backend.enabled &&
      backend.authenticated &&
      !canOpenSettingsTab(settingTab.dataset.settingsTab)
    ) {
      toast("Votre rôle ne permet pas d’accéder à ces paramètres.", "warning");
      return;
    }
    app.settingsTab = settingTab.dataset.settingsTab;
    render();
    return;
  }
  const recTab = event.target.closest("[data-record-tab]");
  if (recTab) {
    const permission = {
      internal1: "synergy1",
      clientReturns: "client_returns",
      internal2: "reevaluation",
      finalReturn: "final_return",
    }[recTab.dataset.recordTab];
    if (
      backend.enabled &&
      backend.authenticated &&
      permission &&
      !backend.permissions.has(permission) &&
      !backend.permissions.has("records_view")
    ) {
      toast("Votre rôle ne permet pas de consulter cette étape.", "warning");
      return;
    }
    app.recordTab = recTab.dataset.recordTab;
    render();
    return;
  }
  const agent = event.target.closest("[data-agent-profile]");
  if (agent) {
    if (!canOpenPage("agentProfile")) {
      toast("Votre rôle ne permet pas d’accéder au profil agent.", "warning");
      return;
    }
    app.agentId = agent.dataset.agentProfile;
    app.page = "agentProfile";
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  if (event.target.matches("input[data-send-select]")) return;
  const action = event.target.closest("[data-action]");
  if (action) {
    handleAction(action);
    return;
  }
  const record = event.target.closest("[data-open-record]");
  if (record) {
    openRecord(
      record.dataset.openRecord,
      record.dataset.recordTab || "internal1",
    );
    return;
  }
  const searchRecord = event.target.closest("[data-search-record]");
  if (searchRecord) {
    openRecord(searchRecord.dataset.searchRecord);
    return;
  }
});
document.addEventListener("submit", handleSubmit);
document.addEventListener("input", (event) => {
  if (event.target.matches("[data-debrief-filter]")) {
    app.debriefFilters[event.target.dataset.debriefFilter] = event.target.value;
    app.debriefPage = 1;
    const table = document.getElementById("debriefTable");
    if (table) table.innerHTML = renderDebriefTable();
    return;
  }
  if (event.target === searchInput) {
    updateGlobalSearch(searchInput.value);
    return;
  }
  if (event.target.matches('[data-filter="search"]')) {
    app.filterRecords.search = event.target.value;
    const pos = event.target.selectionStart;
    mainContent.innerHTML = renderRecords();
    const next = mainContent.querySelector("#recordSearch");
    next?.focus();
    try {
      next?.setSelectionRange(pos, pos);
    } catch (_) {}
    return;
  }
  if (
    event.target.matches(
      'form[data-form="editDebrief"] input[name="agentName"]',
    )
  ) {
    refreshDebriefRecordChoices(event.target.form);
    return;
  }
  if (event.target.matches('input[name="agentName"][list="agentOptions"]')) {
    fillAgentMatricule(event.target);
    return;
  }
  if (event.target.id === "agentSearch") {
    const q = event.target.value.toLowerCase();
    document.querySelectorAll(".agent-card").forEach((card) => {
      card.classList.toggle(
        "hidden",
        !card.textContent.toLowerCase().includes(q),
      );
    });
    return;
  }
  if (event.target.matches("[data-audio-seek]")) {
    const audio = event.target
      .closest(".audio-card")
      ?.querySelector("[data-audio-element]");
    if (audio?.duration)
      audio.currentTime = (Number(event.target.value) / 100) * audio.duration;
    return;
  }
});
document.addEventListener("change", (event) => {
  if (event.target.matches("[data-debrief-page-size]")) {
    app.debriefPageSize = Number(event.target.value) || 10;
    app.debriefPage = 1;
    document.getElementById("debriefTable").innerHTML = renderDebriefTable();
    return;
  }
  if (
    event.target.matches('form[data-form="newTask"] select[name="recordId"]')
  ) {
    const wanted = getRecord(event.target.value)?.responsibleId || "";
    const select = event.target.form.elements.namedItem("assignedTo");
    if (
      select &&
      wanted &&
      [...select.options].some((option) => option.value === wanted)
    )
      select.value = wanted;
  }
  if (
    event.target.matches("[data-user-account-type],[data-user-role-choice]")
  ) {
    updateDemoUserForm(event.target.form);
    return;
  }
  if (event.target.matches("[data-user-role]")) {
    assignUserRole(event.target.dataset.userRole, event.target.value);
    return;
  }
  if (event.target.name === "audioFile") {
    const file = event.target.files?.[0];
    if (file) updateFilenameParsePreview(file, event.target.form);
    return;
  }
  if (event.target.name === "debriefAudioFile") {
    updateDebriefFilenameFields(
      event.target.files?.[0] || null,
      event.target.form,
    );
    return;
  }
  if (event.target.matches('[data-filter="status"]')) {
    app.filterRecords.status = event.target.value;
    render();
    return;
  }
  if (event.target.matches('[data-filter="campaign"]')) {
    app.filterRecords.campaign = event.target.value;
    render();
    return;
  }
  if (event.target.matches('[data-filter="compliance"]')) {
    app.filterRecords.compliance = event.target.value;
    render();
    return;
  }
  const sendKey = event.target.dataset?.sendFilter;
  if (sendKey && sendKey in app.filterSend) {
    app.filterSend[sendKey] = event.target.value;
    render();
    return;
  }
  const dateKey = event.target.dataset?.filter;
  if (["callFrom", "callTo", "closedFrom", "closedTo"].includes(dateKey)) {
    app.filterRecords[dateKey] = event.target.value;
    render();
    return;
  }
  if (event.target.matches('[data-filter="archived"]')) {
    app.filterRecords.archived = event.target.value;
    render();
    return;
  }
  if (event.target.matches('[data-filter="debriefView"]')) {
    app.debriefView = event.target.value;
    render();
    return;
  }
  if (event.target.matches("[data-send-select]")) {
    if (event.target.checked)
      app.selectedToSend.add(event.target.dataset.sendSelect);
    else app.selectedToSend.delete(event.target.dataset.sendSelect);
    render();
    return;
  }
  if (event.target.id === "feedbackFilter") {
    app.feedbackFilter = event.target.value;
    render();
    return;
  }
  if (event.target.id === "taskFilter") {
    app.taskFilter = event.target.value;
    render();
    return;
  }
  if (event.target.id === "batchStatusFilter") {
    app.batchStatus = event.target.value;
    render();
    return;
  }
  if (event.target.matches("[data-audio-speed]")) {
    const audio = event.target
      .closest(".audio-card")
      ?.querySelector("[data-audio-element]");
    if (audio) audio.playbackRate = Number(event.target.value);
    return;
  }
});
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    searchInput.focus();
  }
  if (event.key === "Escape") {
    if (modalRoot.classList.contains("open")) closeModal();
    searchResults.classList.remove("open");
    closeSidebar();
  }
});
initializeBackendAuth();
