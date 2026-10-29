import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { supabase } from "@/lib/supabase/client";

type Scene = { id:string; position:number; prompt:string; action:string; duration_seconds:number; request_id?:string|null;
  status:string;media_url?:string|null;error_message?:string|null };
type Project = { id:string; title:string; status:string; model:string;aspect_ratio:string;generate_audio:boolean;continue_from_previous:boolean;output_url?:string|null;
  error_message?:string|null;duration_seconds:number;scenes:Scene[] };
type Caps = { max_project_seconds:number;max_project_scenes:number;allowed_modes:string[];
  models?:{model:string;durations:number[];supports_audio:boolean;supports_first_frame?:boolean}[] };
type Props = { language:"fr"|"en";packId:string;caps:Caps;onWalletRefresh?:()=>void };
const API=process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/,"")||"https://lbv-connect-api.onrender.com";
const options:Record<string,{action:string;duration:number}[]>={
  light_pack:[{action:"video_4s",duration:4},{action:"video_8s",duration:8}],
  intermediate_pack:[{action:"video_lite",duration:4}],
  pro_pack:[{action:"video_pro_fast",duration:4},{action:"video_pro_standard",duration:8}],
  business_pack:[{action:"video_business_fast",duration:4},{action:"video_business_standard",duration:8}],
};
const border={borderWidth:1,borderColor:"#c0c0c9",borderRadius:10,padding:10};
const small={fontSize:12,color:"#737382"};
async function call<T>(path:string, options:Record<string,unknown>={}):Promise<T>{
  const {data:{session}}=await supabase.auth.getSession();
  if(!session?.access_token||!session.user?.id)throw new Error("Session ORIA expirée.");
  const res=await fetch(`${API}/ai/openrouter-media${path}`,{...options,headers:{"authorization":`Bearer ${session.access_token}`,
    "user-id":session.user.id,"Content-Type":"application/json"}});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(typeof data.detail==="string"?data.detail:`Erreur serveur ${res.status}`);
  return data as T;
}
export default function OriaVideoProjectsExpo({language,packId,caps,onWalletRefresh}:Props){
  const tr=(fr:string,en:string)=>language==="fr"?fr:en;
  const [title,setTitle]=useState("");const [brief,setBrief]=useState("");const [style,setStyle]=useState("Animation 3D cinématique");
  const [model,setModel]=useState(caps.models?.[0]?.model||"");const [ratio,setRatio]=useState("9:16");
  const [audio,setAudio]=useState(false);const [continuity,setContinuity]=useState(false);const [scenes,setScenes]=useState<{prompt:string;action:string;duration_seconds:number}[]>([]);
  const [budget,setBudget]=useState<{total_estimated_credits:number;maximum_total_reservation_credits:number;credits_sufficient_for_all:boolean}|null>(null);
  const [projects,setProjects]=useState<{id:string;title:string;status:string}[]>([]);
  const [project,setProject]=useState<Project|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [notice,setNotice]=useState("");
  const isSupported=caps.allowed_modes.includes("multi_scene")&&caps.max_project_scenes>=2;
  const selected=(caps.models||[]).find(m=>m.model===model);
  const durations=(options[packId]||[]).filter(o=>selected?.durations.includes(o.duration));
  const offer=durations[0];
  const total=scenes.reduce((a,s)=>a+s.duration_seconds,0);
  async function wrapped(fn:()=>Promise<void>){setBusy(true);setError("");setNotice("");try{await fn()}catch(e){setError(e instanceof Error?e.message:"Opération impossible.")}finally{setBusy(false)}}
  async function refresh(){const d=await call<{projects:typeof projects}>("/projects");setProjects(d.projects||[])}
  useEffect(()=>{void refresh().catch(()=>{})},[]);
  function storyboard(){if(!offer||brief.trim().length<10){setError("Décris ton histoire et choisis un modèle.");return}
    const n=Math.min(3,caps.max_project_scenes,Math.floor(caps.max_project_seconds/offer.duration));
    if(n<2){setError("Ton pack ne permet pas au moins 2 scènes.");return}
    setScenes(Array.from({length:n},(_,i)=>({duration_seconds:offer.duration,action:offer.action,
      prompt:`Bible visuelle commune : ${brief.trim()}. Style ${style}. Scène ${i+1}/${n} : ${i===0?"présentation":i===n-1?"conclusion":"action et dialogues"}. Cohérence des personnages, costumes et éclairage.`})));}
  async function estimate(){await wrapped(async()=>{
    const b=await call<{total_estimated_credits:number;maximum_total_reservation_credits:number;credits_sufficient_for_all:boolean}>("/projects/quote",{
      method:"POST",body:JSON.stringify({title,brief,style,aspect_ratio:ratio,model,generate_audio:audio,continue_from_previous:continuity,scenes})});
    setBudget(b);
  })}
  async function create(){await wrapped(async()=>{if(!title.trim()||scenes.length<2||total>caps.max_project_seconds)throw Error("Projet hors limites du pack.");
    const p=await call<Project>("/projects",{method:"POST",body:JSON.stringify({title,brief,style,aspect_ratio:ratio,model,generate_audio:audio,continue_from_previous:continuity,scenes})});
    setProject(p);await refresh();setNotice("Projet enregistré : confirme le devis de chaque scène.");})}
  async function load(id:string){await wrapped(async()=>{setProject(await call<Project>(`/projects/${id}`))})}
  async function sync(){if(!project)return;await wrapped(async()=>{setProject(await call<Project>(`/projects/${project.id}/sync`,{method:"POST"}));onWalletRefresh?.()})}
  async function changeScene(s:Scene,next:string){if(!project)return;await wrapped(async()=>{
    await call(`/projects/${project.id}/scenes/${s.position}`,{method:"PATCH",body:JSON.stringify({prompt:next})});
    setProject(await call<Project>(`/projects/${project.id}`))})}
  async function generate(s:Scene){if(!project)return;await wrapped(async()=>{
    const useRefFrame=project.continue_from_previous&&s.position>1;
    const previous=useRefFrame?await call<{base64:string;mime_type:string}>(`/projects/${project.id}/scenes/${s.position}/first-frame`):null;
    const quote=await call<{reservation_credits:number;credits_sufficient:boolean;generation_available:boolean}>("/quote",{
      method:"POST",body:JSON.stringify({media_type:"video",mode:useRefFrame?"image_to_video":"text_to_video",reference_count:useRefFrame?1:0,
        model:project.model,resolution:"720p",count:1,final_duration_seconds:s.duration_seconds,
        scene_durations_seconds:[s.duration_seconds],generate_audio:project.generate_audio})});
    if(!quote.generation_available||!quote.credits_sufficient)throw Error("Vidéo indisponible ou crédits ORIA insuffisants.");
    // Approval must happen BEFORE claim/POST, never through background retry.
    await new Promise<void>((resolve,reject)=>Alert.alert("ORIA — Accord de réservation",
      `Scène ${s.position} : maximum ${quote.reservation_credits} crédits ORIA. Continuer ?`,[
        {text:"Annuler",style:"cancel",onPress:()=>reject(new Error("Création annulée."))},
        {text:"Confirmer",onPress:()=>resolve()},]));
    const {request_id}=await call<{request_id:string}>(`/projects/${project.id}/scenes/${s.position}/claim`,{method:"POST"});
    const reply=await call<{status:string;error_message?:string}>("/video",{method:"POST",body:JSON.stringify({
      request_id,action:s.action,prompt:s.prompt,accepted_max_credits:quote.reservation_credits,
      mode:useRefFrame?"image_to_video":"text_to_video",
      ...(previous?{reference_image_b64:previous.base64,reference_mime_type:previous.mime_type}:{}),
      model:project.model,requested_seconds:s.duration_seconds,
      aspect_ratio:project.aspect_ratio,generate_audio:project.generate_audio})});
    setProject(await call<Project>(`/projects/${project.id}/sync`,{method:"POST"}));onWalletRefresh?.();
    setNotice(reply.status==="refunded"?(reply.error_message||"Crédits restitués."):"Création transmise, vérifie le statut.");
  })}
  async function render(){if(!project)return;await wrapped(async()=>{
    await call(`/projects/${project.id}/render`,{method:"POST",body:JSON.stringify({keep_scene_audio:true,rights_confirmed:false})});
    setProject({...project,status:"rendering"});setNotice("Montage lancé. Reviens consulter le projet pour le MP4.");
  })}
  const Button=({label,onPress,disabled=false}:{label:string;onPress:()=>void;disabled?:boolean})=><Pressable disabled={disabled||busy}
    onPress={onPress} style={[border,{alignSelf:"flex-start",marginTop:8,backgroundColor:"#20202c",opacity:disabled||busy?.5:1}]}>
      <Text style={{color:"white",fontSize:12,fontWeight:"600"}}>{label}</Text></Pressable>;
  return <View style={[border,{marginTop:16,gap:10}]}>
    <Text style={{fontWeight:"700",fontSize:16}}>🎬 {tr("Mini-films et publicités", "Mini films and ads")}</Text>
    <Text style={small}>{tr(`Pack ${packId} · ${caps.max_project_scenes} scènes · ${caps.max_project_seconds} s maximum. Chaque clip est facturé individuellement.`,
      `Plan ${packId} · ${caps.max_project_scenes} scenes · ${caps.max_project_seconds}s max. Clips billed individually.`)}</Text>
    {!isSupported?<Text style={small}>{tr("Le montage multi-scènes n'est pas inclus dans ce pack.","Multi-scene films aren't included in this plan.")}</Text>:<>
      <View style={{flexDirection:"row",flexWrap:"wrap",gap:8}}>
        <Button label={tr("Nouveau","New")} onPress={()=>setProject(null)}/>
        <Button label={tr("Mes projets","My projects")} onPress={()=>void wrapped(refresh)}/>
      </View>
      {projects.map(p=><Pressable key={p.id} onPress={()=>void load(p.id)} style={{paddingVertical:5}}><Text style={{fontSize:12,textDecorationLine:"underline"}}>{p.title} — {p.status}</Text></Pressable>)}
      {!project?<View style={{gap:8}}>
        <TextInput placeholder={tr("Titre du film","Film title")} style={border} value={title} maxLength={100} onChangeText={setTitle}/>
        <TextInput placeholder={tr("Décris le mini-film ou la pub","Describe film or ad")} style={[border,{minHeight:76}]} multiline value={brief} maxLength={2500} onChangeText={setBrief}/>
        <TextInput placeholder="Style" style={border} value={style} onChangeText={setStyle}/>
        <Text style={small}>{tr("Modèles disponibles selon ton pack", "Models available for your plan")}</Text>
        {(caps.models||[]).map(m=><Pressable key={m.model} onPress={()=>{setModel(m.model);setScenes([]);setAudio(false);setContinuity(false)}} style={{padding:5}}><Text style={{fontSize:12,color:model===m.model?"#6855b6":"#777"}}>{model===m.model?"● ":"○ "}{m.model}</Text></Pressable>)}
        <View style={{flexDirection:"row",gap:15}}><Button label={ratio==="9:16"?"✓ 9:16":"9:16"} onPress={()=>setRatio("9:16")}/><Button label={ratio==="16:9"?"✓ 16:9":"16:9"} onPress={()=>setRatio("16:9")}/></View>
        <Button label={audio?"✓ Avec dialogues IA":"Sans audio IA"} disabled={!selected?.supports_audio} onPress={()=>setAudio(v=>!v)}/>
        <Button label={continuity?"✓ Raccord visuel":"Raccord visuel scène suivante"} disabled={!selected?.supports_first_frame} onPress={()=>setContinuity(v=>!v)}/>
        <Button label={tr("Préparer le storyboard","Prepare storyboard")} disabled={!offer} onPress={storyboard}/>
        {scenes.map((s,i)=><View key={i} style={border}><Text style={small}>Scène {i+1} · {s.duration_seconds}s</Text>
          <TextInput multiline style={[border,{minHeight:90,marginTop:6}]} value={s.prompt} onChangeText={t=>setScenes(rows=>rows.map((r,j)=>j===i?{...r,prompt:t}:r))}/>
          <View style={{flexDirection:"row",gap:10,flexWrap:"wrap"}}>{durations.map(o=><Button key={o.action} label={`${o.duration}s${s.action===o.action?" ✓":""}`} onPress={()=>setScenes(rows=>rows.map((r,j)=>j===i?{...r,action:o.action,duration_seconds:o.duration}:r))}/>)}</View>
          <Button label={tr("Supprimer scène","Remove scene")} disabled={scenes.length<=2} onPress={()=>setScenes(rows=>rows.filter((_,j)=>j!==i))}/>
        </View>)}
        {scenes.length>0?<><Text style={small}>{total}s / {caps.max_project_seconds}s</Text><Button label="+ Scène" disabled={!offer||scenes.length>=caps.max_project_scenes||total+offer.duration>caps.max_project_seconds} onPress={()=>setScenes(rows=>[...rows,{prompt:`${brief}. Suite de la scène ${rows.length}. Même personnages et ambiance.`,action:offer.action,duration_seconds:offer.duration}])}/>
          <Button label={tr("Estimer le coût total","Estimate total cost")} disabled={total>caps.max_project_seconds||!title.trim()} onPress={()=>void estimate()}/>
          {budget?<Text style={small}>Estimation : {budget.total_estimated_credits} crédits · Réservation cumulée : {budget.maximum_total_reservation_credits} · {budget.credits_sufficient_for_all?"Solde suffisant":"Solde insuffisant"}. Devis sans débit.</Text>:null}
          <Button label={tr("Enregistrer le projet","Save project")} disabled={total>caps.max_project_seconds} onPress={()=>void create()}/></>:null}
      </View>:<View style={{gap:8}}>
        <Text style={{fontWeight:"700"}}>{project.title} · {project.status}</Text>
        <Button label={tr("Synchroniser les scènes","Sync scenes")} onPress={()=>void sync()}/>
        {project.scenes.map(s=><View key={s.id} style={border}><Text style={small}>Scène {s.position} · {s.duration_seconds}s · {s.status}</Text>
          <TextInput key={s.id+":"+s.status} defaultValue={s.prompt} multiline editable={!s.request_id||s.status==="refunded"||s.status==="failed"}
            style={[border,{minHeight:76,marginTop:7}]} onEndEditing={e=>{if(e.nativeEvent.text!==s.prompt)void changeScene(s,e.nativeEvent.text)}}/>
          {s.media_url?<Button label={tr("Voir le clip","View clip")} onPress={()=>void Linking.openURL(s.media_url||"")}/>:null}
          {s.error_message?<Text style={small}>{s.error_message}</Text>:null}
          {(["draft","claimed","failed","refunded"].includes(s.status))?<Button label={tr("Devis + générer cette scène","Quote + generate scene")} onPress={()=>void generate(s)}/>:null}
        </View>)}
        {project.scenes.every(s=>s.status==="completed"&&!!s.media_url) && project.status!=="completed" ? <>
          <Text style={small}>{tr("Le montage conserve les voix et bruitages de chaque clip. Pour ajouter une musique externe ou une voix off, utilise la version Web.",
            "The edit keeps each clip's sounds. For external music or voiceover use the Web version.")}</Text>
          <Button label={tr("Assembler le film MP4","Assemble MP4 film")} disabled={project.status==="rendering"} onPress={()=>void render()}/>
        </>:null}
        {project.output_url?<Button label={tr("Ouvrir le film final","Open final film")} onPress={()=>void Linking.openURL(project.output_url||"")}/>:null}
        {project.error_message?<Text style={small}>{project.error_message}</Text>:null}
      </View>}
    </>}
    {busy?<ActivityIndicator/>:null}{notice?<Text style={small}>{notice}</Text>:null}{error?<Text style={{color:"#b42318",fontSize:12}}>{error}</Text>:null}
    <Text style={small}>{tr("Pas de nouvelle génération payante automatique. Un HTTP 429 peut persister sur OpenRouter.","No automatic paid retries. HTTP 429 may persist on OpenRouter.")}</Text>
  </View>
}
