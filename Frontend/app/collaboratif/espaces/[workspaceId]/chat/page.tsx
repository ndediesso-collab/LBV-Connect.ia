"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Bell, Check, ChevronLeft, FileText, Menu, MessageCircle, MessagesSquare,
  Paperclip, Plus, RefreshCcw, Send, Settings, ShieldCheck, Sparkles, Users, Wallet, X } from "lucide-react";
import { collabRequest, collabSupabase, COLLAB_API_URL } from "@/lib/collaboratif-api";

type Person = { user_id: string; role: "owner" | "member"; status: string; first_name: string; last_name: string; avatar_key?: string };
type Group = { id: string; title: string; description?: string; archived: boolean; message_count: number; message_limit: number; pending_ai_slots?: number; updated_at: string };
type Direct = { id: string; counterpart_user_id: string; first_name: string; last_name: string; display_name?: string; read_only?: boolean; updated_at: string; last_message?: string | null };
type PrivateAi = { id: string; title: string; member_user_id: string; updated_at: string };
type Context = { workspace_id: string; member_user_id: string; name: string; is_owner: boolean; pack_active: boolean; role: string; profile?: { first_name: string; last_name: string; avatar_key: string } };
type Boot = { success: boolean; workspace_id: string; context: Context; general_group_id?: string | null; groups: Group[]; profiles: Person[]; privates: PrivateAi[]; directs: Direct[]; unread: number };
type RoomKind = "group" | "direct" | "private";
type Selection = { kind: RoomKind; id: string };
type Message = { id: string; sender_user_id?: string | null; sender_kind?: string; role?: string; content: string; created_at: string };
type FileLink = { id: string; message_id: string; original_name: string; mime_type: string; size_bytes: number };
type CollabModelOption = { id: string; label: string; reasoning_modes?: string[] };
type CollabModelResponse = { success: boolean; workspace_id: string;
  provider: "openai" | "openrouter"; models: string[];
  model_catalog?: CollabModelOption[]; reasoning_modes?: string[];
  group_ai_enabled?: boolean; private_ai_enabled?: boolean };
const reasoningLabels: Record<string,string> = { fast:"Rapide", balanced:"Équilibré", deep:"Approfondi" };
type Notices = { success: boolean; workspace_id: string; unread: number; notifications: { id: number; actor_user_id: string; event_type: string; created_at: string; read_at?: string | null }[] };
const input = "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-foreground/15";
const smallButton = "rounded-xl border border-border bg-surface px-3 py-2 text-sm transition hover:bg-surface-secondary disabled:opacity-40";
const darkButton = "rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-background disabled:opacity-40";
const mentionOria = /(^|[^\w])@oria(?!\w)/i;
const date = (value: string) => { try { return new Date(value).toLocaleTimeString("fr-GA", {hour:"2-digit",minute:"2-digit"}); } catch { return ""; } };
const name = (p: { first_name?: string | null; last_name?: string | null }) => [p.first_name,p.last_name].filter(Boolean).join(" ").trim() || "Collaborateur";
const merge = (old: Message[], incoming: Message[]) => {
  const map = new Map<string,Message>();
  [...old,...incoming].forEach(m => map.set(m.id,m));
  return [...map.values()].sort((a,b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
};

export default function OriaCollaboratifChat() {
  const params = useParams();
  const space = typeof params.workspaceId === "string" ? params.workspaceId : "";
  const root = `/collaboratif/workspaces/${encodeURIComponent(space)}`;
  const hub = `${root}/hub`;
  const [boot, setBoot] = useState<Boot | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [files, setFiles] = useState<FileLink[]>([]);
  const [before, setBefore] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [modelCatalog, setModelCatalog] = useState<CollabModelOption[]>([]);
  const [provider, setProvider] = useState<"openai" | "openrouter" | null>(null);
  const [groupAiEnabled, setGroupAiEnabled] = useState(false);
  const [privateAiEnabled, setPrivateAiEnabled] = useState(false);
  const [mode, setMode] = useState("balanced");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<Notices | null>(null);
  const [newKind, setNewKind] = useState<"group" | "direct" | "private" | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newPerson, setNewPerson] = useState("");
  const [showGroupMember, setShowGroupMember] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState("");
  const [pendingAi, setPendingAi] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<Selection | null>(null);
  const latestLoad = useRef(0);

  const names = useMemo(() => new Map((boot?.profiles ?? []).map(p => [p.user_id, name(p)])), [boot?.profiles]);
  const ownId = boot?.context.member_user_id ?? "";
  const groups = boot?.groups ?? [];
  const directs = boot?.directs ?? [];
  const privates = (boot?.privates ?? []).filter(p => p.member_user_id === ownId && !boot?.context.is_owner);
  const currentGroup = selection?.kind === "group" ? groups.find(g=>g.id===selection.id) : undefined;
  const currentDirect = selection?.kind === "direct" ? directs.find(d=>d.id===selection.id) : undefined;
  const currentPrivate = selection?.kind === "private" ? privates.find(p=>p.id===selection.id) : undefined;
  const title = currentGroup?.title || (currentDirect ? (currentDirect.display_name || name(currentDirect)) : "") || currentPrivate?.title || "Sélectionnez une conversation";
  const canWrite = boot?.context.pack_active === true && !currentGroup?.archived && !currentDirect?.read_only;

  const refreshBoot = useCallback(async (preserve = true) => {
    const value = await collabRequest<Boot>(`${hub}/boot`);
    if (!value.success || value.workspace_id !== space || value.context.workspace_id !== space) throw new Error("Réponse provenant d'un autre espace.");
    setBoot(value);
    if (!preserve) {
      const first = value.general_group_id || value.groups.find(g=>!g.archived)?.id;
      if (first) {
        const next: Selection = { kind: "group", id: first };
        selectedRef.current = next;setSelection(next);
      }
    }
  }, [hub,space]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void collabRequest<Boot>(`${hub}/boot`).then(value => {
      if (!active) return;
      if (!value.success || value.workspace_id !== space || value.context.workspace_id !== space) throw new Error("Espace inaccessible.");
      setBoot(value);
      const first = value.general_group_id || value.groups.find(g=>!g.archived)?.id;
      if (first) {
        const next: Selection = {kind:"group",id:first};
        selectedRef.current=next;setSelection(next);
      }
    }).catch(e=>{ if(active) setError(e instanceof Error?e.message:"Chargement indisponible."); })
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  }, [hub,space]);

  useEffect(() => {
    let alive = true;
    void collabRequest<CollabModelResponse>(`${root}/ai/models`).then(value=>{
      if (!alive) return;
      if (value.workspace_id!==space || value.success!==true ||
          (value.provider!=="openai" && value.provider!=="openrouter"))
        throw new Error("Catalogue fournisseur invalide pour cet espace.");
      const catalog = Array.isArray(value.model_catalog) ? value.model_catalog.filter(item =>
        item && typeof item.id==="string" && typeof item.label==="string" &&
        Array.isArray(value.models) && value.models.includes(item.id) &&
        (value.provider==="openrouter" || !item.id.startsWith("claude-"))) : [];
      // Ne jamais deviner un modele ou un fournisseur depuis le navigateur.
      const list = catalog.map(item=>item.id);
      setProvider(value.provider);
      setModelCatalog(catalog);setModels(list);
      setGroupAiEnabled(value.group_ai_enabled===true);
      setPrivateAiEnabled(value.private_ai_enabled===true);
      setModel(m=>list.includes(m)?m:(list[0]??""));
    }).catch(e=>{if(alive){setModels([]);setModelCatalog([]);setProvider(null);
      setGroupAiEnabled(false);setPrivateAiEnabled(false);
      setError(e instanceof Error?e.message:"Catalogue de modeles indisponible.");}});
    return ()=>{alive=false;};
  }, [root,space]);

  const load = useCallback(async (picked: Selection, older = false, cursor?: string) => {
    const seq=++latestLoad.current;
    const query=new URLSearchParams({limit:"70"});
    if (older && cursor) query.set("before",cursor);
    const uri=picked.kind==="group" ? `${hub}/groups/${picked.id}/messages?${query}`
      : picked.kind==="direct" ? `${hub}/direct/${picked.id}/messages?${query}`
      : `${root}/scope/private/conversations/${picked.id}/messages`;
    const data=await collabRequest<{success:boolean;workspace_id:string;messages:Message[]}>(uri);
    if(data.workspace_id!==space) throw new Error("Messages d'un autre espace refusés.");
    const current=selectedRef.current;
    if(seq!==latestLoad.current || !current || current.kind!==picked.kind || current.id!==picked.id)return;
    const incoming=Array.isArray(data.messages)?data.messages:[];
    setMessages(previous=>merge(older?previous:previous,incoming));
    if(!older)setBefore(incoming.length>=70?incoming[0].id:null);
    else setBefore(incoming.length>=70?incoming[0].id:null);
    if(picked.kind!=="private"){
      try{
        const result=await collabRequest<{workspace_id:string;room_id:string;files:FileLink[]}>(`${hub}/rooms/${picked.kind}/${picked.id}/files`);
        if(result.workspace_id===space && result.room_id===picked.id && selectedRef.current?.id===picked.id)setFiles(result.files??[]);
      }catch{/* Messages stay available even if attachment service fails. */}
    } else setFiles([]);
  }, [hub,root,space]);

  useEffect(()=>{
    if(!selection)return;
    setMessages([]);setFiles([]);setBefore(null);setError("");setPendingAi(false);
    selectedRef.current=selection;
    void load(selection).catch(e=>setError(e instanceof Error?e.message:"Historique indisponible."));
  },[selection,load]);

  useEffect(()=>{
    const interval=window.setInterval(()=>{
      if(document.visibilityState!=="visible"||busy)return;
      const current=selectedRef.current;
      if(current)void load(current).catch(()=>{});
      void refreshBoot().catch(()=>{});
    },5000);
    return ()=>window.clearInterval(interval);
  },[busy,load,refreshBoot]);

  useEffect(()=>{
    if(viewRef.current)viewRef.current.scrollTop=viewRef.current.scrollHeight;
  },[messages.length,selection?.id]);

  function pick(kind:RoomKind,id:string){
    selectedRef.current={kind,id};setSelection({kind,id});setSidebarOpen(false);
    setDraft("");setNotice("");setShowGroupMember(false);
  }

  async function submit(event?:FormEvent) {
    event?.preventDefault();
    const current=selectedRef.current;
    if(!current||busy||pendingAi||!canWrite||!draft.trim())return;
    const content=draft.trim();
    const ai = current.kind==="private" || (current.kind==="group" && mentionOria.test(content));
    if(ai && (!provider || !models.includes(model))){setError("Aucun modèle IA autorisé pour le fournisseur actif.");return;}
    if(ai && current.kind==="group" && !groupAiEnabled){setError("@ORIA n'est pas encore activé dans les groupes de cet espace. Les messages entre collègues restent disponibles.");return;}
    if(ai && current.kind==="private" && !privateAiEnabled){setError("Le chat IA privé professionnel n'est pas activé dans cet espace.");return;}
    const selectedModes = modelCatalog.find(item=>item.id===model)?.reasoning_modes ?? [];
    if(ai && !selectedModes.includes(mode)){setError("Ce niveau de raisonnement n'est pas proposé par le modèle sélectionné.");return;}
    setBusy(true);setError("");setNotice("");
    try{
      if(ai){
        const endpoint=current.kind==="group"?`${root}/ai/groups/${current.id}/ask`:`${root}/ai/private/${current.id}/ask`;
        const body=current.kind==="group"?{request_id:crypto.randomUUID(),model,reasoning_mode:mode,prompt:content}
          :{request_id:crypto.randomUUID(),model,reasoning_mode:mode,message:content};
        const result=await collabRequest<{workspace_id:string;success:boolean}>(endpoint,"POST",body);
        if(!result.success||result.workspace_id!==space)throw new Error("Réponse IA d'un autre espace.");
      } else {
        const result=await collabRequest<{workspace_id:string;success:boolean}>(`${hub}/rooms/${current.kind}/${current.id}/messages`,"POST",
          {client_message_id:crypto.randomUUID(),content});
        if(!result.success||result.workspace_id!==space)throw new Error("Message non confirmé.");
      }
      setDraft("");await load(current);await refreshBoot();
    }catch(e){
      setError(e instanceof Error?e.message:"Envoi impossible.");
      // Seul un refus apres appel fournisseur potentiellement facture bloque un retry.
      // Les erreurs de catalogue, de flags et de pack ne doivent pas figer la saisie.
      if(ai && /incertain|réservés|réservé pour|rapproch|vérification.*débit/i.test(e instanceof Error?e.message:"")){
        setPendingAi(true);
        setNotice("Demande IA possiblement facturée : vérifie l'historique avant de relancer.");
      }
    }finally{setBusy(false);}
  }

  async function uploadFile(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0];const current=selectedRef.current;
    event.target.value="";
    if(!file||!current||current.kind==="private"||!canWrite||busy)return;
    if(file.size===0||file.size>8*1024*1024){setError("Fichier limité à 8 Mo.");return;}
    setBusy(true);setError("");
    try{
      const {data:{session}}=await collabSupabase.auth.getSession();
      if(!session?.access_token||!session.user.id)throw new Error("Session ORIA expirée.");
      const body=new FormData();body.append("file",file,file.name);
      const response=await fetch(`${COLLAB_API_URL}${hub}/rooms/${current.kind}/${current.id}/files`,{
        method:"POST",headers:{authorization:`Bearer ${session.access_token}`,"user-id":session.user.id},body,
      });
      const result:unknown=await response.json().catch(()=>({}));
      if(!response.ok){
        const detail=typeof result==="object"&&result!==null&&"detail" in result?(result as {detail:unknown}).detail:null;
        throw new Error(typeof detail==="string"?detail:"Envoi du fichier refusé.");
      }
      if(typeof result!=="object"||result===null||!("workspace_id" in result)||result.workspace_id!==space)throw new Error("Réponse du mauvais espace.");
      await load(current);await refreshBoot();
    }catch(e){setError(e instanceof Error?e.message:"Fichier non confirmé, ne pas renvoyer immédiatement.");}
    finally{setBusy(false);}
  }

  async function openFile(file:FileLink){
    try{
      const result=await collabRequest<{success:boolean;workspace_id:string;file_id:string;url:string}>(`${hub}/files/${file.id}/url`);
      if(!result.success||result.workspace_id!==space||result.file_id!==file.id||!result.url.startsWith("https://"))throw new Error("Fichier inaccessible.");
      window.open(result.url,"_blank","noopener,noreferrer");
    }catch(e){setError(e instanceof Error?e.message:"Téléchargement refusé.");}
  }

  async function create(){
    if(!newKind||busy)return;
    setBusy(true);setError("");
    try{
      let result:{workspace_id:string;group_id?:string;thread_id?:string;conversation_id?:string;success:boolean};
      if(newKind==="group")result=await collabRequest(`${root}/actions/groups`,"POST",{title:newTitle.trim(),description:""});
      else if(newKind==="direct")result=await collabRequest(`${hub}/direct/open`,"POST",{other_user_id:newPerson});
      else result=await collabRequest(`${root}/actions/private/conversations`,"POST",{title:newTitle.trim()});
      if(!result.success||result.workspace_id!==space)throw new Error("Création non confirmée.");
      const id=result.group_id||result.thread_id||result.conversation_id;
      if(!id)throw new Error("Identifiant de conversation absent.");
      setNewKind(null);setNewPerson("");setNewTitle("");await refreshBoot();pick(newKind,id);
    }catch(e){setError(e instanceof Error?e.message:"Création impossible.");}
    finally{setBusy(false);}
  }

  async function updateGroupMember(add:boolean){
    if(!selectedPerson||!currentGroup||busy)return;
    setBusy(true);setError("");
    try{
      const data=await collabRequest<{workspace_id:string;success:boolean}>(`${root}/actions/groups/${currentGroup.id}/participants`,"POST",{member_user_id:selectedPerson,add});
      if(!data.success||data.workspace_id!==space)throw new Error("Membre non confirmé.");
      setNotice(add?"Membre ajouté.":"Membre retiré.");setSelectedPerson("");setShowGroupMember(false);
    }catch(e){setError(e instanceof Error?e.message:"Modification impossible.");}
    finally{setBusy(false);}
  }

  async function showNotices(){
    setShowNotifications(v=>!v);
    try{
      const data=await collabRequest<Notices>(`${hub}/notifications`);
      if(data.workspace_id===space)setNotifications(data);
    }catch(e){setError(e instanceof Error?e.message:"Notifications indisponibles.");}
  }
  async function readNotices(){
    try{
      const result=await collabRequest<{workspace_id:string;success:boolean}>(`${hub}/notifications/read`,"POST",{});
      if(!result.success||result.workspace_id!==space)throw new Error("Notifications non confirmées.");
      setShowNotifications(false);setNotifications(null);await refreshBoot();
    }catch(e){setError(e instanceof Error?e.message:"Lecture non confirmée.");}
  }

  const fileByMessage = useMemo(()=>{
    const index=new Map<string,FileLink[]>();files.forEach(f=>index.set(f.message_id,[...(index.get(f.message_id)??[]),f]));return index;
  },[files]);
  const members=boot?.profiles.filter(p=>p.status==="active")??[];
  const peers=members.filter(p=>p.user_id!==ownId);

  return <main className="flex h-dvh min-h-[480px] w-full overflow-hidden bg-background text-foreground oria-chat-page">
    {/* Navigation identique à l'esprit du chat ORIA : colonne conversations + fil central. */}
    <aside className={`${sidebarOpen?"flex":"hidden"} w-full shrink-0 flex-col border-r border-border bg-surface sm:flex sm:w-[320px] lg:w-[345px]`}>
      <div className="border-b border-border px-4 pb-4 pt-5">
        <div className="flex items-center justify-between gap-2">
          <Link href="/collaboratif/espaces" className="flex min-w-0 items-center gap-2 font-semibold"><ArrowLeft size={18}/><span className="truncate">{boot?.context.name??"ORIA Collaboratif"}</span></Link>
          <div className="flex items-center gap-1">
            <button title="Notifications" className="relative rounded-lg p-2 hover:bg-surface-secondary" onClick={()=>void showNotices()}><Bell size={19}/>{(boot?.unread??0)>0&&<span className="absolute -right-1 -top-1 rounded-full bg-foreground px-1.5 text-[10px] text-background">{boot?.unread}</span>}</button>
            <button title="Actualiser" className="rounded-lg p-2 hover:bg-surface-secondary" onClick={()=>{void refreshBoot();if(selection)void load(selection);setPendingAi(false);}}><RefreshCcw size={18}/></button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className="inline-flex items-center gap-1"><ShieldCheck size={13}/> {boot?.context.is_owner?"Administrateur":"Membre"}</span>
          <Link className="underline hover:text-foreground" href="/chat">Mon ORIA</Link>
          <Link className="underline hover:text-foreground" href={`${root.replace('/collaboratif/workspaces/','/collaboratif/espaces/')}/finances`}>Crédits</Link>
          {boot?.context.is_owner&&<Link className="underline hover:text-foreground" href={`/collaboratif/invitations-email?workspace=${encodeURIComponent(space)}`}>Inviter</Link>}
          <Link href={`/collaboratif/espaces/${encodeURIComponent(space)}`} title="Réglages et membres"><Settings size={15}/></Link>
        </div>
      </div>
      {showNotifications && <div className="max-h-60 overflow-y-auto border-b border-border p-4 text-xs">
        <div className="mb-3 flex items-center justify-between"><strong>Notifications</strong><button className="underline" onClick={()=>void readNotices()}>Tout marquer lu</button></div>
        {(notifications?.notifications??[]).slice(0,15).map(n=><div className="border-b border-border py-2" key={n.id}>{n.event_type==="direct_message"?"Message privé":"Message de groupe"} · {names.get(n.actor_user_id)??"Collaborateur"} · {date(n.created_at)}{!n.read_at&&<span className="ml-1">•</span>}</div>)}
        {!notifications?.notifications?.length&&<p>Aucune notification.</p>}
      </div>}
      <div className="flex-1 space-y-5 overflow-y-auto p-3">
        <div>
          <div className="flex items-center justify-between px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-muted"><span className="flex items-center gap-1.5"><MessagesSquare size={15}/> Groupes</span>{boot?.context.is_owner&&<button aria-label="Créer un groupe" onClick={()=>setNewKind("group")}><Plus size={17}/></button>}</div>
          {groups.map(g=><button key={g.id} onClick={()=>pick("group",g.id)} className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${selection?.kind==="group"&&selection.id===g.id?"bg-surface-secondary":"hover:bg-surface-secondary"}`}><span className="grid size-9 shrink-0 place-items-center rounded-full bg-foreground text-sm text-background">#</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{g.title}</span><span className="block truncate text-xs text-muted">{g.archived?"Archivé":`${g.message_count.toLocaleString("fr-GA")} messages`}</span></span></button>)}
          {!groups.length&&<p className="px-2 text-xs text-muted">Aucun groupe pour le moment.</p>}
        </div>
        <div>
          <div className="flex items-center justify-between px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-muted"><span className="flex items-center gap-1.5"><MessageCircle size={15}/> Entre collègues</span><button aria-label="Nouvelle discussion entre collègues" onClick={()=>setNewKind("direct")}><Plus size={17}/></button></div>
          {directs.map(t=><button key={t.id} onClick={()=>pick("direct",t.id)} className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${selection?.kind==="direct"&&selection.id===t.id?"bg-surface-secondary":"hover:bg-surface-secondary"}`}><span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-secondary font-medium">{name(t).slice(0,1)}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{t.display_name || name(t)}</span><span className="block truncate text-xs text-muted">{t.read_only?"Supervision · lecture seule":(t.last_message??"Discussion privée")}</span></span></button>)}
        </div>
        <div>
          <div className="flex items-center justify-between px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-muted"><span className="flex items-center gap-1.5"><Sparkles size={15}/> Mes chats ORIA</span>{boot?.context.is_owner?<Link aria-label="Ouvrir mon ORIA personnel" href="/chat"><ChevronLeft size={17} className="rotate-180"/></Link>:<button aria-label="Nouveau chat ORIA" onClick={()=>setNewKind("private")}><Plus size={17}/></button>}</div>
          {boot?.context.is_owner&&<p className="px-2 text-xs text-muted">Le propriétaire utilise son chat ORIA personnel avec son quota.</p>}{privates.map(p=><button key={p.id} onClick={()=>pick("private",p.id)} className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${selection?.kind==="private"&&selection.id===p.id?"bg-surface-secondary":"hover:bg-surface-secondary"}`}><span className="grid size-9 shrink-0 place-items-center rounded-full border border-border"><Sparkles size={17}/></span><span className="truncate text-sm">{p.title}</span></button>)}
        </div>
      </div>
      <div className="flex flex-wrap gap-3 border-t border-border p-3 text-xs text-muted"><Link href={`/collaboratif/espaces/${encodeURIComponent(space)}/actions`} className="inline-flex items-center gap-1 underline"><Wallet size={14}/> Gestion et paiements</Link><Link href="/collaboratif/espaces" className="underline">Changer d'espace</Link></div>
    </aside>

    <section className={`${sidebarOpen?"hidden":"flex"} min-w-0 flex-1 flex-col sm:flex`}>
      <header className="flex min-h-[74px] items-center gap-3 border-b border-border bg-surface px-4">
        <button className="rounded-lg p-2 hover:bg-surface-secondary sm:hidden" aria-label="Afficher les conversations" onClick={()=>setSidebarOpen(true)}><Menu size={19}/></button>
        <span className="grid size-10 shrink-0 place-items-center rounded-full border border-border">{selection?.kind==="private"?<Sparkles size={21}/>:selection?.kind==="group"?<Users size={20}/>:<MessageCircle size={20}/>}</span>
        <div className="min-w-0 flex-1"><h1 className="truncate font-semibold">{title}</h1><p className="text-xs text-muted">{selection?.kind==="group"?`${currentGroup?.message_count??0} / ${currentGroup?.message_limit??20000} messages · groupe` : selection?.kind==="direct"?(currentDirect?.read_only?"Supervision professionnelle · lecture seule":"Conversation professionnelle privée"):selection?.kind==="private"?"Chat professionnel avec ORIA":"Messages professionnels"}</p></div>
        {boot?.context.is_owner&&selection?.kind==="group"&&<button className={smallButton} onClick={()=>setShowGroupMember(v=>!v)} title="Gérer les participants"><Users size={17}/></button>}
      </header>
      {!boot?.context.pack_active&&<div className="border-b border-border px-5 py-3 text-xs">Le pack de l'administrateur est inactif : historiques consultables, nouveaux messages bloqués.</div>}
      {error&&<div role="alert" className="mx-4 mt-3 flex items-start justify-between gap-2 rounded-xl border border-border bg-surface p-3 text-sm"><span>{error}</span><button onClick={()=>setError("")} aria-label="Fermer"><X size={16}/></button></div>}
      {notice&&<div role="status" className="mx-4 mt-3 rounded-xl border border-border bg-surface p-3 text-xs">{notice}</div>}
      {showGroupMember&&currentGroup&&<div className="flex flex-wrap items-end gap-2 border-b border-border p-3 text-xs"><label className="flex-1">Participant<select className={`${input} mt-1`} value={selectedPerson} onChange={e=>setSelectedPerson(e.target.value)}><option value="">Sélectionner</option>{peers.map(p=><option key={p.user_id} value={p.user_id}>{name(p)}</option>)}</select></label><button className={smallButton} disabled={!selectedPerson||busy} onClick={()=>void updateGroupMember(true)}>Ajouter</button><button className={smallButton} disabled={!selectedPerson||busy} onClick={()=>void updateGroupMember(false)}>Retirer</button></div>}
      <div ref={viewRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-6 sm:px-7" aria-live="polite">
        {!selection&&<div className="grid h-full place-items-center text-center text-muted"><div><Sparkles className="mx-auto mb-3" size={36}/><h2 className="font-semibold">ORIA Collaboratif</h2><p className="mt-2 text-sm">Choisissez un groupe ou une conversation.</p></div></div>}
        {selection&&messages.length===0&&!loading&&<div className="grid h-full place-items-center text-sm text-muted">Aucun message pour le moment.</div>}
        {before&&selection?.kind!=="private"&&<div className="text-center"><button className={smallButton} onClick={()=>{if(selection)void load(selection,true,before);}}>Messages plus anciens</button></div>}
        {messages.map(m=>{
          const mine=(m.role==="user"&&selection?.kind==="private")||(m.sender_user_id!==null&&m.sender_user_id===ownId);
          const oria=m.sender_kind==="oria"||m.role==="assistant";
          const attachments=fileByMessage.get(m.id)??[];
          const speaker=oria?"ORIA":selection?.kind==="private"?"Moi":names.get(m.sender_user_id??"")??"Membre";
          return <div key={m.id} className={`flex ${mine?"justify-end":"justify-start"}`}>
            <article className={`max-w-[88%] break-words rounded-2xl px-4 py-3 text-sm shadow-sm sm:max-w-[76%] ${mine?"rounded-br-sm bg-foreground text-background":"rounded-bl-sm border border-border bg-surface text-foreground"}`}>
              {selection?.kind==="group"&&!mine&&<div className="mb-1 text-xs font-semibold opacity-75">{speaker}</div>}
              {selection?.kind==="private"&&!mine&&<div className="mb-1 flex items-center gap-1 text-xs font-semibold"><Sparkles size={12}/> ORIA</div>}
              <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
              {attachments.map(f=><button key={f.id} className={`mt-2 flex max-w-full items-center gap-2 rounded-lg border px-2 py-2 text-xs underline ${mine?"border-background/30":"border-border"}`} onClick={()=>void openFile(f)}><FileText size={16}/><span className="max-w-[220px] truncate">{f.original_name}</span></button>)}
              <time className="mt-1 block text-right text-[10px] opacity-65">{date(m.created_at)} {mine&&<Check className="ml-0.5 inline" size={11}/>}</time>
            </article>
          </div>;
        })}
      </div>
      {selection&&<div className="border-t border-border bg-surface px-3 py-3 sm:px-6">
        {(selection.kind==="group"||selection.kind==="private")&&<div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted"><span>{selection.kind==="group"?"Écrivez @ORIA pour demander une réponse IA":"Conversation avec ORIA"}</span><div className="flex flex-wrap items-center gap-2"><span className="hidden rounded-full border border-border px-2 py-1 text-[11px] sm:inline">{provider==="openai"?"OpenAI actif":provider==="openrouter"?"OpenRouter actif":"Fournisseur non vérifié"}</span><select aria-label="Modèle IA" className="max-w-[185px] rounded-xl border border-border bg-background px-3 py-2 font-medium text-foreground" value={model} onChange={e=>{setModel(e.target.value);setMode("balanced");}} disabled={!provider||busy}><option value="">Modèle indisponible</option>{modelCatalog.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select><select aria-label="Raisonnement" className="rounded-xl border border-border bg-background px-3 py-2 text-foreground" value={mode} onChange={e=>setMode(e.target.value)} disabled={!provider||busy}>{(modelCatalog.find(item=>item.id===model)?.reasoning_modes??[]).filter(m=>m in reasoningLabels).map(m=><option key={m} value={m}>{reasoningLabels[m]}</option>)}</select></div></div>}
        <form onSubmit={e=>void submit(e)} className="flex items-end gap-2">
          <input ref={fileRef} className="hidden" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.docx,.xlsx,.pptx" onChange={e=>void uploadFile(e)}/>
          {selection.kind!=="private"&&<button type="button" className="rounded-xl p-3 hover:bg-surface-secondary disabled:opacity-40" title="Joindre un fichier (8 Mo max)" aria-label="Joindre un fichier" disabled={busy||!canWrite} onClick={()=>fileRef.current?.click()}><Paperclip size={20}/></button>}
          <textarea className={`${input} min-h-[45px] max-h-40 flex-1 resize-none`} placeholder={selection.kind==="group"?"Message… ou @ORIA pour l'IA":"Écrivez un message…"} rows={1}
            maxLength={selection.kind==="group"?4000:8000} value={draft} disabled={!canWrite||busy||pendingAi}
            onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void submit();}}}/>
          <button aria-label="Envoyer" type="submit" disabled={!draft.trim()||busy||!canWrite||pendingAi} className="grid size-[45px] shrink-0 place-items-center rounded-xl bg-foreground text-background disabled:opacity-40"><Send size={19}/></button>
        </form>
        {busy&&<p className="mt-2 text-xs text-muted" role="status">ORIA prépare sa réponse…</p>}
        {pendingAi&&<button className="mt-2 text-xs underline" onClick={()=>{setPendingAi(false);if(selection)void load(selection);}}>J'ai vérifié l'historique : autoriser une nouvelle question</button>}
      </div>}
    </section>

    {newKind&&<div className="fixed inset-0 z-50 grid place-items-center bg-black/55 px-4"><div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-xl"><div className="flex justify-between gap-2"><h2 className="text-lg font-semibold">{newKind==="group"?"Nouveau groupe":newKind==="direct"?"Nouvelle discussion privée":"Nouveau chat ORIA"}</h2><button aria-label="Fermer" onClick={()=>setNewKind(null)}><X size={18}/></button></div>
      {newKind==="direct"?<select value={newPerson} onChange={e=>setNewPerson(e.target.value)} className={input}><option value="">Choisir un collègue</option>{peers.map(p=><option value={p.user_id} key={p.user_id}>{name(p)}</option>)}</select>:<input aria-label="Nom de conversation" className={input} value={newTitle} onChange={e=>setNewTitle(e.target.value)} maxLength={newKind==="group"?100:120} placeholder={newKind==="group"?"Nom du groupe":"Titre de conversation"}/>}
      <div className="flex justify-end gap-2"><button className={smallButton} onClick={()=>setNewKind(null)}>Annuler</button><button className={darkButton} disabled={busy||(newKind==="direct"?!newPerson:!newTitle.trim())} onClick={()=>void create()}>Créer</button></div>
    </div></div>}
    {loading&&<div role="status" className="fixed inset-0 z-40 grid place-items-center bg-background/90 text-sm">Chargement de votre espace ORIA…</div>}
  </main>;
}
