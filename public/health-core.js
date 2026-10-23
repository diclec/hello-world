/* Shared, data-only health scoring. Lower scores mean healthier delivery. */
globalThis.PmoHealth = (() => {
 const dimensions={
  schedule:{name:'Schedule',unit:'Days late',description:'Maximum of recorded schedule slip and overdue unfinished leaf-task days.',weight:25,amber:1,red:11},
  budget:{name:'Budget',unit:'Forecast overrun %',description:'(Estimate at completion − approved budget) ÷ approved budget × 100. Requires a positive budget and recorded forecast.',weight:25,amber:0.01,red:10},
  resources:{name:'Resources',unit:'Hours utilized %',description:'Utilized hours ÷ allocated hours × 100 across project assignments. All assignment hours must be recorded. This measures hours consumed, not concurrent capacity.',weight:15,amber:90,red:110},
  risk:{name:'Risk',unit:'Open high/critical risks',description:'Count of unresolved High or Critical risks. An empty register scores zero.',weight:15,amber:1,red:3},
  issues:{name:'Issues',unit:'Open high/critical issues',description:'Count of unresolved High or Critical issues. An empty register scores zero.',weight:10,amber:1,red:2},
  reporting:{name:'Reporting',unit:'Days since latest status',description:'Age of the newest dated status report, falling back to the project’s last-report date.',weight:10,amber:8,red:14},
  dependencies:{name:'Dependencies',unit:'Overdue dependencies',description:'Count of unresolved RAID dependencies with a due date before today. An empty register scores zero.',weight:0,amber:1,red:3}
 };
 const levels=['project','program','portfolio'];
 const defaults=()=>({revision:0,enabled:false,levels:Object.fromEntries(levels.map(level=>[level,{amber:25,red:60,missingData:'strict',dimensions:Object.fromEntries(Object.entries(dimensions).map(([key,d])=>[key,{weight:d.weight,amber:d.amber,red:d.red}]))}]))});
 const fail=message=>{throw Object.assign(new Error(message),{status:400});};
 const number=(n,min,max)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
 function validate(input){
  if(!input||!Number.isInteger(input.revision)||input.revision<0)fail('A valid settings revision is required');
  const result={revision:input.revision,enabled:true,levels:{}};
  for(const level of levels){
   const p=input.levels?.[level];if(!p||!number(p.amber,0.01,100)||!number(p.red,0.01,100)||p.red<=p.amber)fail(`${level}: overall red must exceed amber, within 0–100`);
   if(!['strict','available'].includes(p.missingData))fail(`${level}: select a missing-data policy`);
   const ds={};let weight=0;
   for(const [key,d] of Object.entries(dimensions)){const v=p.dimensions?.[key];if(!v||!number(v.weight,0,100)||!number(v.amber,0.001,1000000)||!number(v.red,0.001,1000000)||v.red<=v.amber)fail(`${level} ${d.name}: use a weight from 0–100 and positive thresholds with red above amber`);ds[key]={weight:v.weight,amber:v.amber,red:v.red};weight+=v.weight;}
   if(!weight)fail(`${level}: at least one dimension needs a positive weight`);
   result.levels[level]={amber:p.amber,red:p.red,missingData:p.missingData,dimensions:ds};
  }return result;
 }
 function evaluate(projects,policy){
  const current=projects.filter(p=>!['Closed','Canceled'].includes(p.status));
  if(!current.length)return {health:'No active delivery',score:null,coverage:0,dimensions:{}};
  const result={health:'Unknown',score:null,coverage:0,dimensions:{}};let weighted=0,availableWeight=0,totalWeight=0,knownWeight=0,incomplete=false;
  for(const [key,d] of Object.entries(policy.dimensions)){
   if(!d.weight)continue;totalWeight+=d.weight;
   const values=current.map(p=>p.healthMetrics?.[key]).filter(v=>typeof v==='number'&&Number.isFinite(v));
   const score=values.length?values.reduce((sum,v)=>sum+(v>=d.red?100:v>=d.amber?50:0),0)/values.length:null;
   result.dimensions[key]={score,known:values.length,total:current.length,weight:d.weight};knownWeight+=d.weight*values.length/current.length;
   if(values.length!==current.length)incomplete=true;
   if(score!==null){weighted+=score*d.weight;availableWeight+=d.weight;}
  }
  result.coverage=totalWeight?Math.round(knownWeight/totalWeight*10000)/100:0;
  if(!availableWeight||(policy.missingData==='strict'&&incomplete))return result;
  const score=weighted/availableWeight;result.score=Math.round(score*100)/100;
  result.health=score>=policy.red?'At risk':score>=policy.amber?'Needs attention':'On track';return result;
 }
 return {dimensions,levels,defaults,validate,evaluate};
})();
