'use strict';
require('dotenv').config();
const {randomUUID}=require('node:crypto');
const readline = require('node:readline');

const bcrypt=require('bcryptjs');
const {Pool}=require('pg');


function askHidden(label){
  if(process.env.BOOTSTRAP_ADMIN_PASSWORD)return Promise.resolve(process.env.BOOTSTRAP_ADMIN_PASSWORD);
  if(!process.stdin.isTTY)throw new Error('Définissez BOOTSTRAP_ADMIN_PASSWORD dans l’environnement privé pour une exécution non interactive.');
  return new Promise((resolve,reject)=>{
    const input=process.stdin;let value='';process.stdout.write(label);input.setRawMode(true);input.resume();
    const done=(error)=>{input.off('data',onData);input.setRawMode(false);input.pause();process.stdout.write('\n');error?reject(error):resolve(value)};
    const onData=buffer=>{for(const char of buffer.toString('utf8')){
      if(char==='\u0003'){done(new Error('Annulé.'));return}
      if(char==='\r'||char==='\n'){done();return}
      if(char==='\u007f'||char==='\b'){value=value.slice(0,-1);process.stdout.write('\b \b');continue}
      if(char>=' '){value+=char;process.stdout.write('*')}
    }};
    input.on('data',onData);
  });
}
async function main(){
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL est requis.');
  const rl=readline.createInterface({input:process.stdin,output:process.stdout});
  try{
const email = String(
  process.env.BOOTSTRAP_ADMIN_EMAIL ||
  await new Promise(resolve => rl.question('Adresse e-mail administrateur : ', resolve))
).trim().toLowerCase();

const fullName = String(
  process.env.BOOTSTRAP_ADMIN_NAME ||
  await new Promise(resolve => rl.question('Nom complet : ', resolve))
).trim();
    rl.close();
    const password=String(await askHidden('Mot de passe (12 caractères minimum) : '));
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Adresse e-mail invalide.');
    if(fullName.length<2)throw new Error('Nom complet trop court.');
    if(password.length<12)throw new Error('Le mot de passe doit compter au moins 12 caractères.');
    const pool=new Pool({connectionString:process.env.DATABASE_URL});const client=await pool.connect();
    try{
      const id=randomUUID();const passwordHash=await bcrypt.hash(password,12);
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(733100421)');
      await client.query("select 1 from public.app_roles where id='role-admin' for share");
      await client.query('insert into public.app_users(id,email,full_name,password_hash) values($1,$2,$3,$4)',[id,email,fullName,passwordHash]);
      await client.query("insert into public.app_user_roles(user_id,role_id,assigned_by) values($1,'role-admin',$1)",[id]);
      await client.query("insert into public.app_audit_log(actor_id,action,target_type,target_id,details) values($1,'auth.bootstrap_admin_created','user',$1,$2::jsonb)",[id,JSON.stringify({email})]);
      await client.query('commit');
      console.log(`Compte administrateur créé : ${email}. Le mot de passe n’a pas été enregistré dans le dépôt.`);
    }catch(error){await client.query('rollback').catch(()=>{});throw error}finally{client.release();await pool.end()}
  }finally{if(!rl.closed)rl.close()}
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
