import { randomUUID } from 'node:crypto';
import { readJSON } from './auth.js';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export function createHierarchy({all,put,auth}) {
  function visible(actor) {
    const projects=all('projects').filter(p=>auth.canRead(actor,p.id));
    const own=r=>actor.role==='manager'&&r.authorId===actor.id;
    const programs=all('programs').filter(r=>actor.role==='admin'||own(r)||projects.some(p=>p.programId===r.id));
    const portfolios=all('portfolios').filter(r=>actor.role==='admin'||own(r)||projects.some(p=>p.portfolioId===r.id)||programs.some(p=>p.portfolioId===r.id));
    return {portfolios,programs};
  }
  function validateProject(actor,project) {
    for(const key of ['portfolioId','programId'])if(project[key]!==undefined&&typeof project[key]!=='string')fail(400,'Invalid '+key);
    const access=visible(actor);
    if(project.portfolioId&&!access.portfolios.some(p=>p.id===project.portfolioId))fail(404,'Portfolio not found');
    if(project.programId){
      const program=access.programs.find(p=>p.id===project.programId);
      if(!program)fail(404,'Program not found');
      if(!project.portfolioId||program.portfolioId!==project.portfolioId)fail(400,'The selected program must belong to the project portfolio');
    }
  }
  async function handle(req,url,actor,send) {
    const match=url.pathname.match(/^\/api\/(portfolios|programs)(?:\/([^/]+))?$/);
    if(!match)return false;
    const [,kind,id]=match;
    const visibleRows=visible(actor)[kind];
    if(req.method==='GET'){
      if(!id){send(200,{[kind]:visibleRows});return true;}
      const record=visibleRows.find(r=>r.id===id);if(!record)fail(404,'Record not found');
      send(200,record);return true;
    }
    if(!['POST','PATCH'].includes(req.method)){send(405,{error:'Method not allowed'});return true;}
    if((req.method==='POST'&&id)||(req.method==='PATCH'&&!id))fail(405,'Use POST to create or PATCH with a record ID to edit');
    if(!['admin','manager'].includes(actor.role))fail(403,'Administrator or project manager access required');
    const input=await readJSON(req),old=id&&all(kind).find(r=>r.id===id);
    if(id&&(!old||!visibleRows.some(r=>r.id===id)))fail(404,'Record not found');
    if(old&&actor.role!=='admin'&&old.authorId!==actor.id)fail(403,'Only the creator or an administrator can edit this record');
    if(old&&old.revision!==input.revision)fail(409,'This record changed. Refresh and try again.');
    const record={...(old||{}),id:old?.id||randomUUID(),name:input.name??old?.name,description:input.description??old?.description??'',owner:input.owner??old?.owner??actor.name,status:input.status??old?.status??'Draft',authorId:old?.authorId||actor.id,createdAt:old?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),updatedBy:actor.id,revision:(old?.revision||0)+1,demo:false};
    for(const [key,max]of [['name',160],['owner',160],['description',10000]])if(typeof record[key]!=='string'||record[key].length>max||(key==='name'&&!record[key].trim()))fail(400,'Enter a valid '+key);
    record.name=record.name.trim();
    if(!['Draft','Active','On Hold'].includes(record.status))fail(400,'Invalid status');
    if(kind==='programs'){
      record.portfolioId=input.portfolioId??old?.portfolioId;
      if(typeof record.portfolioId!=='string'||!visible(actor).portfolios.some(p=>p.id===record.portfolioId))fail(404,'Select an accessible portfolio');
      if(old&&old.portfolioId!==record.portfolioId&&all('projects').some(p=>p.programId===old.id))fail(409,'Move projects out of the program before changing its portfolio');
    }
    auth.transaction(()=>{put(kind,record);auth.audit(actor,kind+(old?'.updated':'.created'),record.id,{revision:record.revision,portfolioId:record.portfolioId||null});});
    send(old?200:201,record);return true;
  }
  return {visible,validateProject,handle};
}
