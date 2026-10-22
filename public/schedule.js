let scheduleZoom = 'week', scheduleView = 'split';
function projectSchedule(projectId = selected) { return PmoSchedule.calculate(state.tasks.filter(t => t.projectId === projectId)); }
function schedulePanel() {
  const { rows } = projectSchedule();
  const scheduled = rows.filter(r => r.task.startDate && r.task.finishDate);
  return `<section class="panel schedule-panel"><div class="section-heading"><div><h2>Project schedule <span class="count">${rows.length}</span></h2><p>Calendar days · finish-to-start dependencies · parent dates use the earliest subtask start and latest subtask finish.</p></div><div class="schedule-tools"><label>Schedule view<select id="schedule-view" aria-label="Schedule view">${options([{id:'split',name:'Table & Gantt'},{id:'table',name:'Task table'},{id:'gantt',name:'Gantt chart'}],scheduleView)}</select></label><label>Timeline scale<select id="schedule-zoom" aria-label="Timeline scale">${options([{id:'day',name:'Days'},{id:'week',name:'Weeks'},{id:'month',name:'Months'}],scheduleZoom)}</select></label><button class="button" id="schedule-export">Export schedule</button><button class="primary" data-schedule-add="">＋ Add task</button></div></div><div class="schedule-legend"><span><i></i> Task / completed portion</span><span><i class="summary-key"></i> Summary task</span><span>◆ Milestone (0 days)</span><span>→ Finish-to-start link</span></div>${rows.length ? `<div class="schedule-scroll" tabindex="0" role="region" aria-label="Schedule table and Gantt chart"><div class="schedule-layout schedule-view-${scheduleView}"><div class="schedule-table-wrap" tabindex="0" role="region" aria-label="Schedule task rows"><table class="schedule-table"><thead><tr>${['WBS ID','Task Description','Start Date','Finish Date','Duration','Percent Complete','Depends On','Actions'].map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr class="${r.summary?'summary-row':''} ${r.depth===0?'top-level-task':''} ${PmoSchedule.progress(r.task)===100?'completed-task':''}"><td>${esc(r.wbs)}</td><td><button class="schedule-task-name" data-schedule-edit="${r.task.id}" style="padding-left:${r.depth*16}px" title="${esc(r.task.name)}">${r.summary?'▦ ':r.task.duration===0?'◆ ':''}${esc(r.task.name)}</button></td><td>${esc(r.task.startDate||'—')}</td><td>${esc(r.task.finishDate||'—')}</td><td>${r.task.duration===undefined?'—':r.task.duration+' d'}</td><td>${PmoSchedule.progress(r.task)}%</td><td title="${esc((r.task.dependsOn||[]).map(id=>rows.find(x=>x.task.id===id)?.task.name).join(', '))}">${(r.task.dependsOn||[]).map(id=>rows.find(x=>x.task.id===id)?.wbs).join(', ')||'—'}</td><td><button class="text-button" data-schedule-add="${r.task.id}" aria-label="Add subtask to ${esc(r.task.name)}">＋ Subtask</button></td></tr>`).join('')}</tbody></table></div><div class="schedule-gantt-wrap" tabindex="0" role="region" aria-label="Schedule Gantt rows">${scheduleGantt(rows,scheduled)}</div></div></div>`:'<div class="empty"><h2>Build your project schedule</h2><p>Add a task, nest subtasks beneath it, and link predecessors to map out delivery.</p></div>'}<p class="schedule-footnote">WBS numbers follow task creation order within each parent. Unscheduled tasks stay in the table; add a start date or scheduled predecessor to place them on the chart. Parent start dates use the earliest subtask start; parent finish dates use the latest subtask finish, including nested subtasks. Progress includes all leaf subtasks, weighted by duration.</p></section>`;
}
function scheduleGantt(rows, scheduled) {
  const h=52, header=52, day=86400000;
  const first=scheduled.length?scheduled.map(r=>r.task.startDate).sort()[0]:new Date().toISOString().slice(0,10);
  const last=scheduled.length?scheduled.map(r=>r.task.finishDate).sort().at(-1):first;
  const start=Date.parse(first)-2*day, days=Math.round((Date.parse(last)-start)/day)+4;
  const unit={day:28,week:12,month:4}[scheduleZoom], width=Math.min(12000,Math.max(600,days*unit)), step=width/days, height=header+rows.length*h;
  const x=date=>(Date.parse(date)-start)/day*step;
  const ticks=[];const stride=Math.max(1,Math.ceil((scheduleZoom==='day'?1:scheduleZoom==='week'?7:30)/1),Math.ceil(76/step));
  for(let i=0;i<days;i+=stride){const label=new Date(start+i*day).toISOString().slice(0,10);ticks.push(`<line x1="${i*step}" y1="0" x2="${i*step}" y2="${height}" stroke="#E2E8F0"/><text x="${i*step+6}" y="29" class="gantt-axis">${esc(label.slice(5))} <tspan class="gantt-year">${label.slice(0,4)}</tspan></text>`);}
  const bars=rows.map((r,i)=>{
    const t=r.task,y=header+i*h,mid=y+h/2;if(!t.startDate||!t.finishDate)return `<text x="12" y="${mid+4}" class="gantt-unscheduled ${r.depth===0?'top-level-task':''} ${PmoSchedule.progress(t)===100?'completed-task':''}">${scheduleView==='gantt'?esc(r.wbs+' '+t.name)+' · ':''}Unscheduled</text>`;
    const left=x(t.startDate),length=Math.max(t.duration===0?0:step,(x(t.finishDate)-left)+step),label=`${r.wbs} ${t.name}: ${t.startDate} to ${t.finishDate}, ${PmoSchedule.progress(t)}% complete`;
    if(t.duration===0)return `<g><title>${esc(label)}</title>${scheduleView==='gantt'?`<text x="12" y="${y+13}" class="gantt-task-label ${r.depth===0?'top-level-task':''} ${PmoSchedule.progress(t)===100?'completed-task':''}">${esc(r.wbs+' '+t.name)}</text>`:''}<path d="M${left},${mid-7} l7,7 -7,7 -7,-7Z" fill="#bd8b30"/></g>`;
    return `<g><title>${esc(label)}</title>${scheduleView==='gantt'?`<text x="12" y="${y+13}" class="gantt-task-label ${r.depth===0?'top-level-task':''} ${PmoSchedule.progress(t)===100?'completed-task':''}">${esc(r.wbs+' '+t.name)}</text>`:''}<rect x="${left}" y="${mid-8}" width="${length}" height="16" rx="${r.summary?0:4}" fill="${r.summary?'#1E3A5F':'#BAE6FD'}"/><rect x="${left}" y="${mid-8}" width="${length*PmoSchedule.progress(t)/100}" height="16" rx="${r.summary?0:4}" fill="${r.summary?'#0F172A':'#2563EB'}"/>${r.summary?`<path d="M${left},${mid} v12 l5,-8 M${left+length},${mid} v12 l-5,-8" fill="#1E3A5F" stroke="#1E3A5F"/>`:''}</g>`;
  }).join('');
  const links=rows.flatMap((r,i)=>(r.task.dependsOn||[]).map(id=>{
    const j=rows.findIndex(v=>v.task.id===id),p=rows[j]?.task;if(!p?.finishDate||!r.task.startDate)return '';
    const x1=x(p.finishDate)+(p.duration===0?0:step),x2=x(r.task.startDate),y1=header+j*h+h/2,y2=header+i*h+h/2,elbow=Math.max(x1+8,x2-8);
    return `<path d="M${x1},${y1} H${elbow} V${y2} H${x2}" fill="none" stroke="#64748B" stroke-width="1.2" marker-end="url(#schedule-arrow)"><title>${esc(p.name)} → ${esc(r.task.name)}</title></path>`;
  })).join('');
  const today=x(new Date().toISOString().slice(0,10));
  return `<div class="gantt-date-header" style="width:${width}px" aria-hidden="true"><svg width="${width}" height="52"><rect width="${width}" height="52" fill="#F1F5F9"/>${ticks.join('')}</svg></div><svg class="gantt-chart" width="${width}" height="${height}" role="img" aria-label="Gantt chart showing task dates, completion and predecessor links"><defs><marker id="schedule-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#64748B"/></marker></defs><rect width="${width}" height="52" fill="#F1F5F9"/>${ticks.join('')}${rows.map((_,i)=>`<line x1="0" y1="${header+(i+1)*h}" x2="${width}" y2="${header+(i+1)*h}" stroke="#E2E8F0"/>`).join('')}${today>=0&&today<=width?`<line x1="${today}" y1="52" x2="${today}" y2="${height}" stroke="#bd8b30" stroke-dasharray="4 4"><title>Today</title></line>`:''}${links}${bars}</svg>`;
}
function scheduleTaskForm(record, parentId = '') {
  const t=record||{},projectId=t.projectId||selected||state.projects[0]?.id,d=$('#modal');
  const summary=!!record&&state.tasks.some(c=>c.parentId===record.id);
  d.innerHTML=`<form id="schedule-task-form"><div class="modal-heading"><div><div class="eyebrow">PLAN THE WORK</div><h2>${record?'Edit':'New'} ${parentId?'subtask':'task'}</h2></div><button type="button" id="close-schedule" class="icon-button" aria-label="Close dialog">✕</button></div>${field('Task Description','name',t.name,'text',true)}${selectField('Project','projectId',state.projects.filter(p=>p.status!=='Closed'),projectId)}<div class="form-grid">${selectField('Parent task','parentId',[],t.parentId||parentId)}${field('Owner','owner',t.owner||identity.name)}${selectField('Assign to user','assigneeId',[{id:t.assigneeId||(record?'':identity.id),name:'Loading project users…'}],t.assigneeId||(record?'':identity.id))}</div><fieldset class="schedule-dates" ${summary?'disabled':''}><legend>${summary?'Summary dates and progress are calculated from subtasks':'Dates & progress'}</legend><div class="form-grid">${field('Start Date','startDate',t.startDate,'date')}${field('Finish Date','finishDate',t.finishDate,'date')}${field('Duration (calendar days)','duration',t.duration??1,'number')}${field('Percent Complete','percentComplete',PmoSchedule.progress(t),'number')}</div></fieldset><div class="form-grid">${selectField('Status','status',['To do','In progress','Blocked','Done'],t.status||'To do')}${selectField('Workstream','workstreamId',[],t.workstreamId||'')}${field('Due date (for unscheduled work)','due',t.due,'date')}</div><fieldset class="schedule-dependencies" ${summary?'disabled':''}><legend>Depends On (finish-to-start)</legend><div id="schedule-predecessors"></div></fieldset><p class="muted">A linked task starts on its predecessor’s finish date. With multiple predecessors, the latest finish date is used. Enter 0 days for a milestone. Dates and progress of summary tasks roll up automatically.</p><p class="form-error" role="alert"></p><div class="modal-footer">${record?'<button class="danger" type="button" id="delete-schedule-task">Delete task</button>':''}<button class="button" type="button" id="cancel-schedule">Cancel</button><button class="primary" type="submit">${record?'Save changes':'Create task'}</button></div></form>`;
  if(!d.open)d.showModal();$('#close-schedule').onclick=$('#cancel-schedule').onclick=()=>d.close();
  const projectSelect=d.querySelector('[name="projectId"]');if(record)projectSelect.disabled=true;
  let assigneeLoad=0;
  async function fillProject(){
    const {rows}=projectSchedule(projectSelect.value),descendants=new Set(record?[record.id]:[]);let changed=true;while(changed){changed=false;for(const r of rows)if(descendants.has(r.task.parentId)&&!descendants.has(r.task.id)){descendants.add(r.task.id);changed=true;}}
    d.querySelector('[name="parentId"]').innerHTML=options([{id:'',name:'Top-level task'},...rows.filter(r=>!descendants.has(r.task.id)).map(r=>({id:r.task.id,name:r.wbs+' — '+r.task.name}))],t.parentId||parentId);
    d.querySelector('[name="workstreamId"]').innerHTML=options([{id:'',name:'No workstream'},...state.workstreams.filter(w=>w.projectId===projectSelect.value)],t.workstreamId||'');
    $('#schedule-predecessors').innerHTML=rows.filter(r=>!r.summary&&!descendants.has(r.task.id)).map(r=>`<label><input type="checkbox" name="dependsOn" value="${r.task.id}" ${(t.dependsOn||[]).includes(r.task.id)?'checked':''}> ${esc(r.wbs+' — '+r.task.name)}</label>`).join('')||'<p class="muted">No other leaf tasks in this project yet.</p>';
    const project=projectSelect.value,version=++assigneeLoad;
    const assignee=d.querySelector('[name="assigneeId"]'),owner=d.querySelector('[name="owner"]');
    try{
      const result=await api('projects/'+project+'/assignees');if(version!==assigneeLoad||!d.open)return;
      const current=t.assigneeId||(record?'':identity.id);
      assignee.innerHTML=options([{id:'',name:'No linked account — use Owner text'},...result.users.map(u=>({id:u.id,name:u.name+' ('+u.email+')'}))],result.users.some(u=>u.id===current)?current:'');
      const syncOwner=event=>{const user=result.users.find(u=>u.id===assignee.value);owner.readOnly=!!user;if(user)owner.value=user.name;else if(event)owner.value='';};
      assignee.onchange=syncOwner;syncOwner();
    }catch(err){if(version===assigneeLoad){assignee.innerHTML=options([{id:t.assigneeId||'',name:t.assigneeId?'Keep current assignee':'No linked account'}],t.assigneeId||'');toast(err.message);}}
  }
  fillProject();projectSelect.onchange=fillProject;
  const start=d.querySelector('[name="startDate"]'),finish=d.querySelector('[name="finishDate"]'),duration=d.querySelector('[name="duration"]'),percent=d.querySelector('[name="percentComplete"]');
  duration.min='0';duration.step='1';duration.max='36500';percent.min='0';percent.max='100';percent.step='1';
  const syncFinish=()=>{try{if(start.value&&duration.value!=='')finish.value=PmoSchedule.shift(start.value,Math.max(Number(duration.value)-1,0));else finish.value='';}catch{finish.value='';}};
  function updateLinkedStart(){
    const ids=[...d.querySelectorAll('[name="dependsOn"]:checked')].map(el=>el.value),dates=state.tasks.filter(task=>ids.includes(task.id)&&task.finishDate).map(task=>task.finishDate).sort();
    start.readOnly=ids.length>0;start.title=ids.length?'Calculated from predecessor finish dates':'';
    if(dates.length){start.value=dates.at(-1);syncFinish();}
  }
  $('#schedule-predecessors').addEventListener('change',updateLinkedStart);updateLinkedStart();
  start.onchange=duration.oninput=syncFinish;finish.onchange=()=>{if(start.value&&finish.value>=start.value)duration.value=PmoSchedule.span(start.value,finish.value);};
  const status=d.querySelector('[name="status"]');if(summary){status.disabled=true;d.querySelector('[name="due"]').disabled=true;}
  percent.oninput=()=>{status.value=Number(percent.value)===100?'Done':Number(percent.value)>0?'In progress':'To do';};status.onchange=()=>{if(status.value==='Done')percent.value=100;else if(Number(percent.value)===100)percent.value=0;};
  const error=err=>d.querySelector('.form-error').textContent=err.message;
  if(record)$('#delete-schedule-task').onclick=()=>{
    const button=$('#delete-schedule-task');if(button.dataset.confirm!=='yes'){button.dataset.confirm='yes';button.textContent='Confirm delete';return;}
    button.disabled=true;api('tasks/'+record.id,'DELETE',{revision:record.revision}).then(async()=>{d.close();await load();toast('Task deleted');}).catch(err=>{error(err);button.disabled=false;});
  };
  $('#schedule-task-form').onsubmit=async e=>{
    e.preventDefault();const button=e.target.querySelector('[type="submit"]');button.disabled=true;
    try{
      const values=new FormData(e.target),data=Object.fromEntries(values);data.projectId=projectSelect.value;data.dependsOn=summary?[]:values.getAll('dependsOn');
      if(summary){delete data.duration;delete data.percentComplete;delete data.startDate;delete data.finishDate;data.status=record.status;}else{data.duration=Number(data.duration);data.percentComplete=Number(data.percentComplete);if(data.finishDate&&(!data.startDate||data.finishDate!==PmoSchedule.shift(data.startDate,Math.max(data.duration-1,0))))throw Error('Finish Date must match Start Date and Duration');}
      if(record)data.revision=record.revision;
      await api('tasks'+(record?'/'+record.id:''),record?'PATCH':'POST',data);d.close();await load();toast('Task saved; schedule updated');
    }catch(err){error(err);}finally{button.disabled=false;}
  };
}
function exportSchedule(){const {rows}=projectSchedule();const lines=[['WBS ID','Task Description','Start Date','Finish Date','Duration','Percent Complete','Depends On'],...rows.map(r=>[r.wbs,r.task.name,r.task.startDate||'',r.task.finishDate||'',r.task.duration??'',PmoSchedule.progress(r.task),(r.task.dependsOn||[]).map(id=>rows.find(x=>x.task.id===id)?.wbs).join(', ')])];const csv=lines.map(row=>row.map(v=>'"'+String(v).replace(/^[=+@\-]/,"'$&").replaceAll('"','""')+'"').join(',')).join('\r\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='project-schedule.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
function bindSchedule(){
  const taskPane=$('.schedule-table-wrap'),ganttPane=$('.schedule-gantt-wrap');
  if(taskPane&&ganttPane){
    const sync=(source,target)=>{if(Math.abs(target.scrollTop-source.scrollTop)>1)target.scrollTop=source.scrollTop;};
    taskPane.addEventListener('scroll',()=>sync(taskPane,ganttPane));
    ganttPane.addEventListener('scroll',()=>sync(ganttPane,taskPane));
  }

  document.querySelectorAll('[data-schedule-add]').forEach(el=>el.onclick=()=>scheduleTaskForm(null,el.dataset.scheduleAdd));
  document.querySelectorAll('[data-schedule-edit]').forEach(el=>el.onclick=()=>scheduleTaskForm(state.tasks.find(t=>t.id===el.dataset.scheduleEdit)));
  if($('#schedule-view'))$('#schedule-view').onchange=e=>{scheduleView=e.target.value;render();};
  if($('#schedule-zoom'))$('#schedule-zoom').onchange=e=>{scheduleZoom=e.target.value;render();};
  if($('#schedule-export'))$('#schedule-export').onclick=exportSchedule;
}
