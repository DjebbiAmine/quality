'use strict';
require('dotenv').config();
const fs=require('node:fs');
const path=require('node:path');
const {Pool}=require('pg');

async function main(){
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL est requis. Copiez .env.example vers .env puis configurez PostgreSQL local.');
  const pool=new Pool({connectionString:process.env.DATABASE_URL});
  try{
    await pool.query('select 1');
    const sql=fs.readFileSync(path.join(__dirname,'..','..','local-db','bootstrap.sql'),'utf8');
    await pool.query(sql);
    console.log('Schéma local QualiContact initialisé. Aucune migration Supabase n’a été exécutée.');
  }finally{await pool.end();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
