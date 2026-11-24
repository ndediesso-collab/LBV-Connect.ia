"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Wallet } from "lucide-react";
import { collabRequest } from "@/lib/collaboratif-api";
import type { AllocationPreview } from "./AllocationManager";

export default function AllocationPrompt({workspaceId, isOwner}:{workspaceId:string;isOwner:boolean}) {
  const [data,setData] = useState<AllocationPreview|null>(null);
  useEffect(()=>{
    if(!isOwner||!workspaceId){setData(null);return;}
    let mounted=true;
    const read=()=>{
      void collabRequest<AllocationPreview>(`/collaboratif/workspaces/${encodeURIComponent(workspaceId)}/allocation/preview`)
        .then(d=>{if(mounted && d.workspace_id===workspaceId)setData(d);})
        .catch(()=>{if(mounted)setData(null);});
    };
    read();
    const timer=window.setInterval(()=>{if(document.visibilityState==='visible')read();},30_000);
    const onFocus=()=>read();
    window.addEventListener("focus",onFocus);
    return ()=>{mounted=false;window.clearInterval(timer);window.removeEventListener("focus",onFocus);};
  },[isOwner,workspaceId]);
  if(!isOwner||!data?.eligible||!data.needs_prompt)return null;
  return <div role="status" className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-secondary px-3 py-3 text-sm sm:px-6">
    <span className="flex items-start gap-2"><Wallet size={17} className="mt-0.5 shrink-0"/>
      {data.equal_allowed
        ? "Des crédits de pack peuvent être répartis entre les membres actifs. Votre validation est nécessaire."
        : "L'équipe ou le pack a changé. Les crédits restants peuvent être répartis manuellement."}
    </span>
    <Link href={`/collaboratif/espaces/${encodeURIComponent(workspaceId)}/actions#repartition`}
      className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold">
      Gérer les crédits <ArrowRight size={14}/>
    </Link>
  </div>;
}
