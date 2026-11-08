// Owns only .local/postgres and the dedicated Nuqta port. Never uses an existing cluster.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const local = path.join(root, '.local');
const cluster = path.join(local, 'native-postgres');
const data = path.join(cluster, 'data');
const bin = process.env.POSTGRES_BIN || 'C:\\Program Files\\PostgreSQL\\17\\bin';
const port = process.env.NUQTA_DB_PORT || '55432';
const executable = name => process.platform === 'win32' ? path.join(bin, name + '.exe') : name;
function run(name,args,allowFailure=false,env=process.env){
  const r=spawnSync(executable(name),args,{cwd:root,encoding:'utf8',windowsHide:true,env:{...env,PGCONNECT_TIMEOUT:'5'},timeout:45000,stdio:name==='pg_ctl'&&args[0]==='start'?'ignore':'pipe'});
  if(r.error || r.status!==0){if(allowFailure)return false; console.error(r.error?.message || r.stderr || r.stdout);process.exit(1);}
  return true;
}
fs.mkdirSync(local,{recursive:true});
const envFile=path.join(root,'.env');
if(!fs.existsSync(envFile)){
  const migrator=crypto.randomBytes(30).toString('hex'),runtime=crypto.randomBytes(30).toString('hex'),auth=crypto.randomBytes(30).toString('hex');
  fs.writeFileSync(envFile,[
    'APP_ENV=development','AUTH_PROVIDER=local','HOST=127.0.0.1','PORT=4100','PUBLIC_APP_ORIGIN=http://127.0.0.1:5173','COOKIE_SECURE=false',
    'DATABASE_MIGRATOR_URL=postgresql://nuqta_migrator:'+migrator+'@127.0.0.1:'+port+'/nuqta_local',
    'DATABASE_URL=postgresql://nuqta_runtime:'+runtime+'@127.0.0.1:'+port+'/nuqta_local',
    'AUTH_DATABASE_URL=postgresql://nuqta_auth:'+auth+'@127.0.0.1:'+port+'/nuqta_local',
    'NUQTA_RUNTIME_DB_PASSWORD='+runtime,'NUQTA_AUTH_DB_PASSWORD='+auth,'AUTH_PEPPER='+crypto.randomBytes(32).toString('hex'),'LOG_LEVEL=info',''
  ].join('\n'),{mode:0o600});
}
process.loadEnvFile(envFile);
if(!process.env.WORKER_DATABASE_URL){
  const workerPassword=crypto.randomBytes(30).toString('hex'),workerUrl=new URL(process.env.DATABASE_MIGRATOR_URL);workerUrl.username='nuqta_worker';workerUrl.password=workerPassword;
  fs.appendFileSync(envFile,'WORKER_DATABASE_URL='+workerUrl.href+'\nNUQTA_WORKER_DB_PASSWORD='+workerPassword+'\n');
  process.env.WORKER_DATABASE_URL=workerUrl.href;process.env.NUQTA_WORKER_DB_PASSWORD=workerPassword;
}
const ownUrl=new URL(process.env.DATABASE_MIGRATOR_URL);
if(!['127.0.0.1','localhost'].includes(ownUrl.hostname)||ownUrl.pathname!=='/nuqta_local'||ownUrl.port!==port){throw new Error('Local DB tool refuses a non-Nuqta or remote database URL.');}
const command=process.argv[2]||'up';
if(command==='up'){
  if(!fs.existsSync(path.join(data,'PG_VERSION'))){
    fs.mkdirSync(path.dirname(data),{recursive:true});
    const pw=path.join(local,'postgres-init-password');fs.writeFileSync(pw,decodeURIComponent(ownUrl.password),{mode:0o600});
    try{run('initdb',['-D',data,'-U','nuqta_migrator','--encoding=UTF8','--locale=C','--auth=scram-sha-256','--pwfile='+pw]);}finally{fs.unlinkSync(pw);}
  }
  if(!run('pg_ctl',['status','-D',data],true))run('pg_ctl',['start','-D',data,'-l',path.join(cluster,'server.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','-t','30']);
  const env={...process.env,PGPASSWORD:decodeURIComponent(ownUrl.password),PGCONNECT_TIMEOUT:'5'};
  const args=['-h','127.0.0.1','-p',port,'-U','nuqta_migrator'];
  const check=spawnSync(executable('psql'),[...args,'-d','postgres','-tAc',"SELECT 1 FROM pg_database WHERE datname='nuqta_local'"],{encoding:'utf8',windowsHide:true,env});
  if(check.status!==0)throw new Error('Cannot connect to the dedicated local Nuqta cluster.');
  if(check.stdout.trim()!=='1')run('psql',[...args,'-d','postgres','-v','ON_ERROR_STOP=1','-c','CREATE DATABASE nuqta_local'],false,env);
  console.log('Nuqta PostgreSQL is ready on 127.0.0.1:'+port+'. Credentials saved locally; values not printed.');
}else if(command==='down'){
  if(fs.existsSync(path.join(data,'PG_VERSION')))run('pg_ctl',['stop','-D',data,'-m','fast','-w']);
  console.log('Dedicated Nuqta cluster stopped. Data retained.');
}else if(command==='backup'){
  const dest=path.join(local,'backups');fs.mkdirSync(dest,{recursive:true});const file=path.join(dest,'nuqta-'+Date.now()+'.dump');
  run('pg_dump',['-h','127.0.0.1','-p',port,'-U','nuqta_migrator','-d','nuqta_local','-Fc','-f',file],false,{...process.env,PGPASSWORD:decodeURIComponent(ownUrl.password)});
  console.log('Local backup saved inside .local/backups. A successful restore is still required.');
}else throw new Error('Use up, down, or backup.');
