// Prueba del flujo de foco: destrabar tareas en equipo y seguir por separado.
// Uso: COLLAB_HUB_URL=http://localhost:8787 node tests/focus.mjs
const H=process.env.COLLAB_HUB_URL||"http://localhost:8787";
let fails=0;const check=(c,l)=>{if(!c)fails++;console.log(c?"✅":"❌",l)};
const post=async(p,b,t)=>{const r=await fetch(H+p,{method:"POST",headers:t?{authorization:`Bearer ${t}`}:{},body:JSON.stringify(b)});return {s:r.status,...await r.json()}};
const get=async(p,t)=>(await fetch(H+p,{headers:{authorization:`Bearer ${t}`}})).json();
const a=await post("/rooms",{name:"socios",alias:"marce",agent:"claude"});const R=`/rooms/${a.code}`;
const b=await post(`${R}/join`,{alias:"socio",agent:"codex",invite:a.invite_path.split("#i=")[1]});
await post(`${R}/tasks`,{title:"Integrar pagos",owner:"marce"},a.token);
await post(`${R}/tasks`,{title:"Migrar a Postgres",owner:"socio"},a.token);
const g=await post(`${R}/focus`,{task:"t1"},b.token); check(g.s===403,"invitado no puede cambiar foco");
await post(`${R}/focus`,{task:"t1"},a.token);
let c=await get(`${R}/context`,b.token); check(c.focus?.task==="t1","foco en t1 visible para el socio");
const p=await post(`${R}/decisions`,{text:"Usar Stripe Checkout con webhooks",task:"t1"},b.token); check(p.s===202,"plan del invitado queda como propuesta");
await post(`${R}/proposals/${p.proposal.id}`,{action:"aprobar"},a.token);
await post(`${R}/focus`,{task:"t2"},a.token);
await post(`${R}/decisions`,{text:"pg_dump + script de migración por tabla",task:"t2"},a.token);
await post(`${R}/focus`,{task:null},a.token);
c=await get(`${R}/context`,b.token);
check(c.tasks.every(t=>t.unlocked&&t.plan),"ambas tareas destrabadas con plan");
check(c.focus===null,"foco quitado: cada uno sigue solo");
const bad=await post(`${R}/decisions`,{text:"x",task:"t9"},a.token); check(bad.s===404,"tarea inexistente rechazada");
console.log(c.recent.filter(m=>m.from==="sala").map(m=>"   · "+m.body.slice(0,90)).join("\n"));
process.exit(fails?1:0);
