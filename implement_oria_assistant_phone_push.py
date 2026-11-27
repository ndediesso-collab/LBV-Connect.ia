from __future__ import annotations

from datetime import datetime
from pathlib import Path
import shutil

ROOT = Path.cwd()
if not (ROOT / "Backend" / "app" / "main.py").exists() or not (ROOT / "Frontend" / "app" / "assistant" / "page.tsx").exists():
    raise SystemExit("Erreur : lance ce script depuis la racine du dépôt LBV-Connect.ia.")

stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
changed: list[Path] = []


def backup(path: Path) -> None:
    target = path.with_name(path.name + f".bak-phone-push-{stamp}")
    shutil.copy2(path, target)
    print(f"Sauvegarde : {target.relative_to(ROOT)}")


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: ancre attendue une seule fois dans {path}, trouvée {count} fois.")
    backup(path)
    path.write_text(text.replace(old, new, 1), encoding="utf-8", newline="\n")
    changed.append(path)
    print(f"OK : {label}")

# 1) Global preferences table: ORIA Assistant owners do not need a Collaboratif workspace.
sql_path = ROOT / "Backend" / "oria_assistant_push_preferences.sql"
sql_content = r'''-- ORIA Assistant : préférences globales de notifications Push par propriétaire.
-- À exécuter une seule fois dans Supabase SQL Editor avant le déploiement backend.
create table if not exists public.oria_assistant_push_preferences (
    owner_user_id uuid primary key references auth.users(id) on delete cascade,
    push_enabled boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.oria_assistant_push_preferences enable row level security;
revoke all on table public.oria_assistant_push_preferences from anon, authenticated;
grant all on table public.oria_assistant_push_preferences to service_role;

comment on table public.oria_assistant_push_preferences is
    'Préférences globales Web Push des propriétaires ORIA Assistant, indépendantes des espaces Collaboratif.';
'''
if sql_path.exists():
    if sql_path.read_text(encoding="utf-8") != sql_content:
        raise RuntimeError(f"Le fichier {sql_path} existe déjà avec un contenu différent. Arrêt sans l'écraser.")
else:
    sql_path.write_text(sql_content, encoding="utf-8", newline="\n")
    changed.append(sql_path)
    print(f"Créé : {sql_path.relative_to(ROOT)}")

# 2) Dedicated authenticated API for an ORIA Assistant owner to register this browser/device.
route_path = ROOT / "Backend" / "app" / "route" / "oria_assistant_push.py"
route_content = r'''"""Authenticated Web Push enrollment and test delivery for ORIA Assistant owners."""
from __future__ import annotations

import json
import logging
import os
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from app.core.supabase import supabase
from app.services.oria_assistant_push_service import worker_ready
from app.services.oria_collab_push_service import validate_subscription

logger = logging.getLogger("oria.assistant.push.api")
router = APIRouter(prefix="/assistant/push", tags=["ORIA Assistant - notifications Push"])


class SubscriptionKeys(BaseModel):
    p256dh: str = Field(min_length=40, max_length=300)
    auth: str = Field(min_length=10, max_length=300)


class SubscriptionPayload(BaseModel):
    endpoint: str = Field(min_length=20, max_length=2048)
    keys: SubscriptionKeys


class PushPreferencePayload(BaseModel):
    push_enabled: bool


def _owner_id(user_id: str | None, authorization: str | None) -> str:
    if not user_id or not authorization:
        raise HTTPException(401, "Authentification ORIA obligatoire.")
    token = authorization.strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    if not token:
        raise HTTPException(401, "Session ORIA expirée.")
    try:
        response = supabase.auth.get_user(token)
        user = response.user
    except Exception as exc:
        raise HTTPException(401, "Session ORIA invalide ou expirée.") from exc
    if user is None or str(user.id) != str(user_id):
        raise HTTPException(403, "La session ne correspond pas au compte transmis.")
    return str(user.id)


def _owner(user_id: str | None = Header(default=None, alias="user-id"),
           authorization: str | None = Header(default=None, alias="authorization")) -> str:
    return _owner_id(user_id, authorization)


def _preferences(owner: str) -> dict[str, Any] | None:
    response = (supabase.table("oria_assistant_push_preferences")
                .select("owner_user_id,push_enabled")
                .eq("owner_user_id", owner).limit(1).execute())
    data = getattr(response, "data", None)
    return data[0] if isinstance(data, list) and data else data if isinstance(data, dict) else None


def _devices(owner: str) -> list[dict[str, Any]]:
    response = (supabase.table("oria_collab_push_devices_p16")
                .select("id,endpoint,p256dh,auth_key")
                .eq("user_id", owner).execute())
    data = getattr(response, "data", None)
    return [item for item in data if isinstance(item, dict)] if isinstance(data, list) else []


@router.get("/status")
def push_status(owner: str = Depends(_owner)):
    try:
        preference = _preferences(owner)
        devices = _devices(owner)
    except Exception as exc:
        logger.exception("ORIA Assistant Push status could not be read")
        raise HTTPException(503, "Impossible de lire les réglages Push. Vérifie la migration SQL ORIA Assistant Push.") from exc
    ready = bool(worker_ready())
    public_key = str(os.getenv("ORIA_COLLAB_VAPID_PUBLIC_KEY") or "").strip() if ready else ""
    return {
        "success": True,
        "ready": ready and bool(public_key),
        "push_enabled": bool((preference or {}).get("push_enabled")),
        "device_count": len(devices),
        "vapid_public_key": public_key,
    }


@router.post("/subscriptions")
def register_subscription(payload: SubscriptionPayload, owner: str = Depends(_owner)):
    if not worker_ready() or not os.getenv("ORIA_COLLAB_VAPID_PUBLIC_KEY"):
        raise HTTPException(503, "Le serveur Push ORIA n'est pas encore configuré sur Render.")
    subscription = validate_subscription(payload.endpoint, payload.keys.p256dh, payload.keys.auth)
    try:
        supabase.table("oria_collab_push_devices_p16").upsert(
            {"user_id": owner, **subscription}, on_conflict="endpoint",
        ).execute()
        supabase.table("oria_assistant_push_preferences").upsert(
            {"owner_user_id": owner, "push_enabled": True}, on_conflict="owner_user_id",
        ).execute()
    except Exception as exc:
        logger.exception("ORIA Assistant Push device registration failed")
        raise HTTPException(503, "Impossible d'enregistrer ce téléphone pour les notifications ORIA.") from exc
    return {"success": True, "push_enabled": True}


@router.patch("/preferences")
def update_push_preference(payload: PushPreferencePayload, owner: str = Depends(_owner)):
    if payload.push_enabled:
        devices = _devices(owner)
        if not devices:
            raise HTTPException(409, "Enregistre d'abord ce téléphone pour activer les notifications.")
    try:
        supabase.table("oria_assistant_push_preferences").upsert(
            {"owner_user_id": owner, "push_enabled": payload.push_enabled}, on_conflict="owner_user_id",
        ).execute()
    except Exception as exc:
        logger.exception("ORIA Assistant Push preference update failed")
        raise HTTPException(503, "Impossible d'enregistrer cette préférence Push.") from exc
    return {"success": True, "push_enabled": payload.push_enabled}


@router.post("/test")
def send_test_push(owner: str = Depends(_owner)):
    if not worker_ready():
        raise HTTPException(503, "Le worker Push n'est pas prêt. Vérifie les variables VAPID et les flags Push sur Render.")
    try:
        preference = _preferences(owner)
        devices = _devices(owner)
    except Exception as exc:
        logger.exception("ORIA Assistant Push test could not load devices")
        raise HTTPException(503, "Impossible de lire les appareils enregistrés.") from exc
    if not preference or not preference.get("push_enabled"):
        raise HTTPException(409, "Les notifications ORIA Assistant ne sont pas activées pour ce compte.")
    if not devices:
        raise HTTPException(409, "Aucun téléphone enregistré. Active les notifications depuis ton téléphone.")

    try:
        from pywebpush import WebPushException, webpush
        private_key = os.environ["ORIA_COLLAB_VAPID_PRIVATE_KEY"]
        subject = os.environ["ORIA_COLLAB_VAPID_SUBJECT"]
    except Exception as exc:
        logger.exception("ORIA Assistant Push test configuration incomplete")
        raise HTTPException(503, "Configuration VAPID incomplète sur Render.") from exc

    sent = 0
    failures = 0
    for device in devices:
        try:
            payload = {
                "title": "ORIA — Notifications activées",
                "body": "Ton téléphone est bien connecté. Tu recevras une alerte à chaque nouvelle demande client.",
                "url": "/assistant/demandes",
                "tag": "oria-assistant-push-test",
            }
            webpush(
                subscription_info={
                    "endpoint": device["endpoint"],
                    "keys": {"p256dh": device["p256dh"], "auth": device["auth_key"]},
                },
                data=json.dumps(payload, ensure_ascii=False),
                vapid_private_key=private_key,
                vapid_claims={"sub": subject},
                ttl=600,
            )
            sent += 1
        except WebPushException as exc:
            failures += 1
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status in (404, 410):
                try:
                    supabase.table("oria_collab_push_devices_p16").delete().eq("id", device["id"]).execute()
                except Exception:
                    logger.exception("ORIA Assistant expired Push device cleanup failed")
            logger.warning("ORIA Assistant Push test failed for one device (HTTP %s)", status)
        except Exception:
            failures += 1
            logger.exception("ORIA Assistant Push test failed for one device")
    if sent == 0:
        raise HTTPException(503, f"Aucune notification n'a pu être remise au service Push ({failures} échec(s)).")
    return {"success": True, "sent": sent, "failed": failures}
'''
if route_path.exists():
    if route_path.read_text(encoding="utf-8") != route_content:
        raise RuntimeError(f"Le fichier {route_path} existe déjà avec un contenu différent. Arrêt sans l'écraser.")
else:
    route_path.write_text(route_content, encoding="utf-8", newline="\n")
    changed.append(route_path)
    print(f"Créé : {route_path.relative_to(ROOT)}")

# 3) Include the authenticated Push route in FastAPI.
main_path = ROOT / "Backend" / "app" / "main.py"
main_anchor = 'from app.route.oria_assistant import router as oria_assistant_router\napp.include_router(oria_assistant_router)\n'
main_new = main_anchor + '\nfrom app.route.oria_assistant_push import router as oria_assistant_push_router\napp.include_router(oria_assistant_push_router)\n'
replace_once(main_path, main_anchor, main_new, "Route Push ORIA Assistant branchée dans FastAPI")

# 4) Use ORIA Assistant's global owner preference, not Collaboratif workspace preference.
push_service_path = ROOT / "Backend" / "app" / "services" / "oria_assistant_push_service.py"
push_old = '''            prefs = (db.table("oria_collab_push_preferences_p16")
                     .select("workspace_id")
                     .eq("user_id", owner)
                     .eq("push_enabled", True)
                     .limit(1).execute().data or [])
'''
push_new = '''            prefs = (db.table("oria_assistant_push_preferences")
                     .select("owner_user_id")
                     .eq("owner_user_id", owner)
                     .eq("push_enabled", True)
                     .limit(1).execute().data or [])
'''
replace_once(push_service_path, push_old, push_new, "Worker Push relié aux préférences globales ORIA Assistant")

# 5) Service worker: display push notifications and open the ORIA request inbox.
public_dir = ROOT / "Frontend" / "public"
public_dir.mkdir(parents=True, exist_ok=True)
sw_path = public_dir / "oria-assistant-push-sw.js"
sw_content = r'''/* ORIA Assistant Web Push service worker. No message or customer data is cached. */
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = { body: event.data ? event.data.text() : "Une nouvelle demande vous attend." };
  }
  const title = String(payload.title || "Nouvelle demande ORIA").slice(0, 100);
  const body = String(payload.body || "Une nouvelle demande client a été reçue.").slice(0, 220);
  const rawUrl = String(payload.url || "/assistant/demandes");
  let target = "/assistant/demandes";
  try {
    const parsed = new URL(rawUrl, self.location.origin);
    if (parsed.origin === self.location.origin) target = parsed.pathname + parsed.search + parsed.hash;
  } catch (_) {}
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: "/oria-logo.png",
    badge: "/oria-logo.png",
    tag: String(payload.tag || "oria-assistant-request").slice(0, 110),
    renotify: true,
    data: { url: target },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const rawUrl = event.notification && event.notification.data && event.notification.data.url;
  let target = new URL("/assistant/demandes", self.location.origin).href;
  try {
    const parsed = new URL(String(rawUrl || "/assistant/demandes"), self.location.origin);
    if (parsed.origin === self.location.origin) target = parsed.href;
  } catch (_) {}
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) {
        await client.focus();
        if ("navigate" in client) await client.navigate(target);
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
'''
if sw_path.exists():
    if sw_path.read_text(encoding="utf-8") != sw_content:
        raise RuntimeError(f"Le fichier {sw_path} existe déjà avec un contenu différent. Arrêt sans l'écraser.")
else:
    sw_path.write_text(sw_content, encoding="utf-8", newline="\n")
    changed.append(sw_path)
    print(f"Créé : {sw_path.relative_to(ROOT)}")

# 6) Extend the Assistant owner workspace with device enrollment and a real test Push.
page_path = ROOT / "Frontend" / "app" / "assistant" / "page.tsx"
page_text = page_path.read_text(encoding="utf-8")
old_import = 'import { Bot, Check, Copy, ExternalLink, LoaderCircle, Plus, RotateCw, Save, Trash2 } from "lucide-react";'
new_import = 'import { BellRing, Bot, Check, Copy, ExternalLink, LoaderCircle, Plus, RotateCw, Save, Smartphone, Trash2 } from "lucide-react";'
if page_text.count(old_import) != 1:
    raise RuntimeError("Import lucide introuvable ou ambigu dans Frontend/app/assistant/page.tsx")
page_text = page_text.replace(old_import, new_import, 1)

state_anchor = '  const [notice, setNotice] = useState("");\n'
state_new = state_anchor + '''  const [pushStatus, setPushStatus] = useState({ ready: false, push_enabled: false, device_count: 0, vapid_public_key: "" });
  const [pushBusy, setPushBusy] = useState(false);
  const [pushNotice, setPushNotice] = useState("");
  const [pushError, setPushError] = useState("");
'''
if page_text.count(state_anchor) != 1:
    raise RuntimeError("Ancre d'état introuvable ou ambiguë")
page_text = page_text.replace(state_anchor, state_new, 1)

api_effect_anchor = '''  useEffect(() => {
    let active = true;

    void api("/assistant/assistants")
'''
api_effect_new = '''  useEffect(() => {
    let active = true;
    void api("/assistant/push/status")
      .then(payload => { if (active) setPushStatus(payload); })
      .catch(err => { if (active) setPushError(err instanceof Error ? err.message : "État des notifications indisponible."); });
    return () => { active = false; };
  }, [api]);

  useEffect(() => {
    let active = true;

    void api("/assistant/assistants")
'''
if page_text.count(api_effect_anchor) != 1:
    raise RuntimeError("Effet de chargement assistants introuvable ou ambigu")
page_text = page_text.replace(api_effect_anchor, api_effect_new, 1)

handler_anchor = '''  const getPublicUrl = (assistant: Assistant) =>
    assistant.public_url || `https://www.myoriaai.com/a/${encodeURIComponent(assistant.slug)}`;
'''
handler_new = '''  const enablePhonePush = async () => {
    setPushBusy(true);
    setPushError("");
    setPushNotice("");
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        throw new Error("Les notifications Push ne sont pas prises en charge par ce navigateur.");
      }
      const isAppleMobile = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const isStandalone = window.matchMedia("(display-mode: standalone)").matches
        || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
      if (isAppleMobile && !isStandalone) {
        throw new Error("Sur iPhone, ajoute d'abord ORIA à l'écran d'accueil (Partager → Sur l'écran d'accueil), ouvre l'application ORIA installée, puis active les notifications ici.");
      }
      if (!pushStatus.ready || !pushStatus.vapid_public_key) {
        throw new Error("Le serveur Push n'est pas encore prêt. Les clés VAPID et le worker doivent être activés sur Render.");
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Autorise les notifications ORIA dans les réglages de ton téléphone ou de ton navigateur.");

      const registration = await navigator.serviceWorker.register("/oria-assistant-push-sw.js", { scope: "/" });
      const readyRegistration = await navigator.serviceWorker.ready;
      const existing = await readyRegistration.pushManager.getSubscription();
      const subscription = existing || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeVapidPublicKey(pushStatus.vapid_public_key),
      });
      await api("/assistant/push/subscriptions", {
        method: "POST",
        body: JSON.stringify(subscription.toJSON()),
      });
      const refreshed = await api("/assistant/push/status");
      setPushStatus(refreshed);
      const test = await api("/assistant/push/test", { method: "POST" });
      setPushNotice(`Téléphone enregistré. Notification test envoyée au service Push (${test.sent} appareil${test.sent > 1 ? "s" : ""}). Vérifie ton écran.`);
    } catch (err) {
      setPushError(err instanceof Error ? err.message : "Impossible d'activer les notifications sur cet appareil.");
    } finally {
      setPushBusy(false);
    }
  };

  const sendPhonePushTest = async () => {
    setPushBusy(true);
    setPushError("");
    setPushNotice("");
    try {
      const result = await api("/assistant/push/test", { method: "POST" });
      setPushNotice(`Notification test remise au service Push (${result.sent} appareil${result.sent > 1 ? "s" : ""}).`);
    } catch (err) {
      setPushError(err instanceof Error ? err.message : "Envoi de test impossible.");
    } finally {
      setPushBusy(false);
    }
  };

  const getPublicUrl = (assistant: Assistant) =>
    assistant.public_url || `https://www.myoriaai.com/a/${encodeURIComponent(assistant.slug)}`;
'''
if page_text.count(handler_anchor) != 1:
    raise RuntimeError("Ancre des actions assistant introuvable ou ambiguë")
page_text = page_text.replace(handler_anchor, handler_new, 1)

# Helper at module scope.
helper_anchor = 'const emptyEditor: Editor = {\n'
helper_new = '''function decodeVapidPublicKey(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes.buffer;
}

const emptyEditor: Editor = {
'''
if page_text.count(helper_anchor) != 1:
    raise RuntimeError("Ancre helper page Assistant introuvable ou ambiguë")
page_text = page_text.replace(helper_anchor, helper_new, 1)

sidebar_anchor = '''            <p className="mt-2 text-sm leading-6 text-muted">Crée un assistant spécialisé, définis son comportement et partage-le avec un lien public.</p>
          </div>
          <button onClick={beginCreate}
'''
sidebar_new = '''            <p className="mt-2 text-sm leading-6 text-muted">Crée un assistant spécialisé, définis son comportement et partage-le avec un lien public.</p>
          </div>
          <section className="rounded-2xl border border-border bg-surface p-4" aria-label="Notifications Push ORIA Assistant">
            <div className="flex items-center gap-2">
              <span className="grid size-9 place-items-center rounded-xl bg-surface-secondary"><BellRing size={18} /></span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">Notifications sur ton téléphone</h2>
                <p className="text-[11px] text-muted">Alertes pour les nouvelles demandes clients</p>
              </div>
            </div>
            <p className="mt-3 text-xs leading-5 text-muted">
              {pushStatus.push_enabled && pushStatus.device_count > 0
                ? `${pushStatus.device_count} appareil(s) enregistré(s) pour ce compte.`
                : "Enregistre cet appareil pour recevoir les alertes ORIA, même lorsque le site n'est pas ouvert."}
            </p>
            {!pushStatus.ready && <p className="mt-2 text-xs leading-5 text-amber-700">Le service Push du serveur doit être activé pour terminer l'inscription.</p>}
            {pushError && <p role="alert" className="mt-2 text-xs leading-5 text-red-600">{pushError}</p>}
            {pushNotice && <p role="status" className="mt-2 text-xs leading-5 text-emerald-700">{pushNotice}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => void enablePhonePush()} disabled={pushBusy || !pushStatus.ready} className="inline-flex items-center justify-center gap-2 rounded-xl bg-foreground px-3 py-2.5 text-xs font-semibold text-background disabled:cursor-not-allowed disabled:opacity-50">
                {pushBusy ? <LoaderCircle size={14} className="animate-spin" /> : <Smartphone size={14} />}
                Activer sur cet appareil
              </button>
              {pushStatus.push_enabled && pushStatus.device_count > 0 && <button type="button" onClick={() => void sendPhonePushTest()} disabled={pushBusy || !pushStatus.ready} className="rounded-xl border border-border px-3 py-2.5 text-xs font-semibold disabled:opacity-50">Tester la notification</button>}
            </div>
          </section>
          <button onClick={beginCreate}
'''
if page_text.count(sidebar_anchor) != 1:
    raise RuntimeError("Ancre de la barre latérale introuvable ou ambiguë")
page_text = page_text.replace(sidebar_anchor, sidebar_new, 1)

backup(page_path)
page_path.write_text(page_text, encoding="utf-8", newline="\n")
changed.append(page_path)
print("OK : activation et test Push ajoutés dans l'espace Assistant.")

# Ensure frontend pushes are registered from the explicit user gesture only.

# 7) Include endpoint router in FastAPI main after the existing Assistant router.

print("\nTerminé. Fichiers créés/modifiés :")
for path in changed:
    print(f"  - {path.relative_to(ROOT)}")
print("\nÉtape SQL obligatoire : exécuter Backend/oria_assistant_push_preferences.sql dans Supabase SQL Editor.")
print("Variables Render nécessaires : ORIA_COLLAB_PUSH_P16_ENABLED=1, ORIA_COLLAB_PUSH_WORKER_ENABLED=1, ORIA_COLLAB_VAPID_PUBLIC_KEY, ORIA_COLLAB_VAPID_PRIVATE_KEY, ORIA_COLLAB_VAPID_SUBJECT.")
print("Aucun commit, push, déploiement ni accès à Supabase/Render n'a été effectué par ce script.")
