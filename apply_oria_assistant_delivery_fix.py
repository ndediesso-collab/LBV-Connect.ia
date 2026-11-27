#!/usr/bin/env python3
"""Safely apply the ORIA Assistant delivery/model fix to an LBV-Connect.ia checkout.

Run from the repository root:
    python apply_oria_assistant_delivery_fix.py

The script validates every expected source fragment before writing any file,
creates timestamped backups, and never touches Supabase data or deploys anything.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
import sys

ROOT = Path.cwd()
BACKUP_SUFFIX = datetime.now().strftime("%Y%m%d_%H%M%S")


def read_repo_file(relative: str) -> str:
    path = ROOT / relative
    if not path.is_file():
        raise RuntimeError(f"Fichier introuvable : {relative}")
    return path.read_text(encoding="utf-8")


def replace_once(content: str, old: str, new: str, relative: str) -> str:
    count = content.count(old)
    if count != 1:
        raise RuntimeError(
            f"{relative}: fragment attendu une seule fois, trouvé {count} fois. "
            "Aucun fichier n'a été modifié."
        )
    return content.replace(old, new, 1)


def replace_function(content: str, start_marker: str, end_marker: str,
                     replacement: str, relative: str) -> str:
    start = content.find(start_marker)
    end = content.find(end_marker, start + len(start_marker))
    if start < 0 or end < 0:
        raise RuntimeError(f"{relative}: fonction cible introuvable. Aucun fichier modifié.")
    return content[:start] + replacement.rstrip() + "\n\n\n" + content[end:]


changes: dict[str, str] = {}

# 1) Fix the consent detector: recipient names are dynamic (e.g. a company name),
# not limited to a hard-coded vocabulary such as "entreprise" or "banque".
protocol_path = "Backend/app/services/oria_assistant_request_protocol.py"
protocol = read_repo_file(protocol_path)
new_detector = r'''def _assistant_asked_for_consent(visible_message: str) -> bool:
    value = _normalized(visible_message)
    asks = any(term in value for term in (
        "acceptez-vous", "etes-vous d'accord", "etes-vous d accord", "autorisez-vous", "m'autorisez-vous",
        "donnez-vous votre accord", "votre accord", "souhaitez-vous que je transmette",
        "puis-je transmettre", "puis-je communiquer", "consentez-vous", "etes vous d'accord",
    ))
    shares = any(term in value for term in ("transmett", "transmis", "communiqu", "partag"))
    # First accept common generic recipients. Then accept a named organization
    # or recipient such as "à Gabon Drive Location afin de...". The previous
    # implementation rejected that real-world wording because the company's
    # proper name was not present in this fixed vocabulary.
    known_recipient = any(term in value for term in (
        "entreprise", "societe", "service", "equipe", "banque", "assurance",
        "etablissement", "agence", "organisation", "boutique", "commerce",
    ))
    named_recipient = re.search(
        r"\b(?:a|au|aux|vers)\s+"
        r"(?!(?:vous|moi|toi|lui|elle|eux|elles|soi|savoir|quoi|qui)\b)"
        r"[a-z0-9][a-z0-9'’ .-]{1,80}?"
        r"(?=\s+(?:afin|pour|concernant|au sujet|dans le cadre|en vue)\b|[?.!,;:]|$)",
        value,
    )
    return asks and shares and (known_recipient or named_recipient is not None)'''
protocol = replace_function(
    protocol,
    "def _assistant_asked_for_consent(visible_message: str) -> bool:",
    "def _clean_details(value: Any) -> dict[str, str]:",
    new_detector,
    protocol_path,
)
changes[protocol_path] = protocol

# 2) Verify that the RPC-created row is actually visible to the same owner,
# assistant and conversation before the API tells the visitor it was saved.
request_service_path = "Backend/app/services/oria_assistant_requests_service.py"
request_service = read_repo_file(request_service_path)
old_validation = '''        if not isinstance(result, dict) or result.get("success") is not True:
            raise RuntimeError("assistant_request_submit_rpc_invalid")'''
new_validation = '''        if not isinstance(result, dict) or result.get("success") is not True:
            raise RuntimeError("assistant_request_submit_rpc_invalid")

        # Never report success solely because the RPC returned success: verify
        # the created row is readable by the same owner-scoped query used by
        # the professional dashboard.
        saved_request_id = str(result.get("request_id") or result.get("id") or "").strip()
        try:
            saved_request_id = str(UUID(saved_request_id))
        except (ValueError, TypeError, AttributeError):
            raise RuntimeError("assistant_request_submit_rpc_missing_request_id") from None

        persisted_request = _first(
            supabase.table("oria_assistant_requests").select("id")
            .eq("id", saved_request_id)
            .eq("owner_user_id", str(conversation["owner_user_id"]))
            .eq("assistant_id", str(assistant["id"]))
            .eq("conversation_id", conversation_id)
            .limit(1).execute().data
        )
        if persisted_request is None:
            raise RuntimeError("assistant_request_persisted_row_not_visible")'''
request_service = replace_once(request_service, old_validation, new_validation, request_service_path)
request_service = replace_once(
    request_service,
    '    saved_request_id = str(result.get("request_id") or "")\n    if saved_request_id:\n        _queue_request_push(str(conversation["owner_user_id"]), assistant, saved_request_id)',
    '    if saved_request_id:\n        _queue_request_push(str(conversation["owner_user_id"]), assistant, saved_request_id)',
    request_service_path,
)
changes[request_service_path] = request_service

# 3) Route only the public business assistant to the user's selected low-cost models.
adapter_path = "Backend/app/services/oria_assistant_provider_adapter.py"
adapter = read_repo_file(adapter_path)
old_selection = '''    if provider is ChatProvider.OPENAI:
        return AssistantSelection(
            provider=provider,
            logical_model="gpt-5.6-terra",
            provider_model="gpt-5.6-terra",
            credit_action=CreditAction.CHAT_TERRA,
        )
    if provider is ChatProvider.OPENROUTER:
        return AssistantSelection(
            provider=provider,
            logical_model="claude-sonnet-5.5",
            provider_model="anthropic/claude-sonnet-5.5",
            credit_action=CreditAction.CHAT_CLAUDE_SONNET,
        )'''
new_selection = '''    if provider is ChatProvider.OPENAI:
        return AssistantSelection(
            provider=provider,
            logical_model="gpt-6-luna",
            provider_model="gpt-6-luna",
            credit_action=CreditAction.CHAT_LUNA,
        )
    if provider is ChatProvider.OPENROUTER:
        return AssistantSelection(
            provider=provider,
            logical_model="claude-haiku-5.5",
            provider_model="anthropic/claude-haiku-5.5",
            credit_action=CreditAction.CHAT_CLAUDE_HAIKU,
        )'''
adapter = replace_once(adapter, old_selection, new_selection, adapter_path)
changes[adapter_path] = adapter

# 4) Keep the Pro-pack model gate aligned with the newly selected assistant models.
assistant_service_path = "Backend/app/services/oria_assistant_service.py"
assistant_service = read_repo_file(assistant_service_path)
assistant_service = replace_once(
    assistant_service,
    '''    if wallet.pack_id == "pro_pack" and selection.logical_model not in {
        "gpt-5.6-terra", "claude-sonnet-5.5"
    }:''',
    '''    if wallet.pack_id == "pro_pack" and selection.logical_model not in {
        "gpt-6-luna", "claude-haiku-5.5"
    }:''',
    assistant_service_path,
)
changes[assistant_service_path] = assistant_service

# 5) Update provider-selection regression tests and add the exact Gabon Drive
# Location wording that used to be rejected by the consent detector.
provider_test_path = "Backend/tests/test_oria_assistant_provider_adapter.py"
provider_test = read_repo_file(provider_test_path)
provider_test = replace_once(provider_test, "def test_openai_provider_selects_terra(monkeypatch):", "def test_openai_provider_selects_luna(monkeypatch):", provider_test_path)
provider_test = replace_once(provider_test, 'assert selection.logical_model == "gpt-5.6-terra"', 'assert selection.logical_model == "gpt-6-luna"', provider_test_path)
provider_test = replace_once(provider_test, 'assert selection.provider_model == "gpt-5.6-terra"', 'assert selection.provider_model == "gpt-6-luna"', provider_test_path)
provider_test = replace_once(provider_test, 'assert selection.credit_action is CreditAction.CHAT_TERRA', 'assert selection.credit_action is CreditAction.CHAT_LUNA', provider_test_path)
provider_test = replace_once(provider_test, "def test_openrouter_provider_selects_claude_sonnet(monkeypatch):", "def test_openrouter_provider_selects_claude_haiku(monkeypatch):", provider_test_path)
provider_test = replace_once(provider_test, 'assert selection.logical_model == "claude-sonnet-5.5"', 'assert selection.logical_model == "claude-haiku-5.5"', provider_test_path)
provider_test = replace_once(provider_test, 'assert selection.provider_model == "anthropic/claude-sonnet-5.5"', 'assert selection.provider_model == "anthropic/claude-haiku-5.5"', provider_test_path)
provider_test = replace_once(provider_test, 'assert selection.credit_action is CreditAction.CHAT_CLAUDE_SONNET', 'assert selection.credit_action is CreditAction.CHAT_CLAUDE_HAIKU', provider_test_path)
changes[provider_test_path] = provider_test

protocol_test_path = "Backend/tests/test_oria_assistant_request_protocol.py"
protocol_test = read_repo_file(protocol_test_path)
new_test = '''\n\ndef test_gabon_drive_location_named_recipient_is_valid_consent_question():
    # Exact wording from the real DRIVE LOCATION conversation. The recipient
    # is a business name, not one of the generic words in the old allow-list.
    message = (
        "Voici le récapitulatif : Toyota Hilux, 3 jours, livraison à 16 h à Akanda. "
        "Acceptez-vous que ces informations soient communiquées à Gabon Drive Location "
        "afin d'étudier votre demande ?\\n"
        '<!--ORIA_ASSISTANT_REQUEST_DRAFT:{"request_type":"Location Toyota Hilux",'
        '"summary":"Location Toyota Hilux pendant 3 jours avec livraison à Akanda à 16 h.",'
        '"customer_name":"Jules","customer_phone":"+241 74 32 22 19",'
        '"customer_email":null,"details":{"Véhicule":"Toyota Hilux",'
        '"Durée":"3 jours","Livraison":"16 h à Akanda, Carrefour Delapaix"}}-->'
    )
    visible, draft = extract_request_draft(message, collection_enabled=True, history=[
        {"role": "user", "content": (
            "Je m'appelle Jules. Mon téléphone est +241 74 32 22 19. "
            "Je souhaite louer un Toyota Hilux pendant 3 jours avec livraison à 16 h "
            "à Akanda, Carrefour Delapaix."
        )}
    ])
    assert "ORIA_ASSISTANT_REQUEST_DRAFT" not in visible
    assert draft is not None
    assert draft["customer_name"] == "Jules"
    assert draft["customer_phone"] == "+241 74 32 22 19"
    assert draft["details"]["Véhicule"] == "Toyota Hilux"
    assert draft["details"]["Durée"] == "3 jours"
'''
if "test_gabon_drive_location_named_recipient_is_valid_consent_question" not in protocol_test:
    protocol_test = protocol_test.rstrip() + new_test + "\n"
changes[protocol_test_path] = protocol_test

# 6) Make the consent action match the user's expected, unmistakable wording.
public_page_path = "Frontend/app/a/[slug]/page.tsx"
public_page = read_repo_file(public_page_path)
public_page = replace_once(
    public_page,
    '{confirmingRequest ? "Traitement…" : "J\'autorise la transmission"}',
    '{confirmingRequest ? "Traitement…" : "Transmettre"}',
    public_page_path,
)
# Refresh the authoritative transcript/draft state after confirmation. If this
# read fails, idempotency on the backend still protects against duplicate sends.
public_page = replace_once(
    public_page,
    '''      setPendingRequest(null);
    } catch (err) {
      try { await loadMessages(visitor); } catch { /* la session reste récupérable au prochain chargement */ }
      setError(userFacingError(err));
    } finally {
      setConfirmingRequest(false);
    }
  };

  const cancelPendingRequest''',
    '''      setPendingRequest(null);
      // Re-read the server transcript after the durable confirmation.
      try { await loadMessages(visitor); } catch { /* la demande est déjà confirmée côté serveur */ }
    } catch (err) {
      try { await loadMessages(visitor); } catch { /* la session reste récupérable au prochain chargement */ }
      setError(userFacingError(err));
    } finally {
      setConfirmingRequest(false);
    }
  };

  const cancelPendingRequest''',
    public_page_path,
)
changes[public_page_path] = public_page

# 7) Refresh the professional dashboard when the owner returns to its tab.
requests_page_path = "Frontend/app/assistant/demandes/page.tsx"
requests_page = read_repo_file(requests_page_path)
focus_effect = '''\n  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [load]);
'''
if "const refreshWhenVisible = () =>" not in requests_page:
    requests_page = replace_once(
        requests_page,
        '''  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);''',
        '''  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
''' + focus_effect,
        requests_page_path,
    )
changes[requests_page_path] = requests_page

# All transformations are validated before the first write, preventing a
# half-applied patch if the checkout differs from the source reviewed here.
for relative, content in changes.items():
    path = ROOT / relative
    backup = path.with_name(path.name + f".bak-oria-delivery-{BACKUP_SUFFIX}")
    backup.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
    path.write_text(content, encoding="utf-8")

print("Correctif ORIA Assistant appliqué.")
print("Fichiers modifiés :")
for relative in changes:
    print(f" - {relative}")
print("Sauvegardes créées avec le suffixe : .bak-oria-delivery-" + BACKUP_SUFFIX)
print("\nÀ exécuter ensuite depuis Backend :")
print("  pytest tests/test_oria_assistant_request_protocol.py tests/test_oria_assistant_provider_adapter.py -q")
print("\nPuis depuis Frontend :")
print("  npx tsc --noEmit")
print("\nAucun déploiement ni changement Supabase n'a été effectué.")
