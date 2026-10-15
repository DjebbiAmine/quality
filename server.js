'use strict';
require('dotenv').config();
const path=require('node:path');
const fs=require('node:fs');
const os=require('node:os');
const crypto=require('node:crypto');
const {promisify}=require('node:util');
const express=require('express');
const helmet=require('helmet');
const rateLimit=require('express-rate-limit');
const multer=require('multer');
const bcrypt=require('bcryptjs');
const {Pool}=require('pg');
const {S3Client,HeadBucketCommand,CreateBucketCommand,PutObjectCommand,GetObjectCommand,DeleteObjectCommand}=require('@aws-sdk/client-s3');
const {ALL_ACTIVITY_IDS,calculateDashboardSummary,filterStateForUser}=require('./rbac');
const {mergeSendStateChange,hasClientScope,canAccessCallAudio,isDebriefAudioAttached}=require('./state-store');
const {loadAgents}=require('./agents-store');
const {loadRelational,persistRelational,canonicalizeRelational,RELATIONAL_KEYS}=require('./relational-store');

const app=express();
app.disable('x-powered-by');
app.use(helmet({contentSecurityPolicy:false,crossOriginEmbedderPolicy:false}));
app.use(express.json({limit:'25mb'}));
app.use(express.urlencoded({extended:false,limit:'2mb'}));

const pool=new Pool({connectionString:process.env.DATABASE_URL,max:12,idleTimeoutMillis:30000,connectionTimeoutMillis:5000});
pool.on('error',error=>console.error('PostgreSQL pool error:',error.message));
const minioEndpoint=process.env.MINIO_ENDPOINT||'';
const minioReady=!!(minioEndpoint&&process.env.MINIO_ACCESS_KEY&&process.env.MINIO_SECRET_KEY&&process.env.MINIO_BUCKET);
const s3=minioReady?new S3Client({region:process.env.MINIO_REGION||'us-east-1',endpoint:minioEndpoint,forcePathStyle:true,credentials:{accessKeyId:process.env.MINIO_ACCESS_KEY,secretAccessKey:process.env.MINIO_SECRET_KEY}}):null;
const poolReady=process.env.DATABASE_URL?true:false;
const sessionHours=Math.max(1,Math.min(24,Number(process.env.SESSION_TTL_HOURS)||8));
const SESSION_COOKIE='qc_sid';const CSRF_COOKIE='qc_csrf';
const secureCookie=process.env.NODE_ENV==='production';
const loginAttempts=rateLimit({windowMs:15*60*1000,limit:12,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Trop de tentatives de connexion. Réessayez plus tard.'}});
const upload=multer({dest:path.join(os.tmpdir(),'qualicontact-audio'),limits:{fileSize:(Number(process.env.MAX_AUDIO_MIB)||500)*1024*1024,files:1}});

function cookieValue(req,name){
  const header=String(req.headers.cookie||'');
  for(const part of header.split(';')){const index=part.indexOf('=');if(index<0)continue;if(part.slice(0,index).trim()===name)return decodeURIComponent(part.slice(index+1).trim());}
  return '';
}
function setCookie(res,name,value,{httpOnly=true,maxAge=0,sameSite='Strict'}={}){
  const attrs=[`${name}=${encodeURIComponent(value)}`,'Path=/',`SameSite=${sameSite}`];
  if(maxAge)attrs.push(`Max-Age=${Math.floor(maxAge/1000)}`);
  if(httpOnly)attrs.push('HttpOnly');
  if(secureCookie)attrs.push('Secure');
  res.append('Set-Cookie',attrs.join('; '));
}
function clearCookie(res,name,httpOnly=true){
  const attrs=[`${name}=`,`Path=/`,'Max-Age=0','SameSite=Strict'];if(httpOnly)attrs.push('HttpOnly');if(secureCookie)attrs.push('Secure');res.append('Set-Cookie',attrs.join('; '));
}
function timingSafeEqualText(a,b){const left=Buffer.from(String(a||''));const right=Buffer.from(String(b||''));return left.length===right.length&&crypto.timingSafeEqual(left,right)}
function sha256(value){return crypto.createHash('sha256').update(value).digest('hex')}
function csrfToken(req,res){
  let token=cookieValue(req,CSRF_COOKIE);
  if(!/^[A-Za-z0-9_-]{32,}$/.test(token)){token=crypto.randomBytes(32).toString('base64url');setCookie(res,CSRF_COOKIE,token,{httpOnly:false,maxAge:12*60*60*1000,sameSite:'Strict'});}
  return token;
}
function verifyCsrf(req,res,next){
  if(['GET','HEAD','OPTIONS'].includes(req.method))return next();
  const cookie=cookieValue(req,CSRF_COOKIE);const header=String(req.get('x-csrf-token')||'');
  if(!cookie||!header||!timingSafeEqualText(cookie,header))return res.status(403).json({error:'Jeton CSRF invalide. Rechargez la page et réessayez.',code:'CSRF'});
  next();
}
app.use('/quality/api',verifyCsrf);
function requireAuth(req,res,next){
  const raw=cookieValue(req,SESSION_COOKIE);
  if(!raw)return res.status(401).json({error:'Connexion requise.',code:'AUTH_REQUIRED'});
  (async()=>{
    const tokenHash=sha256(raw);
    const result=await pool.query(`select s.user_id,u.email,u.full_name,u.active,u.must_change_password
      from public.app_sessions s join public.app_users u on u.id=s.user_id
      where s.token_hash=$1 and s.expires_at>now()`,[tokenHash]);
    const user=result.rows[0];
    if(!user||!user.active){clearCookie(res,SESSION_COOKIE);return res.status(401).json({error:'Session invalide ou compte désactivé.',code:'AUTH_REQUIRED'});}
    const [roles,permissions]=await Promise.all([
      pool.query(`select r.id,r.code,r.name,r.scope,ur.client_id from public.app_user_roles ur
        join public.app_roles r on r.id=ur.role_id where ur.user_id=$1 and ur.active order by r.name`,[user.user_id]),
      pool.query(`select distinct rp.permission_code from public.app_user_roles ur
        join public.app_role_permissions rp on rp.role_id=ur.role_id
        where ur.user_id=$1 and ur.active order by rp.permission_code`,[user.user_id])
    ]);
    await pool.query('update public.app_sessions set last_seen_at=now() where token_hash=$1',[tokenHash]);
    req.auth={id:user.user_id,email:user.email,fullName:user.full_name,active:user.active,mustChangePassword:user.must_change_password,
      roles:roles.rows,permissions:new Set(permissions.rows.map(row=>row.permission_code)),clientIds:[...new Set(roles.rows.map(row=>row.client_id).filter(Boolean).map(String))],tokenHash};
    next();
  })().catch(next);
}
function requireReadyPassword(req,res,next){if(req.auth?.mustChangePassword)return res.status(428).json({error:'Vous devez changer le mot de passe provisoire avant de continuer.',code:'PASSWORD_CHANGE_REQUIRED'});next()}
function requirePermission(code){return (req,res,next)=>{if(!req.auth?.permissions?.has(code))return res.status(403).json({error:`Permission requise : ${code}.`,code:'PERMISSION_DENIED',permission:code});next()}}
function requireAnyPermission(codes){return (req,res,next)=>{if(!codes.some(code=>req.auth?.permissions?.has(code)))return res.status(403).json({error:'Aucune permission ne permet cette opération.',code:'PERMISSION_DENIED'});next()}}
function authPayload(auth){return {id:auth.id,email:auth.email,name:auth.fullName,active:auth.active,mustChangePassword:auth.mustChangePassword,
  roles:auth.roles.map(role=>({id:role.id,code:role.code,name:role.name,scope:role.scope,clientId:role.client_id})),permissions:[...auth.permissions],clientIds:auth.clientIds};}
async function audit(actorId,action,targetType,targetId,details={},requestId='',db=pool){
  await db.query(`insert into public.app_audit_log(actor_id,action,target_type,target_id,details,request_id)
    values($1,$2,$3,$4,$5::jsonb,$6)`,[actorId||null,action,targetType,targetId||null,JSON.stringify(details||{}),requestId||null]);
}
function isPlainObject(value){return !!value&&typeof value==='object'&&!Array.isArray(value)}
function validPermissionList(values){return Array.isArray(values)&&values.every(value=>ALL_ACTIVITY_IDS.includes(value))}
function validateRolePayload(body){
  const name=String(body?.name||'').trim();const description=String(body?.description||'').trim();const scope=String(body?.scope||'organization');const activities=[...new Set((body?.activities||[]).map(String))];
  if(name.length<2||name.length>80)throw Object.assign(new Error('Le nom du rôle doit contenir entre 2 et 80 caractères.'),{status:400});
  if(!['organization','assigned_client'].includes(scope))throw Object.assign(new Error('Portée de rôle invalide.'),{status:400});
  if(!activities.length||!validPermissionList(activities))throw Object.assign(new Error('Liste de permissions invalide.'),{status:400});
  const clientAllowed=new Set(['portal','client_returns','final_return']);
  if(scope==='assigned_client'&&activities.some(code=>!clientAllowed.has(code)))throw Object.assign(new Error('Un rôle client peut uniquement recevoir portail, retours client et retour final.'),{status:400});
  if(scope==='assigned_client'&&!activities.includes('portal'))throw Object.assign(new Error('Un rôle à portée client doit autoriser l’accès au portail.'),{status:400});
  return {name,description,scope,activities};
}
function publicRole(row){return {id:row.id,name:row.name,description:row.description,scope:row.scope,activities:row.activities||[],system:!!row.is_system};}
function cleanProfileName(value){return String(value||'').trim().replace(/\s+/g,' ').slice(0,100)}
function setSessionCookie(res,raw){setCookie(res,SESSION_COOKIE,raw,{httpOnly:true,maxAge:sessionHours*60*60*1000,sameSite:'Strict'});}
function getPermissionsForPage(auth){return [...(auth.permissions||[])];}

// État métier en PostgreSQL; les permissions sont contrôlées ici, puis à chaque endpoint.
app.get('/quality/api/auth/status',(req,res)=>res.json({authRequired:true,storage:'local-postgresql-minio',version:1,minioConfigured:minioReady}));
app.get('/quality/api/auth/csrf',(req,res)=>res.json({csrfToken:csrfToken(req,res)}));
app.post('/quality/api/auth/login',loginAttempts,async(req,res)=>{
  const email=String(req.body?.email||'').trim().toLowerCase();const password=String(req.body?.password||'');
  if(!email||!password)return res.status(400).json({error:'Saisissez votre e-mail et votre mot de passe.'});
  const result=await pool.query('select id,email,full_name,password_hash,active,must_change_password from public.app_users where lower(email)=lower($1) and active',[email]);
  const user=result.rows[0];const valid=!!user&&!!user.active&&await bcrypt.compare(password,user.password_hash);
  if(!valid){await audit(null,'auth.login_failed','user',null,{email});return res.status(401).json({error:'E-mail ou mot de passe incorrect.',code:'INVALID_CREDENTIALS'});}
  const raw=crypto.randomBytes(32).toString('base64url');const tokenHash=sha256(raw);const ip=(req.ip||'').replace(/^::ffff:/,'');
  await pool.query('delete from public.app_sessions where expires_at<now()');
  await pool.query(`insert into public.app_sessions(token_hash,user_id,expires_at,user_agent,ip_address)
    values($1,$2,now()+($3::int * interval '1 hour'),$4,$5)`,[tokenHash,user.id,sessionHours,String(req.get('user-agent')||'').slice(0,300),ip||null]);
  await pool.query('update public.app_users set last_login_at=now() where id=$1',[user.id]);
  setSessionCookie(res,raw);await audit(user.id,'auth.login','user',user.id,{email:user.email},req.get('x-request-id'));
  const roles=await pool.query(`select r.id,r.code,r.name,r.scope,ur.client_id from public.app_user_roles ur join public.app_roles r on r.id=ur.role_id where ur.user_id=$1 and ur.active order by r.name`,[user.id]);
  const permissions=await pool.query(`select distinct rp.permission_code from public.app_user_roles ur join public.app_role_permissions rp on rp.role_id=ur.role_id where ur.user_id=$1 and ur.active order by rp.permission_code`,[user.id]);
  res.json({user:{id:user.id,email:user.email,name:user.full_name,active:true,mustChangePassword:user.must_change_password,
    roles:roles.rows.map(role=>({id:role.id,code:role.code,name:role.name,scope:role.scope,clientId:role.client_id})),permissions:permissions.rows.map(row=>row.permission_code),
    clientIds:[...new Set(roles.rows.map(role=>role.client_id).filter(Boolean))]}});
});
app.get('/quality/api/auth/me',requireAuth,(req,res)=>res.json({user:authPayload(req.auth)}));
app.post('/quality/api/auth/logout',requireAuth,async(req,res)=>{
  await pool.query('delete from public.app_sessions where token_hash=$1',[req.auth.tokenHash]);
  await audit(req.auth.id,'auth.logout','user',req.auth.id,{},req.get('x-request-id'));
  clearCookie(res,SESSION_COOKIE);res.json({ok:true});
});
app.post('/quality/api/auth/change-password',requireAuth,async(req,res)=>{
  const password=String(req.body?.password||'');if(password.length<12)return res.status(400).json({error:'Le mot de passe doit compter au moins 12 caractères.'});
  const hash=await bcrypt.hash(password,12);
  await pool.query('update public.app_users set password_hash=$2,must_change_password=false,updated_at=now() where id=$1',[req.auth.id,hash]);
  await pool.query('delete from public.app_sessions where user_id=$1 and token_hash<>$2',[req.auth.id,req.auth.tokenHash]);
  await audit(req.auth.id,'auth.password_changed','user',req.auth.id,{},req.get('x-request-id'));
  res.json({ok:true});
});

// L'état applicatif = JSON résiduel (réglages) + agents (crm_agents) + fiches, événements, lots, tâches, débriefs et grilles (tables crm_*).
async function loadFullState(db){
  const result=await db.query("select data,version,updated_at from public.crm_state where id='main'");
  if(!result.rows.length)return null;
  const row=result.rows[0];
  const [agents,relational]=await Promise.all([loadAgents(db),loadRelational(db)]);
  return {row,data:{...row.data,agents,...relational}};
}
app.get('/quality/api/state',requireAuth,requireReadyPassword,requireAnyPermission(['api_dashboard_read','records_view','records_manage','synergy1','client_returns','reevaluation','final_return','client_send','debriefs','agents','tasks','portal','quality_settings']),async(req,res)=>{
  const full=await loadFullState(pool);
  if(!full)return res.json({initialized:false,data:null,version:0});
  const row=full.row;res.set('ETag',`"${row.version}"`);
  res.json({initialized:true,data:filterStateForUser(full.data,req.auth),version:Number(row.version),updatedAt:row.updated_at});
});
app.post('/quality/api/state/initialize-empty',requireAuth,requireReadyPassword,requirePermission('users_roles'),async(req,res)=>{
  const empty={labels:[],driveFolderId:'',driveConnected:false};
  const client=await pool.connect();
  try{
    await client.query('begin');
    const inserted=await client.query("insert into public.crm_state(id,data,version,updated_by) values('main',$1::jsonb,1,$2) on conflict(id) do nothing returning version",[JSON.stringify(empty),req.auth.id]);
    if(!inserted.rows.length){await client.query('rollback');return res.status(409).json({error:'La base CRM est déjà initialisée. Aucune donnée n’a été modifiée.',code:'STATE_ALREADY_INITIALIZED'});}
    await client.query(`insert into public.app_audit_log(actor_id,action,target_type,target_id,details,request_id) values($1,'crm.state.initialized_empty','crm_state','main',$2::jsonb,$3)`,[req.auth.id,JSON.stringify({records:0,tasks:0,debriefs:0}),req.get('x-request-id')||null]);
    await client.query('commit');res.status(201).json({initialized:true,version:1,counts:{records:0,tasks:0,debriefs:0}});
  }catch(error){await client.query('rollback').catch(()=>{});throw error}finally{client.release()}
});
// Qualiticiens affectables : utilisateurs actifs ayant un rôle Qualiticien ou Responsable qualité.
const ASSIGNABLE_ROLE_IDS=['role-qualitician','role-quality-lead'];
async function assignableUsers(db){
  const result=await db.query(`select distinct u.id,u.full_name as name from public.app_users u
    join public.app_user_roles ur on ur.user_id=u.id and ur.active
    where u.active and ur.role_id=any($1::text[]) order by u.full_name`,[ASSIGNABLE_ROLE_IDS]);
  return result.rows;
}
require('./tasks-api').registerTaskRoutes(app,{pool,requireAuth,requireReadyPassword,requirePermission,assignableUsers,audit});
require('./debriefs-api').registerDebriefRoutes(app,{pool,requireAuth,requireReadyPassword,requirePermission,audit});
require('./records-api').registerRecordRoutes(app,{pool,requireAuth,requireReadyPassword,requirePermission,requireAnyPermission,assignableUsers,audit});
require('./record-workflow-api').registerRecordWorkflowRoutes(app,{pool,requireAuth,requireReadyPassword,requireAnyPermission,requirePermission,audit});
require('./grids-api').registerGridRoutes(app,{pool,requireAuth,requireReadyPassword,requirePermission,audit});
require('./settings-api').registerSettingsRoutes(app,{pool,requireAuth,requireReadyPassword,requirePermission,audit});
require('./agents-api').registerAgentRoutes(app,{pool,requireAuth,requireReadyPassword,requireAnyPermission,audit});
app.get('/quality/api/qualiticians',requireAuth,requireReadyPassword,requireAnyPermission(['records_manage','records_assign']),async(req,res)=>{
  res.json({users:await assignableUsers(pool)});
});
app.put('/quality/api/state',requireAuth,requireReadyPassword,requireAnyPermission(['records_manage','synergy1','client_returns','reevaluation','final_return','client_send','debriefs','agents','tasks','quality_settings']),async(req,res)=>{
  const incoming=req.body?.data;const expected=Number(req.body?.version);
  if(!isPlainObject(incoming)||!Number.isInteger(expected)||expected<1)return res.status(400).json({error:'Version ou état CRM invalide.'});
  const client=await pool.connect();
  try{
    await client.query('begin');const result=await client.query("select data,version from public.crm_state where id='main' for update");
    if(!result.rows.length){await client.query('rollback');return res.status(404).json({error:'La base CRM n’est pas encore initialisée.',code:'STATE_NOT_INITIALIZED'});}
    const current=result.rows[0];const version=Number(current.version);
    // Les agents vivent dans la table crm_agents (matricule = clé primaire) et sont injectés dans l'état pour la fusion.
    const currentAgents=await loadAgents(client);const currentRelational=await loadRelational(client);current.data={...current.data,agents:currentAgents,...currentRelational};
    if(version!==expected){await client.query('rollback');return res.status(409).json({error:'Les données ont été modifiées par un autre profil. Rechargez la fiche avant de réessayer.',code:'STATE_VERSION_CONFLICT',version});}
    // Les lignes envoyées par le navigateur sont ramenées à leur forme canonique (horodatages, dates, nombres) avant toute
    // comparaison : une ligne inchangée est strictement égale à celle de la base, quel que soit le format que le navigateur garde.
    // Tâches et débriefs passent par leurs routes dédiées (/quality/api/tasks, /quality/api/debriefs) : ceux d'un ancien navigateur sont ignorés.
    const incomingState={...incoming};delete incomingState.tasks;delete incomingState.debriefs;
    let canonicalIncoming;
    try{canonicalIncoming=canonicalizeRelational(incomingState)}catch(error){await client.query('rollback');return res.status(400).json({error:`Données invalides : ${error.message}`,code:'DATA_INVALID'})}
    // PUT /state ne sert plus qu'au circuit d'envoi client : toute autre modification est refusée (routes dédiées).
    const merged=mergeSendStateChange(current.data,canonicalIncoming,req.auth);
    const newVersion=version+1;
    await persistRelational(client,currentRelational,merged.data);
    const storedState={...merged.data};delete storedState.agents;for(const key of RELATIONAL_KEYS)delete storedState[key];
    await client.query("update public.crm_state set data=$1::jsonb,version=$2,updated_at=now(),updated_by=$3 where id='main'",[JSON.stringify(storedState),newVersion,req.auth.id]);
    const changedSections=Object.keys(merged.data).filter(key=>JSON.stringify(merged.data[key])!==JSON.stringify(current.data[key]));
    await client.query(`insert into public.app_audit_log(actor_id,action,target_type,target_id,details,request_id) values($1,'crm.state.updated','crm_state','main',$2::jsonb,$3)`,[req.auth.id,JSON.stringify({sections:changedSections,permissions:merged.requiredPermissions}),req.get('x-request-id')||null]);
    await client.query('commit');res.json({ok:true,version:newVersion,updatedAt:new Date().toISOString()});
  }catch(error){await client.query('rollback').catch(()=>{});throw error}finally{client.release()}
});
app.get('/quality/api/dashboard/summary',requireAuth,requireReadyPassword,requirePermission('api_dashboard_read'),async(req,res)=>{
  const full=await loadFullState(pool);
  if(!full)return res.json({initialized:false,version:0,summary:null});
  const allowedState=filterStateForUser(full.data,req.auth);
  const summary=calculateDashboardSummary(allowedState);
  await audit(req.auth.id,'api.dashboard.read','dashboard','main',{version:Number(full.row.version)},req.get('x-request-id'));
  res.set('Cache-Control','private, no-store');res.json({initialized:true,version:Number(full.row.version),updatedAt:full.row.updated_at,summary});
});
app.get('/quality/api/dashboard/export',requireAuth,requireReadyPassword,requirePermission('api_dashboard_export'),async(req,res)=>{
  const full=await loadFullState(pool);
  if(!full)return res.status(404).json({error:'Aucune donnée à exporter.'});
  const summary=calculateDashboardSummary(filterStateForUser(full.data,req.auth));
  await audit(req.auth.id,'api.dashboard.export','dashboard','main',{version:Number(full.row.version)},req.get('x-request-id'));
  res.set('Cache-Control','private, no-store');res.json({summary});
});

app.get('/quality/api/admin/access',requireAuth,requireReadyPassword,requirePermission('users_roles'),async(req,res)=>{
  const [roles,users,assignments]=await Promise.all([
    pool.query(`select r.id,r.name,r.description,r.scope,r.is_system,coalesce(array_agg(rp.permission_code order by rp.permission_code) filter(where rp.permission_code is not null),'{}') activities
      from public.app_roles r left join public.app_role_permissions rp on rp.role_id=r.id group by r.id order by r.name`),
    pool.query(`select u.id,u.email,u.full_name,u.active,u.must_change_password,u.created_at,u.last_login_at from public.app_users u order by lower(u.full_name)`),
    pool.query('select user_id,role_id,client_id from public.app_user_roles where active')
  ]);
  const usersOut=users.rows.map(user=>{const assignment=assignments.rows.find(row=>row.user_id===user.id);return {id:user.id,email:user.email,name:user.full_name,active:user.active,mustChangePassword:user.must_change_password,createdAt:user.created_at,lastLoginAt:user.last_login_at,roleId:assignment?.role_id||'',clientId:assignment?.client_id||'',accountType:assignment?.client_id?'client':'internal',role:assignment?.client_id?'Utilisatrice client':'Utilisateur interne'};});
  const userRoleAssignments=Object.fromEntries(assignments.rows.map(row=>[row.user_id,row.role_id]));
  res.json({roles:roles.rows.map(publicRole),users:usersOut,userRoleAssignments,assignments:assignments.rows});
});
app.post('/quality/api/admin/roles',requireAuth,requireReadyPassword,requirePermission('users_roles'),async(req,res)=>{
  const role=validateRolePayload(req.body);const id=`role-${crypto.randomUUID()}`;const client=await pool.connect();
  try{await client.query('begin');await client.query('insert into public.app_roles(id,code,name,description,scope,is_system) values($1,$2,$3,$4,$5,false)',[id,id,role.name,role.description,role.scope]);
    for(const code of role.activities)await client.query('insert into public.app_role_permissions(role_id,permission_code) values($1,$2)',[id,code]);
    await client.query('insert into public.app_audit_log(actor_id,action,target_type,target_id,details) values($1,$2,$3,$4,$5::jsonb)',[req.auth.id,'rbac.role.created','role',id,JSON.stringify({name:role.name,activities:role.activities})]);await client.query('commit');
    res.status(201).json({role:{id,name:role.name,description:role.description,scope:role.scope,activities:role.activities,system:false}});
  }catch(error){await client.query('rollback').catch(()=>{});throw error}finally{client.release()}
});
app.put('/quality/api/admin/roles/:id',requireAuth,requireReadyPassword,requirePermission('users_roles'),async(req,res)=>{
  const role=validateRolePayload(req.body);const id=String(req.params.id);if(id==='role-admin'&&!role.activities.includes('users_roles'))return res.status(409).json({error:'Le rôle Administrateur doit conserver la permission de gérer les accès.'});const client=await pool.connect();
  try{await client.query('begin');const exists=await client.query('select id,is_system from public.app_roles where id=$1 for update',[id]);if(!exists.rows.length){await client.query('rollback');return res.status(404).json({error:'Rôle introuvable.'});}
    await client.query('update public.app_roles set name=$2,description=$3,scope=$4,updated_at=now() where id=$1',[id,role.name,role.description,role.scope]);
    await client.query('delete from public.app_role_permissions where role_id=$1',[id]);for(const code of role.activities)await client.query('insert into public.app_role_permissions(role_id,permission_code) values($1,$2)',[id,code]);
    await client.query('insert into public.app_audit_log(actor_id,action,target_type,target_id,details) values($1,$2,$3,$4,$5::jsonb)',[req.auth.id,'rbac.role.updated','role',id,JSON.stringify({name:role.name,activities:role.activities})]);await client.query('commit');
    res.json({role:{id,name:role.name,description:role.description,scope:role.scope,activities:role.activities,system:exists.rows[0].is_system}});
  }catch(error){await client.query('rollback').catch(()=>{});throw error}finally{client.release()}
});
app.delete('/quality/api/admin/roles/:id',requireAuth,requireReadyPassword,requirePermission('users_roles'),async(req,res)=>{
  const id=String(req.params.id);const client=await pool.connect();
  try{await client.query('begin');const role=await client.query('select id,is_system,name from public.app_roles where id=$1 for update',[id]);if(!role.rows.length){await client.query('rollback');return res.status(404).json({error:'Rôle introuvable.'});}
    if(role.rows[0].is_system){await client.query('rollback');return res.status(409).json({error:'Un rôle système ne peut pas être supprimé.'});}
    const assigned=await client.query('select 1 from public.app_user_roles where role_id=$1 and active limit 1',[id]);if(assigned.rows.length){await client.query('rollback');return res.status(409).json({error:'Ce rôle est attribué. Réattribuez d’abord les profils concernés.'});}
    await client.query('delete from public.app_roles where id=$1',[id]);await client.query('insert into public.app_audit_log(actor_id,action,target_type,target_id,details) values($1,$2,$3,$4,$5::jsonb)',[req.auth.id,'rbac.role.deleted','role',id,JSON.stringify({name:role.rows[0].name})]);await client.query('commit');res.json({ok:true});
  }catch(error){await client.query('rollback').catch(()=>{});throw error}finally{client.release()}
});

function validateUserPayload(body){
  const name=cleanProfileName(body?.name);const email=String(body?.email||'').trim().toLowerCase();const roleId=String(body?.roleId||'');const clientId=String(body?.clientId||'').trim();
  if(name.length<2)throw Object.assign(new Error('Le nom doit comporter au moins deux caractères.'),{status:400});
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Object.assign(new Error('Adresse e-mail invalide.'),{status:400});
  if(!roleId)throw Object.assign(new Error('Choisissez un rôle.'),{status:400});
  return {name,email,roleId,clientId,active:body?.active!==false};
}
async function loadRole(client,roleId){const result=await client.query('select id,scope,name from public.app_roles where id=$1',[roleId]);if(!result.rows.length)throw Object.assign(new Error('Rôle introuvable.'),{status:400});return result.rows[0]}
async function assertNotLastAdministrator(client,userId,newRoleId,active=true){
  const current=await client.query("select 1 from public.app_user_roles where user_id=$1 and role_id='role-admin' and active limit 1",[userId]);
  if(current.rows.length&&(!active||newRoleId!=='role-admin')){const count=await client.query("select count(distinct ur.user_id)::int n from public.app_user_roles ur join public.app_users u on u.id=ur.user_id where ur.role_id='role-admin' and ur.active and u.active");if(count.rows[0].n<=1)throw Object.assign(new Error('Impossible de retirer le dernier administrateur actif.'),{status:409})}
}
function generateTemporaryPassword(){return `${crypto.randomBytes(14).toString('base64url')}#A1!`}
app.post('/quality/api/admin/users',requireAuth,requireReadyPassword,requirePermission('users_roles'),async(req,res)=>{
  const payload=validateUserPayload(req.body);const client=await pool.connect();
  try{await client.query('begin');const role=await loadRole(client,payload.roleId);if(role.scope==='assigned_client'&&!payload.clientId)throw Object.assign(new Error('Un client doit être affecté à ce compte.'),{status:400});if(role.scope==='organization'&&payload.clientId)throw Object.assign(new Error('Un profil organisation ne reçoit pas de client affecté.'),{status:400});
    const id=`u-${crypto.randomUUID()}`;const temporaryPassword=generateTemporaryPassword();const passwordHash=await bcrypt.hash(temporaryPassword,12);
    await client.query('insert into public.app_users(id,email,full_name,password_hash) values($1,$2,$3,$4)',[id,payload.email,payload.name,passwordHash]);
    await client.query('insert into public.app_user_roles(user_id,role_id,client_id,assigned_by) values($1,$2,$3,$4)',[id,role.id,role.scope==='assigned_client'?payload.clientId:null,req.auth.id]);
    await client.query('insert into public.app_audit_log(actor_id,action,target_type,target_id,details) values($1,$2,$3,$4,$5::jsonb)',[req.auth.id,'rbac.user.created','user',id,JSON.stringify({email:payload.email,roleId:role.id,clientId:payload.clientId||null})]);await client.query('commit');
    res.status(201).json({user:{id,email:payload.email,name:payload.name,active:true,roleId:role.id,clientId:payload.clientId,accountType:role.scope==='assigned_client'?'client':'internal',role:role.scope==='assigned_client'?'Utilisatrice client':'Utilisateur interne',mustChangePassword:true},temporaryPassword});
  }catch(error){await client.query('rollback').catch(()=>{});throw error}finally{client.release()}
});
app.put('/quality/api/admin/users/:id',requireAuth,requireReadyPassword,requirePermission('users_roles'),async(req,res)=>{
  const id=String(req.params.id);const payload=validateUserPayload(req.body);const client=await pool.connect();
  try{await client.query('begin');await client.query('select pg_advisory_xact_lock(733100421)');const role=await loadRole(client,payload.roleId);if(role.scope==='assigned_client'&&!payload.clientId)throw Object.assign(new Error('Un client doit être affecté à ce compte.'),{status:400});if(role.scope==='organization'&&payload.clientId)throw Object.assign(new Error('Un profil organisation ne reçoit pas de client affecté.'),{status:400});
    const existing=await client.query('select id from public.app_users where id=$1 for update',[id]);if(!existing.rows.length){await client.query('rollback');return res.status(404).json({error:'Utilisateur introuvable.'});}
    if(id===req.auth.id&&!payload.active)throw Object.assign(new Error('Vous ne pouvez pas désactiver votre propre compte.'),{status:409});
    await assertNotLastAdministrator(client,id,role.id,payload.active);
    await client.query('update public.app_users set email=$2,full_name=$3,active=$4,updated_at=now() where id=$1',[id,payload.email,payload.name,payload.active]);
    await client.query('delete from public.app_user_roles where user_id=$1',[id]);await client.query('insert into public.app_user_roles(user_id,role_id,client_id,assigned_by) values($1,$2,$3,$4)',[id,role.id,role.scope==='assigned_client'?payload.clientId:null,req.auth.id]);
    if(!payload.active)await client.query('delete from public.app_sessions where user_id=$1',[id]);
    await client.query('insert into public.app_audit_log(actor_id,action,target_type,target_id,details) values($1,$2,$3,$4,$5::jsonb)',[req.auth.id,payload.active?'rbac.user.updated':'rbac.user.deactivated','user',id,JSON.stringify({email:payload.email,roleId:role.id,clientId:payload.clientId||null,active:payload.active})]);await client.query('commit');
    res.json({user:{id,email:payload.email,name:payload.name,active:payload.active,roleId:role.id,clientId:payload.clientId,accountType:role.scope==='assigned_client'?'client':'internal',role:role.scope==='assigned_client'?'Utilisatrice client':'Utilisateur interne'}});
  }catch(error){await client.query('rollback').catch(()=>{});throw error}finally{client.release()}
});
app.delete('/quality/api/admin/users/:id',requireAuth,requireReadyPassword,requirePermission('users_roles'),async(req,res)=>{
  const id=String(req.params.id);if(id===req.auth.id)return res.status(409).json({error:'Vous ne pouvez pas désactiver votre propre compte.'});const client=await pool.connect();
  try{await client.query('begin');await client.query('select pg_advisory_xact_lock(733100421)');await assertNotLastAdministrator(client,id,'',false);
    const result=await client.query('update public.app_users set active=false,updated_at=now() where id=$1 returning id,email',[id]);if(!result.rows.length){await client.query('rollback');return res.status(404).json({error:'Utilisateur introuvable.'});}
    await client.query('delete from public.app_sessions where user_id=$1',[id]);await client.query(`insert into public.app_audit_log(actor_id,action,target_type,target_id,details,request_id) values($1,'rbac.user.deactivated','user',$2,$3::jsonb,$4)`,[req.auth.id,id,JSON.stringify({email:result.rows[0].email}),req.get('x-request-id')||null]);await client.query('commit');res.json({ok:true});
  }catch(error){await client.query('rollback').catch(()=>{});throw error}finally{client.release()}
});
app.post('/quality/api/admin/users/:id/reactivate',requireAuth,requireReadyPassword,requirePermission('users_roles'),async(req,res)=>{
  const id=String(req.params.id);const client=await pool.connect();
  try{
    await client.query('begin');await client.query('select pg_advisory_xact_lock(733100421)');
    const found=await client.query('select id,email,active from public.app_users where id=$1 for update',[id]);
    if(!found.rows.length){await client.query('rollback');return res.status(404).json({error:'Utilisateur introuvable.'});}
    const user=found.rows[0];
    if(user.active){await client.query('rollback');return res.status(409).json({error:'Ce compte est déjà actif.'});}
    const clash=await client.query('select 1 from public.app_users where active and lower(email)=lower($1) and id<>$2 limit 1',[user.email,id]);
    if(clash.rows.length){await client.query('rollback');return res.status(409).json({error:'Un compte actif utilise déjà l’adresse e-mail de ce compte : impossible de le réactiver.',code:'EMAIL_IN_USE'});}
    await client.query('update public.app_users set active=true,updated_at=now() where id=$1',[id]);
    await client.query("insert into public.app_audit_log(actor_id,action,target_type,target_id,details,request_id) values($1,'rbac.user.reactivated','user',$2,$3::jsonb,$4)",[req.auth.id,id,JSON.stringify({email:user.email}),req.get('x-request-id')||null]);
    await client.query('commit');res.json({ok:true});
  }catch(error){await client.query('rollback').catch(()=>{});throw error}finally{client.release()}
});

async function ensureMinioBucket(){
  if(!minioReady)return false;
  try{await s3.send(new HeadBucketCommand({Bucket:process.env.MINIO_BUCKET}));}
  catch(error){if(error?.$metadata?.httpStatusCode===404||error?.name==='NotFound'||error?.name==='NoSuchBucket')await s3.send(new CreateBucketCommand({Bucket:process.env.MINIO_BUCKET}));else throw error;}
  return true;
}
function safeExtension(name){const ext=path.extname(String(name||'')).toLowerCase().replace(/[^.a-z0-9]/g,'');return ext.slice(0,12)||'.audio'}
function safeAudioMime(file,extension){const known={'.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4','.ogg':'audio/ogg','.aac':'audio/aac','.flac':'audio/flac','.opus':'audio/ogg','.wma':'audio/x-ms-wma'};return known[extension]||(/^audio\/[a-z0-9.+-]+$/i.test(file.mimetype||'')?file.mimetype:'application/octet-stream')}
async function fileHash(filePath){const hash=crypto.createHash('sha256');const input=fs.createReadStream(filePath);for await(const chunk of input)hash.update(chunk);return hash.digest('hex')}
function audioOutput(row,duplicate=false){return {id:row.id,objectKey:row.object_key,name:row.original_name,mimeType:row.mime_type,fileSize:Number(row.byte_size),sha256:row.sha256,kind:row.media_kind,recordId:row.record_id,clientId:row.client_id,createdAt:row.created_at,duplicate}}
function requireAudioPermission(req,res,next){const kind=String(req.get('x-audio-kind')||'');const permission=kind==='call_record'?'records_manage':kind==='debrief'?'debriefs':'';if(!permission)return res.status(400).json({error:'Type de média invalide.'});if(!req.auth.permissions.has(permission))return res.status(403).json({error:'Permission audio insuffisante.',code:'PERMISSION_DENIED',permission});req.audioKind=kind;next()}
app.post('/quality/api/audio',requireAuth,requireReadyPassword,requireAudioPermission,upload.single('file'),async(req,res)=>{
  const file=req.file;if(!file)return res.status(400).json({error:'Fichier audio manquant.'});
  const kind=String(req.body?.kind||'');const recordId=String(req.body?.recordId||'')||null;const clientId=String(req.body?.clientId||'')||null;
  if((kind==='call_record'&&(!recordId||!clientId))||(kind==='debrief'&&!recordId)){await fs.promises.unlink(file.path).catch(()=>{});return res.status(400).json({error:'L’audio doit être rattaché à une fiche et à son client, ou à une session de débrief.'});}
  if(kind!==req.audioKind){await fs.promises.unlink(file.path).catch(()=>{});return res.status(400).json({error:'Le type de média ne correspond pas à la requête.'})}
  const needed=kind==='call_record'?'records_manage':kind==='debrief'?'debriefs':'';
  const ext=safeExtension(file.originalname);const acceptedMime=/^audio\//i.test(file.mimetype)||file.mimetype==='application/octet-stream';
  const acceptedExt=/\.(mp3|wav|m4a|ogg|aac|flac|opus|wma)$/i.test(file.originalname);
  if(!acceptedMime&&!acceptedExt){await fs.promises.unlink(file.path).catch(()=>{});return res.status(415).json({error:'Format audio non pris en charge.'});}
  if(!minioReady){await fs.promises.unlink(file.path).catch(()=>{});return res.status(503).json({error:'MinIO n’est pas configuré côté serveur.',code:'STORAGE_UNAVAILABLE'});}
  try{
    const digest=await fileHash(file.path);
    const dupe=await pool.query('select * from public.local_audio_objects where sha256=$1 and media_kind=$2 and record_id is not distinct from $3 and client_id is not distinct from $4',[digest,kind,recordId,clientId]);
    if(dupe.rows[0]){await fs.promises.unlink(file.path).catch(()=>{});return res.json({audio:audioOutput(dupe.rows[0],true)});}
    const id=`audio-${crypto.randomUUID()}`;const year=new Date().getUTCFullYear();const objectKey=`${kind}/${year}/${id}${ext}`;const safeMime=safeAudioMime(file,ext);const db=await pool.connect();let objectStored=false;
    try{
      await db.query('begin');
      await s3.send(new PutObjectCommand({Bucket:process.env.MINIO_BUCKET,Key:objectKey,Body:fs.createReadStream(file.path),ContentLength:file.size,ContentType:safeMime,Metadata:{sha256:digest,uploadedby:req.auth.id}}));objectStored=true;
      const result=await db.query(`insert into public.local_audio_objects(id,object_key,sha256,original_name,mime_type,byte_size,media_kind,record_id,client_id,uploaded_by)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,[id,objectKey,digest,file.originalname,safeMime,file.size,kind,recordId,clientId,req.auth.id]);
      await db.query(`insert into public.app_audit_log(actor_id,action,target_type,target_id,details,request_id) values($1,'audio.uploaded',$2,$3,$4::jsonb,$5)`,[req.auth.id,kind,id,JSON.stringify({name:file.originalname,byteSize:file.size,sha256:digest,recordId,clientId}),req.get('x-request-id')||null]);
      await db.query('commit');objectStored=false;res.status(201).json({audio:audioOutput(result.rows[0])});
    }catch(error){await db.query('rollback').catch(()=>{});if(objectStored)await s3.send(new DeleteObjectCommand({Bucket:process.env.MINIO_BUCKET,Key:objectKey})).catch(()=>{});throw error}finally{db.release()}
  }finally{await fs.promises.unlink(file.path).catch(()=>{});}
});
app.get('/quality/api/audio/:id',requireAuth,requireReadyPassword,async(req,res)=>{
  if(!minioReady)return res.status(503).json({error:'MinIO n’est pas configuré côté serveur.',code:'STORAGE_UNAVAILABLE'});
  const result=await pool.query('select * from public.local_audio_objects where id=$1',[String(req.params.id)]);const audio=result.rows[0];if(!audio)return res.status(404).json({error:'Audio introuvable.'});
  const stateData=(await loadFullState(pool))?.data||{};
  if(audio.media_kind==='debrief'){
    if(!req.auth.permissions.has('debriefs'))return res.status(403).json({error:'Permission débrief requise.'});
    if(!isDebriefAudioAttached(audio,stateData))return res.status(404).json({error:'Audio de débrief non associé à une session accessible.'});
  }
  if(audio.media_kind==='call_record'){
    const clientScoped=hasClientScope(req.auth);const canReadAnyCall=['records_view','records_manage','synergy1','reevaluation','client_returns','final_return','client_send'].some(code=>req.auth.permissions.has(code));
    const viaDebrief=!clientScoped&&req.auth.permissions.has('debriefs')&&(await pool.query("select 1 from public.crm_debrief_audios a join public.crm_debriefs d on d.id=a.debrief_id where a.audio_id=$1 and a.source_record_id=$2 and not d.archived limit 1",[audio.id,audio.record_id])).rowCount>0;
    if(!viaDebrief&&!clientScoped&&!canReadAnyCall)return res.status(403).json({error:'Permission fiche requise.'});
    if(!viaDebrief&&!canAccessCallAudio(req.auth,audio,stateData))return res.status(404).json({error:'Audio non associé à une fiche disponible ou hors du périmètre autorisé.'});
  }
  const object=await s3.send(new GetObjectCommand({Bucket:process.env.MINIO_BUCKET,Key:audio.object_key}));
  res.set('Content-Type',audio.mime_type);res.set('Content-Length',String(audio.byte_size));res.set('Content-Disposition',`inline; filename*=UTF-8''${encodeURIComponent(audio.original_name)}`);res.set('Cache-Control','private, no-store');
  if(object.Body?.pipe)object.Body.pipe(res);else res.status(500).json({error:'Flux audio indisponible.'});
});

// Le serveur ne publie que les ressources nécessaires à l’application; .env, SQL et fichiers internes restent privés.
const root=path.resolve(__dirname,'.');
for(const file of ['index.html','app.js','styles.css']){
  const route=file==='index.html'?'/':'/'+file;
  app.get(route,(req,res)=>res.sendFile(file,{root,dotfiles:'allow'}));
}
app.get('/quality/api/health',async(req,res)=>{
  try{await pool.query('select 1');res.json({ok:true,database:'connected',minioConfigured:minioReady});}
  catch(_){res.status(503).json({ok:false,database:'unavailable',minioConfigured:minioReady});}
});
app.use('/quality/api',(req,res)=>res.status(404).json({error:'Endpoint API local introuvable.'}));
app.use((req,res)=>{if(req.method==='GET')return res.status(404).send('Page introuvable.');res.status(404).json({error:'Ressource introuvable.'});});
app.use((error,req,res,next)=>{
  if(res.headersSent)return next(error);
  const status=error.code==='LIMIT_FILE_SIZE'?413:error.code==='LIMIT_UNEXPECTED_FILE'?400:Number(error.status)||(error.code==='23505'?409:error.code==='23503'?409:500);
  const brokenReference=error.code==='23503';
  const emailTaken=error.code==='23505'&&/app_users_(active_)?email/.test(String(error.constraint||error.message));
  const message=brokenReference?'Référence invalide : la fiche, l’utilisateur ou le lot indiqué n’existe pas, ou l’élément est encore utilisé.':emailTaken?'Un compte actif utilise déjà cette adresse e-mail.':status>=500?(process.env.NODE_ENV==='production'?'Erreur interne du serveur.':error.message):error.message;
  if(status>=500)console.error(error);
  res.status(status).json({error:message,code:error.code||undefined,missingPermissions:error.missingPermissions||undefined});
});

async function start(){
  if(!poolReady)throw new Error('DATABASE_URL doit pointer vers PostgreSQL local. Copiez .env.example vers .env avant le démarrage.');
  await pool.query('select 1');
  const schema=await pool.query("select to_regclass('public.app_users') as users,to_regclass('public.crm_state') as crm_state,to_regclass('public.app_audit_log') as audit_log");
  if(!schema.rows[0]?.users||!schema.rows[0]?.crm_state||!schema.rows[0]?.audit_log)throw new Error('Schéma PostgreSQL local absent ou incomplet. Pour une nouvelle installation vide, exécutez npm run db:init sur la base prévue pour QualiContact.');
  const agentsTable=await pool.query("select to_regclass('public.crm_agents') as agents");
  if(!agentsTable.rows[0]?.agents)throw new Error('La table des agents (public.crm_agents) est absente. Exécutez npm run db:migrate-agents pour la créer et migrer les agents existants.');
  const legacyAgents=await pool.query("select coalesce(jsonb_array_length(case when jsonb_typeof(data->'agents')='array' then data->'agents' end),0) as n from public.crm_state where id='main'");
  if(Number(legacyAgents.rows[0]?.n)>0)throw new Error('Des agents sont encore stockés dans le JSON de l’état CRM. Exécutez npm run db:migrate-agents avant de démarrer pour les migrer vers public.crm_agents.');
  const assignPermission=await pool.query("select count(*)::int as n from public.app_permissions where code in ('records_assign','tasks_manage','records_view_all')");
  if(assignPermission.rows[0].n<3)throw new Error('Les permissions records_assign, tasks_manage et records_view_all sont absentes (ou incomplètes). Exécutez npm run db:migrate-assign pour les créer et les accorder aux rôles concernés.');
  const activeEmailIndex=await pool.query("select 1 from pg_indexes where schemaname='public' and indexname='app_users_active_email_uq'");
  if(!activeEmailIndex.rows.length)throw new Error('L’index d’unicité des e-mails des comptes actifs est absent. Exécutez npm run db:migrate-assign pour permettre de recréer un compte avec l’e-mail d’un compte désactivé.');
  const relationalTables=await pool.query("select to_regclass('public.crm_records') as records,to_regclass('public.crm_debriefs') as debriefs,to_regclass('public.crm_grid_criteria') as criteria");
  if(!relationalTables.rows[0]?.records||!relationalTables.rows[0]?.debriefs||!relationalTables.rows[0]?.criteria)throw new Error('Les tables relationnelles (public.crm_records, crm_tasks, crm_debriefs…) sont absentes. Exécutez npm run db:migrate-relational pour les créer et migrer les données existantes.');
  const legacySections=await pool.query(`select coalesce(jsonb_array_length(case when jsonb_typeof(data->'records')='array' then data->'records' end),0)
    +coalesce(jsonb_array_length(case when jsonb_typeof(data->'tasks')='array' then data->'tasks' end),0)
    +coalesce(jsonb_array_length(case when jsonb_typeof(data->'debriefs')='array' then data->'debriefs' end),0)
    +coalesce(jsonb_array_length(case when jsonb_typeof(data->'events')='array' then data->'events' end),0)
    +coalesce(jsonb_array_length(case when jsonb_typeof(data->'batches')='array' then data->'batches' end),0)
    +coalesce(jsonb_array_length(case when jsonb_typeof(data->'optionGroups')='array' then data->'optionGroups' end),0)
    +(select count(*) from jsonb_each(case when jsonb_typeof(data->'criteriaByStage')='object' then data->'criteriaByStage' else '{}'::jsonb end) e where jsonb_typeof(e.value)='array' and jsonb_array_length(e.value)>0) as n
    from public.crm_state where id='main'`);
  if(Number(legacySections.rows[0]?.n)>0)throw new Error('Des fiches, tâches, débriefs, événements, lots ou grilles sont encore stockés dans le JSON de l’état CRM. Exécutez npm run db:migrate-relational (avec --dry-run d’abord) pour les migrer vers les tables relationnelles.');
  if(minioReady)await ensureMinioBucket();
  const port=Number(process.env.PORT)||3000;
  app.listen(port,'0.0.0.0',()=>console.log(`QualiContact local API disponible sur le port ${port} · PostgreSQL connecté · MinIO ${minioReady?'configuré':'non configuré'}.`));
}
if(require.main===module)start().catch(error=>{console.error('Démarrage impossible :',error.message);process.exitCode=1});
module.exports={app,start,pool,authPayload,filterStateForUser,calculateDashboardSummary};
