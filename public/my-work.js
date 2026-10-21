const myWorkExpanded=new Set();
function assignedWorkTasks(){const ids=new Set(state.myTaskIds||[]);return state.tasks.filter(task=>ids.has(task.id));}
function myWorkSummary(tasks){
  const dates=tasks.map(t=>t.finishDate||t.due||'').filter(Boolean).sort(),starts=tasks.map(t=>t.startDate).filter(Boolean).sort();
  const percent=tasks.length?Math.round(tasks.reduce((sum,t)=>sum+PmoSchedule.progress(t),0)/tasks.length):0;
  const status=tasks.every(t=>t.status==='Done')?'Done':tasks.some(t=>t.status==='Blocked')?'Blocked':tasks.some(t=>t.status==='In progress'||PmoSchedule.progress(t)>0)?'In progress':'To do';
  return {finish:dates.at(-1)||'',start:starts[0]||'',percent,status};
}
function myWorkCells(tasks,task){
  const d=myWorkSummary(tasks),finish=task?.finishDate||task?.due||d.finish,start=task?.startDate||d.start;
  return `<td>${esc(identity.name)}</td><td>${esc(finish||'Not set')}</td><td>${badge(task?.status||d.status)}</td><td>${task?PmoSchedule.progress(task):d.percent}%</td><td>${esc(start||'—')}</td><td>${esc(task?.finishDate||(!task?d.finish:'')||'—')}</td><td>${task?.duration===undefined?'—':task.duration+' d'}</td><td>${task?(task.dependsOn?.length||0)+' predecessors':'—'}</td>`;
}
function myWorkVisibility(ancestors){return `data-my-work-ancestors="${ancestors.join(' ')}" ${ancestors.some(key=>!myWorkExpanded.has(key))?'hidden':''}`;}
function myWorkTaskRows(tasks,depth,ancestors){
  return tasks.map(t=>`<tr id="my-work-task-${t.id}" class="my-work-task-row ${PmoSchedule.progress(t)===100?'completed-work':''}" data-work-task="${t.id}" ${myWorkVisibility(ancestors)}><th scope="row"><button class="my-work-name" style="padding-left:${depth*18}px" data-edit-task="${t.id}"><span aria-hidden="true">□</span><span><strong>${esc(t.name)}</strong><small>Task</small></span></button></th>${myWorkCells([t],t)}</tr>`).join('');
}
function myWorkGroup(kind,record,tasks,depth,children,ancestors){
  const key=kind+'-'+record.id,open=myWorkExpanded.has(key);
  return `<tr class="my-work-${kind}-row" ${myWorkVisibility(ancestors)}><th scope="row"><button class="my-work-name" style="padding-left:${depth*18}px" data-my-work-expand="${key}" aria-expanded="${open}" aria-controls="${tasks.map(t=>'my-work-task-'+t.id).join(' ')}"><span aria-hidden="true">${open?'▾':'▸'}</span><span><strong>${esc(record.name)}</strong><small>${kind[0].toUpperCase()+kind.slice(1)} · ${tasks.length} assigned tasks</small></span></button></th>${myWorkCells(tasks)}</tr>${children}`;
}
function myWorkColumns(){return [270,130,145,130,120,130,130,95,120].map(w=>`<col style="width:${w}px">`).join('');}
function myWorkLedger(){
  const tasks=assignedWorkTasks(),ids=new Set(tasks.map(t=>t.projectId)),projects=state.projects.filter(p=>ids.has(p.id));
  const projectRows=(project,depth,ancestors)=>{const own=tasks.filter(t=>t.projectId===project.id);return myWorkGroup('project',project,own,depth,myWorkTaskRows(own,depth+1,[...ancestors,'project-'+project.id]),ancestors);};
  const portfolios=state.portfolios.filter(p=>projects.some(project=>project.portfolioId===p.id));if(projects.some(p=>!p.portfolioId))portfolios.push({id:'unassigned',name:'Unassigned projects'});
  const rows=portfolios.map(portfolio=>{
    const ps=projects.filter(p=>portfolio.id==='unassigned'?!p.portfolioId:p.portfolioId===portfolio.id),projectIds=new Set(ps.map(p=>p.id)),own=tasks.filter(t=>projectIds.has(t.projectId));
    const programs=state.programs.filter(g=>g.portfolioId===portfolio.id&&ps.some(p=>p.programId===g.id));
    const ancestors=['portfolio-'+portfolio.id];
    const children=programs.map(program=>{const children=ps.filter(p=>p.programId===program.id),childIds=new Set(children.map(p=>p.id));return myWorkGroup('program',program,own.filter(t=>childIds.has(t.projectId)),1,children.map(p=>projectRows(p,2,[...ancestors,'program-'+program.id])).join(''),ancestors);}).join('')+ps.filter(p=>!p.programId).map(p=>projectRows(p,1,ancestors)).join('');
    return myWorkGroup('portfolio',portfolio,own,0,children,[]);
  }).join('');
  const headers=['Task Name','Owner','Target Completion Date','Status','Percent Complete','Start Date','Finish Date','Duration','Depends On'];
  return `<section class="panel overview-ledger-panel" aria-label="My assigned work"><div class="overview-ledger-scroll" tabindex="0" role="region" aria-label="Assigned tasks by portfolio, program and project"><table class="my-work-table"><colgroup>${myWorkColumns()}</colgroup><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows||'<tr><td colspan="9" class="overview-ledger-empty">No tasks are assigned to your account.</td></tr>'}</tbody></table></div></section>`;
}
function bindMyWork(){document.querySelectorAll('[data-my-work-expand]').forEach(button=>button.onclick=()=>{const key=button.dataset.myWorkExpand,open=!myWorkExpanded.has(key);open?myWorkExpanded.add(key):myWorkExpanded.delete(key);button.setAttribute('aria-expanded',String(open));button.firstElementChild.textContent=open?'▾':'▸';document.querySelectorAll('[data-my-work-ancestors]').forEach(row=>row.hidden=row.dataset.myWorkAncestors.split(' ').filter(Boolean).some(ancestor=>!myWorkExpanded.has(ancestor)));});}
