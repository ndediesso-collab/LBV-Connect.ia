import { collabRequest } from '@/lib/collaboratif-api';

export type PushMode = 'all'|'important'|'muted';
export type PushSettings = {
  success: boolean;workspace_id:string;
  preferences:{push_enabled:boolean;sound_enabled:boolean;mode:PushMode};
  rooms:{group_id:string;mode:PushMode}[];
  groups:{id:string;title:string}[];
};
export type PushConfig={success:boolean;enabled:boolean;vapid_public_key:string};

export function vapidKeyToBytes(key: string): Uint8Array<ArrayBuffer> {
  const sanitized=key.replace(/-/g,'+').replace(/_/g,'/');
  const padded=sanitized.padEnd(Math.ceil(sanitized.length/4)*4,'=');
  const binary=atob(padded);
  const bytes=new Uint8Array(new ArrayBuffer(binary.length));
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return bytes;
}

export function canUseWebPush(): boolean {
  return typeof window!=='undefined' && 'serviceWorker' in navigator &&
    'PushManager' in window && 'Notification' in window;
}

export function iOSNotInstalled():boolean {
  if(typeof window==='undefined')return false;
  const isIOS=/iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isStandalone=window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((navigator as Navigator & {standalone?:boolean}).standalone);
  return isIOS&&!isStandalone;
}

export async function registerPush(space:string,publicKey:string):Promise<void> {
  if(!canUseWebPush())throw new Error('Les notifications ne sont pas prises en charge ici.');
  if(iOSNotInstalled())throw new Error('Sur iPhone, ajoute ORIA à l’écran d’accueil puis ouvre l’application installée.');
  if(!publicKey)throw new Error('Clé publique Web Push absente sur le serveur ORIA.');
  // Permission appelée directement par le bouton utilisateur, sans popup automatique.
  const permission=await Notification.requestPermission();
  if(permission!=='granted')throw new Error('Autorisation de notification refusée. Vérifie les réglages du téléphone.');
  const reg=await navigator.serviceWorker.register('/oria-collab-sw.js',{scope:'/'});
  const ready=await navigator.serviceWorker.ready;
  const existing=await ready.pushManager.getSubscription();
  const subscription=existing??await ready.pushManager.subscribe({
    userVisibleOnly:true,applicationServerKey:vapidKeyToBytes(publicKey),
  });
  const json=subscription.toJSON();
  if(!json.endpoint||!json.keys?.p256dh||!json.keys?.auth)throw new Error('Abonnement Push incomplet.');
  await collabRequest(`/collaboratif/workspaces/${encodeURIComponent(space)}/push/subscriptions`,'POST',{
    endpoint:json.endpoint,keys:{p256dh:json.keys.p256dh,auth:json.keys.auth},
  });
  // L'application réutilise une seule souscription par appareil, même entre espaces.
  void reg;
}

export async function syncExistingPush(space:string):Promise<void> {
  if(!canUseWebPush()||Notification.permission!=='granted')return;
  const reg=await navigator.serviceWorker.getRegistration('/');
  const subscription=await reg?.pushManager.getSubscription();
  if(!subscription)return;
  const json=subscription.toJSON();
  if(json.endpoint && json.keys?.p256dh && json.keys?.auth){
    await collabRequest(`/collaboratif/workspaces/${encodeURIComponent(space)}/push/subscriptions`,'POST',{
      endpoint:json.endpoint,keys:{p256dh:json.keys.p256dh,auth:json.keys.auth},
    });
  }
}
