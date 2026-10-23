const overviewExpanded=new Set(),overviewPrograms=new Set();
let overviewBudgetCurrency='',overviewChartsExpanded=true;
function overviewHealth(projects){
  const current=projects.filter(p=>!['Closed','Canceled'].includes(p.status));
  if(!current.length)return 'No active delivery';
  return ['At risk','Needs attention','Unknown','On track'].find(health=>current.some(p=>p.health===health))||'Unknown';
}
function portfolioHealthIcon(projects){const health=overviewHealth(projects),color={'At risk':'red','Needs attention':'amber','On track':'green'}[health]||'neutral';return `<span class="portfolio-rag" role="img" aria-label="Portfolio health: ${health}" title="Portfolio health: ${health}"><span class="portfolio-stoplight rag-${color}" aria-hidden="true"><i class="rag-lamp-red"></i><i class="rag-lamp-amber"></i><i class="rag-lamp-green"></i></span><span class="portfolio-rag-label">${health}</span></span>`;}
function overviewData(projects){
  const ids=new Set(projects.map(p=>p.id)),tasks=state.tasks.filter(t=>ids.has(t.projectId)),parents=new Set(tasks.map(t=>t.parentId).filter(Boolean)),leaves=tasks.filter(t=>!parents.has(t.id));
  const today=new Date().toISOString().slice(0,10),milestones=leaves.filter(t=>t.duration===0),open=leaves.filter(t=>PmoSchedule.progress(t)<100),late=milestones.filter(t=>PmoSchedule.progress(t)<100&&t.finishDate&&t.finishDate<today);
  const raid=state.raid.filter(r=>ids.has(r.projectId)&&r.status!=='Resolved'),risks=raid.filter(r=>r.type==='Risk');
  const intervention=projects.filter(p=>!['Closed','Canceled'].includes(p.status)&&(p.health==='At risk'||p.health==='Needs attention'||late.some(t=>t.projectId===p.id)));
  const currencies=[...new Set(projects.map(p=>p.currency||'USD'))].sort().map(currency=>{const ps=projects.filter(p=>(p.currency||'USD')===currency);return {currency,budget:ps.reduce((s,p)=>s+(Number(p.budget)||0),0),forecast:ps.reduce((s,p)=>s+(Number(p.forecast)||0),0)};});
  return {health:overviewHealth(projects),total:projects.length,active:projects.filter(p=>p.status==='Active').length,completed:projects.filter(p=>p.status==='Closed').length,intervention,currencies,milestones,late,delivered:milestones.filter(t=>PmoSchedule.progress(t)===100).length,open,owners:new Set(open.map(t=>(t.owner||'').trim().toLowerCase()).filter(s=>s&&s!=='unassigned')).size,unassigned:open.filter(t=>!t.owner?.trim()||t.owner.trim().toLowerCase()==='unassigned').length,risks,criticalRisks:risks.filter(r=>['High','Critical'].includes(r.severity)).length,links:leaves.reduce((n,t)=>n+(t.dependsOn?.length||0),0),externalDependencies:raid.filter(r=>r.type==='Dependency').length};
}
const overviewTableHeaders=['Portfolio Name','Owner','Target Completion Date','Total Approved Budget','Committed Budget','Remaining Budget','Portfolio Health','Count of Risks','Count of Issues'];
function overviewPie(parts,label,center){
  const total=parts.reduce((sum,p)=>sum+p.value,0);let offset=0;
  return `<div class="overview-pie"><svg viewBox="0 0 100 100" role="img" aria-label="${esc(label)}"><circle cx="50" cy="50" r="39" fill="none" stroke="#E2E8F0" stroke-width="16"/>${parts.map(p=>{const percent=total?p.value/total*100:0,segment=`<circle cx="50" cy="50" r="39" pathLength="100" fill="none" stroke="${p.color}" stroke-width="16" stroke-dasharray="${percent} ${100-percent}" stroke-dashoffset="${-offset}" transform="rotate(-90 50 50)"><title>${esc(p.label+': '+p.value)}</title></circle>`;offset+=percent;return percent?segment:'';}).join('')}</svg><div class="overview-pie-center">${center}</div></div>`;
}
function overviewBudgetTotals(projects){return financialTotals(projects).map(t=>({...t,remainingBudget:t.missingCommitted?null:t.budget-t.committedCosts}));}
function overviewProjectPie(){
  const d=overviewData(state.projects),other=d.total-d.active-d.completed;
  const parts=[{label:'Active',value:d.active,color:'#2563EB'},{label:'Closed',value:d.completed,color:'#22C55E'},{label:'Other',value:other,color:'#CBD5E1'}];
  return `<article class="overview-pie-card" aria-label="Project summary"><h2>Projects</h2><div class="overview-pie-content">${overviewPie(parts,`${d.total} total projects: ${d.active} active, ${d.completed} closed, ${other} other`,`<button data-overview-projects="all" aria-label="Total Projects"><strong>${d.total}</strong><small>Total Projects</small></button>`)}<div class="overview-pie-legend"><button data-overview-projects="Active" aria-label="Active Projects"><i style="background:#2563EB"></i><span>Active Projects</span><strong>${d.active}</strong></button><button data-overview-projects="Closed" aria-label="Closed Projects"><i style="background:#22C55E"></i><span>Closed Projects</span><strong>${d.completed}</strong></button><div><i style="background:#CBD5E1"></i><span>Other Projects</span><strong>${other}</strong></div></div></div></article>`;
}
function overviewPortfolioPie(){
 const palette=['#2563EB','#1E3A5F','#38BDF8','#16A34A','#8B5CF6','#D97706','#0D9488','#DB2777'];
 const parts=state.portfolios.map((p,index)=>({label:p.name,value:state.projects.filter(project=>project.portfolioId===p.id).length,color:palette[index%palette.length]}));
 const unassigned=state.projects.filter(p=>!p.portfolioId).length;if(unassigned)parts.push({label:'Unassigned',value:unassigned,color:'#94A3B8'});
 return `<article class="overview-pie-card" aria-label="Projects per portfolio"><h2>Projects per Portfolio</h2><div class="overview-pie-content">${overviewPie(parts,`Projects per portfolio: ${parts.map(p=>p.label+': '+p.value).join(', ')||'No projects'}`,`<strong>${state.projects.length}</strong><small>Total Projects</small>`)}<div class="overview-pie-legend overview-portfolio-legend">${parts.map(p=>`<div><i style="background:${p.color}"></i><span>${esc(p.label)}</span><strong>${p.value}</strong></div>`).join('')||'<small>No portfolios yet.</small>'}</div></div></article>`;
}
function overviewBudgetPie(){
  const allTotals=overviewBudgetTotals(state.projects),currency=allTotals.some(t=>t.currency===overviewBudgetCurrency)?overviewBudgetCurrency:allTotals.some(t=>t.currency==='USD')?'USD':allTotals[0]?.currency,totals=allTotals.filter(t=>t.currency===currency);
  return `<article class="overview-pie-card" aria-label="Budget summary"><div class="overview-budget-heading"><h2>Total Budget</h2>${allTotals.length>1?`<select id="overview-budget-currency" aria-label="Budget currency">${options(allTotals.map(t=>t.currency),currency)}</select>`:''}</div><div class="overview-budget-pies">${totals.map(t=>{
    const missing=t.missingCommitted,remaining=Math.max(t.budget-t.committedCosts,0),parts=[{label:'Recorded committed budget',value:t.committedCosts,color:'#1E3A5F'},{label:missing?'Unreconciled budget':'Remaining budget',value:remaining,color:missing?'#CBD5E1':'#38BDF8'}];
    return `<div class="overview-currency-pie"><div class="overview-pie-content">${overviewPie(parts,`${t.currency}: approved budget ${t.budget}, recorded commitments ${t.committedCosts}, ${missing?'remaining unknown':`remaining ${t.remainingBudget}`}`,`<strong>${esc(financialMoney(t.budget,t.currency))}</strong><small>${esc(t.currency)} total</small>`)}<div class="overview-pie-legend"><div><i style="background:#1E3A5F"></i><span>Committed</span><strong>${missing===t.projects?'—':esc(financialMoney(t.committedCosts,t.currency))}</strong></div><div><i style="background:${missing?'#CBD5E1':'#38BDF8'}"></i><span>Remaining</span><strong class="${t.remainingBudget<0?'financial-overrun':''}">${t.remainingBudget===null?'—':esc(financialMoney(t.remainingBudget,t.currency))}</strong></div>${missing?`<small>${missing} projects: commitments unrecorded</small>`:t.remainingBudget<0?'<small class="financial-overrun">Commitments exceed approved budget</small>':''}</div></div></div>`;
  }).join('')||'<p class="overview-pie-empty">No project budgets yet.</p>'}</div></article>`;
}
function overviewPortfolioBudgetPie(){
 const totals=overviewBudgetTotals(state.projects),currency=totals.some(t=>t.currency===overviewBudgetCurrency)?overviewBudgetCurrency:totals.some(t=>t.currency==='USD')?'USD':totals[0]?.currency;
 const projects=state.projects.filter(p=>(p.currency||'USD')===currency),palette=['#2563EB','#1E3A5F','#38BDF8','#16A34A','#8B5CF6','#D97706','#0D9488','#DB2777'];
 const parts=state.portfolios.map((p,index)=>({label:p.name,value:projects.filter(project=>project.portfolioId===p.id).reduce((sum,p)=>sum+(Number(p.budget)||0),0),color:palette[index%palette.length]}));
 const unassigned=projects.filter(p=>!p.portfolioId);if(unassigned.length)parts.push({label:'Unassigned',value:unassigned.reduce((sum,p)=>sum+(Number(p.budget)||0),0),color:'#94A3B8'});
 const total=projects.reduce((sum,p)=>sum+(Number(p.budget)||0),0);
 return `<article class="overview-pie-card" aria-label="Budget by portfolio"><div class="overview-budget-heading"><h2>Budget by Portfolio</h2>${totals.length>1?`<select id="overview-portfolio-budget-currency" aria-label="Portfolio budget currency">${options(totals.map(t=>t.currency),currency)}</select>`:''}</div>${currency?`<div class="overview-pie-content">${overviewPie(parts,`${currency} budget by portfolio: ${parts.map(p=>p.label+': '+p.value).join(', ')}`,`<strong>${esc(financialMoney(total,currency))}</strong><small>${esc(currency)} total</small>`)}<div class="overview-pie-legend overview-portfolio-legend">${parts.map(p=>`<div><i style="background:${p.color}"></i><span>${esc(p.label)}</span><strong>${esc(financialMoney(p.value,currency))}</strong></div>`).join('')||'<small>No portfolios yet.</small>'}</div></div>`:'<p class="overview-pie-empty">No project budgets yet.</p>'}</article>`;
}
function overviewTargetDate(projects){
  const dates=projects.map(p=>{
    if(typeof p.target!=='string'||!p.target.trim())return '';
    if(/^\d{4}-\d{2}-\d{2}$/.test(p.target))return PmoSchedule.validDate(p.target)?p.target:'';
    const parsed=Date.parse(p.target);return Number.isFinite(parsed)?new Date(parsed).toISOString().slice(0,10):'';
  });
  return {date:dates.filter(Boolean).sort().at(-1)||'',missing:dates.filter(d=>!d).length};
}
function overviewTableCells(projects,includeCounts=true,includeHealth=true){
  const ids=new Set(projects.map(p=>p.id)),totals=overviewBudgetTotals(projects),raid=state.raid.filter(r=>ids.has(r.projectId)&&r.status!=='Resolved');
  const amounts=['budget','committedCosts','remainingBudget'].map(key=>`<td class="overview-ledger-number">${totals.map(t=>{
    const missing=key==='committedCosts'?t.missingCommitted:0,unknown=key==='remainingBudget'&&t.remainingBudget===null||missing===t.projects;
    return `<div class="overview-ledger-amount ${key==='remainingBudget'&&t.remainingBudget<0?'financial-overrun':''}"><span>${unknown?'—':esc(financialMoney(t[key],t.currency))}<small>${esc(t.currency)}</small></span>${unknown?`<small>${key==='remainingBudget'?'Commitments incomplete':'Not recorded'}</small>`:missing?`<small>${missing} unrecorded · subtotal</small>`:''}</div>`;
  }).join('')||'—'}</td>`).join('');
  const target=overviewTargetDate(projects);
  return `<td class="overview-target-date">${target.date?esc(target.date):'Not set'}${target.date&&target.missing?`<small>${target.missing} project targets unrecorded</small>`:''}</td>`+amounts+`${includeHealth?`<td>${badge(overviewHealth(projects))}</td>`:''}${includeCounts?`<td>${raid.filter(r=>r.type==='Risk').length}</td><td>${raid.filter(r=>r.type==='Issue').length}</td>`:''}`;
}
function projectListStatus(projectId){const report=latestProjectStatus(projectId);return `<details class="project-latest-status"><summary>Latest status${report?' · '+esc(statusReportDate(report)):''}</summary><p>${report?esc(report.description):'No status report yet.'}</p></details>`;}
function overviewLedgerRow(kind,record,projects,depth,expanded=false,hidden=false,parentProgram='',projectDirectory=false){
  const portfolio=kind==='portfolio',program=kind==='program',attributes=portfolio?`data-overview-expand="${record.id}" aria-expanded="${expanded}" aria-controls="overview-${record.id}"`:program?`data-overview-program="${record.id}" aria-expanded="${expanded}" ${projects.length?`aria-controls="${projects.map(p=>'overview-project-'+p.id).join(' ')}"`:''}`:`data-project="${record.id}"`;
  return `<tr class="overview-${kind}-row" ${kind==='project'?`id="overview-project-${record.id}"`:''} ${parentProgram?`data-overview-program-parent="${parentProgram}"`:''} ${hidden?'hidden':''}>${projectDirectory?`<td>${esc(state.portfolios.find(p=>p.id===record.portfolioId)?.name||'Unassigned')}${portfolioHealthIcon(state.projects.filter(p=>(p.portfolioId||'')===(record.portfolioId||'')))}</td>`:''}<th scope="row"><button class="overview-ledger-name" style="padding-left:${depth*18}px" ${attributes}><span class="expand-chevron" aria-hidden="true">${kind==='project'?'◇':expanded?'▾':'▸'}</span><span><span class="project-name-with-status"><strong>${esc(record.name)}</strong>${kind==='project'&&page==='Projects'&&!selected?statusAgeIcon(record.id):''}</span>${portfolio?portfolioHealthIcon(projects):`<small>${program?'Program':'Project'}</small>`}</span></button>${projectDirectory?projectListStatus(record.id):''}</th>${projectDirectory?`<td>${badge(record.health||'Unknown')}</td>`:''}<td>${esc(record.owner||'Unassigned')}</td>${overviewTableCells(projects,!projectDirectory&&page!=='Portfolio Home',!projectDirectory)}</tr>`;
}
function overviewPortfolioLedger(portfolio){
  const projects=state.projects.filter(p=>portfolio.id==='unassigned'?!p.portfolioId:p.portfolioId===portfolio.id),programs=state.programs.filter(p=>p.portfolioId===portfolio.id),open=overviewExpanded.has(portfolio.id);
  return `<tbody>${overviewLedgerRow('portfolio',portfolio,projects,0,open)}</tbody><tbody id="overview-${portfolio.id}" ${open?'':'hidden'}>${programs.map(program=>{const ps=projects.filter(p=>p.programId===program.id),expanded=overviewPrograms.has(program.id);return overviewLedgerRow('program',program,ps,1,expanded)+ps.map(p=>overviewLedgerRow('project',p,[p],2,false,!expanded,program.id)).join('');}).join('')}${projects.filter(p=>!p.programId).map(p=>overviewLedgerRow('project',p,[p],1)).join('')}${!projects.length&&!programs.length?`<tr><td colspan="${page==='Portfolio Home'?7:9}" class="overview-ledger-empty">No programs or projects in this portfolio yet.</td></tr>`:''}</tbody>`;
}
function dashboard(){
  const portfolios=[...state.portfolios];if(state.projects.some(p=>!p.portfolioId))portfolios.push({id:'unassigned',name:'Unassigned projects',owner:'—'});
  return `<section class="home-overview-header"><section class="welcome-header overview-welcome" aria-label="Welcome">${heading('YOUR PORTFOLIO, AT A GLANCE',`Welcome, ${esc(identity.name.split(' ')[0])} <span class="greeting">☀</span>`,'Your portfolios, delivery performance, and priorities in one place.',creationActions())}</section><details id="overview-chart-details" ${overviewChartsExpanded?'open':''}><summary>Portfolio charts</summary><section class="overview-pie-heroes" aria-label="Portfolio summary">${overviewProjectPie()}${overviewPortfolioPie()}${overviewBudgetPie()}${overviewPortfolioBudgetPie()}</section></details></section><section class="panel overview-ledger-panel" aria-label="Portfolio list"><div class="overview-ledger-scroll" tabindex="0" role="region" aria-label="Expandable portfolio overview table"><table class="overview-ledger"><thead><tr>${overviewTableHeaders.slice(0,-2).map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead>${portfolios.map(overviewPortfolioLedger).join('')||'<tbody><tr><td colspan="7" class="overview-ledger-empty">No portfolios yet. Create a portfolio to start organizing delivery.</td></tr></tbody>'}</table></div><p class="overview-ledger-note">Remaining Budget = approved budget − outstanding committed costs. Unrecorded commitments remain unknown. All figures follow your project access; currencies stay separate.</p></section>`;
}
function bindOverview(){
  if($('#project-portfolio-filter'))$('#project-portfolio-filter').onchange=e=>{scopePortfolio=e.target.value;scopeProgram='';render();};
  const charts=$('#overview-chart-details');if(charts)charts.ontoggle=()=>{if(charts.isConnected)overviewChartsExpanded=charts.open;};
  if($('#overview-portfolio-budget-currency'))$('#overview-portfolio-budget-currency').onchange=e=>{overviewBudgetCurrency=e.target.value;render();};
  if($('#overview-budget-currency'))$('#overview-budget-currency').onchange=e=>{overviewBudgetCurrency=e.target.value;render();};
  document.querySelectorAll('[data-overview-projects]').forEach(button=>button.onclick=()=>{scopePortfolio='';scopeProgram='';query='';healthFilter='All health';categoryFilter='All categories';projectViewFilter=button.dataset.overviewProjects;page='Projects';selected=null;render();window.scrollTo(0,0);});
  document.querySelectorAll('[data-overview-expand]').forEach(button=>button.onclick=()=>{const id=button.dataset.overviewExpand,open=!overviewExpanded.has(id);open?overviewExpanded.add(id):overviewExpanded.delete(id);button.setAttribute('aria-expanded',String(open));button.querySelector('.expand-chevron').textContent=open?'▾':'▸';document.getElementById('overview-'+id).hidden=!open;});
  document.querySelectorAll('[data-overview-program]').forEach(button=>button.onclick=()=>{const id=button.dataset.overviewProgram,open=!overviewPrograms.has(id);open?overviewPrograms.add(id):overviewPrograms.delete(id);button.setAttribute('aria-expanded',String(open));button.querySelector('.expand-chevron').textContent=open?'▾':'▸';document.querySelectorAll('[data-overview-program-parent="'+id+'"]').forEach(row=>row.hidden=!open);});
}
function directoryLedger(kind){
  const name=kind==='portfolios'?'Portfolio':kind==='programs'?'Program':'Project',headers=kind==='projects'?['Portfolio Name','Project Name','Project Health',...overviewTableHeaders.slice(1,-3)]:overviewTableHeaders.map((h,i)=>i===0?name+' Name':h);
  let rows='';
  if(kind==='portfolios'){
    const portfolios=[...state.portfolios];if(state.projects.some(p=>!p.portfolioId))portfolios.push({id:'unassigned',name:'Unassigned projects',owner:'—'});
    rows=portfolios.map(overviewPortfolioLedger).join('');
  }else if(kind==='programs'){
    rows=state.programs.map(program=>{const projects=state.projects.filter(p=>p.programId===program.id),expanded=overviewPrograms.has(program.id);return `<tbody>${overviewLedgerRow('program',program,projects,0,expanded)}${projects.map(p=>overviewLedgerRow('project',p,[p],1,false,!expanded,program.id)).join('')}</tbody>`;}).join('');
  }else rows=`<tbody>${filtered().map(p=>overviewLedgerRow('project',p,[p],0,false,false,'',true)).join('')}</tbody>`;
  if(!rows||kind==='projects'&&!filtered().length)rows=`<tbody><tr><td colspan="${headers.length}" class="overview-ledger-empty">No ${kind} to display.</td></tr></tbody>`;
  return `<section class="panel overview-ledger-panel" aria-label="${name} directory"><div class="overview-ledger-scroll" tabindex="0" role="region" aria-label="${name} table"><table class="overview-ledger ${kind==='projects'?'project-directory-ledger':''}"><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead>${rows}</table></div></section>`;
}
