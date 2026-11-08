const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const docs = path.join(root, 'docs/execution');
const required = ['PROJECT-AUDIT','SCREEN-TO-FEATURE-MAP','ARCHITECTURE','DATABASE-PLAN','API-PLAN','PHASES','TASKS','TEST-PLAN','INTEGRATIONS','RUNBOOK','STATUS','DECISIONS','README'];
const errors = [], checks = [];
const report = (name, ok, detail) => { checks.push({name,ok,detail}); if(!ok) errors.push(name+': '+detail); };
for(const f of required) report('document:'+f,fs.existsSync(path.join(docs,f+'.md')),'required Markdown file');
for(const f of [...required.map(n=>path.join(docs,n+'.md')),path.join(root,'README.md')]) {
  const content = fs.readFileSync(f,'utf8').replace(/```[\s\S]*?```/g,'');
  for(const m of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const href=m[1]; if(/^(https?:|#|codex:)/.test(href)) continue;
    const target=path.resolve(path.dirname(f),href.split('#')[0]);
    report('link:'+path.relative(root,f)+':'+href,fs.existsSync(target),'local link target');
  }
}
const tasksText=fs.readFileSync(path.join(docs,'TASKS.md'),'utf8');
const taskIds=[...tasksText.matchAll(/^\| (P\d{2}-\d{2}) \|/gm)].map(m=>m[1]);
report('task IDs unique',new Set(taskIds).size===taskIds.length,taskIds.length+' tasks');
for(const f of required) for(const m of fs.readFileSync(path.join(docs,f+'.md'),'utf8').matchAll(/P\d{2}-\d{2}/g)) report('task-ref:'+m[0],taskIds.includes(m[0]),f);
const phases=fs.readFileSync(path.join(docs,'PHASES.md'),'utf8').split(/^## P/gm).slice(1);
report('phase count',phases.length===16,phases.length);
for(const section of phases) {const n=section.slice(0,2);const numbered=[...section.matchAll(/^\|(\d+) /gm)].map(m=>+m[1]);report('phase P'+n+' has 18 fields',numbered.length===18 && new Set(numbered).size===18,numbered);}
for(const row of JSON.parse(fs.readFileSync(path.join(docs,'evidence/inventory.json'),'utf8'))) {
  const hash=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,row.file))).digest('hex');
  report('original unchanged:'+row.file,hash===row.sha256,hash);
}
for(const f of fs.readdirSync(path.join(docs,'evidence/extracted')).filter(f=>f.endsWith('.js'))) {
  try { new vm.Script(fs.readFileSync(path.join(docs,'evidence/extracted',f),'utf8'),{filename:f});report('syntax:'+f,true,'parsed, not executed'); }
  catch(e) { report('syntax:'+f,false,e.message); }
}
for(const name of ['browser-smoke.json','browser-journeys.json']) {
  const data=JSON.parse(fs.readFileSync(path.join(docs,'evidence',name),'utf8'));
  report('evidence:'+name,Array.isArray(data.results)&&data.results.length>0,'results present');
  report('no browser errors:'+name,(data.errors||[]).length===0&&(data.results||[]).every(x=>(x.errors||[]).length===0),'browser page errors');
  if(name==='browser-journeys.json') report('no unresolved harness failures',data.results.every(x=>x.status!=='FAIL'),data.results.reduce((a,x)=>(a[x.status]=(a[x.status]||0)+1,a),{}));
}
const result={at:new Date().toISOString(),passed:checks.filter(c=>c.ok).length,failed:errors.length,errors,checks};
fs.writeFileSync(path.join(docs,'evidence/verification.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({passed:result.passed,failed:result.failed,errors},null,2));
if(errors.length) process.exitCode=1;
