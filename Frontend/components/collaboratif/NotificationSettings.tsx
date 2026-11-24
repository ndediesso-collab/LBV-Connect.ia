"use client";

import {useCallback,useEffect,useState} from "react";
import {Bell,BellOff,X} from "lucide-react";
import {collabRequest} from "@/lib/collaboratif-api";
import {canUseWebPush,iOSNotInstalled,registerPush,syncExistingPush,
  type PushConfig,type PushSettings} from "@/lib/collab-push";

/** P16 UI légère : pas d'interrupteurs ni d'une page de réglages. */
export default function NotificationSettings({workspaceId,groupId,onClose,onChanged}: {
  workspaceId:string;groupId?:string|null;onClose:()=>void;
  onChanged?:(settings:PushSettings)=>void;
}) {
  const [settings,setSettings]=useState<PushSettings|null>(null);
  const [config,setConfig]=useState<PushConfig|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const root=`/collaboratif/workspaces/${encodeURIComponent(workspaceId)}/push`;
  const refresh=useCallback(async()=>{
    const [prefs,conf]=await Promise.all([
      collabRequest<PushSettings>(`${root}/settings`),
      collabRequest<PushConfig>(`${root}/config`),
    ]);
    if(!prefs.success||prefs.workspace_id!==workspaceId||!conf.success)
      throw new Error("Réglages de notification incorrects.");
    setSettings(prefs);setConfig(conf);
  },[root,workspaceId]);
  useEffect(()=>{void refresh().catch(e=>setError(e instanceof Error?e.message:"Notifications indisponibles."));},[refresh]);

  async function changeGlobal(nextEnabled:boolean){
    if(!settings)return;
    setBusy(true);setError("");setNotice("");
    try{
      if(nextEnabled){
        if(!config?.enabled)throw new Error("Service de notifications non activé.");
        if(!settings.preferences.push_enabled)await registerPush(workspaceId,config.vapid_public_key);
        else await syncExistingPush(workspaceId);
      }
      const next={...settings.preferences,push_enabled:nextEnabled,sound_enabled:false,mode:"all" as const};
      const response=await collabRequest<{success:boolean;workspace_id:string}>(`${root}/settings`,"PATCH",next);
      if(!response.success||response.workspace_id!==workspaceId)throw new Error("Modification non confirmée.");
      const updated={...settings,preferences:next};
      setSettings(updated);onChanged?.(updated);
      setNotice(nextEnabled?"Les alertes sont activées.":"Les alertes sont coupées pour cet espace.");
    }catch(e){setError(e instanceof Error?e.message:"Changement impossible.");}
    finally{setBusy(false);}
  }

  async function toggleGroup(){
    if(!settings||!groupId)return;
    const group=settings.groups.find(g=>g.id===groupId);
    if(!group)return;
    const current=settings.rooms.find(r=>r.group_id===groupId)?.mode??settings.preferences.mode;
    const mode=current==="muted"?"all":"muted";
    setBusy(true);setError("");setNotice("");
    try{
      const response=await collabRequest<{success:boolean;workspace_id:string}>(
        `${root}/groups/${encodeURIComponent(groupId)}/settings`,"PATCH",{mode});
      if(!response.success||response.workspace_id!==workspaceId)throw new Error("Groupe incorrect.");
      const updated: PushSettings={...settings,rooms:[...settings.rooms.filter(r=>r.group_id!==groupId),{group_id:groupId,mode}]};
      setSettings(updated);onChanged?.(updated);
      setNotice(mode==="muted"?`Le groupe ${group.title} est en sourdine.`:`Le groupe ${group.title} n'est plus en sourdine.`);
    }catch(e){setError(e instanceof Error?e.message:"Modification impossible.");}
    finally{setBusy(false);}
  }

  const activeGroup=settings?.groups.find(g=>g.id===groupId);
  const muted=activeGroup && (settings?.rooms.find(r=>r.group_id===groupId)?.mode??settings?.preferences.mode)==="muted";
  const pushEnabled=settings?.preferences.push_enabled===true;
  const unsupported=!canUseWebPush();
  return <section className="mt-3 rounded-xl border border-border bg-background p-3 text-sm" aria-label="Notifications de cet espace">
    <div className="flex items-center justify-between gap-2">
      <strong className="inline-flex items-center gap-2"><Bell size={16}/>Alertes</strong>
      <button type="button" className="rounded-lg p-1" aria-label="Fermer les options" onClick={onClose}><X size={16}/></button>
    </div>
    <p className="mt-1 text-xs text-muted">{pushEnabled?"Alertes activées sur les appareils autorisés.":"Les messages restent visibles dans ORIA."}</p>
    {iOSNotInstalled()&&<p className="mt-2 text-xs text-muted">Sur iPhone, ajoutez ORIA à l'écran d'accueil et ouvrez l'application installée.</p>}
    {unsupported&&<p className="mt-2 text-xs text-muted">Ce navigateur ne prend pas en charge les notifications Push.</p>}
    {!settings?<p className="mt-3 text-xs text-muted">Chargement…</p>:<>
      <button type="button" disabled={busy||!config?.enabled||(!pushEnabled&&unsupported)}
        className="mt-3 w-full rounded-lg bg-foreground px-3 py-2 font-medium text-background disabled:opacity-40"
        onClick={()=>void changeGlobal(!pushEnabled)}>
        {pushEnabled?"Couper les alertes":"Activer les alertes"}
      </button>
      {activeGroup&&<button type="button" disabled={busy}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2"
        onClick={()=>void toggleGroup()}>
        {muted?<Bell size={15}/>:<BellOff size={15}/>}
        {muted?`Réactiver #${activeGroup.title}`:`Mettre #${activeGroup.title} en sourdine`}
      </button>}
    </>}
    {error&&<p role="alert" className="mt-2 text-xs">{error}</p>}
    {notice&&<p role="status" className="mt-2 text-xs">{notice}</p>}
  </section>;
}
