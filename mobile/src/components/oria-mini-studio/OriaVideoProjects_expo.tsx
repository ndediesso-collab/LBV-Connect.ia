import React, { useEffect, useRef, useState } from "react";
import Animated, { FadeInDown, useReducedMotion } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { VideoView, useVideoPlayer } from "expo-video";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { ActivityIndicator, Alert, AppState, Linking, Modal, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from "react-native";
import { supabase } from "@/lib/supabase/client";

type Scene = { id:string; position:number; prompt:string; action:string; duration_seconds:number; request_id?:string|null;
  status:string;media_url?:string|null;error_message?:string|null };
type Project = { id:string; title:string; status:string; model:string;aspect_ratio:string;generate_audio:boolean;continue_from_previous:boolean;output_url?:string|null;
  error_message?:string|null;duration_seconds:number;scenes:Scene[] };
type Caps = { max_project_seconds:number;max_project_scenes:number;allowed_modes:string[];
  models?:{model:string;durations:number[];supports_audio:boolean;supports_first_frame?:boolean}[] };
type Props = { language:"fr"|"en";packId:string;caps:Caps;theme?:"light"|"dark";onWalletRefresh?:()=>void };
const API=process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/,"")||"https://lbv-connect-api.onrender.com";
const options:Record<string,{action:string;duration:number}[]>={
  light_pack:[{action:"video_4s",duration:4},{action:"video_8s",duration:8}],
  intermediate_pack:[{action:"video_lite",duration:4}],
  pro_pack:[{action:"video_pro_fast",duration:4},{action:"video_pro_standard",duration:8}],
  business_pack:[{action:"video_business_fast",duration:4},{action:"video_business_standard",duration:8}],
};
async function call<T>(path:string, options:Record<string,unknown>={}):Promise<T>{
  const {data:{session}}=await supabase.auth.getSession();
  if(!session?.access_token||!session.user?.id)throw new Error("Session ORIA expirée.");
  const res=await fetch(`${API}/ai/openrouter-media${path}`,{...options,headers:{"authorization":`Bearer ${session.access_token}`,
    "user-id":session.user.id,"Content-Type":"application/json"}});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(typeof data.detail==="string"?data.detail:`Erreur serveur ${res.status}`);
  return data as T;
}
/** Un lecteur natif uniquement quand l’utilisateur ouvre un clip. */
function ClipPlayer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, instance => { instance.loop = false; instance.play(); });
  return <VideoView player={player} style={projectStyles.player} nativeControls contentFit="contain" />;
}

export default function OriaVideoProjectsExpo({language,packId,caps,theme="light",onWalletRefresh}:Props){
  const dark = theme === "dark";
  const reduceMotion = useReducedMotion();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const openPreview = (url: string | null | undefined) => {
    if (!url || !/^https:\/\/[^\s/]+/i.test(url)) {
      setError(tr("Aperçu sécurisé indisponible.", "Secure preview unavailable."));
      return;
    }
    setPreviewUrl(url);
  };
  const C = dark ? {
    bg:"#000000", card:"rgba(255,255,255,0.045)", field:"#191919", line:"rgba(255,255,255,0.14)", text:"#ffffff",
    muted:"#bcbcbc", button:"#ffffff", onButton:"#000000", selected:"#ffffff",
  } : {
    bg:"#ffffff", card:"#ffffff", field:"#f7f7f7", line:"#e8e8e8", text:"#111111",
    muted:"#666666", button:"#000000", onButton:"#ffffff", selected:"#111111",
  };
  const small={fontSize:12,color:C.muted,lineHeight:20};
  const field={borderWidth:1,borderColor:C.line,borderRadius:15,padding:15,
    minHeight:50,backgroundColor:C.field,color:C.text,fontSize:14,lineHeight:21};
  const tr=(fr:string,en:string)=>language==="fr"?fr:en;
  const [title,setTitle]=useState("");const [brief,setBrief]=useState("");const [style,setStyle]=useState("Animation 3D cinématique");
  const [model,setModel]=useState(caps.models?.[0]?.model||"");const [ratio,setRatio]=useState("9:16");
  const [audio,setAudio]=useState(false);const [continuity,setContinuity]=useState(false);const [scenes,setScenes]=useState<{prompt:string;action:string;duration_seconds:number}[]>([]);
  const [budget,setBudget]=useState<{total_estimated_credits:number;maximum_total_reservation_credits:number;credits_sufficient_for_all:boolean}|null>(null);
  const [projects,setProjects]=useState<{id:string;title:string;status:string}[]>([]);
  const [project,setProject]=useState<Project|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [notice,setNotice]=useState("");
  const walletRef = useRef(onWalletRefresh);
  useEffect(() => { walletRef.current = onWalletRefresh; }, [onWalletRefresh]);
  const activeProjectId = project?.id;
  const needsStatusTracking = !!project && (project.status === "rendering" ||
    project.scenes.some(s => ["processing", "claimed"].includes(s.status) && !!s.request_id));
  // Check existing jobs only, never start another paid generation.
  useEffect(() => {
    if (!activeProjectId || !needsStatusTracking) return;
    let stopped = false;
    let inFlight = false;
    const timer = setInterval(() => {
      if (stopped || inFlight || AppState.currentState !== "active") return;
      inFlight = true;
      void call<Project>(`/projects/${activeProjectId}/sync`, { method: "POST" })
        .then(latest => {
          if (stopped) return;
          setProject(current => current?.id === activeProjectId ? latest : current);
          walletRef.current?.();
        })
        .catch(() => { /* Manual synchronisation remains available. */ })
        .finally(() => { inFlight = false; });
    }, 30000);
    return () => { stopped = true; clearInterval(timer); };
  }, [activeProjectId, needsStatusTracking]);
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
    const check=await call<{ready:boolean;reasons:string[];status:string}>(`/projects/${project.id}/render-check`);
    if(!check.ready){setProject(await call<Project>(`/projects/${project.id}`));throw Error(check.reasons.join(" ")||"Montage indisponible.");}
    await call(`/projects/${project.id}/render`,{method:"POST",body:JSON.stringify({keep_scene_audio:true,rights_confirmed:false})});
    setProject({...project,status:"rendering"});setNotice("Montage lancé. Reviens consulter le projet pour le MP4.");
  })}
  type ProjectActionProps = {
    label: string;
    onPress: () => void;
    disabled?: boolean;
    primary?: boolean;
    icon?: React.ComponentProps<typeof Ionicons>["name"];
  };
  const Button = ({label,onPress,disabled=false,primary=false,icon}: ProjectActionProps) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [projectStyles.action,
        { backgroundColor: primary ? C.button : C.field, borderColor: primary ? C.button : C.line,
          opacity: disabled || busy ? 0.43 : pressed ? 0.77 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }] },
      ]}
    >
      {icon ? <Ionicons name={icon} size={17} color={primary ? C.onButton : C.text} /> : null}
      <Text style={[projectStyles.actionText, { color: primary ? C.onButton : C.text }]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={[projectStyles.shell, { backgroundColor: C.card, borderColor: C.line }]}>
      <View style={projectStyles.hero}>
        <View style={[projectStyles.heroIcon, { backgroundColor: C.field, borderColor: C.line }]}>
          <Ionicons name="film-outline" color={C.text} size={25} />
        </View>
        <View style={projectStyles.heroContent}>
          <Text style={[projectStyles.overline, { color: C.muted }]}>ORIA / STUDIO FILMS</Text>
          <Text style={[projectStyles.heading, { color: C.text }]}>{tr("Mini-films et publicités", "Mini films and ads")}</Text>
          <Text style={small}>
            {tr(`Pack ${packId} · ${caps.max_project_scenes} scènes · ${caps.max_project_seconds} s maximum. Chaque clip est facturé individuellement.`,
              `Plan ${packId} · ${caps.max_project_scenes} scenes · ${caps.max_project_seconds}s max. Each clip is billed individually.`)}
          </Text>
        </View>
      </View>
      {!isSupported ? (
        <View style={[projectStyles.notice, { backgroundColor: C.field, borderColor: C.line }]}>
          <Ionicons name="lock-closed-outline" size={18} color={C.muted} />
          <Text style={[small, { flex: 1 }]}>{tr("Le montage multi-scènes n'est pas inclus dans ce pack.", "Multi-scene films are not included in this plan.")}</Text>
        </View>
      ) : (
        <>
          <View style={projectStyles.actionRow}>
            <Button icon="add-outline" label={tr("Nouveau projet", "New project")} primary={!project} onPress={() => setProject(null)} />
            <Button icon="albums-outline" label={tr("Mes projets", "My projects")} onPress={() => void wrapped(refresh)} />
          </View>
          {projects.length > 0 ? (
            <View style={projectStyles.history}>
              <Text style={[projectStyles.sectionEyebrow, { color: C.muted }]}>{tr("PROJETS ENREGISTRÉS", "SAVED PROJECTS")}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={projectStyles.historyRow}>
                {projects.map(p => (
                  <Pressable key={p.id} accessibilityRole="button" onPress={() => void load(p.id)}
                    style={({ pressed }) => [projectStyles.historyChip, { backgroundColor: project?.id === p.id ? C.button : C.field,
                      borderColor: project?.id === p.id ? C.button : C.line, opacity: pressed ? 0.75 : 1 }]}>
                    <Ionicons name="folder-open-outline" size={14} color={project?.id === p.id ? C.onButton : C.muted} />
                    <Text numberOfLines={1} style={[projectStyles.chipText, { color: project?.id === p.id ? C.onButton : C.text }]}>{p.title}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}

          {!project ? (
            <View style={projectStyles.form}>
              <Text style={[projectStyles.sectionEyebrow, { color: C.muted }]}>{tr("01 / VOTRE IDÉE", "01 / YOUR IDEA")}</Text>
              <TextInput accessibilityLabel={tr("Titre du film", "Film title")}
                placeholder={tr("Titre du film", "Film title")}
                style={field} placeholderTextColor={C.muted} value={title} maxLength={100} onChangeText={t => {setTitle(t); setBudget(null);}}/>
              <TextInput accessibilityLabel={tr("Description du film", "Film description")}
                placeholder={tr("Décris le mini-film ou la pub", "Describe your film or ad")}
                style={[field, projectStyles.multilineField]} placeholderTextColor={C.muted}
                multiline textAlignVertical="top" value={brief} maxLength={2500} onChangeText={t => {setBrief(t); setBudget(null);}}/>
              <TextInput accessibilityLabel={tr("Style du film", "Film style")} placeholder={tr("Style visuel", "Visual style")}
                style={field} placeholderTextColor={C.muted} value={style} onChangeText={t => {setStyle(t); setBudget(null);}}/>

              <Text style={[projectStyles.sectionEyebrow, { color: C.muted }]}>{tr("02 / CONFIGURATION", "02 / CONFIGURATION")}</Text>
              <Text style={[projectStyles.fieldLabel, { color: C.text }]}>{tr("Modèle vidéo", "Video model")}</Text>
              <View style={projectStyles.modelList}>
                {(caps.models || []).map(m => (
                  <Pressable key={m.model} accessibilityRole="radio"
                    accessibilityState={{ checked: model === m.model }}
                    onPress={() => {setModel(m.model); setScenes([]); setAudio(false); setContinuity(false); setBudget(null);}}
                    style={({ pressed }) => [projectStyles.modelRow,
                      { borderColor: model === m.model ? C.text : C.line,
                        backgroundColor: model === m.model ? C.field : C.card,
                        opacity: pressed ? 0.8 : 1 }]}
                  >
                    <Ionicons name={model === m.model ? "radio-button-on" : "radio-button-off"}
                      size={20} color={C.text} />
                    <Text numberOfLines={2} style={[projectStyles.modelText, { color: C.text }]}>{m.model}</Text>
                    {model === m.model ? <Ionicons name="checkmark" size={17} color={C.text} /> : null}
                  </Pressable>
                ))}
              </View>
              <Text style={[projectStyles.fieldLabel, { color: C.text }]}>{tr("Format vidéo", "Video format")}</Text>
              <View style={projectStyles.actionRow}>
                <Button label={ratio === "9:16" ? "✓ Vertical 9:16" : "Vertical 9:16"} primary={ratio === "9:16"} onPress={() => {setRatio("9:16"); setBudget(null);}} />
                <Button label={ratio === "16:9" ? "✓ Paysage 16:9" : "Paysage 16:9"} primary={ratio === "16:9"} onPress={() => {setRatio("16:9"); setBudget(null);}} />
              </View>
              <View style={projectStyles.actionRow}>
                <Button icon="volume-high-outline" label={audio ? tr("✓ Audio IA", "✓ AI audio") : tr("Sans audio IA", "No AI audio")}
                  disabled={!selected?.supports_audio} onPress={() => {setAudio(v => !v); setBudget(null);}} />
                <Button icon="git-compare-outline" label={continuity ? tr("✓ Raccord visuel", "✓ Frame continuity") : tr("Raccord visuel", "Frame continuity")}
                  disabled={!selected?.supports_first_frame} onPress={() => {setContinuity(v => !v); setBudget(null);}} />
              </View>

              <Text style={[projectStyles.sectionEyebrow, { color: C.muted }]}>{tr("03 / STORYBOARD", "03 / STORYBOARD")}</Text>
              <Text style={small}>{tr("Chaque scène sera générée séparément après validation de son devis.",
                "Each scene is generated separately after you approve its quote.")}</Text>
              <Button icon="color-wand-outline" label={tr("Préparer le storyboard", "Prepare storyboard")} primary
                disabled={!offer} onPress={() => {storyboard(); setBudget(null);}} />
              {scenes.map((s, i) => (
                <Animated.View key={i} entering={reduceMotion ? undefined : FadeInDown.duration(260)}
                  style={[projectStyles.sceneCard, { borderColor: C.line, backgroundColor: C.field }]}>
                  <View style={projectStyles.sceneTop}>
                    <View style={[projectStyles.sceneNumber, { backgroundColor: C.button }]}>
                      <Text style={[projectStyles.sceneNumberText, { color: C.onButton }]}>{String(i + 1).padStart(2, "0")}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[projectStyles.sceneTitle, { color: C.text }]}>{tr("Scène", "Scene")} {i + 1}</Text>
                      <Text style={small}>{s.duration_seconds} s · {s.action}</Text>
                    </View>
                    <Pressable accessibilityRole="button" accessibilityLabel={tr("Supprimer la scène", "Remove scene")}
                      disabled={scenes.length <= 2} onPress={() => {setScenes(rows => rows.filter((_, j) => j !== i)); setBudget(null);}}
                      style={{ opacity: scenes.length <= 2 ? 0.35 : 1, padding: 7 }}>
                      <Ionicons name="trash-outline" size={19} color={C.muted} />
                    </Pressable>
                  </View>
                  <TextInput multiline textAlignVertical="top" style={[field, projectStyles.sceneInput]}
                    value={s.prompt} placeholderTextColor={C.muted}
                    onChangeText={t => {setScenes(rows => rows.map((r,j) => j === i ? {...r,prompt:t} : r)); setBudget(null);}}/>
                  <View style={projectStyles.actionRow}>
                    {durations.map(o => <Button key={o.action} label={`${o.duration}s${s.action === o.action ? " ✓" : ""}`}
                      primary={s.action === o.action}
                      onPress={() => {setScenes(rows => rows.map((r,j) => j === i ? {...r,action:o.action,duration_seconds:o.duration} : r)); setBudget(null);}} />)}
                  </View>
                </Animated.View>
              ))}
              {scenes.length > 0 ? (
                <View style={[projectStyles.summary, { backgroundColor: C.field, borderColor: C.line }]}>
                  <View style={projectStyles.summaryRow}>
                    <Text style={[projectStyles.fieldLabel, { color: C.text }]}>{tr("Durée totale", "Total duration")}</Text>
                    <Text style={[projectStyles.metric, { color: C.text }]}>{total} / {caps.max_project_seconds} s</Text>
                  </View>
                  <View style={[projectStyles.progressTrack, { backgroundColor: C.line }]}>
                    <View style={[projectStyles.progressFill, { backgroundColor: C.button,
                      width: `${Math.min(100, caps.max_project_seconds > 0 ? total / caps.max_project_seconds * 100 : 0)}%` as `${number}%` }]} />
                  </View>
                  <Button icon="add-circle-outline" label={tr("Ajouter une scène", "Add scene")}
                    disabled={!offer || scenes.length >= caps.max_project_scenes || total + offer.duration > caps.max_project_seconds}
                    onPress={() => {setScenes(rows => [...rows, {prompt: `${brief}. Suite de la scène ${rows.length}. Même personnages et ambiance.`,
                      action:offer.action,duration_seconds:offer.duration}]); setBudget(null);}} />
                  <Button icon="calculator-outline" label={tr("Estimer le coût total", "Estimate total cost")}
                    disabled={total > caps.max_project_seconds || !title.trim()} onPress={() => void estimate()} />
                  {budget ? (
                    <View style={[projectStyles.notice, { backgroundColor: C.card, borderColor: C.line }]}>
                      <Ionicons name="information-circle-outline" color={C.text} size={20} />
                      <Text style={[small, { flex: 1 }]}>
                        {tr("Estimation", "Estimate")}: {budget.total_estimated_credits} {tr("crédits", "credits")} · {tr("Réservation maximale", "Maximum reservation")}: {budget.maximum_total_reservation_credits} · {budget.credits_sufficient_for_all ? tr("Solde suffisant", "Sufficient balance") : tr("Solde insuffisant", "Insufficient balance")}. {tr("Devis sans débit", "No charge for quote")}.
                      </Text>
                    </View>
                  ) : null}
                  <Button icon="save-outline" primary label={tr("Enregistrer le projet", "Save project")}
                    disabled={total > caps.max_project_seconds} onPress={() => void create()} />
                </View>
              ) : null}
            </View>
          ) : (
            <View style={projectStyles.form}>
              <View style={[projectStyles.projectHeader, { borderColor: C.line, backgroundColor: C.field }]}>
                <View style={{ flex: 1, gap: 5 }}>
                  <Text style={[projectStyles.overline, { color: C.muted }]}>{tr("PROJET EN COURS", "CURRENT PROJECT")}</Text>
                  <Text style={[projectStyles.heading, { color: C.text }]}>{project.title}</Text>
                  <Text style={small}>{project.status}</Text>
                </View>
                <Ionicons name="videocam-outline" size={24} color={C.text} />
              </View>
              <Button icon="refresh-outline" label={tr("Synchroniser les scènes", "Sync scenes")} onPress={() => void sync()} />
              {needsStatusTracking ? (
                <View style={[projectStyles.notice, { backgroundColor: C.field, borderColor: C.line }]}>
                  <ActivityIndicator size="small" color={C.text} />
                  <Text style={[small, { flex: 1 }]}>{tr("Suivi automatique toutes les 30 secondes. Une baisse du solde peut être une réservation. Ne relance pas la scène.",
                    "Status checked every 30 seconds. A lower balance may be a reservation. Do not resubmit the scene.")}</Text>
                </View>
              ) : null}
              {project.scenes.some(s => s.status === "reconcile") ? (
                <Text style={projectStyles.errorText}>{tr("Vérification du fournisseur ou de la facturation nécessaire. Ne relance pas cette scène.",
                  "Provider or billing review required. Do not retry this scene.")}</Text>
              ) : null}
              {project.scenes.map(s => (
                <Animated.View key={s.id} entering={reduceMotion ? undefined : FadeInDown.duration(260)}
                  style={[projectStyles.sceneCard, { backgroundColor: C.field, borderColor: C.line }]}>
                  <View style={projectStyles.sceneTop}>
                    <View style={[projectStyles.sceneNumber, { backgroundColor: C.button }]}>
                      <Text style={[projectStyles.sceneNumberText, { color: C.onButton }]}>{String(s.position).padStart(2, "0")}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[projectStyles.sceneTitle, { color: C.text }]}>{tr("Scène", "Scene")} {s.position}</Text>
                      <Text style={small}>{s.duration_seconds} s · {s.status}</Text>
                    </View>
                    {s.status === "completed" ? <Ionicons name="checkmark-circle" size={23} color={C.text} /> : null}
                  </View>
                  <TextInput key={`${s.id}:${s.status}`} defaultValue={s.prompt} multiline
                    editable={!s.request_id || s.status === "refunded" || s.status === "failed"}
                    style={[field, projectStyles.sceneInput]}
                    onEndEditing={e => { if (e.nativeEvent.text !== s.prompt) void changeScene(s, e.nativeEvent.text); }} />
                  <View style={projectStyles.actionRow}>
                    {s.media_url ? <Button icon="play-circle-outline" primary
                      label={tr("Voir le clip", "Preview clip")} onPress={() => openPreview(s.media_url)}/> : null}
                    {(["draft", "claimed", "failed", "refunded"].includes(s.status)) ?
                      <Button icon="sparkles-outline" label={tr("Devis + générer cette scène", "Quote + generate scene")}
                        onPress={() => void generate(s)} /> : null}
                  </View>
                  {s.error_message ? <Text style={projectStyles.errorText}>{s.error_message}</Text> : null}
                </Animated.View>
              ))}
              {project.scenes.every(s => s.status === "completed" && !!s.media_url) && project.status !== "completed" ? (
                <View style={[projectStyles.summary, { backgroundColor: C.field, borderColor: C.line }]}>
                  <Text style={small}>{tr("Le montage conserve les sons des clips. Pour ajouter une musique externe ou une voix off, utilisez la version Web.",
                    "The edit keeps clip audio. For an external soundtrack or voiceover, use the Web version.")}</Text>
                  <Button icon="cut-outline" primary label={tr("Assembler le film MP4", "Assemble MP4 film")}
                    onPress={() => void render()}/>
                </View>
              ) : null}
              {project.output_url ? (
                <Button icon="play-circle-outline" primary label={tr("Voir le film final", "Preview final film")}
                  onPress={() => openPreview(project.output_url)} />
              ) : null}
              {project.error_message ? <Text style={projectStyles.errorText}>{project.error_message}</Text> : null}
            </View>
          )}
        </>
      )}
      {busy ? <View style={projectStyles.busyRow}><ActivityIndicator color={C.text}/><Text style={small}>{tr("Opération en cours…", "Processing…")}</Text></View> : null}
      {notice ? <View style={[projectStyles.notice, { backgroundColor: C.field, borderColor: C.line }]}>
        <Ionicons name="information-circle-outline" size={19} color={C.text}/>
        <Text style={[small, { flex: 1, color: C.text }]}>{notice}</Text>
      </View> : null}
      {error ? <View style={projectStyles.errorBox}><Text style={projectStyles.errorText}>{error}</Text></View> : null}
      <Text style={[small, projectStyles.footerNote]}>{tr("Aucune génération payante n’est relancée automatiquement. Les erreurs HTTP 429 peuvent persister chez OpenRouter.",
        "No automatic paid retry. HTTP 429 errors can persist on OpenRouter.")}</Text>

      <Modal visible={Boolean(previewUrl)} animationType="slide" presentationStyle="fullScreen"
        statusBarTranslucent={Platform.OS === "android"} onRequestClose={() => setPreviewUrl(null)}>
        <SafeAreaProvider style={projectStyles.previewRoot}>
          <StatusBar barStyle="light-content" />
          <SafeAreaView style={projectStyles.previewRoot} edges={["top", "bottom", "left", "right"]}>
            <View style={projectStyles.previewBar}>
              <Text style={projectStyles.previewTitle}>{tr("Aperçu ORIA", "ORIA preview")}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={tr("Fermer l’aperçu", "Close preview")}
                onPress={() => setPreviewUrl(null)} style={projectStyles.previewClose}>
                <Ionicons name="close" size={23} color="#ffffff" />
              </Pressable>
            </View>
            {previewUrl ? <ClipPlayer key={previewUrl} uri={previewUrl} /> : null}
            <View style={projectStyles.previewActions}>
              <Pressable accessibilityRole="button" style={projectStyles.previewExternal}
                onPress={() => { if (previewUrl) void Linking.openURL(previewUrl).catch(() => setError("Lien indisponible.")); }}>
                <Ionicons name="open-outline" color="#ffffff" size={18}/>
                <Text style={projectStyles.previewExternalText}>{tr("Ouvrir dans le lecteur externe", "Open in external player")}</Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
    </View>
  );
}

const projectStyles = StyleSheet.create({
  shell: { borderWidth: 1, borderRadius: 26, padding: 19, gap: 20, marginTop: 12 },
  hero: { flexDirection: "row", gap: 13, alignItems: "flex-start" },
  heroIcon: { height: 52, width: 52, borderWidth: 1, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  heroContent: { flex: 1, gap: 5 },
  overline: { fontSize: 10, fontWeight: "800", letterSpacing: 1.25 },
  heading: { fontSize: 19, fontWeight: "800", letterSpacing: -0.45, lineHeight: 25 },
  form: { gap: 13 },
  sectionEyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.4, marginTop: 12 },
  fieldLabel: { fontSize: 13, fontWeight: "700" },
  multilineField: { minHeight: 106 },
  modelList: { gap: 8 },
  modelRow: { minHeight: 50, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderRadius: 15,
    flexDirection: "row", gap: 12, alignItems: "center" },
  modelText: { flex: 1, fontSize: 13, fontWeight: "700" },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  action: { minHeight: 45, borderRadius: 15, paddingHorizontal: 15, paddingVertical: 10,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderWidth: 1 },
  actionText: { fontWeight: "800", fontSize: 12, lineHeight: 19 },
  history: { gap: 9 },
  historyRow: { flexDirection: "row", gap: 8, paddingVertical: 2 },
  historyChip: { minHeight: 38, maxWidth: 220, flexDirection: "row", gap: 6, alignItems: "center",
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 12 },
  chipText: { fontSize: 12, fontWeight: "700", maxWidth: 176 },
  sceneCard: { borderWidth: 1, borderRadius: 20, padding: 15, gap: 13 },
  sceneTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  sceneNumber: { height: 38, width: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  sceneNumberText: { fontSize: 12, fontWeight: "900" },
  sceneTitle: { fontWeight: "800", fontSize: 15 },
  sceneInput: { minHeight: 104 },
  summary: { borderWidth: 1, borderRadius: 20, padding: 16, gap: 13 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  metric: { fontSize: 16, fontWeight: "800", letterSpacing: -0.3 },
  progressTrack: { height: 5, borderRadius: 6, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 6 },
  projectHeader: { borderWidth: 1, borderRadius: 20, padding: 17, flexDirection: "row", gap: 15, alignItems: "center" },
  notice: { borderRadius: 16, padding: 13, borderWidth: 1, flexDirection: "row", gap: 11, alignItems: "center" },
  busyRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 8 },
  errorBox: { backgroundColor: "#3c1319", padding: 14, borderRadius: 16 },
  errorText: { color: "#ee7f88", fontSize: 12, lineHeight: 19 },
  footerNote: { textAlign: "center", paddingTop: 8 },
  previewRoot: { flex: 1, backgroundColor: "#000000" },
  previewBar: { minHeight: 64, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20 },
  previewTitle: { color: "#ffffff", fontSize: 16, fontWeight: "800" },
  previewClose: { height: 44, width: 44, borderRadius: 14, backgroundColor: "#1f1f1f", alignItems: "center", justifyContent: "center" },
  player: { flex: 1, width: "100%", backgroundColor: "#000000" },
  previewActions: { padding: 20, alignItems: "center" },
  previewExternal: { flexDirection: "row", gap: 8, alignItems: "center", minHeight: 48, borderRadius: 15,
    borderWidth: 1, borderColor: "#333333", backgroundColor: "#191919", paddingHorizontal: 15 },
  previewExternalText: { color: "#ffffff", fontSize: 12, fontWeight: "700" },
});
