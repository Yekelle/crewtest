const TEST_MODE = true;

const SUPABASE_URL = "";
const SUPABASE_PUBLISHABLE_KEY = "";

const AUTH_HASH_PARAMS=new URLSearchParams(window.location.hash.replace(/^#/,""));
const AUTH_QUERY_PARAMS=new URLSearchParams(window.location.search);
let authSetupRequested=["invite","recovery"].includes(AUTH_HASH_PARAMS.get("type"))||["invite","recovery"].includes(AUTH_QUERY_PARAMS.get("type"));

const supabaseClient = TEST_MODE
  ? null
  : window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
let authUser=null;
let authRole=null;
let authLoading=true;

const SABOTAGE_TYPES=["Oxygène","Réacteur","Lumières","Radio","Sismiques","Portes","Champignon"];
let DELETED_SESSIONS=new Set();
let SESSIONS={};
let DEFAULT_SESSION_PARTICIPANTS={};
let RECORDS=[],GAMES=[],SESSION_PARTICIPANTS={},PLAYERS=[];
let TEST_IMPORTS={};
let pendingJsonImport=null;
const CREWTEST_STORAGE_KEY="crewtest-json-lab-v1";
let currentScope=latestMonth(),currentPlayer="Bunny_Island",currentPlayerMonth=latestMonth(),currentPlayerMode="month",currentPlayerDetailTab="overview",editingRecordKey=null;

/* ===== Authentification et données Supabase ===== */

async function refreshAdminAuth(sessionOverride=null){
  authLoading=true;
  authUser=sessionOverride?.user||null;
  authRole=null;
  renderAdminAccess();
  try{
    let session=sessionOverride;
    if(!session){
      const {data,error}=await supabaseClient.auth.getSession();
      if(error)throw error;
      session=data?.session||null;
    }
    authUser=session?.user||null;
    if(authUser){
      const {data,error}=await supabaseClient.from("user_roles").select("role").eq("user_id",authUser.id).maybeSingle();
      if(error)throw error;
      authRole=data?.role||null;
    }
  }catch(error){
    console.error("Crew'mong Us : impossible de vérifier le rôle Admin.",error);
    authUser=null;authRole=null;
  }
  authLoading=false;
  renderAdminAccess();
  renderAccountSetup();
  syncEditorNavigation();
  if(editorCanWrite())renderAdmin();
}

async function handleAdminLogin(){
  const email=document.getElementById("admin-login-email")?.value.trim();
  const password=document.getElementById("admin-login-password")?.value;
  const status=document.getElementById("admin-auth-status");
  if(!email||!password){
    if(status)status.textContent="Renseigne l’adresse e-mail et le mot de passe.";
    return;
  }
  if(status)status.textContent="Connexion…";
  const {data,error}=await supabaseClient.auth.signInWithPassword({email,password});
  if(error){
    if(status)status.textContent="Connexion impossible : "+error.message;
    return;
  }
  await refreshAdminAuth(data?.session||null);
  if(!editorCanWrite()){
    await supabaseClient.auth.signOut();
    authUser=null;authRole=null;renderAdminAccess();syncEditorNavigation();
    const s=document.getElementById("admin-auth-status");
    if(s)s.textContent="Ce compte n’a pas de rôle Admin ou Helper.";
  }
}

async function handlePasswordLink(){
  const email=document.getElementById("admin-login-email")?.value.trim();
  const status=document.getElementById("admin-auth-status");
  if(!email){
    if(status)status.textContent="Entre d’abord l’adresse e-mail du compte.";
    return;
  }
  if(status)status.textContent="Envoi du lien…";
  const redirectTo=window.location.origin+window.location.pathname;
  const {error}=await supabaseClient.auth.resetPasswordForEmail(email,{redirectTo});
  if(error){
    if(status)status.textContent="Impossible d’envoyer le lien : "+error.message;
    return;
  }
  if(status)status.textContent="Un lien pour définir ou réinitialiser le mot de passe a été envoyé par e-mail.";
}

async function handleAdminLogout(){
  const {error}=await supabaseClient.auth.signOut({scope:"local"});
  if(error){
    const status=document.getElementById("admin-auth-status");
    if(status)status.textContent="Déconnexion impossible : "+error.message;
    return;
  }
  authUser=null;authRole=null;renderAdminAccess();renderAccountSetup();syncEditorNavigation();
}

function accountSetupNeeded(){
  if(!authUser)return false;
  const setupDone=authUser.user_metadata?.crew_setup_complete===true;
  return !setupDone&&(authSetupRequested||!authRole);
}

function renderAccountSetup(){
  const overlay=document.getElementById("account-setup-overlay");
  const email=document.getElementById("account-setup-email");
  if(!overlay)return;
  const show=accountSetupNeeded();
  overlay.hidden=!show;
  if(show&&email)email.textContent=authUser?.email||"Compte invité";
}

async function handleAccountSetup(event){
  event.preventDefault();
  const password=document.getElementById("account-setup-password")?.value||"";
  const confirmPassword=document.getElementById("account-setup-password-confirm")?.value||"";
  const button=document.getElementById("account-setup-submit");
  const status=document.getElementById("account-setup-status");

  if(password.length<8){
    if(status)status.textContent="Choisis un mot de passe d’au moins 8 caractères.";
    return;
  }
  if(password!==confirmPassword){
    if(status)status.textContent="Les deux mots de passe ne correspondent pas.";
    return;
  }

  if(button)button.disabled=true;
  if(status)status.textContent="Création du mot de passe…";

  const {data,error}=await supabaseClient.auth.updateUser({
    password,
    data:{crew_setup_complete:true}
  });

  if(error){
    if(status)status.textContent="Impossible de créer le mot de passe : "+error.message;
    if(button)button.disabled=false;
    return;
  }

  authUser=data?.user||authUser;
  authSetupRequested=false;
  history.replaceState(null,"",window.location.pathname);
  if(status)status.textContent="Mot de passe créé. Ton compte est prêt.";
  document.getElementById("account-setup-password").value="";
  document.getElementById("account-setup-password-confirm").value="";

  setTimeout(async()=>{
    renderAccountSetup();
    await refreshAdminAuth();
    if(button)button.disabled=false;
  },700);
}

function renderAdminAccess(){
  const panel=document.getElementById("admin-auth-panel"),protectedBox=document.getElementById("admin-protected"),adminOnly=document.getElementById("admin-only-tools");
  if(!panel||!protectedBox)return;
  if(authLoading){
    panel.innerHTML=`<h3>Accès Gestion</h3><p class="muted">Vérification de la session…</p>`;
    protectedBox.hidden=true;
    if(adminOnly)adminOnly.hidden=true;
    return;
  }
  if(editorCanWrite()){
    const isAdmin=authRole==="admin";
    panel.innerHTML=`<div class="admin-auth-user"><div><h3>${isAdmin?"Administration":"Accès Helper"} déverrouillé${isAdmin?"":" "}</h3><p class="muted">Connecté avec <strong>${esc(authUser.email||"compte")}</strong> • rôle ${isAdmin?"Admin":"Helper"}${isAdmin?"":" • saisie et modification des fiches"}</p></div><button id="admin-logout-btn" class="secondary" type="button">Se déconnecter</button></div>`;
    protectedBox.hidden=false;
    if(adminOnly)adminOnly.hidden=!isAdmin;
    document.getElementById("admin-logout-btn")?.addEventListener("click",handleAdminLogout);
    return;
  }
  const message=authUser?"Ce compte n’a pas accès à la gestion.":"La consultation du site reste publique. Une connexion Admin ou Helper est nécessaire uniquement pour modifier les données.";
  panel.innerHTML=`<h3>Accès Gestion</h3><p class="muted">${message}</p><form id="admin-login-form" class="admin-auth-form"><label>E-mail<input id="admin-login-email" type="email" autocomplete="username" required></label><label>Mot de passe<input id="admin-login-password" type="password" autocomplete="current-password" required></label><div class="admin-auth-actions"><button class="primary" type="submit">Se connecter</button><button id="admin-password-link" class="secondary" type="button">Définir / réinitialiser le mot de passe</button></div></form><span id="admin-auth-status" class="muted admin-auth-status"></span>`;
  protectedBox.hidden=true;
  if(adminOnly)adminOnly.hidden=true;
  document.getElementById("admin-login-form")?.addEventListener("submit",e=>{e.preventDefault();handleAdminLogin()});
  document.getElementById("admin-password-link")?.addEventListener("click",handlePasswordLink);
}

function editorCanWrite(){return (authRole==="admin"||authRole==="helper")&&!!authUser}
function adminCanWrite(){return authRole==="admin"&&!!authUser}

function syncEditorNavigation(){
  const entryNav=document.querySelector('.nav[data-view="entry"]');
  const entryView=document.getElementById("view-entry");
  const canEdit=editorCanWrite();

  if(entryNav)entryNav.hidden=!canEdit;

  if(!canEdit&&entryView?.classList.contains("active")){
    document.querySelectorAll(".nav").forEach(x=>x.classList.toggle("active",x.dataset.view==="admin"));
    document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id==="view-admin"));
    renderAdminAccess();
  }
}
function requireEditor(){
  return editorCanWrite();
}
function requireAdmin(){
  if(adminCanWrite())return true;
  const status=document.getElementById("admin-player-status");
  if(status)status.textContent="Cette action est réservée aux comptes Admin.";
  return false;
}
async function reloadPublicData(){
  await loadFromSupabase();
  refreshSessionSelectors();populateGameSelect();syncEntryPlayerOptions();refreshEventPlayerOptions();renderAll();
  if(editorCanWrite())renderAdmin();
}
async function insertAdminPlayerToSupabase(player){
  const {data,error}=await supabaseClient.from("players").insert({name:player.name,handle:player.handle,active:true,source:"admin"}).select("id,name,handle,active,source").single();
  if(error)throw error;
  return data;
}
async function updateAdminPlayerInSupabase(player){
  const {data,error}=await supabaseClient.from("players").update({name:player.name,handle:player.handle,active:player.active!==false,updated_at:new Date().toISOString()}).eq("id",player.id).select("id,name,handle,active,source").single();
  if(error)throw error;
  return data;
}
async function toggleAdminPlayerInSupabase(player){
  const {error}=await supabaseClient.from("players").update({active:player.active!==false,updated_at:new Date().toISOString()}).eq("id",player.id);
  if(error)throw error;
}
async function deleteAdminPlayerInSupabase(player){
  const {error}=await supabaseClient.rpc("delete_player",{p_player_id:player.id});
  if(error)throw error;
}

async function adminCreateSessionInSupabase(session){
  const {data,error}=await supabaseClient.rpc("admin_create_session",{
    p_id:session.id,
    p_date_label:session.date,
    p_month:session.month,
    p_label:session.label
  });
  if(error)throw error;
  return data;
}
async function adminUpdateSessionInSupabase(oldId,newId,session){
  const {data,error}=await supabaseClient.rpc("admin_update_session",{
    p_old_id:oldId,
    p_new_id:newId,
    p_date_label:session.date,
    p_month:session.month,
    p_label:session.label
  });
  if(error)throw error;
  return data;
}
async function adminDeleteSessionInSupabase(id){
  const {error}=await supabaseClient.rpc("admin_delete_session",{p_session_id:id});
  if(error)throw error;
}
async function adminSaveParticipantsInSupabase(session,names){
  const playerIds=names.map(name=>PLAYERS.find(p=>p.name===name)?.id).filter(Boolean);
  if(playerIds.length!==names.length)throw new Error("Un participant sélectionné est introuvable dans Supabase.");
  const {error}=await supabaseClient.rpc("admin_save_participants",{
    p_session_id:session,
    p_player_ids:playerIds
  });
  if(error)throw error;
}
async function adminUpsertRecordInSupabase(payload){
  const {data,error}=await supabaseClient.rpc("admin_upsert_record",payload);
  if(error)throw error;
  return data;
}
async function adminDeleteRecordInSupabase(id){
  const {error}=await supabaseClient.rpc("admin_delete_record",{p_record_id:id});
  if(error)throw error;
}

async function loadFromSupabase(){
  const queries=await Promise.all([
    supabaseClient.from("players").select("id,name,handle,active,source"),
    supabaseClient.from("sessions").select("id,date_label,month,label"),
    supabaseClient.from("games").select("id,session_id,game_number,map,winner,method,t1_deaths"),
    supabaseClient.from("session_participants").select("session_id,player_id"),
    supabaseClient.from("records").select("id,game_id,player_id,role,reports,self_reports,sabotage_count,sabotages,repair,kills,death,death_pos,turn,tasks,total_tasks,ejected,note")
  ]);
  const failed=queries.find(q=>q.error);
  if(failed?.error) throw failed.error;

  const [playersQ,sessionsQ,gamesQ,participantsQ,recordsQ]=queries;
  const playerRows=playersQ.data||[];
  const sessionRows=sessionsQ.data||[];
  const gameRows=gamesQ.data||[];
  const participantRows=participantsQ.data||[];
  const recordRows=recordsQ.data||[];

  if(!playerRows.length || !sessionRows.length || !gameRows.length || !recordRows.length){
    throw new Error(
      `Supabase a répondu avec des données incomplètes (joueurs: ${playerRows.length}, sessions: ${sessionRows.length}, games: ${gameRows.length}, fiches: ${recordRows.length}). Conservation de la sauvegarde locale.`
    );
  }

  const playerById=new Map(playerRows.map(p=>[p.id,p.name]));
  const gameById=new Map(gameRows.map(g=>[g.id,g]));

  PLAYERS=playerRows.map(p=>({
    id:p.id,
    name:String(p.name),
    handle:String(p.handle),
    active:p.active!==false,
    source:p.source||"integrated"
  }));

  SESSIONS=Object.fromEntries(sessionRows.map(s=>[
    s.id,
    {date:s.date_label,month:s.month,label:s.label}
  ]));

  GAMES=gameRows.map(g=>({
    id:g.id,
    session:g.session_id,
    n:Number(g.game_number),
    map:g.map,
    winner:g.winner,
    method:g.method,
    t1Deaths:Number(g.t1_deaths||0)
  }));

  DEFAULT_SESSION_PARTICIPANTS=Object.fromEntries(
    Object.keys(SESSIONS).map(id=>[id,[]])
  );
  SESSION_PARTICIPANTS=DEFAULT_SESSION_PARTICIPANTS;

  participantRows.forEach(row=>{
    const name=playerById.get(row.player_id);
    if(name&&SESSION_PARTICIPANTS[row.session_id]){
      SESSION_PARTICIPANTS[row.session_id].push(name);
    }
  });

  RECORDS=recordRows.map(r=>{
    const game=gameById.get(r.game_id);
    const playerName=playerById.get(r.player_id);
    if(!game||!playerName){
      throw new Error("Une fiche Supabase référence une game ou un joueur introuvable.");
    }
    return {
      id:r.id,
      gameId:r.game_id,
      session:game.session_id,
      p:playerName,
      g:Number(game.game_number),
      role:r.role,
      reports:Number(r.reports||0),
      self:Number(r.self_reports||0),
      sab:Number(r.sabotage_count||0),
      sabotages:Array.isArray(r.sabotages)?r.sabotages:[],
      repair:r.repair===null?null:Number(r.repair||0),
      kills:Array.isArray(r.kills)?r.kills:[],
      death:r.death,
      deathPos:r.death_pos===null?null:Number(r.death_pos),
      turn:r.turn===null?null:Number(r.turn),
      tasks:r.tasks===null?null:Number(r.tasks),
      totalTasks:r.total_tasks===null?null:Number(r.total_tasks),
      ejected:r.ejected===true,
      note:r.note||""
    };
  });

  DELETED_SESSIONS=new Set();
  console.info("Crew'mong Us : données chargées depuis Supabase.");
}
/* ===== Helpers de sessions et joueurs ===== */
function sessionIds(){return Object.keys(SESSIONS).sort((a,b)=>b.localeCompare(a))}
function availableMonths(){return [...new Set(sessionIds().map(id=>SESSIONS[id]?.month).filter(Boolean))].sort((a,b)=>b.localeCompare(a))}
function latestMonth(){return availableMonths()[0]||"2026-09"}
function monthLabel(ym){const [y,m]=String(ym).split("-").map(Number);if(!y||!m)return ym;return new Intl.DateTimeFormat("fr-FR",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(Date.UTC(y,m-1,1))).replace(/^./,c=>c.toUpperCase())}
function sessionMetaFromId(id){const [y,m,d]=id.split("-").map(Number),date=new Date(Date.UTC(y,m-1,d));return{date:new Intl.DateTimeFormat("fr-FR",{day:"numeric",month:"long",year:"numeric",timeZone:"UTC"}).format(date),month:id.slice(0,7),label:String(d).padStart(2,"0")+"/"+String(m).padStart(2,"0")+"/"+y}}
function refreshSessionSelectors(){
 const months=availableMonths(),ids=sessionIds();
 const period=document.getElementById("period-select"),periodValue=currentScope==="all"?"all":(months.includes(currentScope)?currentScope:(months[0]||"all"));
 period.innerHTML=months.map(m=>`<option value="${esc(m)}">${esc(monthLabel(m))}</option>`).join("")+`<option value="all">Stats globales</option>`;period.value=periodValue;currentScope=periodValue;
 const sessionMonth=document.getElementById("session-month"),oldSessionMonth=sessionMonth.value;
 sessionMonth.innerHTML=months.map(m=>`<option value="${esc(m)}">${esc(monthLabel(m))}</option>`).join("");sessionMonth.value=months.includes(oldSessionMonth)?oldSessionMonth:(months[0]||"");
 const playerMonth=document.getElementById("player-month-select"),wantedPlayerMonth=months.includes(currentPlayerMonth)?currentPlayerMonth:(months[0]||"");
 playerMonth.innerHTML=months.map(m=>`<option value="${esc(m)}">${esc(monthLabel(m))}</option>`).join("");playerMonth.value=wantedPlayerMonth;currentPlayerMonth=wantedPlayerMonth;
 const formSession=document.getElementById("form-session"),oldForm=formSession.value;
 formSession.innerHTML=ids.map(id=>`<option value="${esc(id)}">${esc(SESSIONS[id]?.label||id)}</option>`).join("");formSession.value=ids.includes(oldForm)?oldForm:(ids[0]||"");
}
function sortedPlayers(){return [...PLAYERS].sort((a,b)=>a.name.localeCompare(b.name,"fr",{sensitivity:"base"}))}
function activePlayers(){return sortedPlayers().filter(p=>p.active!==false)}
function playerIsUsed(name){return RECORDS.some(r=>r.p===name||r.kills?.includes(name))||Object.values(SESSION_PARTICIPANTS).some(names=>Array.isArray(names)&&names.includes(name))}
function participantNamesForSession(session){const saved=SESSION_PARTICIPANTS[session];return Array.isArray(saved)?saved:[]}
function participantsForSession(session){const allowed=new Set(participantNamesForSession(session));return sortedPlayers().filter(p=>allowed.has(p.name))}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function pct(n,d){return d?(n/d*100).toFixed(1).replace(".",",")+" %":"0 %"}
function gameFor(r){return GAMES.find(g=>g.session===r.session&&g.n===r.g)}
function resultFor(r){const g=gameFor(r);return g&&((r.role==="Imposteur"&&g.winner==="Imposteurs")||(r.role==="Crew"&&g.winner==="Crewmates"))?"Victoire":"Défaite"}
function gamesForScope(s){return s==="all"?[...GAMES]:GAMES.filter(g=>SESSIONS[g.session]?.month===s)}
function recordsForScope(s){return s==="all"?[...RECORDS]:RECORDS.filter(r=>SESSIONS[r.session]?.month===s)}
function favoriteFromList(list){const c={};(list||[]).filter(Boolean).forEach(s=>c[s]=(c[s]||0)+1);const vals=Object.values(c),max=vals.length?Math.max(...vals):0;if(!max)return null;const names=Object.entries(c).filter(([,n])=>n===max).map(([s])=>s);return{name:names.join(" / "),count:max}}
function favoriteSabotage(records){return favoriteFromList(records.flatMap(r=>r.sabotages||[]))}
function turnNumber(v){if(!v)return null;const m=String(v).match(/T(\d+)/);return m?Number(m[1]):null}

function icon(name){
 const paths={
 crown:'<path d="M3 7l4 4 5-7 5 7 4-4-2 11H5L3 7z"/><path d="M6 21h12"/>',
 star:'<path d="m12 2 3 6 7 .8-5 4.7 1.5 6.5L12 17l-6.5 3 1.5-6.5-5-4.7L9 8z"/>',
 medal:'<circle cx="12" cy="9" r="5"/><path d="M9 14 7 22l5-3 5 3-2-8"/>',
 users:'<circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2 21c0-4 2-7 6-7s6 3 6 7M14 15c4 0 7 2 8 6"/>',
 shield:'<path d="M12 3 4 6v6c0 5 3 8 8 10 5-2 8-5 8-10V6z"/><path d="m9 12 2 2 4-5"/>',
 infinity:'<path d="M7 8c-3 0-5 2-5 4s2 4 5 4c4 0 6-8 10-8 3 0 5 2 5 4s-2 4-5 4c-4 0-6-8-10-8z"/>',
 cone:'<path d="M8 20h8L13 4h-2z"/><path d="M5 20h14M9 14h6"/>',
 eject:'<path d="M5 12h13"/><path d="m14 8 4 4-4 4"/><path d="M4 5h4v14H4"/>',
 x:'<path d="M5 5l14 14M19 5 5 19"/>',
 skull:'<circle cx="12" cy="10" r="7"/><path d="M9 10h.01M15 10h.01M9 16v4M12 17v3M15 16v4"/>',
 fast:'<path d="m3 6 7 6-7 6zM11 6l7 6-7 6zM20 6v12"/>',
 megaphone:'<path d="M3 11v2l11 4V7z"/><path d="M14 9h4l3-3v12l-3-3h-4M7 15l1 5h3"/>',
 sad:'<circle cx="12" cy="12" r="9"/><path d="M9 9h.01M15 9h.01M8 17c2-3 6-3 8 0"/>',
 chart:'<path d="M4 20V10M10 20V4M16 20v-7M22 20V7"/>',
 crowd:'<circle cx="12" cy="7" r="3"/><circle cx="5" cy="10" r="2"/><circle cx="19" cy="10" r="2"/><path d="M7 21v-4c0-3 2-5 5-5s5 2 5 5v4M1 21v-3c0-2 1-4 4-4M23 21v-3c0-2-1-4-4-4"/>',
 wrench:'<path d="M14 6a5 5 0 0 0-6 6L3 17l4 4 5-5a5 5 0 0 0 6-6l-3 3-4-4z"/>',
 bolt:'<path d="M13 2 4 14h7l-1 8 9-13h-7z"/>',
 map:'<path d="M3 6 9 3l6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
 duo:'<circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M2 21c0-4 2-7 6-7 2 0 3 .6 4 1.6M22 21c0-4-2-7-6-7-2 0-3 .6-4 1.6"/>',
 repair:'<path d="M14 6a5 5 0 0 0-6 6L3 17l4 4 5-5a5 5 0 0 0 6-6l-3 3-4-4z"/>',
 ghost:'<path d="M5 21V10a7 7 0 0 1 14 0v11l-3-2-2 2-2-2-2 2-2-2z"/><path d="M9 10h.01M15 10h.01"/>'
 };
 return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]||paths.star}</svg>`;
}
function vrow(label,value,detail,icoName){return `<div class="vrow"><span class="ico">${icon(icoName)}</span><div><span class="vlabel">${esc(label)}</span><small>${esc(detail||"")}</small></div><strong>${esc(value)}</strong></div>`}
function t1row(label,name,stat){return `<div class="t1mini"><div class="t1copy"><b class="t1label">${esc(label)}</b><strong class="t1name">${esc(name)}</strong><small class="t1stat">${esc(stat)}</small></div></div>`}
function mentionRow(label,value,detail){return `<div class="mention-row"><div class="mention-copy"><b class="mention-label">${esc(label)}</b><small class="mention-detail">${esc(detail)}</small></div><strong class="mention-value">${esc(value)}</strong></div>`}


/* ===== CREWTEST : import JSON local ===== */
function crewtestNormalizeMap(map){
  const s=String(map||"").trim();
  if(/^skeld$/i.test(s))return "The Skeld";
  if(/^fungle$/i.test(s))return "The Fungle";
  if(/^mira(\s*hq)?$/i.test(s))return "MIRA HQ";
  return s||"Inconnue";
}
function crewtestBaseName(raw,data){
  const value=String(raw||"").trim();
  const players=Array.isArray(data&&data.Players)?data.Players:[];
  const exact=players.find(function(p){return value===String(p.Name||"")});
  if(exact)return exact.Name;
  const withColor=players.find(function(p){return value.startsWith(String(p.Name||"")+" (")});
  if(withColor)return withColor.Name;
  return value.replace(/\s+\([^)]*\)\s*$/,"");
}
function crewtestRole(role){
  return /impost/i.test(String(role||""))?"Imposteur":"Crew";
}
function crewtestWinnerInfo(reason){
  const s=String(reason||"");
  const winner=/Crewmates/i.test(s)?"Crewmates":(/Impostors/i.test(s)?"Imposteurs":"");
  let method="";
  if(/task/i.test(s))method="Quêtes";
  else if(/sabotage/i.test(s))method="Sabotage";
  else if(/kill/i.test(s))method="Kills";
  else if(/vot/i.test(s))method="Votes";
  return {winner:winner,method:method};
}
function crewtestSabotageName(event){
  const s=(String((event&&event.Detail)||"")+" "+String((event&&event.System)||"")).toLowerCase();
  if(s.includes("reactor")||s.includes("laboratory"))return "Réacteur";
  if(s.includes("light")||s.includes("electrical"))return "Lumières";
  if(s.includes("oxygen")||s.includes("lifesupp"))return "Oxygène";
  if(s.includes("comm"))return "Radio";
  if(s.includes("heli")||s.includes("seismic"))return "Sismiques";
  if(s.includes("mushroom"))return "Champignon";
  if(s.includes("door"))return "Portes";
  return "";
}
function crewtestTs(value){
  const n=Date.parse(String(value||""));
  return Number.isFinite(n)?n:null;
}
function crewtestSessionId(data){
  const s=String((data&&data.StartedAt)||"");
  const m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m?m[1]+"-"+m[2]+"-"+m[3]:"";
}
function crewtestPlayerKey(data){
  return (Array.isArray(data&&data.Players)?data.Players:[])
    .map(function(p){return String(p.Name||"").trim().toLowerCase()})
    .filter(Boolean).sort().join("|");
}
function crewtestFingerprint(data){
  if(data&&data.GameFingerprint)return String(data.GameFingerprint);
  return [String((data&&data.StartedAt)||""),crewtestNormalizeMap(data&&data.Map),crewtestPlayerKey(data)].join("||");
}
function crewtestCoreSignature(data){
  const events=Array.isArray(data&&data.Events)?data.Events:[];
  const meetings=Array.isArray(data&&data.Meetings)?data.Meetings:[];
  const players=(Array.isArray(data&&data.Players)?data.Players:[]).map(function(p){
    return String(p.Name||"").trim().toLowerCase()+":"+crewtestRole(p.Role);
  }).sort();
  const kills=events.filter(function(e){return e.Type==="kill"}).map(function(e){
    return crewtestBaseName(e.Player,data).toLowerCase()+">"+crewtestBaseName(e.Target,data).toLowerCase();
  });
  const meetingSig=meetings.slice().sort(function(a,b){return Number(a.Number||0)-Number(b.Number||0)}).map(function(m){
    const votes=(Array.isArray(m.Votes)?m.Votes:[]).map(function(v){
      return crewtestBaseName(v.Voter,data).toLowerCase()+">"+crewtestBaseName(v.Target,data).toLowerCase()+":"+String(v.Type||"");
    }).sort();
    return [
      crewtestBaseName(m.Reporter,data).toLowerCase(),
      crewtestBaseName(m.ReportedBody,data).toLowerCase(),
      m.Emergency===true?"emergency":"report",
      crewtestBaseName(String(m.ExileResult||"").split(" was ")[0],data).toLowerCase(),
      votes.join(",")
    ].join("|");
  });
  return JSON.stringify({
    map:crewtestNormalizeMap(data&&data.Map),
    players:players,
    winner:String((data&&data.WinnerReason)||"").toLowerCase(),
    kills:kills,
    meetings:meetingSig
  });
}
function crewtestEventInfoKey(e,data){
  return [
    String(e&&e.Type||""),
    crewtestBaseName(e&&e.Player,data).toLowerCase(),
    crewtestBaseName(e&&e.Target,data).toLowerCase(),
    String(e&&e.System||""),
    e&&e.Amount!==null&&e&&e.Amount!==undefined?String(e.Amount):"",
    String(e&&e.Detail||"").replace(/\s+/g," ").trim(),
    String(e&&e.Location||"").trim()
  ].join("|");
}
function crewtestFindDuplicate(data){
  const fp=crewtestFingerprint(data);
  const all=Object.values(TEST_IMPORTS).filter(Boolean);
  const exact=TEST_IMPORTS[fp]||all.find(function(x){
    return x.fingerprint===fp||(Array.isArray(x.fingerprints)&&x.fingerprints.includes(fp));
  });
  if(exact)return {kind:"exact",info:exact};

  const start=crewtestTs(data&&data.StartedAt);
  const finish=crewtestTs(data&&data.FinishedAt);
  const core=crewtestCoreSignature(data);
  const same=all.find(function(x){
    const raw=x.raw||{};
    const otherStart=crewtestTs(x.startedAt||raw.StartedAt);
    const otherFinish=crewtestTs(raw.FinishedAt);
    const closeStart=start!==null&&otherStart!==null&&Math.abs(start-otherStart)<=20000;
    const closeFinish=finish===null||otherFinish===null||Math.abs(finish-otherFinish)<=20000;
    return closeStart&&closeFinish&&crewtestCoreSignature(raw)===core;
  });
  return same?{kind:"same_game",info:same}:null;
}
function crewtestCompareInformation(existingRaw,incomingRaw){
  const oldEvents=Array.isArray(existingRaw&&existingRaw.Events)?existingRaw.Events:[];
  const newEvents=Array.isArray(incomingRaw&&incomingRaw.Events)?incomingRaw.Events:[];
  const oldKeys=new Set(oldEvents.map(function(e){return crewtestEventInfoKey(e,existingRaw)}));
  const extras=newEvents.filter(function(e){return !oldKeys.has(crewtestEventInfoKey(e,incomingRaw))});
  const extraSystems=extras.filter(function(e){return e.Type==="system_update"&&e.Player});
  const oldVotes=(Array.isArray(existingRaw&&existingRaw.Meetings)?existingRaw.Meetings:[]).reduce(function(n,m){return n+(Array.isArray(m.Votes)?m.Votes.length:0)},0);
  const newVotes=(Array.isArray(incomingRaw&&incomingRaw.Meetings)?incomingRaw.Meetings:[]).reduce(function(n,m){return n+(Array.isArray(m.Votes)?m.Votes.length:0)},0);
  const oldTaskInfo=(Array.isArray(existingRaw&&existingRaw.Players)?existingRaw.Players:[]).reduce(function(n,p){return n+Number(p.TasksCompleted||0)+Number(p.TasksTotal||0)},0);
  const newTaskInfo=(Array.isArray(incomingRaw&&incomingRaw.Players)?incomingRaw.Players:[]).reduce(function(n,p){return n+Number(p.TasksCompleted||0)+Number(p.TasksTotal||0)},0);
  const details=[];
  if(extraSystems.length)details.push(extraSystems.length+" trace(s) système supplémentaire(s)");
  const otherExtras=extras.length-extraSystems.length;
  if(otherExtras>0)details.push(otherExtras+" autre(s) événement(s) supplémentaire(s)");
  if(newVotes>oldVotes)details.push((newVotes-oldVotes)+" vote(s) supplémentaire(s)");
  if(newTaskInfo>oldTaskInfo)details.push("informations de tâches plus complètes");
  return {
    richer:extras.length>0||newVotes>oldVotes||newTaskInfo>oldTaskInfo,
    details:details,
    extraEvents:extras.length
  };
}
function crewtestMergeRaw(existingRaw,incomingRaw){
  const merged=Object.assign({},existingRaw||{},incomingRaw||{});
  const aStart=crewtestTs(existingRaw&&existingRaw.StartedAt),bStart=crewtestTs(incomingRaw&&incomingRaw.StartedAt);
  const aEnd=crewtestTs(existingRaw&&existingRaw.FinishedAt),bEnd=crewtestTs(incomingRaw&&incomingRaw.FinishedAt);
  if(aStart!==null&&bStart!==null)merged.StartedAt=aStart<=bStart?existingRaw.StartedAt:incomingRaw.StartedAt;
  if(aEnd!==null&&bEnd!==null)merged.FinishedAt=aEnd>=bEnd?existingRaw.FinishedAt:incomingRaw.FinishedAt;
  merged.DurationSeconds=Math.max(Number(existingRaw&&existingRaw.DurationSeconds||0),Number(incomingRaw&&incomingRaw.DurationSeconds||0));

  const playerMap=new Map();
  [existingRaw,incomingRaw].forEach(function(src){
    (Array.isArray(src&&src.Players)?src.Players:[]).forEach(function(p){
      const key=String(p.Name||"").trim().toLowerCase();
      if(!key)return;
      const old=playerMap.get(key)||{};
      playerMap.set(key,Object.assign({},old,p,{
        Dead:old.Dead===true||p.Dead===true,
        Disconnected:old.Disconnected===true||p.Disconnected===true,
        TasksCompleted:Math.max(Number(old.TasksCompleted||0),Number(p.TasksCompleted||0)),
        TasksTotal:Math.max(Number(old.TasksTotal||0),Number(p.TasksTotal||0))
      }));
    });
  });
  merged.Players=Array.from(playerMap.values());

  const eventMap=new Map();
  [existingRaw,incomingRaw].forEach(function(src){
    (Array.isArray(src&&src.Events)?src.Events:[]).forEach(function(e){
      const key=crewtestEventInfoKey(e,src);
      const old=eventMap.get(key);
      if(!old){eventMap.set(key,e);return}
      const ot=crewtestTs(old.Timestamp),nt=crewtestTs(e.Timestamp);
      if(nt!==null&&(ot===null||nt<ot))eventMap.set(key,e);
    });
  });
  merged.Events=Array.from(eventMap.values()).sort(function(a,b){return (crewtestTs(a.Timestamp)||0)-(crewtestTs(b.Timestamp)||0)});

  const meetingMap=new Map();
  [existingRaw,incomingRaw].forEach(function(src){
    (Array.isArray(src&&src.Meetings)?src.Meetings:[]).forEach(function(m){
      const key=String(m.Number||1);
      const old=meetingMap.get(key)||{};
      const voteMap=new Map();
      (Array.isArray(old.Votes)?old.Votes:[]).concat(Array.isArray(m.Votes)?m.Votes:[]).forEach(function(v){
        const vk=[crewtestBaseName(v.Voter,src).toLowerCase(),crewtestBaseName(v.Target,src).toLowerCase(),String(v.Type||"")].join("|");
        voteMap.set(vk,v);
      });
      meetingMap.set(key,Object.assign({},old,m,{Votes:Array.from(voteMap.values())}));
    });
  });
  merged.Meetings=Array.from(meetingMap.values()).sort(function(a,b){return Number(a.Number||0)-Number(b.Number||0)});
  return merged;
}
function crewtestRepairCounts(data){
  const events=(Array.isArray(data&&data.Events)?data.Events:[])
    .map(function(e){return Object.assign({},e,{_ts:crewtestTs(e.Timestamp)})})
    .filter(function(e){return e._ts!==null})
    .sort(function(a,b){return a._ts-b._ts});
  const meetings=(Array.isArray(data&&data.Meetings)?data.Meetings:[])
    .map(function(m){return crewtestTs(m.StartedAt)})
    .filter(function(x){return x!==null})
    .sort(function(a,b){return a-b});
  const counts=new Map();

  function systemsFor(sab){
    if(sab==="Réacteur")return new Set(["Reactor","Laboratory"]);
    if(sab==="Lumières")return new Set(["Electrical"]);
    if(sab==="Oxygène")return new Set(["LifeSupp"]);
    if(sab==="Radio")return new Set(["Comms"]);
    if(sab==="Sismiques")return new Set(["HeliSabotage","Laboratory","Reactor"]);
    if(sab==="Champignon")return new Set(["MushroomMixupSabotage"]);
    if(sab==="Portes")return new Set(["Doors"]);
    return new Set();
  }

  const starts=events.filter(function(e){return e.Type==="sabotage_start"});
  starts.forEach(function(start){
    const sab=crewtestSabotageName(start);
    if(!sab)return;
    const allowed=systemsFor(sab);
    if(!allowed.size)return;

    const endEvent=events.find(function(e){
      return e._ts>start._ts&&e.Type==="sabotage_end";
    });
    const meetingTime=meetings.find(function(t){return t>start._ts});
    let endTs=endEvent?endEvent._ts:Infinity;
    if(meetingTime!==undefined&&meetingTime<endTs)endTs=meetingTime;

    const participants=new Set();
    events.forEach(function(e){
      if(e._ts<start._ts||e._ts>endTs)return;
      if(e.Type!=="system_update"||!e.Player||!allowed.has(String(e.System||"")))return;
      const amount=Number(e.Amount);
      // 128 = déclenchement du sabotage ; 16 = reset/nettoyage au meeting.
      if(amount===128||amount===16)return;
      const name=crewtestBaseName(e.Player,data);
      if(name)participants.add(name);
    });

    participants.forEach(function(name){
      counts.set(name,(counts.get(name)||0)+1);
    });
  });

  return counts;
}

function crewtestVoteStats(data){
  const players=Array.isArray(data&&data.Players)?data.Players:[];
  const meetings=Array.isArray(data&&data.Meetings)?data.Meetings:[];
  const roleByName=new Map(players.map(function(p){
    return [String(p.Name||"").trim(),crewtestRole(p.Role)];
  }));
  const stats=new Map();

  function get(name){
    if(!stats.has(name))stats.set(name,{
      cast:0,playerVotes:0,onImpostor:0,onCrew:0,skips:0,noVote:0,selfVotes:0,
      crewPlayerVotes:0,crewCorrect:0,crewWrong:0
    });
    return stats.get(name);
  }

  meetings.forEach(function(m){
    (Array.isArray(m&&m.Votes)?m.Votes:[]).forEach(function(v){
      const voter=crewtestBaseName(v.Voter,data);
      if(!voter)return;
      const s=get(voter);
      const type=String(v.Type||"").toLowerCase();
      s.cast++;

      if(type==="skip"){s.skips++;return}
      if(type==="no_vote"||type==="novote"){s.noVote++;return}
      if(type!=="player")return;

      s.playerVotes++;
      const target=crewtestBaseName(v.Target,data);
      if(target&&target===voter)s.selfVotes++;

      const targetRole=roleByName.get(target);
      if(targetRole==="Imposteur")s.onImpostor++;
      else if(targetRole==="Crew")s.onCrew++;

      if(roleByName.get(voter)==="Crew"){
        s.crewPlayerVotes++;
        if(targetRole==="Imposteur")s.crewCorrect++;
        else if(targetRole==="Crew")s.crewWrong++;
      }
    });
  });

  return stats;
}

function crewtestDeriveGame(data){
  const events=Array.isArray(data&&data.Events)?data.Events:[];
  const meetings=Array.isArray(data&&data.Meetings)?data.Meetings:[];
  const rawPlayers=Array.isArray(data&&data.Players)?data.Players:[];
  const nameOf=function(v){return crewtestBaseName(v,data)};
  const killEvents=events.filter(function(e){return e.Type==="kill"}).map(function(e){
    return Object.assign({},e,{killer:nameOf(e.Player),victim:nameOf(e.Target),ts:crewtestTs(e.Timestamp)});
  }).sort(function(a,b){return (a.ts||0)-(b.ts||0)});
  const deathOrder=new Map();
  killEvents.forEach(function(e,i){if(e.victim&&!deathOrder.has(e.victim))deathOrder.set(e.victim,i+1)});
  const meetingTimes=meetings.map(function(m){return crewtestTs(m.StartedAt)}).filter(function(x){return x!==null}).sort(function(a,b){return a-b});
  const killByVictim=new Map(killEvents.map(function(e){return [e.victim,e]}));
  const exiled=new Set();
  meetings.forEach(function(m){
    const value=String(m.ExileResult||"").toLowerCase();
    rawPlayers.forEach(function(p){const name=String(p.Name||"");if(name&&value.startsWith(name.toLowerCase()+" "))exiled.add(name)});
  });
  events.filter(function(e){return e.Type==="exile_result"}).forEach(function(e){
    const value=String(e.Detail||"").toLowerCase();
    rawPlayers.forEach(function(p){const name=String(p.Name||"");if(name&&value.startsWith(name.toLowerCase()+" "))exiled.add(name)});
  });
  const reportCounts=new Map(),selfCounts=new Map();
  meetings.forEach(function(m){
    if(m.Emergency||!m.Reporter||!m.ReportedBody)return;
    const reporter=nameOf(m.Reporter),body=nameOf(m.ReportedBody),killed=killByVictim.get(body);
    if(killed&&killed.killer===reporter)selfCounts.set(reporter,(selfCounts.get(reporter)||0)+1);
    else reportCounts.set(reporter,(reportCounts.get(reporter)||0)+1);
  });
  const repairCounts=crewtestRepairCounts(data);
  const voteStats=crewtestVoteStats(data);
  const sabotageByPlayer=new Map();
  events.filter(function(e){return e.Type==="sabotage_start"}).forEach(function(start){
    const sab=crewtestSabotageName(start);if(!sab)return;
    let actor=nameOf(start.Player);
    if(!actor){
      const t=crewtestTs(start.Timestamp);
      const nearby=events.filter(function(e){
        if(e.Type!=="system_update"||!e.Player||Number(e.Amount)!==128)return false;
        const et=crewtestTs(e.Timestamp);
        return t!==null&&et!==null&&Math.abs(t-et)<=8000;
      }).sort(function(a,b){return Math.abs((crewtestTs(a.Timestamp)||0)-t)-Math.abs((crewtestTs(b.Timestamp)||0)-t)})[0];
      if(nearby)actor=nameOf(nearby.Player);
    }
    if(!actor){
      const impostors=rawPlayers.filter(function(p){return crewtestRole(p.Role)==="Imposteur"});
      if(impostors.length===1)actor=impostors[0].Name;
    }
    if(actor){if(!sabotageByPlayer.has(actor))sabotageByPlayer.set(actor,[]);sabotageByPlayer.get(actor).push(sab)}
  });
  const rows=rawPlayers.map(function(p){
    const name=String(p.Name||"").trim(),role=crewtestRole(p.Role);
    const kills=killEvents.filter(function(e){return e.killer===name}).map(function(e){return e.victim}).filter(Boolean);
    const deathEvent=killByVictim.get(name);
    let death="Survit",deathPos=null,turn=null;
    if(deathEvent){
      death="Tué par "+deathEvent.killer;deathPos=deathOrder.get(name)||null;
      turn=1+meetingTimes.filter(function(mt){return deathEvent.ts!==null&&mt<deathEvent.ts}).length;
    }else if(exiled.has(name))death="Éjecté au conseil";
    const sabotages=sabotageByPlayer.get(name)||[];
    const vote=voteStats.get(name)||{cast:0,playerVotes:0,onImpostor:0,onCrew:0,skips:0,noVote:0,selfVotes:0,crewPlayerVotes:0,crewCorrect:0,crewWrong:0};
    return {name:name,role:role,reports:reportCounts.get(name)||0,self:selfCounts.get(name)||0,sabotages:sabotages,repair:repairCounts.get(name)||0,kills:kills,death:death,deathPos:deathPos,turn:turn,tasks:role==="Crew"?Number(p.TasksCompleted||0):null,totalTasks:role==="Crew"?Number(p.TasksTotal||0):null,ejected:exiled.has(name),voteCast:vote.cast,votePlayer:vote.playerVotes,voteImpostor:vote.onImpostor,voteCrew:vote.onCrew,voteSkip:vote.skips,voteNoVote:vote.noVote,voteSelf:vote.selfVotes,crewVoteTotal:vote.crewPlayerVotes,crewVoteCorrect:vote.crewCorrect,crewVoteWrong:vote.crewWrong};
  });
  const t1Deaths=killEvents.filter(function(e){return e.ts!==null&&!meetingTimes.some(function(mt){return mt<e.ts})}).length;
  return {rows:rows,t1Deaths:t1Deaths,win:crewtestWinnerInfo(data.WinnerReason),map:crewtestNormalizeMap(data.Map)};
}
function crewtestMergeIntoGame(preview){
  const match=preview.match&&preview.match.info;if(!match)throw new Error("Game existante introuvable.");
  const merged=crewtestMergeRaw(match.raw||{},preview.data);
  const derived=crewtestDeriveGame(merged);
  const game=GAMES.find(function(g){return g.session===match.sessionId&&Number(g.n)===Number(match.gameNumber)});
  if(!game)throw new Error("La game existante n\u0027est plus présente dans CREWTEST.");
  game.map=derived.map;game.winner=derived.win.winner||game.winner;game.method=derived.win.method||game.method;game.t1Deaths=derived.t1Deaths;game.startedAt=merged.StartedAt||game.startedAt;
  derived.rows.forEach(function(row){
    const r=RECORDS.find(function(x){return x.gameId===game.id&&x.p===row.name});
    if(!r)return;
    r.role=row.role;
    r.reports=Math.max(Number(r.reports||0),row.reports);
    r.self=Math.max(Number(r.self||0),row.self);
    r.repair=Math.max(Number(r.repair||0),Number(row.repair||0));
    if(row.sabotages.length>=Number(r.sab||0)){r.sabotages=row.sabotages.slice();r.sab=row.sabotages.length}
    if(row.kills.length>=(Array.isArray(r.kills)?r.kills.length:0))r.kills=row.kills.slice();
    if(r.death==="Survit"&&row.death!=="Survit")r.death=row.death;
    if(r.deathPos===null&&row.deathPos!==null)r.deathPos=row.deathPos;
    if(r.turn===null&&row.turn!==null)r.turn=row.turn;
    if(row.tasks!==null)r.tasks=Math.max(Number(r.tasks||0),row.tasks);
    if(row.totalTasks!==null)r.totalTasks=Math.max(Number(r.totalTasks||0),row.totalTasks);
    r.ejected=r.ejected===true||row.ejected===true;
    r.voteCast=Math.max(Number(r.voteCast||0),Number(row.voteCast||0));
    r.votePlayer=Math.max(Number(r.votePlayer||0),Number(row.votePlayer||0));
    r.voteImpostor=Math.max(Number(r.voteImpostor||0),Number(row.voteImpostor||0));
    r.voteCrew=Math.max(Number(r.voteCrew||0),Number(row.voteCrew||0));
    r.voteSkip=Math.max(Number(r.voteSkip||0),Number(row.voteSkip||0));
    r.voteNoVote=Math.max(Number(r.voteNoVote||0),Number(row.voteNoVote||0));
    r.voteSelf=Math.max(Number(r.voteSelf||0),Number(row.voteSelf||0));
    r.crewVoteTotal=Math.max(Number(r.crewVoteTotal||0),Number(row.crewVoteTotal||0));
    r.crewVoteCorrect=Math.max(Number(r.crewVoteCorrect||0),Number(row.crewVoteCorrect||0));
    r.crewVoteWrong=Math.max(Number(r.crewVoteWrong||0),Number(row.crewVoteWrong||0));
  });
  match.raw=merged;
  match.startedAt=merged.StartedAt||match.startedAt;
  match.map=derived.map;
  match.playerKey=crewtestPlayerKey(merged);
  match.loggerVersion=merged.LoggerVersion||match.loggerVersion;
  match.fingerprints=Array.from(new Set((match.fingerprints||[match.fingerprint]).concat([preview.fingerprint])));
  match.sources=Array.from(new Set((match.sources||[]).concat(preview.sourceName?[preview.sourceName]:[])));
  crewtestRenumberSession(match.sessionId);
  crewtestSaveState();
  currentScope=SESSIONS[match.sessionId].month;currentPlayerMonth=currentScope;currentPlayerMode="month";
  crewtestRefreshAll(match.sessionId);
  return {sessionId:match.sessionId,gameNumber:match.gameNumber};
}
function crewtestRecalculateImportedRepairs(){
  let changed=false;
  Object.values(TEST_IMPORTS).filter(Boolean).forEach(function(info){
    if(!info.raw)return;
    const derived=crewtestDeriveGame(info.raw);
    const game=GAMES.find(function(g){
      return g.session===info.sessionId&&Number(g.n)===Number(info.gameNumber);
    });
    if(!game)return;
    derived.rows.forEach(function(row){
      const r=RECORDS.find(function(x){return x.gameId===game.id&&x.p===row.name});
      if(!r)return;
      const next=Math.max(Number(r.repair||0),Number(row.repair||0));
      if(next!==Number(r.repair||0)){r.repair=next;changed=true}
    });
  });
  if(changed)crewtestSaveState();
}

function crewtestInfoForGame(game){
  if(!game)return null;
  const all=Object.values(TEST_IMPORTS).filter(Boolean);
  const byFingerprint=all.find(function(info){
    return info.fingerprint===game.fingerprint||
      (Array.isArray(info.fingerprints)&&info.fingerprints.includes(game.fingerprint));
  });
  if(byFingerprint)return byFingerprint;
  return all.find(function(info){
    return info.sessionId===game.session&&Number(info.gameNumber)===Number(game.n);
  })||null;
}
function crewtestGameStartedAt(game){
  const direct=crewtestTs(game&&game.startedAt);
  if(direct!==null)return direct;
  const info=crewtestInfoForGame(game);
  return crewtestTs((info&&info.startedAt)||(info&&info.raw&&info.raw.StartedAt));
}
function crewtestRenumberSession(sessionId){
  const games=GAMES.filter(function(g){return g.session===sessionId});
  if(!games.length)return [];

  const oldNumbers=new Map(games.map(function(g){return [g.id,Number(g.n)||0]}));
  games.sort(function(a,b){
    const ta=crewtestGameStartedAt(a),tb=crewtestGameStartedAt(b);
    if(ta===null&&tb===null)return (oldNumbers.get(a.id)||0)-(oldNumbers.get(b.id)||0);
    if(ta===null)return 1;
    if(tb===null)return -1;
    if(ta!==tb)return ta-tb;
    return (oldNumbers.get(a.id)||0)-(oldNumbers.get(b.id)||0);
  });

  const changes=[];
  games.forEach(function(game,index){
    const next=index+1,old=oldNumbers.get(game.id)||Number(game.n)||0;
    game.n=next;
    RECORDS.filter(function(r){return r.gameId===game.id}).forEach(function(r){r.g=next});
    const info=crewtestInfoForGame(game);
    if(info)info.gameNumber=next;
    if(old!==next)changes.push({gameId:game.id,from:old,to:next});
  });
  return changes;
}
function crewtestRenumberAll(){
  const sessions=[...new Set(GAMES.map(function(g){return g.session}).filter(Boolean))];
  const changes=[];
  sessions.forEach(function(id){changes.push.apply(changes,crewtestRenumberSession(id))});
  return changes;
}
function crewtestProposedGameNumber(sessionId,data){
  const incoming=crewtestTs(data&&data.StartedAt);
  const games=GAMES.filter(function(g){return g.session===sessionId});
  if(incoming===null)return games.length+1;
  const before=games.filter(function(g){
    const t=crewtestGameStartedAt(g);
    return t!==null&&t<incoming;
  }).length;
  return before+1;
}

function crewtestRecalculateImportedVotes(){
  let changed=false;
  Object.values(TEST_IMPORTS).filter(Boolean).forEach(function(info){
    if(!info.raw)return;
    const derived=crewtestDeriveGame(info.raw);
    const game=GAMES.find(function(g){
      return g.session===info.sessionId&&Number(g.n)===Number(info.gameNumber);
    });
    if(!game)return;
    derived.rows.forEach(function(row){
      const r=RECORDS.find(function(x){return x.gameId===game.id&&x.p===row.name});
      if(!r)return;
      const fields=["voteCast","votePlayer","voteImpostor","voteCrew","voteSkip","voteNoVote","voteSelf","crewVoteTotal","crewVoteCorrect","crewVoteWrong"];
      fields.forEach(function(field){
        const next=Number(row[field]||0);
        if(Number(r[field]||0)!==next){r[field]=next;changed=true}
      });
    });
  });
  if(changed)crewtestSaveState();
}

function crewtestSaveState(){
  if(!TEST_MODE)return;
  localStorage.setItem(CREWTEST_STORAGE_KEY,JSON.stringify({
    sessions:SESSIONS,games:GAMES,records:RECORDS,players:PLAYERS,
    participants:SESSION_PARTICIPANTS,imports:TEST_IMPORTS
  }));
}
function crewtestLoadState(){
  if(!TEST_MODE)return;
  try{
    const raw=localStorage.getItem(CREWTEST_STORAGE_KEY);
    if(!raw)return;
    const state=JSON.parse(raw);
    SESSIONS=state.sessions&&typeof state.sessions==="object"?state.sessions:{};
    GAMES=Array.isArray(state.games)?state.games:[];
    RECORDS=Array.isArray(state.records)?state.records:[];
    PLAYERS=Array.isArray(state.players)?state.players:[];
    SESSION_PARTICIPANTS=state.participants&&typeof state.participants==="object"?state.participants:{};
    TEST_IMPORTS=state.imports&&typeof state.imports==="object"?state.imports:{};
    DEFAULT_SESSION_PARTICIPANTS=Object.fromEntries(Object.keys(SESSIONS).map(function(id){return [id,[]]}));
  }catch(error){
    console.error("CREWTEST : impossible de relire les données locales.",error);
  }
}
function crewtestRefreshAll(sessionId){
  refreshSessionSelectors();
  if(sessionId){
    currentScope=(SESSIONS[sessionId]&&SESSIONS[sessionId].month)||currentScope;
    const period=document.getElementById("period-select");
    if(period&&Array.from(period.options).some(function(o){return o.value===currentScope}))period.value=currentScope;
    const sm=document.getElementById("session-month");
    if(sm&&Array.from(sm.options).some(function(o){return o.value===currentScope}))sm.value=currentScope;
    currentPlayerMonth=currentScope;
  }
  populateGameSelect();
  syncEntryPlayerOptions();
  refreshEventPlayerOptions();
  renderAll();
  renderAdminAccess();
  if(adminCanWrite())renderAdmin();
}
function crewtestBuildPreview(data,sourceName){
  if(!data||typeof data!=="object")throw new Error("Le fichier ne contient pas un objet JSON valide.");
  if(!data.StartedAt)throw new Error("StartedAt est absent du JSON.");
  if(!Array.isArray(data.Players)||!data.Players.length)throw new Error("Aucun joueur trouvé dans Players.");
  const sessionId=crewtestSessionId(data);
  if(!sessionId)throw new Error("La date StartedAt n\u0027est pas reconnue.");
  const match=crewtestFindDuplicate(data);
  const nextGame=match&&match.info?Number(match.info.gameNumber):crewtestProposedGameNumber(sessionId,data);
  const win=crewtestWinnerInfo(data.WinnerReason);
  const warnings=[];
  let comparison=null;
  if(!win.winner)warnings.push("Camp gagnant non reconnu.");
  if(!win.method)warnings.push("Méthode de victoire non reconnue.");
  if((data.Events||[]).some(function(e){return e.Type==="sabotage_end"}))warnings.push("Les anciennes V2/V2.1 ne permettent pas encore d\u0027attribuer fiablement tous les réparateurs.");
  if(!match&&GAMES.some(function(g){return g.session===sessionId&&Number(g.n)>=nextGame})){
    warnings.push("Import chronologique : les games suivantes seront renumérotées automatiquement.");
  }
  if(match&&match.kind==="exact")warnings.push("Cette source a déjà été importée pour la Game "+match.info.gameNumber+".");
  if(match&&match.kind==="same_game"){
    comparison=crewtestCompareInformation(match.info.raw||{},data);
    if(comparison.richer)warnings.push("Même game détectée : nouvelles informations disponibles pour compléter la Game "+match.info.gameNumber+".");
    else warnings.push("Même game détectée, mais aucune information nouvelle utile.");
  }
  return {
    data:data,sourceName:sourceName||"",sessionId:sessionId,nextGame:nextGame,match:match,comparison:comparison,warnings:warnings,
    fingerprint:crewtestFingerprint(data),map:crewtestNormalizeMap(data.Map),playerKey:crewtestPlayerKey(data),win:win
  };
}
function crewtestFormatDateTime(value){
  const ts=crewtestTs(value);
  if(ts===null)return "—";
  return new Intl.DateTimeFormat("fr-FR",{
    day:"2-digit",month:"2-digit",year:"numeric",
    hour:"2-digit",minute:"2-digit",second:"2-digit"
  }).format(new Date(ts));
}

function crewtestRenderPreview(preview){
  const box=document.getElementById("json-import-preview");
  const warn=document.getElementById("json-import-warnings");
  const confirmButton=document.getElementById("json-import-confirm");
  if(!box||!warn||!confirmButton)return;
  const players=preview.data.Players.map(function(p){return esc(p.Name)+" ("+crewtestRole(p.Role)+")"}).join(", ");
  const matched=preview.match&&preview.match.info;
  const shownGame=matched?matched.gameNumber:preview.nextGame;
  const meta=SESSIONS[preview.sessionId]?SESSIONS[preview.sessionId].label+" — existante":sessionMetaFromId(preview.sessionId).label+" — sera créée";
  const rows=[
    ["Soirée",meta],
    ["Game",shownGame+" (ordre chronologique)"],
    ["Début",crewtestFormatDateTime(preview.data.StartedAt)],
    ["Fin",crewtestFormatDateTime(preview.data.FinishedAt)],
    ["Map",preview.map],
    ["Joueurs",players],
    ["Vainqueur",preview.win.winner||"À vérifier"],
    ["Méthode",preview.win.method||"À vérifier"],
    ["Logger",preview.data.LoggerVersion||"inconnue"],
    ["Source",preview.sourceName||"fichier local"]
  ];
  if(matched&&Array.isArray(matched.sources)&&matched.sources.length)rows.push(["Sources déjà fusionnées",matched.sources.join(", ")]);
  box.hidden=false;
  box.innerHTML=rows.map(function(row){return '<div class="card"><span>'+esc(row[0])+'</span><strong>'+row[1]+'</strong></div>'}).join("");
  let extra=preview.warnings.slice();
  if(preview.comparison&&preview.comparison.richer&&preview.comparison.details.length)extra=extra.concat(preview.comparison.details.map(function(x){return "+ "+x}));
  warn.innerHTML=extra.length?extra.map(function(w){return "<div>⚠ "+esc(w)+"</div>"}).join(""):"Aucune anomalie évidente détectée.";
  if(preview.match&&preview.match.kind==="exact"){confirmButton.disabled=true;confirmButton.textContent="Game déjà importée";}
  else if(preview.match&&preview.match.kind==="same_game"){
    confirmButton.disabled=!(preview.comparison&&preview.comparison.richer);
    confirmButton.textContent=preview.comparison&&preview.comparison.richer?"Compléter la Game "+preview.match.info.gameNumber:"Aucune info nouvelle";
  }else{confirmButton.disabled=false;confirmButton.textContent="Importer cette game"}
}
function crewtestImportData(preview){
  const data=preview.data;
  const sessionId=preview.sessionId;
  const gameNumber=preview.nextGame;
  const events=Array.isArray(data.Events)?data.Events:[];
  const meetings=Array.isArray(data.Meetings)?data.Meetings:[];
  const rawPlayers=data.Players;
  const nameOf=function(v){return crewtestBaseName(v,data)};

  if(!SESSIONS[sessionId])SESSIONS[sessionId]=sessionMetaFromId(sessionId);

  rawPlayers.forEach(function(p,i){
    const name=String(p.Name||"").trim();
    if(!name)return;
    if(!PLAYERS.some(function(x){return x.name===name})){
      PLAYERS.push({id:"test-"+sessionId+"-"+i+"-"+name,name:name,handle:name,active:true,source:"json"});
    }
  });
  const participantSet=new Set((SESSION_PARTICIPANTS[sessionId]||[]).concat(rawPlayers.map(function(p){return String(p.Name||"").trim()}).filter(Boolean)));
  SESSION_PARTICIPANTS[sessionId]=Array.from(participantSet);

  const killEvents=events.filter(function(e){return e.Type==="kill"}).map(function(e){
    return Object.assign({},e,{killer:nameOf(e.Player),victim:nameOf(e.Target),ts:crewtestTs(e.Timestamp)});
  }).sort(function(a,b){return (a.ts||0)-(b.ts||0)});
  const deathOrder=new Map();
  killEvents.forEach(function(e,i){if(e.victim&&!deathOrder.has(e.victim))deathOrder.set(e.victim,i+1)});
  const meetingTimes=meetings.map(function(m){return crewtestTs(m.StartedAt)}).filter(function(x){return x!==null}).sort(function(a,b){return a-b});
  const killByVictim=new Map(killEvents.map(function(e){return [e.victim,e]}));

  const exiled=new Set();
  meetings.forEach(function(m){
    const value=String(m.ExileResult||"").toLowerCase();
    rawPlayers.forEach(function(p){
      const name=String(p.Name||"");
      if(name&&value.startsWith(name.toLowerCase()+" "))exiled.add(name);
    });
  });
  events.filter(function(e){return e.Type==="exile_result"}).forEach(function(e){
    const value=String(e.Detail||"").toLowerCase();
    rawPlayers.forEach(function(p){
      const name=String(p.Name||"");
      if(name&&value.startsWith(name.toLowerCase()+" "))exiled.add(name);
    });
  });

  const reportCounts=new Map(),selfCounts=new Map();
  meetings.forEach(function(m){
    if(m.Emergency||!m.Reporter||!m.ReportedBody)return;
    const reporter=nameOf(m.Reporter),body=nameOf(m.ReportedBody);
    const killed=killByVictim.get(body);
    if(killed&&killed.killer===reporter)selfCounts.set(reporter,(selfCounts.get(reporter)||0)+1);
    else reportCounts.set(reporter,(reportCounts.get(reporter)||0)+1);
  });

  const repairCounts=crewtestRepairCounts(data);
  const voteStats=crewtestVoteStats(data);
  const sabotageByPlayer=new Map();
  events.filter(function(e){return e.Type==="sabotage_start"}).forEach(function(start){
    const sab=crewtestSabotageName(start);
    if(!sab)return;
    let actor=nameOf(start.Player);
    if(!actor){
      const t=crewtestTs(start.Timestamp);
      const nearby=events.find(function(e){
        if(e.Type!=="system_update"||!e.Player)return false;
        const et=crewtestTs(e.Timestamp);
        return t!==null&&et!==null&&Math.abs(t-et)<=2000&&Number(e.Amount)===128;
      });
      if(nearby)actor=nameOf(nearby.Player);
    }
    if(!actor){
      const impostors=rawPlayers.filter(function(p){return crewtestRole(p.Role)==="Imposteur"});
      if(impostors.length===1)actor=impostors[0].Name;
    }
    if(actor){
      if(!sabotageByPlayer.has(actor))sabotageByPlayer.set(actor,[]);
      sabotageByPlayer.get(actor).push(sab);
    }
  });

  const t1Deaths=killEvents.filter(function(e){
    return e.ts!==null&&!meetingTimes.some(function(mt){return mt<e.ts});
  }).length;
  const gameId="test-game-"+preview.fingerprint;
  GAMES.push({
    id:gameId,session:sessionId,n:gameNumber,map:preview.map,
    winner:preview.win.winner||"Inconnu",method:preview.win.method||"Inconnu",
    t1Deaths:t1Deaths,startedAt:data.StartedAt,fingerprint:preview.fingerprint
  });

  rawPlayers.forEach(function(p,i){
    const name=String(p.Name||"").trim();
    if(!name)return;
    const role=crewtestRole(p.Role);
    const kills=killEvents.filter(function(e){return e.killer===name}).map(function(e){return e.victim}).filter(Boolean);
    const deathEvent=killByVictim.get(name);
    let death="Survit",deathPos=null,turn=null;
    if(deathEvent){
      death="Tué par "+deathEvent.killer;
      deathPos=deathOrder.get(name)||null;
      turn=1+meetingTimes.filter(function(mt){return deathEvent.ts!==null&&mt<deathEvent.ts}).length;
    }else if(exiled.has(name)){
      death="Éjecté au conseil";
    }
    const sabotages=sabotageByPlayer.get(name)||[];
    const vote=voteStats.get(name)||{cast:0,playerVotes:0,onImpostor:0,onCrew:0,skips:0,noVote:0,selfVotes:0,crewPlayerVotes:0,crewCorrect:0,crewWrong:0};
    RECORDS.push({
      id:"test-record-"+preview.fingerprint+"-"+i,gameId:gameId,session:sessionId,p:name,g:gameNumber,role:role,
      reports:reportCounts.get(name)||0,self:selfCounts.get(name)||0,
      sab:sabotages.length,sabotages:sabotages,repair:repairCounts.get(name)||0,
      kills:role==="Imposteur"?kills:[],death:death,deathPos:deathPos,turn:turn,
      tasks:role==="Crew"?Number(p.TasksCompleted||0):null,
      totalTasks:role==="Crew"?Number(p.TasksTotal||0):null,
      ejected:exiled.has(name),
      voteCast:vote.cast,votePlayer:vote.playerVotes,voteImpostor:vote.onImpostor,voteCrew:vote.onCrew,
      voteSkip:vote.skips,voteNoVote:vote.noVote,voteSelf:vote.selfVotes,
      crewVoteTotal:vote.crewPlayerVotes,crewVoteCorrect:vote.crewCorrect,crewVoteWrong:vote.crewWrong,
      note:"Import JSON "+String(data.LoggerVersion||"")
    });
  });

  TEST_IMPORTS[preview.fingerprint]={
    fingerprint:preview.fingerprint,fingerprints:[preview.fingerprint],
    sessionId:sessionId,gameNumber:gameNumber,
    startedAt:data.StartedAt,map:preview.map,playerKey:preview.playerKey,
    loggerVersion:data.LoggerVersion||"",sources:preview.sourceName?[preview.sourceName]:[],raw:data
  };
  crewtestRenumberSession(sessionId);
  crewtestSaveState();

  currentScope=SESSIONS[sessionId].month;
  currentPlayer=String((rawPlayers[0]&&rawPlayers[0].Name)||currentPlayer);
  currentPlayerMonth=currentScope;
  currentPlayerMode="month";
  crewtestRefreshAll(sessionId);
  const importedGame=GAMES.find(function(g){return g.id===gameId});
  return {sessionId:sessionId,gameNumber:importedGame?importedGame.n:gameNumber};
}
function crewtestExportState(){
  const payload={
    format:"crewtest-local-state",
    version:1,
    exportedAt:new Date().toISOString(),
    sessions:SESSIONS,
    games:GAMES,
    records:RECORDS,
    players:PLAYERS,
    participants:SESSION_PARTICIPANTS,
    imports:TEST_IMPORTS
  };
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  const stamp=new Date().toISOString().replace(/[:.]/g,"-");
  a.href=url;
  a.download="crewtest-export-"+stamp+".json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function(){URL.revokeObjectURL(url)},1000);
}

function crewtestReset(){
  localStorage.removeItem(CREWTEST_STORAGE_KEY);
  SESSIONS={};GAMES=[];RECORDS=[];PLAYERS=[];SESSION_PARTICIPANTS={};TEST_IMPORTS={};
  DEFAULT_SESSION_PARTICIPANTS={};
  pendingJsonImport=null;
  const file=document.getElementById("json-import-file");if(file)file.value="";
  const preview=document.getElementById("json-import-preview");if(preview){preview.hidden=true;preview.innerHTML=""}
  const warnings=document.getElementById("json-import-warnings");if(warnings)warnings.textContent="";
  const confirmButton=document.getElementById("json-import-confirm");if(confirmButton)confirmButton.disabled=true;
  crewtestRefreshAll();
}
function crewtestInitImporter(){
  const file=document.getElementById("json-import-file");
  const confirmButton=document.getElementById("json-import-confirm");
  const exportButton=document.getElementById("json-import-export");
  const clear=document.getElementById("json-import-clear");
  const status=document.getElementById("json-import-status");
  if(!file||!confirmButton||!clear)return;
  if(exportButton)exportButton.addEventListener("click",function(){
    crewtestExportState();
    if(status)status.textContent="Export local créé.";
  });
  file.addEventListener("change",async function(){
    pendingJsonImport=null;
    confirmButton.disabled=true;
    if(status)status.textContent="";
    const selected=file.files&&file.files[0];
    if(!selected)return;
    try{
      const data=JSON.parse(await selected.text());
      pendingJsonImport=crewtestBuildPreview(data,selected.name);
      crewtestRenderPreview(pendingJsonImport);
      if(status){
        if(pendingJsonImport.match&&pendingJsonImport.match.kind==="exact")status.textContent="Import bloqué : cette source est déjà connue.";
        else if(pendingJsonImport.match&&pendingJsonImport.match.kind==="same_game"&&pendingJsonImport.comparison&&pendingJsonImport.comparison.richer)status.textContent="Même game détectée : elle peut être complétée.";
        else if(pendingJsonImport.match&&pendingJsonImport.match.kind==="same_game")status.textContent="Même game détectée : aucune information nouvelle.";
        else status.textContent="Prévisualisation prête.";
      }
    }catch(error){
      const box=document.getElementById("json-import-preview");if(box)box.hidden=true;
      const warnings=document.getElementById("json-import-warnings");if(warnings)warnings.textContent="Erreur : "+error.message;
      if(status)status.textContent="Fichier non importable.";
    }
  });
  confirmButton.addEventListener("click",function(){
    if(!pendingJsonImport)return;
    let result=null;
    if(pendingJsonImport.match&&pendingJsonImport.match.kind==="same_game"&&pendingJsonImport.comparison&&pendingJsonImport.comparison.richer){
      result=crewtestMergeIntoGame(pendingJsonImport);
      if(status)status.textContent="Game "+result.gameNumber+" complétée avec les nouvelles informations.";
    }else if(!pendingJsonImport.match){
      result=crewtestImportData(pendingJsonImport);
      if(status)status.textContent="Importé : soirée "+SESSIONS[result.sessionId].label+", Game "+result.gameNumber+".";
    }else return;
    confirmButton.disabled=true;
    confirmButton.textContent="Import terminé";
    pendingJsonImport=null;
  });
  clear.addEventListener("click",function(){
    if(window.confirm("Vider toutes les données locales de CREWTEST ?"))crewtestReset();
  });
}

/* navigation */
document.querySelectorAll(".nav").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll(".nav").forEach(x=>x.classList.remove("active"));b.classList.add("active");document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));document.getElementById("view-"+b.dataset.view).classList.add("active");if(b.dataset.view==="admin"){renderAdminAccess();if(adminCanWrite())renderAdmin()}}));
document.getElementById("period-select").addEventListener("change",e=>{currentScope=e.target.value;renderStats()});
document.getElementById("session-month").addEventListener("change",renderSessions);
document.getElementById("player-month-select").addEventListener("change",e=>{currentPlayerMonth=e.target.value;currentPlayerMode="month";renderPlayerTabs();renderPlayer()});
document.querySelectorAll("#player-detail-tabs [data-player-detail]").forEach(b=>b.addEventListener("click",()=>{
  currentPlayerDetailTab=b.dataset.playerDetail;
  syncPlayerDetailTabs();
}));

/* ===== Rendu des pages ===== */
function renderStats(){
 const games=gamesForScope(currentScope),recs=recordsForScope(currentScope),all=currentScope==="all";
 document.getElementById("scope-kicker").textContent=all?"STATS GLOBALES":"STATS DU MOIS";
 document.getElementById("scope-title").textContent=all?"Toutes périodes":monthLabel(currentScope);
 document.getElementById("scope-subtitle").textContent=all?"Toutes les sessions enregistrées.":"Toutes les sessions enregistrées pendant le mois.";
 const iw=games.filter(g=>g.winner==="Imposteurs"),cw=games.filter(g=>g.winner==="Crewmates");
 document.getElementById("impo-win-count").textContent=iw.length;document.getElementById("impo-win-pct").textContent=pct(iw.length,games.length);
 document.getElementById("crew-win-count").textContent=cw.length;document.getElementById("crew-win-pct").textContent=pct(cw.length,games.length);
 document.getElementById("impo-bar").style.width=(games.length?iw.length/games.length*100:0)+"%";document.getElementById("crew-bar").style.width=(games.length?cw.length/games.length*100:0)+"%";
 const im=["Kills","Votes","Sabotage"].map(m=>[m,iw.filter(g=>g.method===m).length]);
 const cr=[["Quêtes",cw.filter(g=>g.method==="Quêtes").length],["Votes",cw.filter(g=>g.method==="Votes").length]];
 document.getElementById("impo-methods").innerHTML=im.map(([m,n])=>`<b>${m}</b> ${n} (${pct(n,iw.length)})`).join(" • ");
 document.getElementById("crew-methods").innerHTML=`<b>Quêtes</b> ${cr[0][1]} (${pct(cr[0][1],cw.length)}) • <b>Élimination</b> ${cr[1][1]} (${pct(cr[1][1],cw.length)})`;

 const tracked=sortedPlayers().map(p=>{const rr=recs.filter(r=>r.p===p.name),imp=rr.filter(r=>r.role==="Imposteur"),crew=rr.filter(r=>r.role==="Crew"),taskRows=crew.filter(r=>Number.isFinite(r.tasks)&&Number(r.totalTasks||9)>0),taskDone=taskRows.reduce((a,r)=>a+Number(r.tasks||0),0),taskTotal=taskRows.reduce((a,r)=>a+Number(r.totalTasks||9),0);return{name:p.name,rr,imp,crew,impWins:imp.filter(r=>resultFor(r)==="Victoire").length,crewWins:crew.filter(r=>resultFor(r)==="Victoire").length,impEjected:imp.filter(r=>r.ejected).length,crewEjected:crew.filter(r=>r.ejected).length,kills:rr.reduce((a,r)=>a+(r.kills?.length||0),0),maxKills:Math.max(0,...rr.map(r=>r.kills?.length||0)),t1:crew.filter(r=>r.turn===1).length,firstDeath:crew.filter(r=>r.deathPos===1).length,repairs:rr.reduce((a,r)=>a+(Number.isFinite(r.repair)?r.repair:0),0),taskGames:taskRows.length,taskDone,taskTotal,taskRate:taskTotal?taskDone/taskTotal:null}}).filter(x=>x.rr.length);
 if(!tracked.length){document.getElementById("hall").innerHTML="";document.getElementById("shame").innerHTML="";document.getElementById("t1-rows").innerHTML="";document.getElementById("mentions").innerHTML="";document.getElementById("t1-average").textContent="0 Crewmate";return}
 const impP=tracked.filter(x=>x.imp.length),crewP=tracked.filter(x=>x.crew.length),taskEligible=tracked.filter(x=>x.taskGames>=3&&x.taskRate!==null);
 const bestTaskRate=taskEligible.length?Math.max(...taskEligible.map(x=>x.taskRate)):null,worstTaskRate=taskEligible.length?Math.min(...taskEligible.map(x=>x.taskRate)):null,bestTasks=taskEligible.filter(x=>x.taskRate===bestTaskRate),worstTasks=taskEligible.filter(x=>x.taskRate===worstTaskRate);
 const maxIR=impP.length?Math.max(...impP.map(x=>x.impWins/x.imp.length)):0,iaot=impP.length?impP.filter(x=>x.impWins/x.imp.length===maxIR):[],mostIW=impP.length?[...impP].sort((a,b)=>b.impWins-a.impWins)[0]:null;
 const maxCR=crewP.length?Math.max(...crewP.map(x=>x.crewWins/x.crew.length)):0,bestC=crewP.length?crewP.filter(x=>x.crewWins/x.crew.length===maxCR):[],mostIG=[...tracked].sort((a,b)=>b.imp.length-a.imp.length)[0];
 const maxCS=Math.max(...tracked.map(x=>x.crew.length/x.rr.length)),career=tracked.filter(x=>x.crew.length/x.rr.length===maxCS),never=impP.filter(x=>x.impEjected===0);
 document.getElementById("hall").innerHTML=[
 vrow(all?"IAOT — Impo of all time":"Imposteur du mois",iaot.length?iaot.map(x=>x.name).join(", "):"Pas de données",iaot.length?`${pct(maxIR,1)} de victoires Imposteur`:"Aucun Imposteur enregistré","crown"),
 vrow("Boss final",mostIW?mostIW.name:"Pas de données",mostIW?`${mostIW.impWins} victoire${mostIW.impWins>1?"s":""} en Imposteur`:"Aucune victoire Imposteur","star"),
 vrow("Valeur sûre du Crew",bestC.length?bestC.map(x=>x.name).join(", "):"Pas de données",bestC.length?`${pct(maxCR,1)} de victoires Crew`:"Aucun Crew enregistré","medal"),
 vrow("Abonné au côté obscur",mostIG.name,`${pct(mostIG.imp.length,mostIG.rr.length)} en Imposteur`,"users"),
 vrow("Le Crewmate de carrière",career.map(x=>x.name).join(", "),`${pct(maxCS,1)} Crew`,"shield"),
 vrow("Sous les radars",never.map(x=>x.name).join(", "),"0 éjection en Imposteur","infinity"),
 vrow("Employé du mois",bestTasks.length?bestTasks.map(x=>x.name).join(", "):"Pas assez de données",bestTasks.length?bestTasks.map(x=>`${x.taskDone} quêtes`).join(" • "):"Minimum 3 games Crew","bolt")
 ].join("");

 const zero=impP.filter(x=>x.impWins===0),maxE=impP.length?Math.max(...impP.map(x=>x.impEjected)):0,sas=impP.length?impP.filter(x=>x.impEjected===maxE):[],maxER=impP.length?Math.max(...impP.map(x=>x.impEjected/x.imp.length)):0,mostE=impP.length?impP.filter(x=>x.impEjected/x.imp.length===maxER):[];
 const maxT1=Math.max(...tracked.map(x=>x.t1)),ghost=tracked.filter(x=>x.t1===maxT1),maxFR=crewP.length?Math.max(...crewP.map(x=>x.firstDeath/x.crew.length)):0,express=crewP.length?crewP.filter(x=>x.firstDeath/x.crew.length===maxFR):[],maxCE=Math.max(...tracked.map(x=>x.crewEjected)),sus=tracked.filter(x=>x.crewEjected===maxCE&&maxCE>0),noCW=crewP.filter(x=>x.crewWins===0);
 document.getElementById("shame").innerHTML=[
 vrow("Impo en période d’essai",zero.length?zero.map(x=>x.name).join(", "):"Personne",zero.length?zero.map(x=>`${x.impWins} victoire${x.impWins>1?"s":""} sur ${x.imp.length} game${x.imp.length>1?"s":""} Imposteur`).join(" • "):"Aucun joueur concerné","cone"),
 vrow("Abonné au SAS",sas.length?sas.map(x=>x.name).join(", "):"Personne",sas.length?`${maxE} éjection${maxE>1?"s":""} en Imposteur`:"Aucun joueur concerné","eject"),
 vrow("VIP du SAS",mostE.length?mostE.map(x=>x.name).join(", "):"Personne",mostE.length?`${pct(maxER,1)} d’éjection en tant qu’Imposteur`:"Aucun joueur concerné","x"),
 vrow("Fantôme ultime",ghost.map(x=>x.name).join(", "),`Mort en T1 ${maxT1} fois`,"ghost"),
 vrow("Le départ express",express.length?express.map(x=>x.name).join(", "):"Personne",express.length?`Mort en premier ${express[0].firstDeath} fois • ${pct(maxFR,1)}`:"Aucun joueur concerné","fast"),
 vrow("Accusé idéal",sus.length?sus.map(x=>x.name).join(", "):"Personne",sus.length?`${maxCE} éjection(s) en Crew`:"","megaphone"),
 vrow("Soirée noire",noCW.length?noCW.map(x=>x.name).join(", "):"Personne",noCW.length?"0 victoire Crew":"Aucun joueur concerné","sad"),
 vrow("Éternel vacancier",worstTasks.length?worstTasks.map(x=>x.name).join(", "):"Pas assez de données",worstTasks.length?worstTasks.map(x=>`${x.taskDone} quêtes`).join(" • "):"Minimum 3 games Crew","sad")
 ].join("");

 const avgT1=games.length?games.reduce((a,g)=>a+(g.t1Deaths||0),0)/games.length:0,maxDeaths=Math.max(0,...games.map(g=>g.t1Deaths||0)),maxTimes=games.filter(g=>(g.t1Deaths||0)===maxDeaths).length;
 document.getElementById("t1-average").textContent=`${avgT1.toFixed(2).replace(".",",")} Crewmate${avgT1>1?"s":""}`;
 const maxRisk=crewP.length?Math.max(...crewP.map(x=>x.t1/x.crew.length)):0,risk=crewP.length?crewP.filter(x=>x.t1/x.crew.length===maxRisk):[],noT1=crewP.filter(x=>x.t1===0);
 document.getElementById("t1-rows").innerHTML=[
 t1row("Mort le plus souvent",ghost.map(x=>x.name).join(", "),`${maxT1} fois`),
 t1row("Taux de décès T1",risk.length?risk.map(x=>x.name).join(", "):"Pas de données",risk.length?`${pct(maxRisk,1)} de mort T1 • ${risk[0].t1}/${risk[0].crew.length} games Crew`:"Aucune game Crew"),
 t1row("Maximum de kills",`${maxDeaths} morts`,`Record atteint ${maxTimes} fois`),
 t1row("Aucun décès T1",noT1.length?noT1.map(x=>x.name).join(", "):"Personne",noT1.length?noT1.map(x=>`0/${x.crew.length}`).join(" • "):"")
 ].join("");

 const topKG=Math.max(...tracked.map(x=>x.maxKills)),topK=tracked.filter(x=>x.maxKills===topKG),bestRepair=Math.max(...tracked.map(x=>x.repairs)),repairers=tracked.filter(x=>x.repairs===bestRepair),favSab=favoriteSabotage(recs.filter(r=>r.role==="Imposteur"));
 const mapStats={};games.forEach(g=>{mapStats[g.map]??={total:0,imp:0,crew:0};mapStats[g.map].total++;g.winner==="Imposteurs"?mapStats[g.map].imp++:mapStats[g.map].crew++});
 const bestIM=Object.values(mapStats).length?Math.max(...Object.values(mapStats).map(x=>x.imp/x.total)):0,impMaps=Object.entries(mapStats).length?Object.entries(mapStats).filter(([,x])=>x.imp/x.total===bestIM):[],bestCM=Object.values(mapStats).length?Math.max(...Object.values(mapStats).map(x=>x.crew/x.total)):0,crewMaps=Object.entries(mapStats).length?Object.entries(mapStats).filter(([,x])=>x.crew/x.total===bestCM):[];
 document.getElementById("mentions").innerHTML=[
 mentionRow("Serial Killer",topK.map(x=>x.name).join(", "),`${topKG} kills en une game`),
 mentionRow("SOS Dépannage",repairers.map(x=>x.name).join(", "),`${bestRepair} réparations au total`),
 mentionRow("Sabotage préféré des Imposteurs",favSab?favSab.name:"Non renseigné",favSab?`${favSab.count} utilisations détaillées`:""),
 mentionRow("Map préférée des Imposteurs",impMaps.length?impMaps.map(([m])=>m).join(" & "):"Pas de données",impMaps.length?`${pct(bestIM,1)} de victoires`:"Aucune game"),
 mentionRow("Map la plus favorable au Crew",crewMaps.length?crewMaps.map(([m])=>m).join(" & "):"Pas de données",crewMaps.length?`${pct(bestCM,1)} de victoires`:"Aucune game")
 ].join("");
}

function renderSessions(){
 const month=document.getElementById("session-month").value,cards=document.getElementById("session-cards"),entries=Object.entries(SESSIONS).filter(([,s])=>s.month===month).sort((a,b)=>b[0].localeCompare(a[0]));
 cards.innerHTML=entries.map(([id,s],i)=>`<button class="session-card ${i===0?"active":""}" data-id="${id}"><h3>${esc(s.date)}</h3><p>${GAMES.filter(g=>g.session===id).length} games enregistrées</p></button>`).join("");
 cards.querySelectorAll(".session-card").forEach(b=>b.addEventListener("click",()=>{cards.querySelectorAll(".session-card").forEach(x=>x.classList.remove("active"));b.classList.add("active");renderSession(b.dataset.id)}));if(entries.length)renderSession(entries[0][0]);
}
function renderSession(id){
 const s=SESSIONS[id],games=GAMES.filter(g=>g.session===id).sort((a,b)=>a.n-b.n),recs=RECORDS.filter(r=>r.session===id),iw=games.filter(g=>g.winner==="Imposteurs").length,cw=games.length-iw;
 const votes=recs.reduce((a,r)=>a+Number(r.voteCast||0),0),voteImp=recs.reduce((a,r)=>a+Number(r.voteImpostor||0),0),voteCrew=recs.reduce((a,r)=>a+Number(r.voteCrew||0),0),skips=recs.reduce((a,r)=>a+Number(r.voteSkip||0),0),noVotes=recs.reduce((a,r)=>a+Number(r.voteNoVote||0),0),crewVoteTotal=recs.reduce((a,r)=>a+Number(r.crewVoteTotal||0),0),crewVoteCorrect=recs.reduce((a,r)=>a+Number(r.crewVoteCorrect||0),0),
 normalReports=recs.reduce((a,r)=>a+Number(r.reports||0),0),selfReports=recs.reduce((a,r)=>a+Number(r.self||0),0),totalReports=normalReports+selfReports,
 recordsWithReport=recs.filter(r=>Number(r.reports||0)+Number(r.self||0)>0).length,
 taskRows=recs.filter(r=>r.role==="Crew"&&r.tasks!==null&&r.tasks!==undefined&&r.totalTasks!==null&&r.totalTasks!==undefined),
 taskDone=taskRows.reduce((a,r)=>a+Number(r.tasks||0),0),taskTotal=taskRows.reduce((a,r)=>a+Number(r.totalTasks||0),0);
 document.getElementById("session-title").textContent=s.date;
 document.getElementById("session-summary").innerHTML=[
  ["Games",games.length],["Wins Imposteurs",iw],["Wins Crew",cw],
  ["Morts T1 / game",games.length?(games.reduce((a,g)=>a+(g.t1Deaths||0),0)/games.length).toFixed(2).replace(".",","):"0"],
  ["Map la + jouée",mostCommon(games.map(g=>g.map))||"—"],
  ["Reports normaux",normalReports],["Self-reports",selfReports],["Reports totaux",totalReports],
  ["Fiches avec report",pct(recordsWithReport,recs.length)],["Taux de self-report",pct(selfReports,totalReports)],
  ["Quêtes moyennes Crew",taskRows.length?(taskDone/taskRows.length).toFixed(2).replace(".",","):"—"],["Taux de quêtes Crew",pct(taskDone,taskTotal)],
  ["Votes enregistrés",votes],["Votes sur Imposteur",voteImp],["Votes sur Crew",voteCrew],
  ["Skips / sans vote",skips+" / "+noVotes],["Justesse du Crew",pct(crewVoteCorrect,crewVoteTotal)]
 ].map(([a,b])=>`<div class="card"><span>${esc(a)}</span><strong>${esc(String(b))}</strong></div>`).join("");
 document.getElementById("session-games").innerHTML=games.map(g=>`<tr><td>${g.n}</td><td>${esc(g.map)}</td><td>${esc(g.winner)}</td><td>${esc(g.method)}</td><td>${g.t1Deaths||0}</td></tr>`).join("")
}
function mostCommon(arr){const c={};arr.forEach(v=>c[v]=(c[v]||0)+1);return Object.entries(c).sort((a,b)=>b[1]-a[1])[0]?.[0]}

/* ===== Fiche joueur ===== */
function renderPlayerList(){
 const box=document.getElementById("player-list");
 box.innerHTML=sortedPlayers().map(p=>{
   const has=RECORDS.some(r=>r.p===p.name);
   return `<button class="player-btn ${p.name===currentPlayer?"active":""}" data-p="${esc(p.name)}">${esc(p.name)}<span>@${esc(p.handle)}${has?" • données":" • aucune grille"}</span></button>`
 }).join("");
 box.querySelectorAll(".player-btn").forEach(b=>b.addEventListener("click",()=>{
   currentPlayer=b.dataset.p;
   currentPlayerMonth=latestMonth();
   currentPlayerMode="month";
   currentPlayerDetailTab="overview";
   renderPlayerList();
   syncPlayerMonth();
   renderPlayerTabs();
   renderPlayer();
 }))
}
function syncPlayerMonth(){document.getElementById("player-month-select").value=currentPlayerMonth}
function renderPlayerTabs(){
 const all=RECORDS.filter(r=>r.p===currentPlayer),
 ids=[...new Set(all.filter(r=>SESSIONS[r.session]?.month===currentPlayerMonth).map(r=>r.session))].sort((a,b)=>b.localeCompare(a)),
 box=document.getElementById("player-session-tabs");
 box.innerHTML=`<button class="tab ${currentPlayerMode==="month"?"active":""}" data-mode="month">Cumul du mois</button>`+
 ids.map(id=>`<button class="tab ${currentPlayerMode===id?"active":""}" data-mode="${id}">${esc(SESSIONS[id].label)}</button>`).join("")+
 `<button class="tab ${currentPlayerMode==="all"?"active":""}" data-mode="all">Cumul global</button>`;
 box.querySelectorAll(".tab").forEach(b=>b.addEventListener("click",()=>{
   currentPlayerMode=b.dataset.mode;
   renderPlayerTabs();
   renderPlayer()
 }))
}
function syncPlayerDetailTabs(){
 const valid=["overview","votes","impostor","games"];
 if(!valid.includes(currentPlayerDetailTab))currentPlayerDetailTab="overview";
 document.querySelectorAll("#player-detail-tabs [data-player-detail]").forEach(b=>{
   const active=b.dataset.playerDetail===currentPlayerDetailTab;
   b.classList.toggle("active",active);
   b.setAttribute("aria-selected",active?"true":"false");
 });
 valid.forEach(name=>{
   const panel=document.getElementById("player-detail-"+name);
   if(panel)panel.hidden=name!==currentPlayerDetailTab;
 });
}
function statCards(targetId,items){
 const target=document.getElementById(targetId);
 if(!target)return;
 target.innerHTML=items.map(([a,b])=>`<div class="kv-item"><span>${esc(a)}</span><strong>${esc(String(b))}</strong></div>`).join("");
}
function clearPlayerDetails(message=""){
 ["p-overview-performance","p-overview-reports","p-overview-activity","p-vote-stats","p-impostor-stats"].forEach(id=>{
   const el=document.getElementById(id);if(el)el.innerHTML=message?`<div class="kv-item"><span>Info</span><strong>${esc(message)}</strong></div>`:"";
 });
 document.getElementById("p-maps").innerHTML="";
 document.getElementById("p-sabotage").innerHTML="";
 document.getElementById("p-games").innerHTML="";
 syncPlayerDetailTabs();
}
function renderPlayer(){
 const p=sortedPlayers().find(x=>x.name===currentPlayer);
 syncPlayerDetailTabs();
 if(!p){
  document.getElementById("p-name").textContent="Aucun streamer";
  const twitchLink=document.getElementById("p-handle");twitchLink.textContent="";twitchLink.removeAttribute("href");
  document.getElementById("p-state").textContent="Aucun streamer enregistré";
  document.getElementById("p-summary").innerHTML=`<div class="card"><span>Statut</span><strong>Aucune donnée</strong></div>`;
  clearPlayerDetails();
  return;
 }
 const all=RECORDS.filter(r=>r.p===currentPlayer);
 let rr=currentPlayerMode==="all"?all:currentPlayerMode==="month"?all.filter(r=>SESSIONS[r.session]?.month===currentPlayerMonth):all.filter(r=>r.session===currentPlayerMode);
 document.getElementById("p-name").textContent=p.name;
 const twitchLink=document.getElementById("p-handle");
 twitchLink.textContent="@"+p.handle+" ↗";
 twitchLink.href="https://www.twitch.tv/"+encodeURIComponent(p.handle);
 twitchLink.setAttribute("aria-label","Ouvrir la chaîne Twitch de "+p.name);
 document.getElementById("p-state").textContent=all.length?"Données présentes":"Aucune grille détaillée";

 if(!all.length){
  document.getElementById("p-summary").innerHTML=`<div class="card"><span>Statut</span><strong>Pas de données</strong></div>`;
  clearPlayerDetails("Aucune grille fournie dans cette démo.");
  return;
 }

 const wins=rr.filter(r=>resultFor(r)==="Victoire").length,
 imp=rr.filter(r=>r.role==="Imposteur"),
 crew=rr.filter(r=>r.role==="Crew"),
 kills=rr.reduce((a,r)=>a+(r.kills?.length||0),0),
 reports=rr.reduce((a,r)=>a+Number(r.reports||0),0),
 selfReports=rr.reduce((a,r)=>a+Number(r.self||0),0),
 totalReports=reports+selfReports,
 reportGames=rr.filter(r=>Number(r.reports||0)+Number(r.self||0)>0).length,
 repairs=rr.reduce((a,r)=>a+(Number.isFinite(r.repair)?r.repair:0),0),
 votes=rr.reduce((a,r)=>a+Number(r.voteCast||0),0),
 voteImp=rr.reduce((a,r)=>a+Number(r.voteImpostor||0),0),
 voteCrew=rr.reduce((a,r)=>a+Number(r.voteCrew||0),0),
 voteSkip=rr.reduce((a,r)=>a+Number(r.voteSkip||0),0),
 voteNoVote=rr.reduce((a,r)=>a+Number(r.voteNoVote||0),0),
 voteSelf=rr.reduce((a,r)=>a+Number(r.voteSelf||0),0),
 crewVoteTotal=rr.reduce((a,r)=>a+Number(r.crewVoteTotal||0),0),
 crewVoteCorrect=rr.reduce((a,r)=>a+Number(r.crewVoteCorrect||0),0),
 crewVoteWrong=rr.reduce((a,r)=>a+Number(r.crewVoteWrong||0),0),
 taskRows=crew.filter(r=>r.tasks!==null&&r.tasks!==undefined&&r.totalTasks!==null&&r.totalTasks!==undefined),
 taskDone=taskRows.reduce((a,r)=>a+Number(r.tasks||0),0),
 taskTotal=taskRows.reduce((a,r)=>a+Number(r.totalTasks||0),0),
 crewSurvived=crew.filter(r=>!r.ejected&&(!r.death||r.death==="Survit")).length,
 sabCount=rr.reduce((a,r)=>a+Number(r.sab||0),0),
 fav=favoriteSabotage(imp);

 document.getElementById("p-summary").innerHTML=[
  ["Games",rr.length],["Victoires",wins],["Kills",kills],["Reports",totalReports],["Réparations",repairs]
 ].map(([a,b])=>`<div class="card"><span>${a}</span><strong>${b}</strong></div>`).join("");

 statCards("p-overview-performance",[
  ["Winrate global",pct(wins,rr.length)],
  ["Winrate Crew",pct(crew.filter(r=>resultFor(r)==="Victoire").length,crew.length)],
  ["Winrate Imposteur",pct(imp.filter(r=>resultFor(r)==="Victoire").length,imp.length)],
  ["Part Crew",pct(crew.length,rr.length)],
  ["Morts T1",crew.filter(r=>r.turn===1).length],
  ["Éjections Crew",crew.filter(r=>r.ejected).length],
  ["Survie Crew",pct(crewSurvived,crew.length)]
 ]);
 statCards("p-overview-reports",[
  ["Reports normaux",reports],
  ["Self-reports",selfReports],
  ["Reports totaux",totalReports],
  ["Games avec report",pct(reportGames,rr.length)],
  ["Taux de self-report",pct(selfReports,totalReports)]
 ]);
 statCards("p-overview-activity",[
  ["Réparations",repairs],
  ["Réparations / game",rr.length?(repairs/rr.length).toFixed(2).replace(".",","):"—"],
  ["Quêtes moyennes (Crew)",taskRows.length?(taskDone/taskRows.length).toFixed(2).replace(".",","):"—"],
  ["Taux de quêtes (Crew)",pct(taskDone,taskTotal)]
 ]);
 statCards("p-vote-stats",[
  ["Votes enregistrés",votes],
  ["Votes sur Imposteur",voteImp],
  ["Votes sur Crew",voteCrew],
  ["Skips",voteSkip],
  ["Sans vote",voteNoVote],
  ["Auto-votes",voteSelf],
  ["Votes justes (Crew)",crewVoteCorrect],
  ["Votes à côté (Crew)",crewVoteWrong],
  ["Justesse du vote Crew",pct(crewVoteCorrect,crewVoteTotal)]
 ]);
 statCards("p-impostor-stats",[
  ["Games en Imposteur",imp.length],
  ["Winrate Imposteur",pct(imp.filter(r=>resultFor(r)==="Victoire").length,imp.length)],
  ["Kills",kills],
  ["Kills / game Imposteur",imp.length?(kills/imp.length).toFixed(2).replace(".",","):"—"],
  ["Éjections Imposteur",imp.filter(r=>r.ejected).length],
  ["Sabotages",sabCount],
  ["Sabotages / game Imposteur",imp.length?(sabCount/imp.length).toFixed(2).replace(".",","):"—"]
 ]);

 const maps={};
 imp.forEach(r=>{const g=gameFor(r);if(g)maps[g.map]=(maps[g.map]||0)+1});
 document.getElementById("p-maps").innerHTML=Object.keys(maps).length
  ?Object.entries(maps).map(([m,n])=>`<div class="map-row"><span>${esc(m)}</span><strong>${n}</strong></div>`).join("")
  :`<div class="map-row"><span>Aucune game en Imposteur</span><strong>0</strong></div>`;
 document.getElementById("p-sabotage").innerHTML=`<span>Sabotage préféré en Imposteur</span><strong>${esc(fav?fav.name:(imp.some(r=>(r.sab||0)>0)?"Non renseigné":"Aucun"))}</strong>`;

 document.getElementById("p-games").innerHTML=[...rr].sort((a,b)=>a.g-b.g).map(r=>{
  const g=gameFor(r),
  killsText=r.role==="Imposteur"?(r.kills?.join(" → ")||"Aucun kill"):"—",
  sortie=r.ejected?"Éjecté":(r.role==="Crew"?(r.death||"Survit"):"Survit");
  return `<tr><td>${r.g}</td><td>${esc(g?.map||"—")}</td><td>${esc(r.role)}</td><td>${resultFor(r)}</td><td>${esc(g?.method||"—")}</td><td>${r.reports||0}</td><td>${r.self||0}</td><td>${r.sab||0}</td><td>${r.repair===null?"?":r.repair}</td><td>${esc(killsText)}</td><td>${esc(sortie)}</td><td>${r.role==="Crew"&&r.deathPos?`${r.deathPos}${r.deathPos===1?"er":"e"}`:"—"}</td><td>${r.turn?`T${r.turn}`:"—"}</td><td>${r.tasks===null?"—":`${r.tasks}/${r.totalTasks||9}`}</td><td>${esc(r.note||"")}</td></tr>`
 }).join("");
 syncPlayerDetailTabs();
}

/* ===== Saisie d'une game ===== */
function playerOptions(blank=false,session=null){const list=session?participantsForSession(session):activePlayers();return (blank?`<option value="">— Choisir —</option>`:"")+list.map(p=>`<option value="${esc(p.name)}">${esc(p.name)}</option>`).join("")}
function currentEntrySession(){return document.getElementById("form-session").value}
function syncEntryPlayerOptions(){const sel=document.getElementById("form-player"),old=sel.value;sel.innerHTML=playerOptions(false,currentEntrySession());if([...sel.options].some(o=>o.value===old))sel.value=old}
function refreshEventPlayerOptions(){const session=currentEntrySession();document.querySelectorAll("#events-list .event-row").forEach(row=>{const type=row.querySelector(".ev-type")?.value,sel=row.querySelector(".ev-target");if(!sel)return;const old=sel.value;let html="";if(type==="kill"||type==="death")html=playerOptions(true,session);if(type==="self")html=`<option value="">Non renseigné</option>${playerOptions(false,session)}`;if(html){sel.innerHTML=html;if([...sel.options].some(o=>o.value===old))sel.value=old}})}
function sabotageOptions(blank=false){return (blank?`<option value="">— Choisir —</option>`:"")+SABOTAGE_TYPES.map(s=>`<option>${esc(s)}</option>`).join("")}
function populateGameSelect(){const session=document.getElementById("form-session").value,sel=document.getElementById("form-game"),nums=[...new Set(GAMES.filter(g=>g.session===session).map(g=>g.n))].sort((a,b)=>a-b);sel.innerHTML=nums.map(n=>`<option value="${n}">${n}</option>`).join("");if(!nums.length)sel.innerHTML='<option value="1">1</option>'}
function updateReportPreview(){const normal=Math.max(0,Number(document.getElementById("form-reports")?.value)||0),self=document.querySelectorAll('#events-list .event-row .ev-type').length?[...document.querySelectorAll('#events-list .event-row .ev-type')].filter(x=>x.value==="self").length:0,out=document.getElementById("reports-total-preview");if(out)out.textContent=`Total reports : ${normal+self} (${normal} normal${normal>1?"s":""} + ${self} self-report${self>1?"s":""})`}
function initEntry(){syncEntryPlayerOptions();populateGameSelect();document.getElementById("events-list").innerHTML="";document.getElementById("sabotages-list").innerHTML="";updateSabotageCount();updateReportPreview();syncWinnerFromResult();syncEntryRolePanels()}
function ensureSelectValue(sel,value,label=value){if(value===null||value===undefined||value==="")return;if(![...sel.options].some(o=>o.value===String(value)))sel.insertAdjacentHTML("beforeend",`<option value="${esc(value)}">${esc(label)}</option>`);sel.value=String(value)}
function eventTurnLabel(turn){return turn&&turn>=5?"T5+":`T${turn||1}`}
function addEventRow(data={}){const el=document.createElement("div");el.className="dynamic-row event-row";el.innerHTML=`<label>Tour<select class="ev-turn"><option>T1</option><option>T2</option><option>T3</option><option>T4</option><option>T5+</option></select></label><label>Type<select class="ev-type"><option value="kill">Le streamer tue</option><option value="death">Le streamer meurt</option><option value="self">Self-report</option></select></label><div class="dynamic-field"></div><button type="button" class="remove">×</button>`;document.getElementById("events-list").appendChild(el);el.querySelector(".ev-type").addEventListener("change",()=>{renderEventDetail(el);updateReportPreview()});el.querySelector(".remove").addEventListener("click",()=>{el.remove();updateReportPreview()});if(data.type)el.querySelector(".ev-type").value=data.type;el.querySelector(".ev-turn").value=eventTurnLabel(data.turn);renderEventDetail(el);const target=el.querySelector(".ev-target");if(target&&data.target){ensureSelectValue(target,data.target);target.value=data.target}const pos=el.querySelector(".ev-pos");if(pos&&data.pos)pos.value=String(data.pos);updateReportPreview()}
function renderEventDetail(el){const t=el.querySelector(".ev-type").value,b=el.querySelector(".dynamic-field");if(t==="kill")b.innerHTML=`<label>Victime<select class="ev-target">${playerOptions(true,currentEntrySession())}</select></label>`;if(t==="death")b.innerHTML=`<div class="two-cols"><label>Tué par<select class="ev-target">${playerOptions(true,currentEntrySession())}</select></label><label>Ordre de mort<input class="ev-pos" type="number" min="1" max="10" placeholder="1, 2, 3…"></label></div>`;if(t==="self")b.innerHTML=`<label>Victime self-report<select class="ev-target"><option value="">Non renseigné</option>${playerOptions(false,currentEntrySession())}</select></label>`}
function addSabotageRow(data={}){const r=document.createElement("div");r.className="dynamic-row sabotage-row";r.innerHTML=`<label>Tour<select class="sab-turn"><option>T1</option><option>T2</option><option>T3</option><option>T4</option><option>T5+</option></select></label><label>Sabotage<select class="sab-type">${sabotageOptions(false)}</select></label><button type="button" class="remove">×</button>`;document.getElementById("sabotages-list").appendChild(r);r.querySelector(".remove").addEventListener("click",()=>{r.remove();updateSabotageCount()});r.querySelector(".sab-type").addEventListener("change",updateFavoriteSuggestion);r.querySelector(".sab-turn").value=eventTurnLabel(data.turn);if(data.sabotage){const sel=r.querySelector(".sab-type");ensureSelectValue(sel,data.sabotage);sel.value=data.sabotage}updateSabotageCount()}
function updateSabotageCount(){const n=document.querySelectorAll("#sabotages-list .sabotage-row").length;document.getElementById("sabotage-count").textContent=`${n} sabotage${n>1?"s":""}`;updateFavoriteSuggestion()}
function updateFavoriteSuggestion(){const vals=[...document.querySelectorAll("#sabotages-list .sab-type")].map(x=>x.value),fav=favoriteFromList(vals),out=document.getElementById("favorite-sabotage-preview");if(out)out.textContent=fav?`${fav.name} (${fav.count})`:"Aucun"}
function syncEntryRolePanels(){const crew=document.getElementById("form-role").value==="Crew";document.getElementById("crew-repair-panel").hidden=false;document.getElementById("impostor-sabotage-panel").hidden=crew}
function changeRepair(delta){const input=document.getElementById("form-repairs"),next=Math.max(0,(Number(input.value)||0)+delta);input.value=String(next)}
function syncWinnerFromResult(){const role=document.getElementById("form-role").value,res=document.getElementById("form-result").value;document.getElementById("form-winning-side").value=(res==="Victoire")?(role==="Crew"?"Crewmates":"Imposteurs"):(role==="Crew"?"Imposteurs":"Crewmates")}
function resetManualEntryForNewGame(){
  editingRecordKey=null;
  const session=document.getElementById("form-session").value;
  const nums=GAMES.filter(g=>g.session===session).map(g=>Number(g.n)||0);
  const next=Math.max(0,...nums)+1;
  const gameSel=document.getElementById("form-game");
  if(![...gameSel.options].some(o=>Number(o.value)===next))gameSel.insertAdjacentHTML("beforeend",`<option value="${next}">${next}</option>`);
  gameSel.value=String(next);
  syncEntryPlayerOptions();
  const playerSel=document.getElementById("form-player");if(playerSel.options.length)playerSel.selectedIndex=0;
  document.getElementById("form-map").selectedIndex=0;
  document.getElementById("form-role").value="Crew";
  document.getElementById("form-result").value="Victoire";
  document.getElementById("form-ejected").value="Non";
  document.getElementById("form-reports").value="0";
  document.getElementById("form-repairs").value="0";
  document.getElementById("form-tasks").value="0";
  document.getElementById("form-note").value="";
  document.getElementById("events-list").innerHTML="";
  document.getElementById("sabotages-list").innerHTML="";
  document.getElementById("form-method").selectedIndex=0;
  document.getElementById("save-entry-btn").textContent="Enregistrer la fiche";
  updateSabotageCount();
  updateReportPreview();
  syncWinnerFromResult();
  syncEntryRolePanels();
  document.getElementById("entry-status").textContent=`Game ${next} prête à être saisie.`;
}
document.getElementById("form-role").addEventListener("change",()=>{syncWinnerFromResult();syncEntryRolePanels()});document.getElementById("form-result").addEventListener("change",syncWinnerFromResult);document.getElementById("form-reports").addEventListener("input",updateReportPreview);document.getElementById("add-event-btn").addEventListener("click",()=>addEventRow());document.getElementById("add-sabotage-btn").addEventListener("click",()=>addSabotageRow());document.getElementById("repair-minus").addEventListener("click",()=>changeRepair(-1));document.getElementById("repair-plus").addEventListener("click",()=>changeRepair(1));document.getElementById("form-session").addEventListener("change",()=>{populateGameSelect();syncEntryPlayerOptions();refreshEventPlayerOptions();updateReportPreview()});
document.getElementById("new-game-btn").addEventListener("click",resetManualEntryForNewGame);

/* ===== Administration ===== */
function crewtestManualUpsert(payload){
  const session=payload.p_session_id;
  const gnum=Number(payload.p_game_number);
  let game=GAMES.find(g=>g.session===session&&Number(g.n)===gnum);

  if(!game){
    game={
      id:"manual-game-"+session+"-"+gnum+"-"+Date.now(),
      session:session,
      n:gnum,
      map:payload.p_map,
      winner:payload.p_winner,
      method:payload.p_method,
      t1Deaths:0,
      manual:true
    };
    GAMES.push(game);
  }else{
    game.map=payload.p_map;
    game.winner=payload.p_winner;
    game.method=payload.p_method;
  }

  let record=null;
  if(payload.p_existing_record_id){
    record=RECORDS.find(r=>r.id===payload.p_existing_record_id)||null;
  }
  if(!record){
    record=RECORDS.find(r=>r.session===session&&r.p===payload.p_player_name&&Number(r.g)===gnum)||null;
  }

  const values={
    gameId:game.id,
    session:session,
    p:payload.p_player_name,
    g:gnum,
    role:payload.p_role,
    reports:Number(payload.p_reports||0),
    self:Number(payload.p_self_reports||0),
    sab:Array.isArray(payload.p_sabotages)?payload.p_sabotages.length:0,
    sabotages:Array.isArray(payload.p_sabotages)?payload.p_sabotages.slice():[],
    repair:Number(payload.p_repair||0),
    kills:Array.isArray(payload.p_kills)?payload.p_kills.slice():[],
    death:payload.p_death||"Survit",
    deathPos:payload.p_death_pos===null?null:Number(payload.p_death_pos),
    turn:payload.p_turn===null?null:Number(payload.p_turn),
    tasks:payload.p_tasks===null?null:Number(payload.p_tasks),
    totalTasks:payload.p_total_tasks===null?null:Number(payload.p_total_tasks),
    ejected:payload.p_ejected===true,
    note:payload.p_note||"",
    manual:true
  };

  if(record)Object.assign(record,values);
  else{
    record=Object.assign({id:"manual-record-"+Date.now()+"-"+Math.random().toString(36).slice(2,8)},values);
    RECORDS.push(record);
  }

  if(!SESSION_PARTICIPANTS[session])SESSION_PARTICIPANTS[session]=[];
  if(!SESSION_PARTICIPANTS[session].includes(payload.p_player_name))SESSION_PARTICIPANTS[session].push(payload.p_player_name);

  game.t1Deaths=RECORDS.filter(r=>r.gameId===game.id&&r.role==="Crew"&&Number(r.turn)===1&&r.death&&r.death!=="Survit").length;
  crewtestSaveState();
  crewtestRefreshAll(session);
  return record;
}

function editRecordFromAdmin(index){
 const r=RECORDS[index];if(!r)return;
 const g=gameFor(r);editingRecordKey={session:r.session,p:r.p,g:r.g};
 const sessionSel=document.getElementById("form-session");ensureSelectValue(sessionSel,r.session,SESSIONS[r.session]?.label||r.session);sessionSel.value=r.session;
 populateGameSelect();syncEntryPlayerOptions();
 const playerSel=document.getElementById("form-player");ensureSelectValue(playerSel,r.p,r.p);playerSel.value=r.p;
 const gameSel=document.getElementById("form-game");ensureSelectValue(gameSel,r.g,r.g);gameSel.value=String(r.g);
 if(g){ensureSelectValue(document.getElementById("form-map"),g.map,g.map);document.getElementById("form-map").value=g.map;document.getElementById("form-winning-side").value=g.winner;document.getElementById("form-method").value=g.method}
 document.getElementById("form-role").value=r.role;
 document.getElementById("form-result").value=resultFor(r);
 document.getElementById("form-ejected").value=r.ejected?"Oui":"Non";
 document.getElementById("form-reports").value=String(r.reports||0);
 document.getElementById("form-repairs").value=String(Number.isFinite(r.repair)?r.repair:0);
 document.getElementById("form-tasks").value=String(r.tasks??0);
 document.getElementById("form-note").value=r.note||"";
 document.getElementById("events-list").innerHTML="";
 (r.kills||[]).forEach(target=>addEventRow({type:"kill",target}));
 const deathMatch=/^Tu(?:é|ée) par (.+)$/.exec(r.death||"");
 if(deathMatch||((r.death||"")!=="Survit"&&!String(r.death||"").startsWith("Éjecté")&&r.death)){addEventRow({type:"death",turn:r.turn,target:deathMatch?.[1]||"",pos:r.deathPos})}
 for(let i=0;i<(r.self||0);i++)addEventRow({type:"self"});
 document.getElementById("sabotages-list").innerHTML="";
 (r.sabotages||[]).forEach(sabotage=>addSabotageRow({sabotage}));
 updateSabotageCount();updateReportPreview();syncEntryRolePanels();refreshEventPlayerOptions();
 document.getElementById("save-entry-btn").textContent="Enregistrer les modifications";
 document.getElementById("entry-status").textContent=`Modification de ${r.p}, Game ${r.g} du ${SESSIONS[r.session]?.label||r.session}.`;
 document.querySelectorAll(".nav").forEach(x=>x.classList.toggle("active",x.dataset.view==="entry"));
 document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id==="view-entry"));
 window.scrollTo({top:document.getElementById("view-entry").offsetTop-80,behavior:"smooth"});
}
document.getElementById("save-entry-btn").addEventListener("click",async()=>{
  if(!requireEditor()){
    document.getElementById("entry-status").textContent="Connecte-toi avec un compte Admin ou Helper pour enregistrer les données.";
    return;
  }
  const saveButton=document.getElementById("save-entry-btn");
  const session=document.getElementById("form-session").value,gnum=Number(document.getElementById("form-game").value),player=document.getElementById("form-player").value,role=document.getElementById("form-role").value;
  const kills=[];let death="Survit",deathPos=null,deathTurn=null,self=0;
  document.querySelectorAll("#events-list .event-row").forEach(r=>{const type=r.querySelector(".ev-type").value,turn=turnNumber(r.querySelector(".ev-turn").value),target=r.querySelector(".ev-target")?.value||"";if(type==="kill"&&target)kills.push(target);if(type==="death"){death=target?`Tué par ${target}`:"Mort";deathPos=Number(r.querySelector(".ev-pos")?.value)||null;deathTurn=turn}if(type==="self")self++});
  const repairs=Math.max(0,Number(document.getElementById("form-repairs").value)||0);
  const sabotages=role==="Imposteur"?[...document.querySelectorAll("#sabotages-list .sab-type")].map(x=>x.value):[];
  const ejected=document.getElementById("form-ejected").value==="Oui";
  if(ejected&&death==="Survit")death="Éjecté au conseil";
  const winner=document.getElementById("form-winning-side").value,method=document.getElementById("form-method").value,map=document.getElementById("form-map").value;
  const identityChanged=editingRecordKey&&(editingRecordKey.session!==session||editingRecordKey.p!==player||editingRecordKey.g!==gnum);
  if(identityChanged&&RECORDS.some(r=>r.session===session&&r.p===player&&r.g===gnum)){alert("Une fiche existe déjà pour ce joueur dans cette game. Modifie-la directement depuis l’Admin.");return}
  const existingRecord=editingRecordKey?RECORDS.find(r=>r.session===editingRecordKey.session&&r.p===editingRecordKey.p&&r.g===editingRecordKey.g):null;
  const payload={
    p_existing_record_id:existingRecord?.id||null,
    p_session_id:session,
    p_game_number:gnum,
    p_player_name:player,
    p_role:role,
    p_reports:Number(document.getElementById("form-reports").value)||0,
    p_self_reports:self,
    p_sabotages:sabotages,
    p_repair:repairs,
    p_kills:role==="Imposteur"?kills:[],
    p_death:death,
    p_death_pos:deathPos,
    p_turn:deathTurn,
    p_tasks:role==="Crew"?(Number(document.getElementById("form-tasks").value)||0):null,
    p_total_tasks:role==="Crew"?9:null,
    p_ejected:ejected,
    p_note:document.getElementById("form-note").value.trim(),
    p_map:map,
    p_winner:winner,
    p_method:method
  };
  const wasEditing=!!editingRecordKey;
  saveButton.disabled=true;
  try{
    if(TEST_MODE){
      crewtestManualUpsert(payload);
      editingRecordKey=null;
      saveButton.textContent="Enregistrer la fiche";
      const sessionSel=document.getElementById("form-session");
      ensureSelectValue(sessionSel,session,SESSIONS[session]?.label||session);
      sessionSel.value=session;
      populateGameSelect();
      const gameSel=document.getElementById("form-game");
      ensureSelectValue(gameSel,gnum,gnum);
      gameSel.value=String(gnum);
      syncEntryPlayerOptions();
      const playerSel=document.getElementById("form-player");
      ensureSelectValue(playerSel,player,player);
      playerSel.value=player;
      document.getElementById("entry-status").textContent=`${wasEditing?"Modifié":"Enregistré"} : ${player}, Game ${gnum}. Données enregistrées localement dans CREWTEST.`;
    }else{
      await adminUpsertRecordInSupabase(payload);
      editingRecordKey=null;
      saveButton.textContent="Enregistrer la fiche";
      await reloadPublicData();
      const sessionSel=document.getElementById("form-session");
      ensureSelectValue(sessionSel,session,SESSIONS[session]?.label||session);
      sessionSel.value=session;
      populateGameSelect();
      const gameSel=document.getElementById("form-game");
      ensureSelectValue(gameSel,gnum,gnum);
      gameSel.value=String(gnum);
      syncEntryPlayerOptions();
      const playerSel=document.getElementById("form-player");
      ensureSelectValue(playerSel,player,player);
      playerSel.value=player;
      document.getElementById("entry-status").textContent=`${wasEditing?"Modifié":"Enregistré"} : ${player}, Game ${gnum}. Les données sont enregistrées dans Supabase.`;
    }
  }catch(error){
    document.getElementById("entry-status").textContent=(TEST_MODE?"Erreur CREWTEST : ":"Erreur Supabase : ")+error.message;
  }finally{saveButton.disabled=false}
});

async function addAdminSession(){
  if(!requireAdmin())return;
  const input=document.getElementById("admin-new-session-date"),status=document.getElementById("admin-session-status"),id=input.value;
  if(!id){status.textContent="Choisis une date.";return}
  if(SESSIONS[id]&&!DELETED_SESSIONS.has(id)){status.textContent="Cette session existe déjà.";return}
  const meta=sessionMetaFromId(id);
  try{
    await adminCreateSessionInSupabase({id,date:meta.date,month:meta.month,label:meta.label});
    await reloadPublicData();
    document.getElementById("form-session").value=id;populateGameSelect();syncEntryPlayerOptions();refreshEventPlayerOptions();
    const adminSel=document.getElementById("admin-participant-session");adminSel.value=id;renderAdminParticipants();
    status.textContent=`Session du ${meta.label} ajoutée dans Supabase. Aucun membre n’est coché par défaut.`;
  }catch(error){status.textContent="Erreur Supabase : "+error.message}
}
function renderAdminSessions(){
 const box=document.getElementById("admin-sessions-list"),status=document.getElementById("admin-manage-session-status");
 const ids=sessionIds();
 box.innerHTML=ids.map(id=>{
   const games=GAMES.filter(g=>g.session===id).length,records=RECORDS.filter(r=>r.session===id).length;
   return `<div class="admin-session-row" data-session="${esc(id)}">
     <div class="admin-session-main">
       <strong>${esc(SESSIONS[id]?.date||id)}</strong>
       <small>${games} game${games!==1?"s":""} • ${records} fiche${records!==1?"s":""}</small>
     </div>
     <label>Nouvelle date<input class="admin-session-edit-date" type="date" value="${esc(id)}"></label>
     <div class="admin-session-actions">
       <button type="button" class="secondary admin-session-edit">Modifier</button>
       <button type="button" class="danger admin-session-delete">Supprimer</button>
     </div>
   </div>`;
 }).join("");
 box.querySelectorAll(".admin-session-edit").forEach(btn=>btn.addEventListener("click",()=>editAdminSession(btn.closest(".admin-session-row"))));
 box.querySelectorAll(".admin-session-delete").forEach(btn=>btn.addEventListener("click",()=>deleteAdminSession(btn.closest(".admin-session-row"))));
 if(!ids.length)box.innerHTML='<p class="muted">Aucune session enregistrée.</p>';
 if(status&&!status.textContent)status.textContent="";
}
async function editAdminSession(row){
  if(!requireAdmin())return;
  const oldId=row.dataset.session,newId=row.querySelector(".admin-session-edit-date").value,status=document.getElementById("admin-manage-session-status");
  if(!newId){status.textContent="Choisis une nouvelle date.";return}
  if(newId===oldId){status.textContent="La date n’a pas changé.";return}
  if(SESSIONS[newId]){status.textContent="Une session existe déjà à cette date.";return}
  const meta=sessionMetaFromId(newId);
  try{
    await adminUpdateSessionInSupabase(oldId,newId,meta);
    await reloadPublicData();
    const adminSel=document.getElementById("admin-participant-session");
    if([...adminSel.options].some(o=>o.value===newId)){adminSel.value=newId;renderAdminParticipants()}
    status.textContent=`Session déplacée du ${oldId.split("-").reverse().join("/")} au ${meta.label} dans Supabase.`;
  }catch(error){status.textContent="Erreur Supabase : "+error.message}
}
async function deleteAdminSession(row){
  if(!requireAdmin())return;
  const id=row.dataset.session,status=document.getElementById("admin-manage-session-status");
  const games=GAMES.filter(g=>g.session===id).length,records=RECORDS.filter(r=>r.session===id).length;
  const label=SESSIONS[id]?.label||id;
  if(!confirm(`Supprimer définitivement la session du ${label} ?\n\nCela supprimera aussi ${games} game(s) et ${records} fiche(s) joueur associée(s).\n\nCette action est irréversible.`))return;

  if(TEST_MODE){
    const removedGameIds=new Set(GAMES.filter(g=>g.session===id).map(g=>g.id));
    GAMES=GAMES.filter(g=>g.session!==id);
    RECORDS=RECORDS.filter(r=>r.session!==id&&!removedGameIds.has(r.gameId));
    delete SESSION_PARTICIPANTS[id];
    delete SESSIONS[id];
    for(const [fp,info] of Object.entries(TEST_IMPORTS)){
      if(info?.sessionId===id)delete TEST_IMPORTS[fp];
    }
    DEFAULT_SESSION_PARTICIPANTS=Object.fromEntries(Object.keys(SESSIONS).map(sid=>[sid,[]]));
    crewtestSaveState();
    crewtestRefreshAll();
    status.textContent=`Session du ${label} supprimée de CREWTEST.`;
    return;
  }

  if(sessionIds().length<=1){status.textContent="Impossible de supprimer la dernière session.";return}
  try{
    await adminDeleteSessionInSupabase(id);
    await reloadPublicData();
    status.textContent=`Session du ${label} supprimée de Supabase.`;
  }catch(error){status.textContent="Erreur Supabase : "+error.message}
}
function renderAdminParticipants(){
 const sessionSel=document.getElementById("admin-participant-session"),list=document.getElementById("admin-participants-list");
 const sessions=Object.entries(SESSIONS).sort((a,b)=>b[0].localeCompare(a[0]));
 const old=sessionSel.value;
 sessionSel.innerHTML=sessions.map(([id,s])=>`<option value="${esc(id)}">${esc(s.label||s.date||id)}</option>`).join("");
 if(sessions.some(([id])=>id===old))sessionSel.value=old;
 const selected=new Set(participantNamesForSession(sessionSel.value));
 list.innerHTML=sortedPlayers().map(p=>{const inactive=p.active===false&&!selected.has(p.name);return `<label class="participant-check ${p.active===false?"inactive":""}"><input type="checkbox" value="${esc(p.name)}" ${selected.has(p.name)?"checked":""} ${inactive?"disabled":""}><span>${esc(p.name)}${p.active===false?" <small>(inactif)</small>":""}</span></label>`}).join("");
}
function clearAdminParticipants(){
 document.querySelectorAll("#admin-participants-list input[type=\"checkbox\"]").forEach(x=>x.checked=false);
 document.getElementById("admin-participants-status").textContent="Tous les participants ont été décochés. Clique sur Enregistrer pour valider.";
}
async function saveAdminParticipants(){
  if(!requireAdmin())return;
  const session=document.getElementById("admin-participant-session").value;
  const names=[...document.querySelectorAll("#admin-participants-list input:checked")].map(x=>x.value);
  const status=document.getElementById("admin-participants-status");
  try{
    await adminSaveParticipantsInSupabase(session,names);
    await reloadPublicData();
    if(currentEntrySession()===session){syncEntryPlayerOptions();refreshEventPlayerOptions()}
    status.textContent=`${names.length} participant${names.length>1?"s":""} enregistré${names.length>1?"s":""} dans Supabase pour cette soirée.`;
  }catch(error){status.textContent="Erreur Supabase : "+error.message}
}
function resetAdminPlayerForm(){
 const name=document.getElementById("admin-player-name"),handle=document.getElementById("admin-player-handle"),button=document.getElementById("admin-add-player-btn"),cancel=document.getElementById("admin-cancel-player-edit"),status=document.getElementById("admin-player-status");
 if(!name)return;
 name.value="";handle.value="";name.disabled=false;button.textContent="+ Ajouter le streamer";cancel.hidden=true;delete button.dataset.editName;
 if(status)status.textContent="";
}
function renderAdminPlayers(){
 const list=document.getElementById("admin-players-list");
 const status=document.getElementById("admin-player-status");
 if(!list)return;
 const players=sortedPlayers();
  list.innerHTML=players.map(p=>{
    const used=playerIsUsed(p.name);
    const state=p.active===false?"Inactif":"Actif";
    const stateClass=p.active===false?"inactive":"";
    const toggleLabel=p.active===false?"Réactiver":"Désactiver";
    const toggleClass=p.active===false?"primary":"secondary";
    const deleteButton=`<button type="button" class="danger admin-player-delete" data-name="${esc(p.name)}">Supprimer</button>`;
    return `<div class="admin-player-row ${stateClass}">
      <div><strong>${esc(p.name)}</strong><small>@${esc(p.handle)} • ${state}${used?" • données utilisées":""}</small></div>
      <div class="admin-player-actions">
        <button type="button" class="secondary admin-player-edit" data-name="${esc(p.name)}">Modifier</button>
        <button type="button" class="${toggleClass} admin-player-toggle" data-name="${esc(p.name)}">${toggleLabel}</button>
        ${deleteButton}
      </div>
    </div>`;
  }).join("");
 list.querySelectorAll(".admin-player-edit").forEach(btn=>btn.addEventListener("click",()=>editAdminPlayer(btn.dataset.name)));
 list.querySelectorAll(".admin-player-toggle").forEach(btn=>btn.addEventListener("click",()=>toggleAdminPlayer(btn.dataset.name)));
 list.querySelectorAll(".admin-player-delete").forEach(btn=>btn.addEventListener("click",()=>deleteAdminPlayer(btn.dataset.name)));
 if(!players.length)list.innerHTML='<p class="muted">Aucun streamer enregistré.</p>';
 if(status&&!status.textContent)status.textContent="";
}
function editAdminPlayer(name){
 const p=PLAYERS.find(x=>x.name===name),nameInput=document.getElementById("admin-player-name"),handleInput=document.getElementById("admin-player-handle"),button=document.getElementById("admin-add-player-btn"),cancel=document.getElementById("admin-cancel-player-edit"),status=document.getElementById("admin-player-status");
 if(!p)return;
 const used=playerIsUsed(p.name);
 nameInput.value=p.name;handleInput.value=p.handle;nameInput.disabled=used;button.textContent="Enregistrer les modifications";button.dataset.editName=p.name;cancel.hidden=false;
 status.textContent=used?"Ce streamer est déjà utilisé : son nom est verrouillé pour préserver les anciennes données.":"Modifie le nom ou le pseudo Twitch puis enregistre.";
 nameInput.focus();
}
async function addAdminPlayer(){
  if(!requireAdmin())return;
  const nameInput=document.getElementById("admin-player-name"),handleInput=document.getElementById("admin-player-handle"),button=document.getElementById("admin-add-player-btn"),status=document.getElementById("admin-player-status");
  const oldName=button.dataset.editName||"",name=nameInput.value.trim(),handle=handleInput.value.trim().replace(/^@+/,"");
  if(!name||!handle){status.textContent="Renseigne le nom affiché et le pseudo Twitch.";return}
  const exists=PLAYERS.some(p=>{const same=p.name.toLowerCase()===oldName.toLowerCase();return !same&&(p.name.toLowerCase()===name.toLowerCase()||p.handle.toLowerCase()===handle.toLowerCase())});
  if(exists){status.textContent="Ce nom ou ce pseudo Twitch existe déjà.";return}
  button.disabled=true;
  try{
    if(oldName){
      const p=PLAYERS.find(x=>x.name===oldName);if(!p){resetAdminPlayerForm();return}
      const used=playerIsUsed(oldName);
      if(used&&name!==oldName){status.textContent="Impossible de renommer ce streamer car il est déjà utilisé dans des données.";return}
      p.name=name;p.handle=handle;
      const saved=await updateAdminPlayerInSupabase(p);
      p.id=saved.id;p.source=saved.source||p.source||"integrated";
      if(name!==oldName){
        RECORDS.forEach(r=>{if(r.p===oldName)r.p=name;if(Array.isArray(r.kills))r.kills=r.kills.map(k=>k===oldName?name:k);if(typeof r.death==="string")r.death=r.death.split(oldName).join(name)});
        Object.keys(SESSION_PARTICIPANTS).forEach(id=>{if(Array.isArray(SESSION_PARTICIPANTS[id]))SESSION_PARTICIPANTS[id]=SESSION_PARTICIPANTS[id].map(n=>n===oldName?name:n)});
        if(currentPlayer===oldName)currentPlayer=name;
      }
      refreshSessionSelectors();syncEntryPlayerOptions();refreshEventPlayerOptions();renderAll();renderAdmin();resetAdminPlayerForm();
      status.textContent=`${name} a été modifié dans Supabase.`;return;
    }
    const saved=await insertAdminPlayerToSupabase({name,handle,active:true});
    PLAYERS.push({id:saved.id,name:saved.name,handle:saved.handle,active:saved.active,source:saved.source});
    refreshSessionSelectors();syncEntryPlayerOptions();refreshEventPlayerOptions();renderAll();renderAdmin();resetAdminPlayerForm();
    status.textContent=`${name} a été ajouté dans Supabase.`;
  }catch(error){status.textContent="Erreur Supabase : "+error.message}
  finally{button.disabled=false}
}
async function toggleAdminPlayer(name){
  if(!requireAdmin())return;
  const p=PLAYERS.find(x=>x.name===name),status=document.getElementById("admin-player-status");if(!p)return;
  const previous=p.active;p.active=p.active===false;
  try{
    await toggleAdminPlayerInSupabase(p);refreshSessionSelectors();syncEntryPlayerOptions();refreshEventPlayerOptions();renderAll();renderAdmin();
    status.textContent=p.active?`${name} est de nouveau actif.`:`${name} est maintenant inactif. Il reste visible dans l’historique.`;
  }catch(error){p.active=previous;status.textContent="Erreur Supabase : "+error.message}
}
async function deleteAdminPlayer(name){
  if(!requireAdmin())return;
  const status=document.getElementById("admin-player-status"),p=PLAYERS.find(x=>x.name===name);if(!p)return;
  const used=playerIsUsed(name);
  const warning=used?`\\n\\nCette suppression retirera aussi ${name} de ses anciennes statistiques, parties et listes de participants. Les autres joueurs conserveront leurs données, mais les références à ${name} seront supprimées.\\n\\nCette action est irréversible. Continuer ?`:`\\n\\nSupprimer ${name} de la liste des streamers ?`;
  if(!confirm(warning))return;
  try{
    await deleteAdminPlayerInSupabase(p);await reloadPublicData();
    status.textContent=used?`${name} et ses données historiques ont été supprimés de Supabase.`:`${name} a été supprimé de Supabase.`;
  }catch(error){status.textContent="Erreur Supabase : "+error.message}
}

function deleteCrewtestGame(gameId){
  if(!TEST_MODE||!requireAdmin())return;
  const game=GAMES.find(function(g){return g.id===gameId});
  if(!game)return;
  const sessionId=game.session;
  const label=(SESSIONS[sessionId]&&SESSIONS[sessionId].label)||sessionId;
  const recordCount=RECORDS.filter(function(r){return r.gameId===gameId}).length;
  if(!window.confirm("Supprimer entièrement la Game "+game.n+" du "+label+" ?\n\n"+recordCount+" fiche(s) joueur seront supprimée(s), ainsi que les empreintes JSON associées.\n\nCette action est irréversible."))return;

  RECORDS=RECORDS.filter(function(r){return r.gameId!==gameId});
  GAMES=GAMES.filter(function(g){return g.id!==gameId});

  for(const key of Object.keys(TEST_IMPORTS)){
    const info=TEST_IMPORTS[key];
    if(!info)continue;
    const sameFingerprint=info.fingerprint===game.fingerprint||
      (Array.isArray(info.fingerprints)&&info.fingerprints.includes(game.fingerprint));
    const sameLegacy=info.sessionId===sessionId&&Number(info.gameNumber)===Number(game.n);
    if(sameFingerprint||sameLegacy)delete TEST_IMPORTS[key];
  }

  crewtestRenumberSession(sessionId);
  crewtestSaveState();
  crewtestRefreshAll(sessionId);
}

function renderAdmin(){
  if(!editorCanWrite()){renderAdminAccess();return}
  const isAdmin=adminCanWrite();
  const adminOnly=document.getElementById("admin-only-tools");
  if(adminOnly)adminOnly.hidden=!isAdmin;
  if(isAdmin){renderAdminPlayers();renderAdminSessions();renderAdminParticipants()}
  const box=document.getElementById("admin-list"),sorted=[...RECORDS].sort((a,b)=>b.session.localeCompare(a.session)||b.g-a.g||a.p.localeCompare(b.p));
  const gameButtons=new Set();
  box.innerHTML=sorted.map(r=>{
    const idx=RECORDS.indexOf(r),g=gameFor(r);
    const deleteButton=isAdmin?`<button class="danger admin-delete-record" data-i="${idx}" type="button">Supprimer fiche</button>`:"";
    let deleteGameButton="";
    if(TEST_MODE&&isAdmin&&g&&!gameButtons.has(g.id)){
      gameButtons.add(g.id);
      deleteGameButton=`<button class="danger admin-delete-game" data-game-id="${esc(g.id)}" type="button">Supprimer la game</button>`;
    }
    return `<div class="admin-item"><div><strong>${esc(r.p)} • ${esc(SESSIONS[r.session]?.label||r.session)} • Game ${r.g}</strong><small>${esc(g?.map||"—")} • ${esc(r.role)} • ${resultFor(r)}</small></div><div class="admin-item-actions"><button class="secondary admin-edit-record" data-i="${idx}" type="button">Modifier</button>${deleteButton}${deleteGameButton}</div></div>`;
  }).join("");
  box.querySelectorAll(".admin-edit-record").forEach(b=>b.addEventListener("click",()=>editRecordFromAdmin(Number(b.dataset.i))));
  if(isAdmin)box.querySelectorAll(".admin-delete-record").forEach(b=>b.addEventListener("click",()=>deleteAdminRecord(Number(b.dataset.i))));
  if(TEST_MODE&&isAdmin)box.querySelectorAll(".admin-delete-game").forEach(b=>b.addEventListener("click",()=>deleteCrewtestGame(b.dataset.gameId)));
}
async function deleteAdminRecord(index){
  if(!requireAdmin())return;
  const r=RECORDS[index];if(!r)return;
  if(!confirm(`Supprimer la fiche de ${r.p}, Game ${r.g} du ${SESSIONS[r.session]?.label||r.session} ?\n\nCette action est irréversible.`))return;

  if(TEST_MODE){
    const gameId=r.gameId;
    RECORDS.splice(index,1);

    const stillHasRecords=RECORDS.some(x=>x.gameId===gameId);
    if(!stillHasRecords){
      const game=GAMES.find(g=>g.id===gameId);
      if(game?.fingerprint){
        delete TEST_IMPORTS[game.fingerprint];
      }else{
        for(const [fp,info] of Object.entries(TEST_IMPORTS)){
          if(info?.sessionId===r.session&&Number(info?.gameNumber)===Number(r.g))delete TEST_IMPORTS[fp];
        }
      }
      GAMES=GAMES.filter(g=>g.id!==gameId);
      crewtestRenumberSession(r.session);
    }

    crewtestSaveState();
    crewtestRefreshAll(r.session);
    return;
  }

  try{
    await adminDeleteRecordInSupabase(r.id);
    await reloadPublicData();
  }catch(error){
    alert("Erreur Supabase : "+error.message);
  }
}

document.getElementById("account-setup-form")?.addEventListener("submit",handleAccountSetup);
if(!TEST_MODE){
  supabaseClient.auth.onAuthStateChange((event,session)=>{
    if(event==="PASSWORD_RECOVERY")authSetupRequested=true;
    setTimeout(()=>refreshAdminAuth(session||null),0);
  });
}
document.getElementById("admin-add-session-btn").addEventListener("click",addAdminSession);document.getElementById("admin-participant-session").addEventListener("change",renderAdminParticipants);document.getElementById("clear-participants-btn").addEventListener("click",clearAdminParticipants);document.getElementById("save-participants-btn").addEventListener("click",saveAdminParticipants);document.getElementById("admin-add-player-btn").addEventListener("click",addAdminPlayer);document.getElementById("admin-cancel-player-edit").addEventListener("click",resetAdminPlayerForm);
document.getElementById("admin-reset").addEventListener("click",async()=>{
  if(!requireEditor())return;
  if(TEST_MODE){
    crewtestLoadState();
    crewtestRefreshAll();
    const status=document.getElementById("admin-manage-session-status");
    if(status&&!status.closest("#admin-only-tools")?.hidden)status.textContent="Données locales CREWTEST rechargées.";
    return;
  }
  try{
    await reloadPublicData();
    const status=document.getElementById("admin-manage-session-status");
    if(status&&!status.closest("#admin-only-tools")?.hidden)status.textContent="Données rechargées depuis Supabase.";
  }catch(error){alert("Erreur Supabase : "+error.message)}
});
/* ===== Initialisation et rendu global ===== */
function renderAll(){renderStats();renderSessions();renderPlayerList();syncPlayerMonth();renderPlayerTabs();renderPlayer()}
async function startApp(){

  if(TEST_MODE){
    authLoading=false;
    authUser={email:"crewtest@local"};
    authRole="admin";

    crewtestLoadState();
    const renumbered=crewtestRenumberAll();
    if(renumbered.length)crewtestSaveState();
    crewtestRecalculateImportedRepairs();
    crewtestRecalculateImportedVotes();

    const entryNav=document.querySelector('.nav[data-view="entry"]');
    if(entryNav)entryNav.hidden=false;

    refreshSessionSelectors();
    initEntry();
    renderAll();
    renderAdminAccess();
    if(adminCanWrite())renderAdmin();
    crewtestInitImporter();

    return;
  }

  try{
    await loadFromSupabase();
  }catch(error){
    console.error("Crew'mong Us : impossible de charger les données Supabase.",error);

    const main=document.querySelector("main");

    if(main){
      main.innerHTML=`
        <section class="view active">
          <article class="panel">
            <div class="section-title">
              <span class="section-icon">!</span>
              <h2>Données indisponibles</h2>
            </div>
            <p>Impossible de charger les données depuis Supabase.</p>
          </article>
        </section>
      `;
    }

    return;
  }

  refreshSessionSelectors();
  initEntry();
  renderAll();
  await refreshAdminAuth();
}

startApp();
