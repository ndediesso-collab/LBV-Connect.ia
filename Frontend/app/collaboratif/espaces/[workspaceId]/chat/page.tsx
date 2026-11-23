"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Bell, Check, ChevronLeft, FileText, Menu, MessageCircle, MessagesSquare,
  Download, Eye, Paperclip, Plus, RefreshCcw, Send, Settings, ShieldCheck, Sparkles, Users, Wallet, X, Copy, Pencil, Mic, Square, Play } from "lucide-react";
import { collabRequest, collabSupabase, COLLAB_API_URL } from "@/lib/collaboratif-api";
import { OriaRichMessage, type OriaWebIllustration } from "@/components/oria-chat/OriaRichMessage"; // ORIA_COLLAB_P10_SHARED_RICH_RENDERER

type Person = { user_id: string; role: "owner" | "member"; status: string; first_name: string; last_name: string; avatar_key?: string };
type Group = { id: string; title: string; description?: string; archived: boolean; message_count: number; message_limit: number; pending_ai_slots?: number; updated_at: string };
type Direct = { id: string; counterpart_user_id: string; first_name: string; last_name: string; display_name?: string; read_only?: boolean; updated_at: string; last_message?: string | null };
type PrivateAi = { id: string; title: string; member_user_id: string; updated_at: string };
type Context = { workspace_id: string; member_user_id: string; name: string; is_owner: boolean; pack_active: boolean; role: string; profile?: { first_name: string; last_name: string; avatar_key: string } };
type Boot = { success: boolean; workspace_id: string; context: Context; general_group_id?: string | null; groups: Group[]; profiles: Person[]; privates: PrivateAi[]; directs: Direct[]; unread: number };
type RoomKind = "group" | "direct" | "private";
type Selection = { kind: RoomKind; id: string };
type Message = { id: string; sender_user_id?: string | null; sender_kind?: string; role?: string; content: string; created_at: string; edited_at?: string | null; ai_request_id?: string | null };
type FileLink = { id: string; message_id: string; original_name: string; mime_type: string; size_bytes: number; private_ai?: boolean };
type OwnWallet = { success: boolean; workspace_id: string; member_user_id: string;
  personal_balance: number; pack_quota: { available?: number; reserved?: number; spent?: number } };
type DeliveryState = {success: boolean;workspace_id:string;target_id:string;
  request_id:string;state:string;actual_credits?:number|null;
  phase?:string;seq?:number;preview?:string;receipt_ready?:boolean;updated_at?:string};
// ORIA_COLLAB_P9_INLINE_PROGRESS — cet objet est uniquement visuel et n'engage aucun crédit.
type OptimisticGroupMessage = {group:string;request:string;content:string;createdAt:number;ai:boolean};
type RichSource = {url:string;title:string};
type RichItem = {web_images:OriaWebIllustration[];sources:RichSource[]};
type RichPayload = {success:boolean;workspace_id:string;group_id:string;items:Record<string,RichItem>};
type CollabModelOption = { id: string; label: string; reasoning_modes?: string[] };
type CollabModelResponse = { success: boolean; workspace_id: string;
  provider: "openai" | "openrouter"; models: string[];
  model_catalog?: CollabModelOption[]; reasoning_modes?: string[];
  group_ai_enabled?: boolean; private_ai_enabled?: boolean;
  preferences?: { model: string; reasoning_mode: string } | null };
const reasoningLabels: Record<string,string> = { fast:"Rapide", balanced:"Équilibré", deep:"Approfondi" };
type Notices = { success: boolean; workspace_id: string; unread: number; notifications: { id: number; actor_user_id: string; event_type: string; created_at: string; read_at?: string | null }[] };
const input = "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-foreground/15";
const smallButton = "rounded-xl border border-border bg-surface px-3 py-2 text-sm transition hover:bg-surface-secondary disabled:opacity-40";
const darkButton = "rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-background disabled:opacity-40";
const mentionOria = /(^|[^\w])@oria(?!\w)/i;
const generationSteps = ["Envoi", "Préparation", "Génération", "Livraison"] as const;
function generationStep(phase:string,text:string):number {
  if(phase==="starting")return 0;
  if(phase==="provider_complete"||phase==="settled")return 3;
  if(phase==="running"&&Boolean(text))return 2;
  return 1;
}
function generationStatus(phase:string,text:string):string {
  switch(phase){
    case "starting": return "Transmission de votre demande à ORIA…";
    case "reconnecting": return "Retrouvons la génération en cours…";
    case "not_started": return "Vérification et réservation en cours…";
    case "running": return text ? "Réponse en cours de rédaction…" : "ORIA prépare sa réponse avec le modèle sélectionné…";
    case "provider_complete": return "Réponse reçue. Enregistrement et vérification des crédits…";
    case "uncertain": return "Résultat en cours de vérification. Aucun nouvel appel IA.";
    default: return "Traitement en cours…";
  }
}
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
  const [ownWallet, setOwnWallet] = useState<OwnWallet | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [richByRequest,setRichByRequest] = useState<Record<string,RichItem>>({});
  const [files, setFiles] = useState<FileLink[]>([]);
  const [previewFile, setPreviewFile] = useState<{file:FileLink;url:string}|null>(null);
  const [before, setBefore] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [editingId,setEditingId] = useState<string|null>(null);
  const [editText,setEditText] = useState("");
  const [voiceUrls,setVoiceUrls] = useState<Record<string,string>>({});
  const [recording,setRecording] = useState(false);
  const recordingRef = useRef<MediaRecorder|null>(null);
  const recordingStreamRef = useRef<MediaStream|null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingGroupRef = useRef<Selection|null>(null);
  const sendRecordingRef = useRef(false);
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [modelCatalog, setModelCatalog] = useState<CollabModelOption[]>([]);
  const [provider, setProvider] = useState<"openai" | "openrouter" | null>(null);
  const [groupAiEnabled, setGroupAiEnabled] = useState(false);
  const [privateAiEnabled, setPrivateAiEnabled] = useState(false);
  const [mode, setMode] = useState("balanced");
  const [webEnabled,setWebEnabled] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<Notices | null>(null);
  const [newKind, setNewKind] = useState<"group" | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [showGroupMember, setShowGroupMember] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState("");
  const [pendingAi, setPendingAi] = useState(false);
  const [livePreview, setLivePreview] = useState<{group:string;request:string;text:string;phase:string}|null>(null);
  const [optimisticGroupMessage,setOptimisticGroupMessage] = useState<OptimisticGroupMessage|null>(null);
  const monitorRef = useRef<{key:string;abort:AbortController}|null>(null);
  const recoverRef = useRef<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
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

  const refreshOwnWallet = useCallback(async () => {
    if (!ownId || !space) return;
    const result=await collabRequest<OwnWallet>(`${root}/finance/wallet`);
    // Le serveur restreint déjà le wallet ; vérifier en plus l'identité côté UI.
    if (!result.success || result.member_user_id !== ownId || result.workspace_id !== space)
      throw new Error("Solde reçu pour un autre utilisateur ou espace.");
    setOwnWallet(result);
  },[root,space,ownId]);

  useEffect(()=>{
    if(!ownId)return;
    void refreshOwnWallet().catch(()=>setOwnWallet(null));
    const refresh=()=>{if(document.visibilityState==='visible')void refreshOwnWallet().catch(()=>{});};
    const timer=window.setInterval(refresh,12000);
    window.addEventListener('focus',refresh);
    return ()=>{window.clearInterval(timer);window.removeEventListener('focus',refresh);};
  },[ownId,refreshOwnWallet]);

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
      // Les préférences sont par utilisateur + espace ; jamais partagées avec un collègue.
      let local: {model:string;reasoning_mode:string}|null = null;
      try { if (ownId) {
        const saved = localStorage.getItem(`oria-collab-chat:${ownId}:${space}`);
        if (saved) local = JSON.parse(saved);
      }} catch { /* stockages privés parfois indisponibles */ }
      const preferred = value.preferences ?? local;
      const valid = preferred && list.includes(preferred.model) ? preferred.model : (list[0]??"");
      const modes = catalog.find(x=>x.id===valid)?.reasoning_modes ?? [];
      const validMode = preferred && modes.includes(preferred.reasoning_mode)
        ? preferred.reasoning_mode : (modes.includes('balanced') ? 'balanced' : (modes[0]??'balanced'));
      setModel(valid);setMode(validMode);
    }).catch(e=>{if(alive){setModels([]);setModelCatalog([]);setProvider(null);
      setGroupAiEnabled(false);setPrivateAiEnabled(false);
      setError(e instanceof Error?e.message:"Catalogue de modeles indisponible.");}});
    return ()=>{alive=false;};
  }, [root,space,ownId]);

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
    if(picked.kind==='group') {
      const ids=[...new Set(incoming.filter(m=>m.sender_kind==='oria').map(m=>m.id))].slice(0,35);
      if(ids.length) {
        void collabRequest<RichPayload>(`${root}/ai/groups/${picked.id}/rich`,'POST',{message_ids:ids})
          .then(rich=>{
            if(rich.success&&rich.workspace_id===space&&rich.group_id===picked.id&&
               selectedRef.current?.kind==='group'&&selectedRef.current.id===picked.id) {
              setRichByRequest(previous=>({...previous,...rich.items}));
            }
          }).catch(()=>{/* Markdown remains available if rich data are absent. */});
      }
    }
    if(!older && picked.kind==="group") {
      setOptimisticGroupMessage(previous=>{
        if(!previous||previous.group!==picked.id)return previous;
        const found=incoming.some(m=>m.ai_request_id===previous.request ||
          (m.sender_user_id===ownId && m.content===previous.content &&
            Date.parse(m.created_at)>=previous.createdAt-15000));
        return found ? null : previous;
      });
    }
    if(!older)setBefore(incoming.length>=70?incoming[0].id:null);
    else setBefore(incoming.length>=70?incoming[0].id:null);
    if(picked.kind!=="private"){
      try{
        const result=await collabRequest<{workspace_id:string;room_id:string;files:FileLink[]}>(`${hub}/rooms/${picked.kind}/${picked.id}/files`);
        if(result.workspace_id===space && result.room_id===picked.id && selectedRef.current?.id===picked.id)setFiles(result.files??[]);
      }catch{/* Messages stay available even if attachment service fails. */}
    } else {
      try {
        const result=await collabRequest<{success:boolean;workspace_id:string;conversation_id:string;files:FileLink[]}>(`${root}/ai/private/${picked.id}/files`);
        if(result.success && result.workspace_id===space && result.conversation_id===picked.id && selectedRef.current?.id===picked.id){
          setFiles((result.files??[]).map(file=>({...file,private_ai:true})));
        }
      } catch { setFiles([]); /* Le fil reste lisible pendant une panne fichiers. */ }
    }
  }, [hub,root,space,ownId]);

  const pendingKey = useCallback((picked:Selection)=>
    `oria-collab-pending:${ownId}:${space}:${picked.kind}:${picked.id}`,[ownId,space]);

  const watchDeliveryStream = useCallback(async (picked:Selection, requestId:string) => {
    if(picked.kind!=='group')return;
    const key=`${picked.id}:${requestId}`;
    if(monitorRef.current?.key===key)return;
    monitorRef.current?.abort.abort();
    const controller = new AbortController();
    monitorRef.current={key,abort:controller};
    try {
      const {data:{session}}=await collabSupabase.auth.getSession();
      if(!session?.access_token||!session.user.id)return;
      const path=`${root}/ai/groups/${picked.id}/jobs/${requestId}/stream`;
      const resp=await fetch(`${COLLAB_API_URL}${path}`,{
        headers:{authorization:`Bearer ${session.access_token}`,'user-id':session.user.id},
        cache:'no-store',signal:controller.signal,
      });
      if(!resp.ok||!resp.body)return;
      const reader=resp.body.getReader();
      const decoder=new TextDecoder();
      let buffer='';
      let terminal=false;
      while(!controller.signal.aborted){
        const next=await reader.read();
        if(next.done)break;
        buffer+=decoder.decode(next.value,{stream:true}).replace(/\r\n/g,'\n');
        let delimiter=buffer.indexOf('\n\n');
        while(delimiter>=0){
          const block=buffer.slice(0,delimiter);buffer=buffer.slice(delimiter+2);
          const event=block.split('\n').find(line=>line.startsWith('data: '));
          if(event){
            let state:DeliveryState|null=null;
            try{state=JSON.parse(event.slice(6)) as DeliveryState;}catch{}
            if(state?.request_id===requestId&&state.workspace_id===space&&state.target_id===picked.id){
              if(selectedRef.current?.id===picked.id&&selectedRef.current.kind==='group'){
                // Montrer la bulle dès la réservation, avant le premier delta.
                // Les PDF ne publient aucun fragment de JSON de composition.
                if(state.state==='reserved'){
                  setLivePreview(previous=>({group:picked.id,request:requestId,
                    text:typeof state.preview==='string'?state.preview:(previous?.request===requestId?previous.text:''),
                    phase:state.phase??'running'}));
                }
                if(state.state==='settled'){
                  terminal=true;setLivePreview(null);setPendingAi(false);
                  try{localStorage.removeItem(`oria-collab-pending:${ownId}:${space}:group:${picked.id}`);}catch{}
                  void load(picked).catch(()=>{});void refreshOwnWallet().catch(()=>{});
                } else if(['uncertain','needs_review','released','failed'].includes(state.state)){
                  terminal=true;setLivePreview(null);setPendingAi(state.state!=='released');
                  if(state.state==='released'){
                    try{localStorage.removeItem(`oria-collab-pending:${ownId}:${space}:group:${picked.id}`);}catch{}
                  }
                }
              }
            }
          }
          delimiter=buffer.indexOf('\n\n');
        }
        if(terminal)break;
      }
    }catch{/* Network stream may disconnect: history/status polling is authoritative. */}
    finally {if(monitorRef.current?.key===key)monitorRef.current=null;}
  },[root,space,ownId,load,refreshOwnWallet]);

  useEffect(()=>()=>{monitorRef.current?.abort.abort();},[]);

  const checkPending = useCallback(async (picked:Selection) => {
    if(!ownId || (picked.kind!=="group" && picked.kind!=="private")) return;
    const key=pendingKey(picked);
    let requestId:string|null=null;
    try { requestId=localStorage.getItem(key); } catch { /* stockage désactivé */ }
    if(!requestId && picked.kind==="group"){
      // A job might predate localStorage (old sessions or other device).
      // The server verifies workspace/group membership before returning an ID.
      try {
        const latest=await collabRequest<{success:boolean;workspace_id:string;group_id:string;
          active:boolean;request_id?:string;state?:string}>(`${root}/ai/groups/${picked.id}/jobs/latest`);
        if(latest.success && latest.workspace_id===space && latest.group_id===picked.id && latest.active && latest.request_id){
          requestId=latest.request_id;
          try{localStorage.setItem(key,requestId);}catch{}
        }
      } catch { /* Le statut local continue à fonctionner si le contrôle distant est indisponible. */ }
    }
    if(!requestId)return;
    if(picked.kind==='group'){
      // Également visible en revenant dans le groupe après navigation.
      setLivePreview(previous=>previous?.group===picked.id&&previous.request===requestId
        ?previous:{group:picked.id,request:requestId,text:'',phase:'reconnecting'});
      void watchDeliveryStream(picked,requestId);
    }
    if(selectedRef.current?.id===picked.id && selectedRef.current?.kind===picked.kind)
      setPendingAi(true);
    const endpoint=picked.kind==="group"?
      `${root}/ai/groups/${picked.id}/jobs/${requestId}`:
      `${root}/ai/private/${picked.id}/jobs/${requestId}`;
    try{
      const status=await collabRequest<DeliveryState>(endpoint);
      if(!status.success || status.workspace_id!==space || status.target_id!==picked.id ||
         status.request_id!==requestId)throw new Error('Statut incohérent.');
      if(picked.kind==='group' && status.state==='reserved' && status.receipt_ready===true &&
         status.phase==='provider_complete' && Boolean(status.updated_at) &&
         Date.now()-new Date(status.updated_at as string).getTime()>12000 &&
         !recoverRef.current.has(requestId)){
        recoverRef.current.add(requestId);
        // Non-billable recovery. Never re-call OpenAI/OpenRouter.
        void collabRequest(`${root}/ai/groups/${picked.id}/jobs/${requestId}/recover`, 'POST', {})
          .then(()=>{void load(picked);void refreshOwnWallet().catch(()=>{});})
          .catch(()=>{recoverRef.current.delete(requestId);});
      }
      if(status.state==='settled'){
        try{localStorage.removeItem(key);}catch{}
        if(selectedRef.current?.id===picked.id && selectedRef.current?.kind===picked.kind){
          setPendingAi(false);setLivePreview(null);setNotice('Réponse ORIA livrée dans cette conversation.');
          await load(picked);void refreshOwnWallet().catch(()=>{});
        }
      } else if(status.state==='released'){
        try{localStorage.removeItem(key);}catch{}
        setLivePreview(null);setPendingAi(false);
        setNotice('Réservation annulée : aucun débit confirmé.');
      } else if(['uncertain','needs_review','failed'].includes(status.state)){
        if(selectedRef.current?.id===picked.id && selectedRef.current?.kind===picked.kind){
          setPendingAi(true);
          setNotice('Demande en rapprochement : aucun second appel fournisseur autorisé automatiquement.');
        }
      } else if(['reserved','pending'].includes(status.state)){
        if(selectedRef.current?.id===picked.id && selectedRef.current?.kind===picked.kind){
          if(picked.kind==='group')setLivePreview(previous=>({group:picked.id,request:requestId,
            text:typeof status.preview==='string'?status.preview:(previous?.request===requestId?previous.text:''),
            phase:status.phase??'not_started'}));
          setNotice('ORIA traite une demande déjà enregistrée. Le résultat restera dans le fil après validation.');
        }
      }
    }catch{
      if(selectedRef.current?.id===picked.id && selectedRef.current?.kind===picked.kind){
        setPendingAi(true);setNotice('Statut IA non confirmé. Ne pas renvoyer cette demande avant vérification.');
      }
    }
  },[ownId,pendingKey,root,space,load,refreshOwnWallet,watchDeliveryStream]);

  useEffect(()=>{
    if(!selection)return;
    monitorRef.current?.abort.abort();
    setLivePreview(null);
    setMessages([]);setFiles([]);setBefore(null);setError("");setPendingAi(false);setPreviewFile(null);
    selectedRef.current=selection;
    void load(selection).catch(e=>setError(e instanceof Error?e.message:"Historique indisponible."));
    void checkPending(selection);
  },[selection,load,checkPending]);

  useEffect(()=>{
    const interval=window.setInterval(()=>{
      if(document.visibilityState!=="visible"||busy)return;
      const current=selectedRef.current;
      if(current){void load(current).catch(()=>{});void checkPending(current);}
      void refreshBoot().catch(()=>{});
    },5000);
    return ()=>window.clearInterval(interval);
  },[busy,load,refreshBoot,checkPending]);

  useEffect(()=>{
    if(viewRef.current)viewRef.current.scrollTop=viewRef.current.scrollHeight;
  },[messages.length,selection?.id,optimisticGroupMessage?.request]);

  useEffect(()=>{
    const view=viewRef.current;
    if(view && view.scrollHeight-view.scrollTop-view.clientHeight < 250)
      view.scrollTop=view.scrollHeight;
  },[livePreview?.text,livePreview?.phase]);

  function pick(kind:RoomKind,id:string){
    if(recordingRef.current?.state==="recording"){sendRecordingRef.current=false;recordingRef.current.stop();setRecording(false); }
    selectedRef.current={kind,id};setSelection({kind,id});setSidebarOpen(false);
    setEditingId(null);setEditText("");
    setDraft("");setMentionOpen(false);setNotice("");setShowGroupMember(false);
  }

  function persistSelection(nextModel:string,nextMode:string) {
    if (!ownId) return;
    try { localStorage.setItem(`oria-collab-chat:${ownId}:${space}`,
      JSON.stringify({model:nextModel,reasoning_mode:nextMode})); } catch { /* aucune fuite */ }
    void collabRequest(`${root}/ai/preferences`,"PATCH",{model:nextModel,reasoning_mode:nextMode})
      .catch(()=>{/* Sauvegarde locale disponible si migration SQL non installée */});
  }

  function suggestOria(value:string, caret:number) {
    return selection?.kind==="group" && /(^|\s)@[a-z]*$/i.test(value.slice(0,caret));
  }

  function completeOriaMention(){
    const area = draftRef.current;
    if (!area) return;
    const caret = area.selectionStart ?? draft.length;
    const left = draft.slice(0,caret);
    const right = draft.slice(caret);
    const nextLeft = left.replace(/(^|\s)@[a-z]*$/i, "$1@ORIA ");
    const next = nextLeft + right;
    setDraft(next);setMentionOpen(false);
    requestAnimationFrame(()=>{area.focus();area.setSelectionRange(nextLeft.length,nextLeft.length);});
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
    const requestId=crypto.randomUUID();
    // Le message est montré immédiatement dans le groupe, sans attendre le réseau.
    if(current.kind==='group')setOptimisticGroupMessage({group:current.id,request:requestId,
      content,createdAt:Date.now(),ai});
    setDraft("");setBusy(true);setError("");setNotice("");
    if(ai && current.kind==='group')setLivePreview({group:current.id,request:requestId,text:'',phase:'starting'});
    try{
      if(ai){
        const endpoint=current.kind==="group"?`${root}/ai/groups/${current.id}/ask`:`${root}/ai/private/${current.id}/ask`;
        try{localStorage.setItem(pendingKey(current),requestId);}catch{}
        if(current.kind==='group')void watchDeliveryStream(current,requestId);
        const body=current.kind==="group"?{request_id:requestId,model,reasoning_mode:mode,web:webEnabled,prompt:content}
          :{request_id:requestId,model,reasoning_mode:mode,web:webEnabled,message:content};
        const result=await collabRequest<{workspace_id:string;success:boolean}>(endpoint,"POST",body);
        if(!result.success||result.workspace_id!==space)throw new Error("Réponse IA d'un autre espace.");
        try{localStorage.removeItem(pendingKey(current));}catch{}
        setPendingAi(false);
      } else {
        const result=await collabRequest<{workspace_id:string;success:boolean}>(`${hub}/rooms/${current.kind}/${current.id}/messages`,"POST",
          {client_message_id:requestId,content});
        if(!result.success||result.workspace_id!==space)throw new Error("Message non confirmé.");
      }
      await load(current);
      setOptimisticGroupMessage(previous=>previous?.request===requestId?null:previous);
      setLivePreview(previous=>previous?.request===requestId?null:previous);
      await refreshBoot();void refreshOwnWallet().catch(()=>{});
    }catch(e){
      const message=e instanceof Error?e.message:"Envoi impossible.";
      setError(message);
      if(!ai){
        // Envoi humain non confirmé : pas de doublon fantôme.
        setOptimisticGroupMessage(previous=>previous?.request===requestId?null:previous);
        setDraft(previous=>previous||content);
      } else {
        // Réponses de pré-validation connues : aucun appel fournisseur n'a été lancé.
        const definitelyPreflight=/la demande doit contenir @oria|mode de raisonnement invalide|contexte du groupe est trop volumineux|un participant n.a pas assez de crédits|quotas des participants sont insuffisants|action du modèle absente|modèle non autorisé|modèle ou devis fournisseur indisponible|format indisponible|erreur serveur \((400|402|403|422)\)/i.test(message);
        if(definitelyPreflight){
          try{localStorage.removeItem(pendingKey(current));}catch{}
          setOptimisticGroupMessage(previous=>previous?.request===requestId?null:previous);
          setLivePreview(previous=>previous?.request===requestId?null:previous);
          setPendingAi(false);
          setDraft(previous=>previous||content);
        } else {
          // Une autre erreur HTTP ne prouve PAS l'absence d'un appel payant.
          // Conserver l'ID, vérifier en base, et ne jamais refaire l'appel.
          if(current.kind==='group'){
            setPendingAi(true);
            setLivePreview(previous=>previous?.request===requestId
              ?{...previous,phase:'reconnecting'}:{group:current.id,request:requestId,text:'',phase:'reconnecting'});
            void checkPending(current);
          }
          setNotice("Vérification de la demande en cours. Aucun nouvel appel fournisseur ne sera déclenché automatiquement.");
        }
      }
    }finally{setBusy(false);}
  }

  async function sendGroupAttachment(file:File,picked:Selection){
    if(picked.kind!=="group" || !canWrite || busy)return;
    if(!file.size||file.size>8*1024*1024){setError("Pièce jointe limitée à 8 Mo.");return;}
    setBusy(true);setError("");
    try{
      const {data:{session}}=await collabSupabase.auth.getSession();
      if(!session?.access_token||!session.user.id)throw new Error("Session ORIA expirée.");
      const form=new FormData();form.append("file",file,file.name);
      const response=await fetch(`${COLLAB_API_URL}${hub}/rooms/group/${picked.id}/files`,{
        method:"POST",headers:{authorization:`Bearer ${session.access_token}`,"user-id":session.user.id},body:form,
      });
      const result:unknown=await response.json().catch(()=>({}));
      if(!response.ok){
        const detail=typeof result==="object"&&result!==null&&"detail" in result?(result as {detail:unknown}).detail:null;
        throw new Error(typeof detail==="string"?detail:"Envoi du fichier refusé.");
      }
      if(typeof result!=="object"||result===null||!("workspace_id" in result)||result.workspace_id!==space)
        throw new Error("Réponse du mauvais espace.");
      if(selectedRef.current?.id===picked.id&&selectedRef.current.kind==="group")await load(picked);
      await refreshBoot();
      setNotice(file.type.startsWith("audio/")?"Note vocale envoyée au groupe.":"Fichier disponible pour ce groupe. Demandez @ORIA de l'analyser.");
    }catch(e){setError(e instanceof Error?e.message:"Envoi non confirmé. Vérifiez l’historique avant de réessayer.");}
    finally{setBusy(false);}
  }

  async function uploadFile(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0];event.target.value="";
    const picked=selectedRef.current;
    if(file&&picked)await sendGroupAttachment(file,picked);
  }

  async function toggleVoiceRecording(){
    const recorder=recordingRef.current;
    if(recorder&&recorder.state==="recording"){
      sendRecordingRef.current=true;
      recorder.stop();
      setRecording(false);
      return;
    }
    const picked=selectedRef.current;
    if(!picked||picked.kind!=="group"||busy||!canWrite)return;
    try{
      if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==="undefined")
        throw new Error("Ce navigateur ne permet pas les notes vocales.");
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      const mime=["audio/webm;codecs=opus","audio/mp4","audio/webm","audio/ogg;codecs=opus"]
        .find(m=>MediaRecorder.isTypeSupported(m));
      const next=mime?new MediaRecorder(stream,{mimeType:mime}):new MediaRecorder(stream);
      const actual=next.mimeType.split(";",1)[0].toLowerCase();
      const ext=actual==="audio/mp4"?"m4a":actual==="audio/ogg"?"ogg":actual==="audio/webm"?"webm":"";
      if(!ext){stream.getTracks().forEach(t=>t.stop());throw new Error("Format microphone non pris en charge.");}
      recordingStreamRef.current=stream;recordingRef.current=next;
      recordingGroupRef.current=picked;audioChunksRef.current=[];sendRecordingRef.current=false;
      next.ondataavailable=e=>{if(e.data.size>0)audioChunksRef.current.push(e.data);};
      next.onerror=()=>{sendRecordingRef.current=false;setError("Enregistrement audio interrompu.");};
      const maxTimer=window.setTimeout(()=>{
        if(next.state==="recording"){
          sendRecordingRef.current=true;next.stop();setRecording(false);
        }
      },295000);
      next.onstop=()=>{
        window.clearTimeout(maxTimer);
        stream.getTracks().forEach(t=>t.stop());recordingStreamRef.current=null;recordingRef.current=null;
        setRecording(false);
        const send=sendRecordingRef.current;sendRecordingRef.current=false;
        const data=new Blob(audioChunksRef.current,{type:actual});audioChunksRef.current=[];
        if(!send)return;
        if(data.size===0||data.size>8*1024*1024){setError("Note vocale vide ou supérieure à 8 Mo.");return;}
        const target=recordingGroupRef.current;
        if(target)void sendGroupAttachment(new File([data],`oria-vocal-${Date.now()}.${ext}`,{type:actual}),target);
      };
      next.start(1000);setRecording(true);setError("");
    }catch(e){setError(e instanceof Error?e.message:"Microphone inaccessible.");}
  }

  async function listenVoice(file:FileLink){
    try{setVoiceUrls(prev=>({...prev,[file.id]:""}));const url=await verifiedFileUrl(file);
      setVoiceUrls(prev=>({...prev,[file.id]:url}));}
    catch(e){setError(e instanceof Error?e.message:"Lecture vocale indisponible.");}
  }

  async function copyMessage(content:string){
    try{await navigator.clipboard.writeText(content);setNotice("Message copié.");}
    catch{setError("Impossible de copier ce message. Autorisez le presse-papiers.");}
  }

  async function saveEditMessage(m:Message){
    const current=selectedRef.current;
    if(!current||current.kind!=="group"||busy||m.sender_user_id!==ownId||m.sender_kind==="oria")return;
    const content=editText.trim();
    if(!content||content.length>4000||mentionOria.test(content)){
      setError("Modification refusée (message vide, trop long ou commande @ORIA).");return;
    }
    setBusy(true);setError("");
    try{
      const result=await collabRequest<{success:boolean;workspace_id:string;group_id:string;message_id:string;content:string;edited_at?:string}>(
        `${hub}/groups/${current.id}/messages/${m.id}`,"PATCH",{content});
      if(!result.success||result.workspace_id!==space||result.group_id!==current.id||result.message_id!==m.id)
        throw new Error("Édition non confirmée.");
      setMessages(items=>items.map(x=>x.id===m.id?{...x,content:result.content,edited_at:result.edited_at}:x));
      setEditingId(null);setEditText("");setNotice("Message modifié.");
      if(selectedRef.current?.id===current.id)await load(current);
    }catch(e){setError(e instanceof Error?e.message:"Modification refusée.");}
    finally{setBusy(false);}
  }

  useEffect(()=>()=>{
    // Aucune capture microphone persistante après quitter le chat.
    sendRecordingRef.current=false;
    if(recordingRef.current?.state==="recording")recordingRef.current.stop();
    recordingStreamRef.current?.getTracks().forEach(t=>t.stop());
  },[]);

  async function verifiedFileUrl(file:FileLink):Promise<string>{
    // Each open requests a fresh, short-lived URL from the authorized workspace API.
    const endpoint=file.private_ai?`${root}/ai/private/files/${file.id}/url`:`${hub}/files/${file.id}/url`;
    const result=await collabRequest<{success:boolean;workspace_id:string;file_id:string;url:string}>(endpoint);
    if(!result.success||result.workspace_id!==space||result.file_id!==file.id||!result.url.startsWith("https://"))throw new Error("Fichier inaccessible.");
    return result.url;
  }
  async function openFile(file:FileLink){
    try{
      const url=await verifiedFileUrl(file);
      window.open(url,"_blank","noopener,noreferrer");
    }catch(e){setError(e instanceof Error?e.message:"Téléchargement refusé.");}
  }
  async function previewAttachment(file:FileLink){
    try{
      setPreviewFile({file,url:await verifiedFileUrl(file)});
    }catch(e){setError(e instanceof Error?e.message:"Aperçu indisponible.");}
  }

  async function create(){
    if(!newKind||busy)return;
    setBusy(true);setError("");
    try{
      let result:{workspace_id:string;group_id?:string;thread_id?:string;conversation_id?:string;success:boolean};
      result=await collabRequest(`${root}/actions/groups`,"POST",{title:newTitle.trim(),description:""});
      if(!result.success||result.workspace_id!==space)throw new Error("Création non confirmée.");
      const id=result.group_id||result.thread_id||result.conversation_id;
      if(!id)throw new Error("Identifiant de conversation absent.");
      setNewKind(null);setNewTitle("");await refreshBoot();pick("group",id);
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
            <button title="Actualiser" className="rounded-lg p-2 hover:bg-surface-secondary" onClick={()=>{void refreshBoot();void refreshOwnWallet().catch(()=>{});if(selection){void load(selection);void checkPending(selection);}}}><RefreshCcw size={18}/></button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className="inline-flex items-center gap-1"><ShieldCheck size={13}/> {boot?.context.is_owner?"Administrateur":"Membre"}</span>
          <Link className="underline hover:text-foreground" href="/chat" title="Ouvrir ORIA classique hors de cet espace">Quitter vers ORIA personnel</Link>
          <Link className="underline hover:text-foreground" href={`${root.replace('/collaboratif/workspaces/','/collaboratif/espaces/')}/finances`}>Crédits</Link>
          {ownWallet&&<span role="status" title="Solde de votre profil uniquement" className="rounded-lg border border-border px-2 py-1 tabular-nums"><Wallet size={12} className="mr-1 inline"/> {((ownWallet.pack_quota?.available??0)+(ownWallet.personal_balance??0)).toLocaleString("fr-GA")} disponibles · {((ownWallet.pack_quota?.reserved??0)).toLocaleString("fr-GA")} réservés · {((ownWallet.pack_quota?.spent??0)).toLocaleString("fr-GA")} dépensés</span>}
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
        {selection&&messages.length===0&&!loading&&!livePreview&&<div className="grid h-full place-items-center text-sm text-muted">Aucun message pour le moment.</div>}
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
              {editingId===m.id?<div className="space-y-2">
                <textarea aria-label="Modifier mon message" className={`${input} min-h-[80px]`} maxLength={4000}
                  value={editText} onChange={e=>setEditText(e.target.value)}/>
                <div className="flex gap-2"><button type="button" className={smallButton} disabled={busy} onClick={()=>void saveEditMessage(m)}>Enregistrer</button>
                <button type="button" className={smallButton} onClick={()=>{setEditingId(null);setEditText("");}}>Annuler</button></div>
              </div>:oria?
                <OriaRichMessage content={m.content} language="fr"
                  webImages={richByRequest[m.id]?.web_images??[]}/>
                :<p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>}
              {oria&&Boolean(richByRequest[m.id]?.sources?.length)&&
                <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-2 text-[11px]" aria-label="Sources Web">
                  {(richByRequest[m.id].sources||[]).slice(0,8).map((source,i)=><a
                    key={`${m.id}-${i}`} href={source.url} target="_blank" rel="noopener noreferrer"
                    className="rounded-lg border border-border px-2 py-1 underline underline-offset-2 hover:bg-surface-secondary"
                    title={source.url}>Source {i+1} : {source.title}</a>)}
                </div>}
              <div className="mt-1 flex items-center justify-end gap-2 opacity-70">
                {m.edited_at&&<span className="text-[10px]">modifié</span>}
                <button type="button" title="Copier le message" aria-label="Copier le message"
                  onClick={()=>void copyMessage(m.content)}><Copy size={13}/></button>
                {mine&&!oria&&!m.ai_request_id&&!mentionOria.test(m.content)&&attachments.length===0&&
                  <button type="button" title="Modifier mon message" aria-label="Modifier mon message"
                    disabled={busy} onClick={()=>{setEditingId(m.id);setEditText(m.content);}}><Pencil size={13}/></button>}
              </div>
               {attachments.map(f=>f.mime_type.startsWith("audio/")?
                 <div key={f.id} className="mt-2 rounded-lg border border-border p-2 text-xs">
                   <div className="mb-2 flex items-center gap-2"><Mic size={15}/><span>Note vocale</span>
                   <button type="button" className="underline" onClick={()=>void listenVoice(f)}><Play size={13} className="mr-1 inline"/>Écouter</button></div>
                   {voiceUrls[f.id]&&<audio controls preload="none" src={voiceUrls[f.id]} className="h-9 max-w-full"/>}
                 </div>:
                 <div key={f.id} className={`mt-2 flex max-w-full items-center gap-2 rounded-lg border px-2 py-2 text-xs ${mine?"border-background/30":"border-border"}`}><FileText size={16}/><span className="max-w-[185px] truncate" title={f.original_name}>{f.original_name}</span><button type="button" title="Aperçu" aria-label={`Aperçu de ${f.original_name}`} onClick={()=>void previewAttachment(f)}><Eye size={16}/></button><button type="button" title="Télécharger" aria-label={`Télécharger ${f.original_name}`} onClick={()=>void openFile(f)}><Download size={16}/></button></div>)}
              <time className="mt-1 block text-right text-[10px] opacity-65">{date(m.created_at)} {mine&&<Check className="ml-0.5 inline" size={11}/>}</time>
            </article>
          </div>;
        })}
        {selection?.kind==='group'&&optimisticGroupMessage?.group===selection.id&&
          !messages.some(m=>m.ai_request_id===optimisticGroupMessage.request ||
            (m.sender_user_id===ownId&&m.content===optimisticGroupMessage.content&&
              Date.parse(m.created_at)>=optimisticGroupMessage.createdAt-15000))&&
          <div className="flex justify-end" aria-label="Message envoyé en cours de confirmation">
            <article className="max-w-[88%] break-words rounded-2xl rounded-br-sm bg-foreground px-4 py-3 text-sm text-background sm:max-w-[76%]">
              <p className="whitespace-pre-wrap leading-relaxed">{optimisticGroupMessage.content}</p>
              <p className="mt-1 text-right text-[10px] opacity-65">Envoi en cours…</p>
            </article>
          </div>}
        {selection?.kind==='group'&&livePreview?.group===selection.id&&
          <div className="flex justify-start" role="status" aria-live="polite">
            <article className="max-w-[88%] rounded-2xl rounded-bl-sm border border-border bg-surface px-4 py-3 text-sm sm:max-w-[76%]">
              <div className="mb-2 flex items-center gap-2 font-semibold">
                <span className="grid size-6 place-items-center rounded-full bg-foreground text-xs text-background">O</span>
                ORIA <span className="text-xs font-normal text-muted">en cours…</span>
              </div>
              <div className="mb-3 flex flex-wrap items-center gap-2" aria-label="Étapes de génération">
                {generationSteps.map((step,index)=>{
                  const active=generationStep(livePreview.phase,livePreview.text)===index;
                  const done=generationStep(livePreview.phase,livePreview.text)>index;
                  return <span key={step} className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] ${active?'border-foreground font-semibold':'border-border text-muted'}`}>
                    {done?<Check size={11}/>:active?<span className="size-2 animate-pulse rounded-full bg-foreground"/>:<span className="size-2 rounded-full border border-border"/>}{step}
                  </span>;
                })}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted" role="status">
                <span aria-hidden="true" className="size-3 shrink-0 animate-spin rounded-full border-2 border-border border-t-foreground"/>
                {generationStatus(livePreview.phase,livePreview.text)}
              </div>
              {Boolean(livePreview.text)&&<div className="mt-3"><OriaRichMessage content={livePreview.text} language="fr"/><span aria-hidden="true" className="animate-pulse">▍</span></div>}
              {livePreview.phase==='reconnecting'&&<p className="mt-2 text-xs text-muted">La réponse est suivie sur le serveur. Vous pouvez revenir dans ce groupe sans relancer l'IA.</p>}
            </article>
          </div>}
      </div>
      {previewFile&&<div role="dialog" aria-modal="true" aria-label={`Aperçu ${previewFile.file.original_name}`} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"><div className="flex h-[min(85vh,850px)] w-[min(96vw,1050px)] flex-col overflow-hidden rounded-2xl bg-background text-foreground"><div className="flex items-center justify-between gap-3 border-b border-border p-3"><span className="truncate font-medium">{previewFile.file.original_name}</span><div className="flex items-center gap-3"><button type="button" aria-label="Télécharger" onClick={()=>void openFile(previewFile.file)}><Download size={18}/></button><button type="button" aria-label="Fermer l’aperçu" onClick={()=>setPreviewFile(null)}><X size={18}/></button></div></div><div className="min-h-0 flex-1 bg-surface p-2">{previewFile.file.mime_type.startsWith('image/')?<img src={previewFile.url} alt={previewFile.file.original_name} className="h-full w-full object-contain"/>:(['application/pdf','text/plain'].includes(previewFile.file.mime_type))?<iframe title={previewFile.file.original_name} src={previewFile.url} className="h-full w-full rounded-md bg-white"/>:<div className="grid h-full place-items-center text-center text-sm text-muted"><div>Aperçu natif non pris en charge pour ce format.<br/>Utilise Télécharger pour consulter le fichier original.</div></div>}</div></div></div>}
      {selection&&<div className="border-t border-border bg-surface px-3 py-3 sm:px-6">
        {(selection.kind==="group"||selection.kind==="private")&&<div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted"><span>{selection.kind==="group"?"Écrivez @ORIA pour demander une réponse IA":"Conversation avec ORIA"}</span><div className="flex flex-wrap items-center gap-2"><span className="hidden rounded-full border border-border px-2 py-1 text-[11px] sm:inline">{provider==="openai"?"OpenAI actif":provider==="openrouter"?"OpenRouter actif":"Fournisseur non vérifié"}</span><select aria-label="Modèle IA" className="max-w-[185px] rounded-xl border border-border bg-background px-3 py-2 font-medium text-foreground" value={model} onChange={e=>{const m=e.target.value;const allowed=modelCatalog.find(x=>x.id===m)?.reasoning_modes??[];const next=allowed.includes(mode)?mode:(allowed.includes('balanced')?'balanced':(allowed[0]??'balanced'));setModel(m);setMode(next);persistSelection(m,next);}} disabled={!provider||busy}><option value="">Modèle indisponible</option>{modelCatalog.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select><select aria-label="Raisonnement" className="rounded-xl border border-border bg-background px-3 py-2 text-foreground" value={mode} onChange={e=>{setMode(e.target.value);persistSelection(model,e.target.value);}} disabled={!provider||busy}>{(modelCatalog.find(item=>item.id===model)?.reasoning_modes??[]).filter(m=>m in reasoningLabels).map(m=><option key={m} value={m}>{reasoningLabels[m]}</option>)}</select></div></div>}
        {selection.kind==="group"&&mentionOpen&&<div className="mb-2 flex justify-start"><button type="button" role="option" aria-label="Compléter avec @ORIA" className="rounded-xl border border-border bg-background px-4 py-2 text-sm shadow-sm hover:bg-surface-secondary" onMouseDown={e=>e.preventDefault()} onClick={completeOriaMention}><Sparkles size={15} className="mr-2 inline"/>@ORIA <span className="ml-2 text-xs text-muted">Tab ou Entrée</span></button></div>}
        {(selection.kind==="group"||selection.kind==="private")&&<label className="mb-2 flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={webEnabled} onChange={e=>setWebEnabled(e.target.checked)} disabled={busy||pendingAi} aria-label="Recherche Web avec facturation des outils"/>Recherche Web (coût des outils inclus dans le devis)</label>}
        <form onSubmit={e=>void submit(e)} className="flex items-end gap-2">
          <input ref={fileRef} className="hidden" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.docx,.xlsx,.pptx,.webm,.ogg,.m4a,.mp3,.wav" onChange={e=>void uploadFile(e)}/>
          {selection.kind==="group"&&<button type="button" className="rounded-xl p-3 hover:bg-surface-secondary disabled:opacity-40" title="Joindre un fichier (8 Mo max)" aria-label="Joindre un fichier" disabled={busy||!canWrite} onClick={()=>fileRef.current?.click()}><Paperclip size={20}/></button>}
          {selection.kind==="group"&&<button type="button" aria-label={recording?"Arrêter et envoyer la note vocale":"Enregistrer une note vocale"}
            title={recording?"Arrêter et envoyer":"Enregistrer une note vocale"}
            className={`rounded-xl p-3 hover:bg-surface-secondary ${recording?"animate-pulse text-red-500":""}`}
            disabled={busy||!canWrite} onClick={()=>void toggleVoiceRecording()}>
            {recording?<Square size={19}/>:<Mic size={19}/>}
          </button>}
          <textarea ref={draftRef} className={`${input} min-h-[45px] max-h-40 flex-1 resize-none`} placeholder={selection.kind==="group"?"Message… ou @ORIA pour l'IA":"Écrivez un message…"} rows={1}
            maxLength={selection.kind==="group"?4000:8000} value={draft} disabled={!canWrite||busy||pendingAi}
            onChange={e=>{setDraft(e.target.value);setMentionOpen(Boolean(suggestOria(e.target.value,e.target.selectionStart)));}} onKeyDown={e=>{if(mentionOpen&&(e.key==="Tab"||e.key==="Enter")){e.preventDefault();completeOriaMention();return;}if(e.key==="Escape")setMentionOpen(false);if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void submit();}}}/>
          <button aria-label="Envoyer" type="submit" disabled={!draft.trim()||busy||!canWrite||pendingAi} className="grid size-[45px] shrink-0 place-items-center rounded-xl bg-foreground text-background disabled:opacity-40"><Send size={19}/></button>
        </form>
        {recording&&<p className="mt-2 text-xs text-muted" role="status">Microphone actif. Touchez Arrêter pour envoyer (5 min max).</p>}
        {busy&&<p className="mt-2 text-xs text-muted" role="status">Envoi ou génération en cours…</p>}
        {pendingAi&&<p className="mt-2 text-xs text-muted" role="status">Une demande est en cours ou en rapprochement. Son identifiant a été conservé ; aucun nouvel appel payant ne sera déclenché ici.</p>}
      </div>}
    </section>

    {newKind&&<div className="fixed inset-0 z-50 grid place-items-center bg-black/55 px-4"><div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-xl"><div className="flex justify-between gap-2"><h2 className="text-lg font-semibold">Nouveau groupe de travail</h2><button aria-label="Fermer" onClick={()=>setNewKind(null)}><X size={18}/></button></div>
      <input aria-label="Nom du groupe" className={input} value={newTitle} onChange={e=>setNewTitle(e.target.value)} maxLength={100} placeholder="Nom du groupe"/>
      <p className="text-xs text-muted">Les membres de l’espace se retrouvent dans les groupes. Pour vos conversations personnelles, quittez l’espace et ouvrez ORIA classique.</p>
      <div className="flex justify-end gap-2"><button className={smallButton} onClick={()=>setNewKind(null)}>Annuler</button><button className={darkButton} disabled={busy||!newTitle.trim()} onClick={()=>void create()}>Créer ce groupe</button></div>
    </div></div>}
    {loading&&<div role="status" className="fixed inset-0 z-40 grid place-items-center bg-background/90 text-sm">Chargement de votre espace ORIA…</div>}
  </main>;
}
