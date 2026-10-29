"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Clapperboard, Film, RefreshCw, Play, Download, Plus, Music2 } from "lucide-react";

type Scene = { id: string; position: number; prompt: string; duration_seconds: number; action: string;
  request_id?: string | null; status: string; media_url?: string | null; error_message?: string | null };
type Project = { id: string; title: string; brief: string; aspect_ratio: string; model: string;
  generate_audio: boolean; continue_from_previous: boolean; status: string; output_url?: string | null; error_message?: string | null;
  duration_seconds: number; scenes: Scene[] };
type Offer = { action: string; duration: number; label: string };
type VideoCaps = { max_project_seconds: number; max_project_scenes: number; allowed_modes: string[];
  models?: { model: string; durations: number[]; supports_audio: boolean; supports_first_frame?: boolean }[] };
type Props = { language: "fr" | "en"; packId: string; caps: VideoCaps; onWalletRefresh?: () => void };
const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "https://lbv-connect-api.onrender.com";
const supabase = createClient();
const offers: Record<string, Offer[]> = {
  light_pack: [{ action: "video_4s", duration: 4, label: "4s" }, { action: "video_8s", duration: 8, label: "8s" }],
  intermediate_pack: [{ action: "video_lite", duration: 4, label: "4s" }],
  pro_pack: [{ action: "video_pro_fast", duration: 4, label: "4s" }, { action: "video_pro_standard", duration: 8, label: "8s" }],
  business_pack: [{ action: "video_business_fast", duration: 4, label: "4s" }, { action: "video_business_standard", duration: 8, label: "8s" }],
};
async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token || !session.user?.id) throw new Error("Reconnectez-vous à ORIA.");
  const headers = new Headers(options.headers);
  headers.set("authorization", `Bearer ${session.access_token}`);
  headers.set("user-id", session.user.id);
  if (options.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`${API_URL}/ai/openrouter-media${path}`, { ...options, headers });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof json.detail === "string" ? json.detail : `Erreur ORIA (${response.status})`);
  return json as T;
}
function toBase64(file: File): Promise<string> {
  if (file.size > 8 * 1024 * 1024 || file.size === 0) return Promise.reject(new Error("Audio : 8 Mo maximum."));
  return new Promise((resolve, reject) => { const r = new FileReader();
    r.onerror = () => reject(new Error("Lecture audio impossible."));
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.readAsDataURL(file); });
}
function template(brief: string, style: string, n: number, index: number): string {
  const arc = ["Présentation du décor et des personnages", "Action principale et réaction des personnages", "Moment fort et émotion", "Conclusion et plan final"];
  return `Bible visuelle cohérente pour toutes les scènes : ${brief.trim()}. Style ${style}. Même personnage, mêmes accessoires, mêmes vêtements et décor entre les scènes. Scène ${index+1}/${n} — ${arc[index === n-1 ? 3 : Math.min(2,index)]}. Mouvement fluide, caméra cinématographique, aucun sous-titre intégré.`;
}
export default function OriaVideoProjectsWeb({ language, packId, caps, onWalletRefresh }: Props) {
  const fr = language === "fr";
  const tr = (a: string,b: string) => fr ? a:b;
  const choices = useMemo(() => (offers[packId] || []).filter(o => (caps.models || []).some(m => m.durations.includes(o.duration))), [packId,caps]);
  const [title,setTitle] = useState(""); const [brief,setBrief] = useState(""); const [style,setStyle] = useState("Réaliste cinématographique");
  const [ratio,setRatio] = useState("9:16"); const [model,setModel] = useState(caps.models?.[0]?.model || "");
  const [audio,setAudio] = useState(false); const [continuity,setContinuity] = useState(false);
  const [scenes,setScenes] = useState<{prompt: string; duration_seconds: number; action: string}[]>([]);
  const [budget,setBudget] = useState<{total_estimated_credits:number;maximum_total_reservation_credits:number;credits_sufficient_for_all:boolean;scenes:{scene:number;reservation_credits:number}[]} | null>(null);
  const [list,setList] = useState<{id:string;title:string;status:string}[]>([]);
  const [project,setProject] = useState<Project | null>(null);
  const walletRef = useRef(onWalletRefresh);
  useEffect(() => { walletRef.current = onWalletRefresh; }, [onWalletRefresh]);
  const activeProjectId = project?.id;
  const needsStatusTracking = !!project && (project.status === "rendering" ||
    project.scenes.some(s => ["processing", "claimed"].includes(s.status) && !!s.request_id));
  // Poll only the EXISTING job IDs. Never send a paid /video POST automatically.
  // Polling OpenRouter every 30s is consistent with their asynchronous video guidance.
  useEffect(() => {
    if (!activeProjectId || !needsStatusTracking) return;
    let stopped = false;
    let inFlight = false;
    const timer = setInterval(() => {
      if (stopped || inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      void api<Project>(`/projects/${activeProjectId}/sync`, { method: "POST" })
        .then(latest => {
          if (stopped) return;
          setProject(current => current?.id === activeProjectId ? latest : current);
          walletRef.current?.();
        })
        .catch(() => { /* The manual Synchroniser button remains available. */ })
        .finally(() => { inFlight = false; });
    }, 30000);
    return () => { stopped = true; clearInterval(timer); };
  }, [activeProjectId, needsStatusTracking]);
  const [busy,setBusy] = useState(false); const [message,setMessage] = useState(""); const [problem,setProblem] = useState("");
  const [music,setMusic] = useState<File | null>(null); const [voice,setVoice] = useState<File | null>(null);
  const [keepAudio,setKeepAudio] = useState(true); const [rights,setRights] = useState(false);
  const [transition,setTransition] = useState<"fade"|"cut">("fade");
  const canUse = caps.allowed_modes.includes("multi_scene") && caps.max_project_scenes >= 2;
  const selectedModel = (caps.models || []).find(m => m.model === model);
  const eligibleOffers = choices.filter(o => selectedModel?.durations.includes(o.duration));
  const firstOffer = eligibleOffers[0];
  useEffect(() => { if (!(caps.models || []).some(m => m.model === model)) setModel(caps.models?.[0]?.model || ""); }, [caps,model]);
  useEffect(() => { if (!selectedModel?.supports_audio) setAudio(false); }, [selectedModel?.supports_audio]);
  useEffect(() => { if (!selectedModel?.supports_first_frame) setContinuity(false); }, [selectedModel?.supports_first_frame]);
  async function refreshList() { const data = await api<{projects: typeof list}>("/projects"); setList(data.projects || []); }
  useEffect(() => { void refreshList().catch(()=>{}); }, []);
  function createStoryboard() {
    setBudget(null);setProblem("");
    if (!firstOffer || !brief.trim() || brief.trim().length < 10) { setProblem("Décris ton film et choisis un modèle."); return; }
    const limit = Math.min(caps.max_project_scenes, Math.floor(caps.max_project_seconds / firstOffer.duration));
    const amount = Math.min(limit, 3);
    if (amount < 2) { setProblem("Le pack ou le modèle ne permet pas deux scènes."); return; }
    setScenes(Array.from({length:amount}, (_,i) => ({ prompt:template(brief,style,amount,i), duration_seconds:firstOffer.duration, action:firstOffer.action })));
  }
  function edit(index:number, field:"prompt"|"action", value:string) {
    setBudget(null);setScenes(rows=>rows.map((s,i)=>i!==index?s: field==="prompt"?{...s,prompt:value}: {
      ...s,action:value,duration_seconds:eligibleOffers.find(o=>o.action===value)?.duration || s.duration_seconds }));
  }
  const total = scenes.reduce((n,s)=>n+s.duration_seconds,0);
  const remaining = caps.max_project_seconds - total;
  async function run(action:()=>Promise<void>) { setBusy(true);setProblem("");setMessage("");try{await action();}catch(e){setProblem(e instanceof Error?e.message:"Opération impossible.");}finally{setBusy(false);} }
  async function estimateProject() { await run(async()=>{
    if(!title.trim()||scenes.length<2||total>caps.max_project_seconds) throw Error("Projet hors limites du pack.");
    const result=await api<{total_estimated_credits:number;maximum_total_reservation_credits:number;credits_sufficient_for_all:boolean;scenes:{scene:number;reservation_credits:number}[]}>("/projects/quote",{
      method:"POST",body:JSON.stringify({title,brief,style,aspect_ratio:ratio,model,generate_audio:audio,continue_from_previous:continuity,scenes})});
    setBudget(result);
  }); }
  async function saveProject() { await run(async()=>{
    if (!title.trim() || total>caps.max_project_seconds || scenes.length<2 || scenes.length>caps.max_project_scenes) throw Error("Durée, nom ou nombre de scènes non conforme au pack.");
    const saved = await api<Project>("/projects",{method:"POST",body:JSON.stringify({title,brief,style,aspect_ratio:ratio,model,generate_audio:audio,continue_from_previous:continuity,scenes})});
    setProject(saved);await refreshList(); setMessage("Storyboard sauvegardé. Chaque scène nécessite son propre devis et ton accord.");
  }); }
  async function loadProject(pid:string) { await run(async()=>{ setProject(await api<Project>(`/projects/${pid}`)); }); }
  async function sync() { if(!project)return; await run(async()=>{
    const result=await api<Project>(`/projects/${project.id}/sync`,{method:"POST"});setProject(result);onWalletRefresh?.();
  }); }
  async function changeScene(position:number,prompt:string) { if(!project)return;await run(async()=>{
    await api(`/projects/${project.id}/scenes/${position}`,{method:"PATCH",body:JSON.stringify({prompt})});
    setProject(await api<Project>(`/projects/${project.id}`));
  }); }
  async function generateScene(scene:Scene) { if(!project)return; await run(async()=>{
    const useReference = project.continue_from_previous && scene.position>1;
    const previousFrame = useReference ? await api<{mime_type:string;base64:string}>(`/projects/${project.id}/scenes/${scene.position}/first-frame`) : null;
    // Always ask the real server for a quote; never infer costs from frontend prices.
    const quote = await api<{reservation_credits:number; estimated_credits:number; credits_sufficient:boolean;generation_available:boolean}>("/quote",{
      method:"POST",body:JSON.stringify({media_type:"video",mode:useReference?"image_to_video":"text_to_video",reference_count:useReference?1:0,
        model:project.model,resolution:"720p",count:1,final_duration_seconds:scene.duration_seconds,
        scene_durations_seconds:[scene.duration_seconds], generate_audio:project.generate_audio}) });
    if (!quote.generation_available || !quote.credits_sufficient) throw Error("Création indisponible ou crédits ORIA insuffisants.");
    if (!window.confirm(`Scène ${scene.position} : maximum ${quote.reservation_credits.toLocaleString("fr-FR")} crédits ORIA réservés. Continuer ?`)) return;
    const claimed=await api<{request_id:string}>(`/projects/${project.id}/scenes/${scene.position}/claim`,{method:"POST"});
    const res=await api<{status:string;error_message?:string}>("/video",{method:"POST",body:JSON.stringify({request_id:claimed.request_id,
      action:scene.action,prompt:scene.prompt,accepted_max_credits:quote.reservation_credits,
      mode:useReference?"image_to_video":"text_to_video",
      ...(previousFrame?{reference_image_b64:previousFrame.base64,reference_mime_type:previousFrame.mime_type}:{}),
      model:project.model,requested_seconds:scene.duration_seconds,
      aspect_ratio:project.aspect_ratio,generate_audio:project.generate_audio})});
    const refreshed=await api<Project>(`/projects/${project.id}/sync`,{method:"POST"});setProject(refreshed); onWalletRefresh?.();
    setMessage(res.status==="refunded" ? (res.error_message||"Création refusée : réservation restituée."):
      "Demande enregistrée. Vérifie le statut avant toute nouvelle tentative.");
  }); }
  async function render() { if(!project)return; await run(async()=>{
    if ((music || voice) && !rights) throw Error("Confirme les droits d'utilisation des pistes audio.");
    const check=await api<{ready:boolean;reasons:string[];status:string}>(`/projects/${project.id}/render-check`);
    if (!check.ready) {
      // Refresh the status after an interrupted previous attempt, without any paid API call.
      setProject(await api<Project>(`/projects/${project.id}`));
      throw Error(check.reasons.join(" ") || "Montage momentanément indisponible.");
    }
    const data=await api<{status:string}>(`/projects/${project.id}/render`,{method:"POST",body:JSON.stringify({
      music_b64: music?await toBase64(music):null,voice_b64:voice?await toBase64(voice):null,
      keep_scene_audio:keepAudio,rights_confirmed:rights,music_volume:0.16,transition})});
    setProject({...project,status:data.status});setMessage("Montage lancé. Actualise l'état du projet pour récupérer le MP4.");
  }); }
  const complete = project?.scenes?.every(s=>s.status==="completed" && s.media_url);
  return <div className="mt-4 rounded-2xl border border-border bg-surface p-4 text-sm sm:p-5">
    <div className="flex items-center gap-2"><Clapperboard size={20}/><h3 className="font-semibold">{tr("Projets vidéo & mini-films", "Video projects & mini-films")}</h3></div>
    <p className="mt-2 text-xs leading-5 text-muted">{tr("Films verticaux, pubs et histoires en plusieurs scènes. Chaque clip est payé séparément ; l'assemblage ne déclenche aucune nouvelle IA payante.", "Vertical stories and ads, created from individually billed short clips; assembly makes no new paid AI requests.")}</p>
    <p className="mt-1 text-xs text-muted">Pack : {packId} · {caps.max_project_seconds}s · {caps.max_project_scenes} {tr("scènes max", "scenes max")}</p>
    {!canUse ? <p className="mt-3 rounded-lg border p-3 text-xs">{tr("Les films multi-scènes ne sont pas inclus dans ce pack.", "Multi-scene films are not included in this pack.")}</p> : <>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" className="rounded-lg border border-border px-3 py-2 text-xs" onClick={()=>{setProject(null);setMessage("");}}>{tr("Nouveau projet", "New project")}</button>
        <button type="button" className="rounded-lg border border-border px-3 py-2 text-xs" onClick={()=>void run(refreshList)}><RefreshCw size={13} className="inline"/> {tr("Mes projets", "My projects")}</button>
        <select className="min-w-0 max-w-[240px] rounded-lg border border-border bg-background p-2 text-xs" value={project?.id||""} onChange={e=>{if(e.target.value)void loadProject(e.target.value)}}>
          <option value="">{tr("Ouvrir un projet existant", "Open existing project")}</option>
          {list.map(p=><option key={p.id} value={p.id}>{p.title} — {p.status}</option>)}
        </select>
      </div>
      {!project ? <div className="mt-4 space-y-3">
        <label className="block text-xs">{tr("Titre du film", "Film title")}<input className="mt-1 w-full rounded-lg border border-border bg-background p-2.5" value={title} maxLength={100} onChange={e=>setTitle(e.target.value)} placeholder="Les aventures d'une mangue"/></label>
        <label className="block text-xs">{tr("Histoire / publicité", "Story / advertisement")}<textarea className="mt-1 w-full rounded-lg border border-border bg-background p-2.5" value={brief} rows={3} maxLength={2500} onChange={e=>setBrief(e.target.value)} placeholder="Une mangue parlante rencontre un ananas dans un marché coloré..."/></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs">{tr("Style visuel", "Visual style")}<select className="mt-1 w-full rounded-lg border border-border bg-background p-2" value={style} onChange={e=>setStyle(e.target.value)}>{["Réaliste cinématographique","Animation 3D expressive","Publicité luxe","Comédie fruits parlants","Mini-fiction dramatique"].map(x=><option key={x}>{x}</option>)}</select></label>
          <label className="text-xs">{tr("Format", "Aspect ratio")}<select className="mt-1 w-full rounded-lg border border-border bg-background p-2" value={ratio} onChange={e=>setRatio(e.target.value)}><option value="9:16">9:16 TikTok</option><option value="16:9">16:9 YouTube</option></select></label>
          <label className="text-xs">{tr("Modèle vidéo (selon pack)", "Video model (by plan)")}<select className="mt-1 w-full rounded-lg border border-border bg-background p-2" value={model} onChange={e=>{setModel(e.target.value);setScenes([]);setContinuity(false);}}>{caps.models?.map(m=><option key={m.model} value={m.model}>{m.model}</option>)}</select></label>
          <label className="flex items-center gap-2 pt-5 text-xs"><input type="checkbox" checked={audio} disabled={!selectedModel?.supports_audio} onChange={e=>setAudio(e.target.checked)}/>{tr("Dialogues et bruitages IA par scène", "AI dialogue and sound per scene")}</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={continuity} disabled={!selectedModel?.supports_first_frame} onChange={e=>setContinuity(e.target.checked)}/>{tr("Raccord visuel : utiliser la dernière image de la scène précédente", "Visual continuity: use prior scene's final frame")}</label>
        </div>
        <button type="button" onClick={createStoryboard} disabled={!firstOffer} className="rounded-lg border border-border px-3 py-2 text-xs"><Plus size={14} className="inline"/> {tr("Préparer les scènes", "Prepare scenes")}</button>
        {scenes.length>0 && <div className="space-y-3">
          {scenes.map((s,i)=><div key={i} className="rounded-lg border border-border p-3"><div className="flex justify-between text-xs font-semibold"><span>Scène {i+1}</span><span>{s.duration_seconds}s</span></div>
            <textarea rows={3} className="mt-2 w-full rounded-lg border border-border bg-background p-2 text-xs" value={s.prompt} onChange={e=>edit(i,"prompt",e.target.value)}/>
            <select className="mt-2 rounded-lg border border-border bg-background p-2 text-xs" value={s.action} onChange={e=>edit(i,"action",e.target.value)}>{eligibleOffers.map(o=><option key={o.action} value={o.action}>{o.label}</option>)}</select>
            <button type="button" className="ml-2 text-xs underline" disabled={scenes.length<=2} onClick={()=>setScenes(rows=>rows.filter((_,j)=>i!==j))}>{tr("Supprimer", "Remove")}</button>
          </div>)}
          <div className="flex items-center justify-between gap-2 text-xs"><span>{total}s / {caps.max_project_seconds}s · {scenes.length}/{caps.max_project_scenes} scènes</span><button disabled={!firstOffer||remaining<firstOffer.duration||scenes.length>=caps.max_project_scenes} className="rounded-lg border border-border px-3 py-2" onClick={()=>setScenes(rows=>[...rows,{prompt:template(brief,style,rows.length+1,rows.length),duration_seconds:firstOffer.duration,action:firstOffer.action}])}>+ {tr("Scène", "Scene")}</button></div>
          <button type="button" disabled={busy||total>caps.max_project_seconds||!title.trim()} onClick={()=>void estimateProject()} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold">{tr("Estimer le coût global (sans débit)", "Estimate total cost (no charge)")}</button>
          {budget && <div className="rounded-lg border border-border bg-surface-secondary p-3 text-xs">
             <p>{tr("Estimation globale", "Total estimate")} : <strong>{budget.total_estimated_credits.toLocaleString("fr-FR")} crédits</strong></p>
             <p>{tr("Réservations maximales cumulées", "Combined maximum reservations")} : <strong>{budget.maximum_total_reservation_credits.toLocaleString("fr-FR")} crédits</strong></p>
             <p>{budget.credits_sufficient_for_all?tr("Solde actuellement suffisant pour toutes les scènes (sous réserve de changement).", "Balance currently sufficient for all scenes (may change)."):
                  tr("Solde insuffisant pour financer toutes les scènes en une fois.", "Insufficient balance for all scenes at once.")}</p>
             <p className="text-muted">{tr("Aucun crédit débité : chaque scène sera confirmée séparément.", "No credits charged: each scene needs separate consent.")}</p>
          </div>}
          <button type="button" disabled={busy||total>caps.max_project_seconds||!title.trim()} onClick={()=>void saveProject()} className="rounded-lg bg-foreground px-4 py-2 text-xs font-semibold text-background">{tr("Enregistrer le projet", "Save project")}</button>
        </div>}
      </div> : <div className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><strong>{project.title}</strong><p className="text-xs text-muted">{project.duration_seconds}s · {project.aspect_ratio} · {project.status}</p></div>
          <button type="button" disabled={busy} className="rounded-lg border border-border p-2 text-xs" onClick={()=>void sync()}><RefreshCw size={14} className="inline"/> {tr("Synchroniser scènes", "Sync scenes")}</button></div>
        {needsStatusTracking && <p className="text-xs text-muted">{tr("Suivi automatique toutes les 30 secondes. Les crédits affichés comme débités peuvent encore correspondre à une réservation. Ne relance pas cette scène.", "Automatically checking every 30 seconds. A reduced credit balance may still be a reservation. Do not resubmit this scene.")}</p>}
        {project.scenes.some(s=>s.status==="reconcile") && <p className="text-xs text-red-600">{tr("Une scène nécessite un contrôle du fournisseur ou de la facturation. Ne relance pas cette scène tant que son statut n'est pas vérifié.", "A scene requires provider or billing reconciliation. Do not retry until it is checked.")}</p>}
        {project.scenes.map(s=><div key={s.id} className="rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-xs">Scène {s.position} · {s.duration_seconds}s</strong><span className="text-xs">{s.status}</span></div>
          <textarea key={`${s.id}:${s.status}`} className="mt-2 w-full rounded-lg border border-border bg-background p-2 text-xs" rows={3} defaultValue={s.prompt} disabled={!!s.request_id && s.status!=="refunded" && s.status!=="failed"} onBlur={e=>{if(e.target.value!==s.prompt && (s.status==="draft"||s.status==="refunded"||s.status==="failed"))void changeScene(s.position,e.target.value)}}/>
          {project.continue_from_previous && s.position>1 && <p className="mt-1 text-[11px] text-muted">{tr("Raccord visuel activé : la scène précédente doit être terminée avant celle-ci.", "Visual continuity: complete prior scene first.")}</p>}
          {s.media_url ? <video controls preload="metadata" className="mt-2 max-h-72 w-full rounded-lg" src={s.media_url}/> : <p className="mt-1 text-xs text-muted">{s.error_message||""}</p>}
          {(s.status==="draft"||s.status==="claimed"||s.status==="refunded"||s.status==="failed") && <button type="button" disabled={busy} className="mt-2 rounded-lg border border-border px-3 py-2 text-xs" onClick={()=>void generateScene(s)}><Play size={12} className="inline"/> {tr("Devis et génération de cette scène", "Quote & generate this scene")}</button>}
        </div>)}
        {complete && project.status!=="completed" && <div className="rounded-xl border border-border bg-surface-secondary p-3 space-y-3">
          <h4 className="flex items-center gap-2 text-xs font-semibold"><Music2 size={15}/> {tr("Montage final et audio", "Final edit and audio")}</h4>
          <label className="block text-xs">{tr("Musique fournie (MP3/WAV, 8 Mo)", "Your music (MP3/WAV, 8 MB)")}<input type="file" accept="audio/*" onChange={e=>setMusic(e.target.files?.[0]||null)} className="mt-1 block w-full text-xs"/></label>
          <label className="block text-xs">{tr("Voix off fournie (optionnelle)", "Your voiceover (optional)")}<input type="file" accept="audio/*" onChange={e=>setVoice(e.target.files?.[0]||null)} className="mt-1 block w-full text-xs"/></label>
          <label className="block text-xs">{tr("Transition entre les scènes", "Scene transition")}
            <select className="mt-1 block rounded-lg border border-border bg-background p-2" value={transition} onChange={e=>setTransition(e.target.value as "fade"|"cut")}> <option value="fade">{tr("Fondu court", "Short fade")}</option><option value="cut">{tr("Coupe nette", "Hard cut")}</option></select>
          </label>
          <label className="flex gap-2 text-xs"><input type="checkbox" checked={keepAudio} onChange={e=>setKeepAudio(e.target.checked)}/> {tr("Conserver l'audio original des scènes", "Keep original scene audio")}</label>
          <label className="flex gap-2 text-xs"><input type="checkbox" checked={rights} onChange={e=>setRights(e.target.checked)}/>{tr("Je dispose des droits sur les pistes ajoutées.", "I have rights to the added tracks.")}</label>
          <button type="button" disabled={busy} onClick={()=>void render()} className="rounded-lg bg-foreground px-4 py-2 text-xs font-semibold text-background"><Film size={14} className="inline"/> {tr("Assembler le MP4 sans nouvelle génération payante", "Assemble MP4 without new paid AI")}</button>
        </div>}
        {project.status==="rendering" && <p className="text-xs text-muted">Montage en cours. L'état est actualisé toutes les 30 secondes. Vérifie avant une éventuelle reprise : aucun nouveau clip IA ne sera généré.</p>}
        {project.status==="render_failed" && <p className="text-xs text-red-600">{project.error_message || "Le rendu a échoué. Réessaie l'assemblage sans générer de nouvelles scènes."}</p>}
        {project.output_url && <div className="space-y-2"><video src={project.output_url} controls className="w-full rounded-xl"/><a href={project.output_url} download className="inline-flex items-center gap-2 text-xs underline"><Download size={13}/> {tr("Télécharger le film", "Download film")}</a></div>}
      </div>}
    </>}
    {busy && <p className="mt-3 flex items-center gap-2 text-xs"><RefreshCw size={13} className="animate-spin"/> {tr("Opération en cours", "Working")}</p>}
    {message && <p className="mt-3 text-xs">{message}</p>}{problem && <p className="mt-3 text-xs text-red-600">{problem}</p>}
    <p className="mt-3 text-[11px] text-muted">{tr("La même identité visuelle d'une scène à l'autre n'est pas garantie. Pas de génération payante automatique ; le modèle peut renvoyer HTTP 429.", "Visual continuity is not guaranteed. No automatic paid retries; provider may return HTTP 429.")}</p>
  </div>;
}
