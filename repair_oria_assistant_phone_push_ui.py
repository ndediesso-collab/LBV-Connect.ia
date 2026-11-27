from __future__ import annotations

from datetime import datetime
from pathlib import Path
import shutil

ROOT = Path.cwd()
PAGE = ROOT / "Frontend" / "app" / "assistant" / "page.tsx"
SW = ROOT / "Frontend" / "public" / "oria-assistant-push-sw.js"
if not PAGE.exists():
    raise SystemExit("Lance ce script depuis la racine du dépôt LBV-Connect.ia.")
if not SW.exists():
    raise SystemExit("Le Service Worker ORIA Assistant n'existe pas. Relance d'abord le script principal ou restaure Frontend/public/oria-assistant-push-sw.js.")

text = PAGE.read_text(encoding="utf-8")
original = text


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: ancre attendue une fois, trouvée {count} fois. Aucun changement de page n'a été écrit.")
    text = text.replace(old, new, 1)

# 1) Icons
old_import = 'import { Bot, Check, Copy, ExternalLink, LoaderCircle, Plus, RotateCw, Save, Trash2 } from "lucide-react";'
new_import = 'import { BellRing, Bot, Check, Copy, ExternalLink, LoaderCircle, Plus, RotateCw, Save, Smartphone, Trash2 } from "lucide-react";'
replace_once(old_import, new_import, "Import lucide")

# 2) State
state_anchor = '  const [notice, setNotice] = useState("");\n'
state_new = state_anchor + '''  const [pushStatus, setPushStatus] = useState({ ready: false, push_enabled: false, device_count: 0, vapid_public_key: "" });
  const [pushBusy, setPushBusy] = useState(false);
  const [pushNotice, setPushNotice] = useState("");
  const [pushError, setPushError] = useState("");
'''
replace_once(state_anchor, state_new, "État React Push")

# 3) Load Push status in its own effect.
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
replace_once(api_effect_anchor, api_effect_new, "Chargement du statut Push")

# 4) User-gesture handlers.
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
        throw new Error("Sur iPhone, ajoute d'abord ORIA à l'écran d'accueil depuis Safari, ouvre l'application ORIA installée, puis active les notifications ici.");
      }
      if (!pushStatus.ready || !pushStatus.vapid_public_key) {
        throw new Error("Le serveur Push n'est pas encore prêt. Vérifie les variables VAPID et les deux flags Push sur Render.");
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Autorise les notifications ORIA dans les réglages de ton téléphone ou de ton navigateur.");

      const registration = await navigator.serviceWorker.register("/oria-assistant-push-sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
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
      setPushNotice(`Appareil enregistré. Le service Push a accepté l'envoi du test (${test.sent} appareil${test.sent > 1 ? "s" : ""}). Vérifie ton écran.`);
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
      setPushNotice(`Le service Push a accepté le test pour ${result.sent} appareil${result.sent > 1 ? "s" : ""}. Vérifie ton écran.`);
    } catch (err) {
      setPushError(err instanceof Error ? err.message : "Envoi de test impossible.");
    } finally {
      setPushBusy(false);
    }
  };

  const getPublicUrl = (assistant: Assistant) =>
    assistant.public_url || `https://www.myoriaai.com/a/${encodeURIComponent(assistant.slug)}`;
'''
replace_once(handler_anchor, handler_new, "Actions d'inscription et de test Push")

# 5) VAPID helper.
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
replace_once(helper_anchor, helper_new, "Helper de décodage de la clé VAPID")

# 6) Insert UI using the actual JSX line from the current page (the original patch
# expected a line break after <button> and therefore failed before writing the file).
sidebar_anchor = '''            <p className="mt-2 text-sm leading-6 text-muted">Crée un assistant spécialisé, définis son comportement et partage-le avec un lien public.</p>
          </div>
          <button onClick={beginCreate}'''
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
          <button onClick={beginCreate}'''
replace_once(sidebar_anchor, sidebar_new, "Carte d'activation Push dans la barre latérale")

if text == original:
    raise SystemExit("Aucun changement détecté.")

stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
backup = PAGE.with_name(PAGE.name + f".bak-phone-push-ui-{stamp}")
shutil.copy2(PAGE, backup)
PAGE.write_text(text, encoding="utf-8", newline="\n")
print(f"OK : interface d'inscription Push ajoutée à {PAGE.relative_to(ROOT)}")
print(f"Sauvegarde : {backup.relative_to(ROOT)}")
print("Fichiers Backend, Service Worker et SQL créés par le premier script conservés sans nouvelle modification.")
