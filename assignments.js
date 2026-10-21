const normalize=value=>String(value||'').trim().toLowerCase();
export function createAssignments({db,auth,all}){
  const fail=message=>{throw Object.assign(new Error(message),{status:400});};
  const users=()=>db.prepare("SELECT id,name,email,role FROM users WHERE status='active' ORDER BY name,email").all().map(user=>({...user,projectIds:db.prepare('SELECT project_id FROM memberships WHERE user_id=?').all(user.id).map(r=>r.project_id)}));
  const eligible=(projectId,people)=>people.filter(user=>auth.canRead(user,projectId));
  function resolve(task,people){
    const candidates=eligible(task.projectId,people);
    if(task.assigneeId)return candidates.find(user=>user.id===task.assigneeId);
    const owner=normalize(task.owner);if(!owner)return;
    const matches=candidates.filter(user=>normalize(user.email)===owner||normalize(user.name)===owner);
    return matches.length===1?matches[0]:undefined;
  }
  function prepare(input,old,record){
    const task={...record};
    if(input.assigneeId!==undefined&&typeof input.assigneeId!=='string')fail('Select a valid task assignee');
    if(input.assigneeId===undefined&&old&&input.owner!==undefined&&input.owner!==old.owner)delete task.assigneeId;
    if(task.assigneeId){
      const person=resolve(task,users());if(!person)fail('Select an active user with access to this project');
      task.owner=person.name;
    }else{
      const person=resolve(task,users());if(person)task.assigneeId=person.id;
    }
    return task;
  }
  function forActor(actor,source=all('tasks')){
    const people=users();return source.filter(task=>auth.canRead(actor,task.projectId)&&resolve(task,people)?.id===actor.id);
  }
  function list(actor,projectId){
    if(!all('projects').some(p=>p.id===projectId)||!auth.canRead(actor,projectId))throw Object.assign(new Error('Project not found'),{status:404});
    return eligible(projectId,users()).map(({id,name,email})=>({id,name,email}));
  }
  return {prepare,forActor,list};
}
