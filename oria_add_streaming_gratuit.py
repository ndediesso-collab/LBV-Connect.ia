#!/usr/bin/env python3
"""ORIA: correctifs ciblés. Exécuter à la racine du dépôt téléchargé.

Conception défensive : préparation en mémoire, vérification de chaque ancre,
compilation Python puis écriture seulement si tout est cohérent. Aucune
connexion réseau et aucune donnée Supabase n'est modifiée par ce script.
"""
from __future__ import annotations
import argparse
import ast
from pathlib import Path
import sys

ROOT = Path.cwd()
changes: dict[str, str] = {}
counts: dict[str, int] = {}


def read(path: str) -> str:
    if path not in changes:
        file = ROOT / path
        if not file.is_file():
            raise RuntimeError(f"Fichier manquant : {path}. Se placer à la racine du dépôt GitHub ORIA.")
        changes[path] = file.read_text(encoding="utf-8")
    return changes[path]


def replace(path: str, old: str, new: str, count: int = 1) -> None:
    current = read(path)
    n = current.count(old)
    if n != count:
        raise RuntimeError(f"Ancre obsolète : {path}, attendue {count} fois, présente {n} fois : {old[:90]!r}")
    changes[path] = current.replace(old, new)
    counts[path] = counts.get(path, 0) + 1


FRONT = "Frontend/app/chat/page.tsx"
AI = "Backend/app/route/ai.py"
COSTS = "Backend/app/config/credit_costs.py"
ACCESS = "Backend/app/config/free_tier_access.py"
POLICY = "Backend/app/config/free_tier_policy.py"
FREE_DOC = "Backend/app/route/free_documents.py"
GATEWAY = "Backend/app/services/free_tier_gateway.py"
ARTIFACT = "Backend/app/services/artifact_service.py"
TRIALS = "Backend/app/config/model_trials.py"


FREE_CHAT = "Backend/app/route/free_chat.py"

# 6 : STREAMING REEL DU CHAT GRATUIT, en conservant le registre idempotent
# et la facturation transactionnelle existante. Une coupure navigateur
# n'annule PAS le calcul deja engage : le serveur attend l'usage final.
replace(FREE_CHAT, '''import asyncio
import logging
import os''', '''import asyncio
import json
import logging
import os''')
replace(FREE_CHAT, '''from fastapi import APIRouter, Header, HTTPException''', '''from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse''')
replace(FREE_CHAT, '''# Interne uniquement: before_message_id et reservation_id_override ne sont pas
# exposés dans les parametres HTTP du chat gratuit.
async def _oria_free_chat_core(payload: FreeChatRequest, uid: str, *,''', '''def _oria_free_stream_provider(provider, model: str, message: str,
                               images: list[dict], history: list[dict],
                               reasoning_mode: str, output_limit: int, emit_delta) -> dict:
    """Execution synchrone dans asyncio.to_thread, afin de ne pas bloquer FastAPI.

    Seul un événement fournisseur final avec usage verifie permet de regler
    la reservation. Les deltas visibles ne sont JAMAIS utilises comme facture.
    """
    parts: list[str] = []
    usage_event: dict | None = None
    if provider is ChatProvider.OPENAI:
        generator = OpenAIService().chat_stream(
            model=MODEL_OPENAI_IDS["luna"], message=message, web=False,
            attachments=images, history=history, reasoning_mode=reasoning_mode,
            max_output_tokens=output_limit,
        )
    elif provider is ChatProvider.OPENROUTER:
        actual_model = ("anthropic/claude-haiku-5.5" if model == "claude-haiku-5.5"
                        else "openai/gpt-6-luna")
        generator = _oria_openrouter_service().chat_stream(
            model=actual_model, message=message, web=False, attachments=images,
            history=history, reasoning_mode=reasoning_mode,
            max_completion_tokens=output_limit,
        )
    else:
        raise RuntimeError("Fournisseur IA indisponible.")
    try:
        for event in generator:
            if not isinstance(event, dict):
                continue
            kind = event.get("type")
            if kind == "delta":
                delta = event.get("content")
                if isinstance(delta, str) and delta:
                    parts.append(delta)
                    emit_delta(delta)
            elif kind == "usage":
                usage_event = event
    finally:
        closer = getattr(generator, "close", None)
        if callable(closer):
            closer()
    if not parts or not isinstance(usage_event, dict):
        raise RuntimeError("Flux incomplet ou usage final fournisseur absent.")
    content = "".join(parts)
    if provider is ChatProvider.OPENAI:
        measured = usage_event.get("usage")
        if not isinstance(measured, dict):
            raise RuntimeError("Usage OpenAI final absent.")
        return {"message": content, "usage": measured, "citations": []}
    if (not isinstance(usage_event.get("provider_usage"), dict)
            or usage_event.get("provider_cost_usd") is None):
        raise RuntimeError("Facture finale OpenRouter non confirmee.")
    return {**usage_event, "message": content, "citations": []}


# Interne uniquement: before_message_id et reservation_id_override ne sont pas
# exposés dans les parametres HTTP du chat gratuit.
async def _oria_free_chat_core(payload: FreeChatRequest, uid: str, *,''')
replace(FREE_CHAT, '''                               reservation_id_override: str | None = None):''', '''                               reservation_id_override: str | None = None,
                               stream_on_delta=None):''')
replace(FREE_CHAT, '''    # After reserve, any unknown provider result is considered potentially
    # billable. Keep the reservation for a verified reconciliation.
    try:
        if provider is ChatProvider.OPENAI:
            model_id = MODEL_OPENAI_IDS["luna"]''', '''    # After reserve, any unknown provider result is considered potentially
    # billable. Keep the reservation for a verified reconciliation.
    try:
        if stream_on_delta is not None:
            result = await asyncio.to_thread(
                _oria_free_stream_provider, provider, payload.model, message,
                image_payloads, history, payload.reasoning_mode, output_limit,
                stream_on_delta,
            )
            if provider is ChatProvider.OPENAI:
                usage = result.get("usage")
                if not isinstance(usage, dict):
                    raise ValueError("Usage final OpenAI absent")
                bill = TokenBillingService.calculate(
                    model="luna", usage=usage, web_search_calls=0,
                )
            else:
                bill = OpenRouterTokenBillingService.calculate(result)
        elif provider is ChatProvider.OPENAI:
            model_id = MODEL_OPENAI_IDS["luna"]''')
# Extraire la gestion idempotente du endpoint REST pour la reutiliser en SSE.
replace(FREE_CHAT, '''@router.post("/chat/persistent")
async def persistent_free_chat(payload: FreeChatRequest,
                               user_id: str | None = Header(default=None, alias="user-id"),
                               authorization: str | None = Header(default=None)):
    from uuid import uuid5, NAMESPACE_URL''', '''async def _persistent_free_chat_core(payload: FreeChatRequest,
                                     user_id: str | None = None,
                                     authorization: str | None = None,
                                     emit_delta=None):
    _enabled()
    from uuid import uuid5, NAMESPACE_URL''')
replace(FREE_CHAT, '''            result = await free_chat(payload,user_id=user_id,authorization=authorization)''', '''            result = await _oria_free_chat_core(payload, uid, stream_on_delta=emit_delta)''')
replace(FREE_CHAT, '''    return await asyncio.shield(_FREE_ACTIVE_TASKS[key])


# ORIA_FREE_EDIT_PREVIEW_20261116''', '''    return await asyncio.shield(_FREE_ACTIVE_TASKS[key])


@router.post("/chat/persistent")
async def persistent_free_chat(payload: FreeChatRequest,
                               user_id: str | None = Header(default=None, alias="user-id"),
                               authorization: str | None = Header(default=None)):
    return await _persistent_free_chat_core(payload, user_id, authorization)


def _oria_free_sse(event: str, payload: dict) -> str:
    return f"event: {event}\\ndata: {json.dumps(payload, ensure_ascii=False)}\\n\\n"


_FREE_STREAM_PRODUCERS: set[asyncio.Task] = set()


@router.post("/chat/persistent/stream")
async def persistent_free_chat_stream(payload: FreeChatRequest,
                                      user_id: str | None = Header(default=None, alias="user-id"),
                                      authorization: str | None = Header(default=None)):
    """Flux visible et facturation durable : fermeture navigateur != annulation API.

    Un seul calcul par identifiant message, meme si le client se reconnecte.
    Le flux ne peut s'afficher qu'apres authentification du compte.
    """
    _enabled()
    uid = _identity(user_id, authorization)
    if payload.conversation_id is None or payload.current_message_id is None:
        raise HTTPException(422, "Identifiants du message et de la conversation requis.")
    loop = asyncio.get_running_loop()
    stream_queue: asyncio.Queue[tuple[str, str]] = asyncio.Queue()

    def emit_delta(value: str) -> None:
        # Le fournisseur s'execute dans un thread. Seul le loop touche la file.
        loop.call_soon_threadsafe(stream_queue.put_nowait, ("delta", value))

    # Cette tâche n'est jamais annulee par la fermeture de la connexion SSE.
    # Le coeur protege aussi son appel fournisseur par asyncio.shield.
    producer = asyncio.create_task(_persistent_free_chat_core(
        payload, uid, authorization, emit_delta=emit_delta,
    ))
    # Conserver une reference forte si le navigateur se deconnecte.
    _FREE_STREAM_PRODUCERS.add(producer)
    def cleanup(done: asyncio.Task) -> None:
        _FREE_STREAM_PRODUCERS.discard(done)
        try:
            done.exception()  # Consommer une eventuelle erreur sans la masquer.
        except asyncio.CancelledError:
            pass
    producer.add_done_callback(cleanup)

    async def events():
        waiting = asyncio.create_task(stream_queue.get())
        try:
            yield _oria_free_sse("start", {"success": True, "model": payload.model})
            while True:
                completed, _ = await asyncio.wait(
                    {producer, waiting}, timeout=15,
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if not completed:
                    yield ": keepalive\\n\\n"
                    continue
                if waiting in completed:
                    kind, value = waiting.result()
                    if kind == "delta":
                        yield _oria_free_sse("delta", {"content": value})
                    waiting = asyncio.create_task(stream_queue.get())
                if producer in completed:
                    # Les derniers deltas du thread peuvent encore etre en file.
                    while not stream_queue.empty():
                        kind, value = stream_queue.get_nowait()
                        if kind == "delta":
                            yield _oria_free_sse("delta", {"content": value})
                    try:
                        result = producer.result()
                    except Exception:
                        logger.exception("ORIA FREE STREAM : generation ou reglement non confirme")
                        yield _oria_free_sse("error", {
                            "detail": "Generation non confirmee : verifiez le solde et l'historique avant de relancer."
                        })
                    else:
                        yield _oria_free_sse("done", result)
                    break
        finally:
            waiting.cancel()
            # Ne PAS annuler producer : il doit finir et regler la reserve.

    return StreamingResponse(
        events(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform",
                 "X-Accel-Buffering": "no"},
    )


# ORIA_FREE_EDIT_PREVIEW_20261116''')

# Client SSE gratuit : conserver l'authentification et les objets File existants.
replace(FRONT, '''/*
 * ============================================================
 * API STREAMING AUTHENTIFIÉE
 * ============================================================
 */

async function apiStreamFetch(''', '''/*
 * ============================================================
 * API STREAMING AUTHENTIFIÉE
 * ============================================================
 */

async function apiFreeStreamFetch(payload: unknown, signal?: AbortSignal): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user || !session.access_token) throw new Error("Utilisateur non authentifié.");
  const response = await fetch(`${API_URL}/ai/free/chat/persistent/stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-id": session.user.id,
      authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.detail || "La generation gratuite est indisponible.");
  }
  if (!response.body) throw new Error("Le flux de reponse gratuite est vide.");
  return response;
}

async function apiStreamFetch(''')
replace(FRONT, '''    let userEntry: ChatMessage | null = null;
    try {''', '''    let userEntry: ChatMessage | null = null;
    let streamedAssistantId: string | null = null;
    try {''')
replace(FRONT, '''        const response = await apiFetch<{
          success: boolean; message: string; requires_reconciliation?: boolean;
          server_persisted?: boolean; assistant_message_id?: string;
          wallet?: OriaFreeStatus["wallet"];
        }>("/ai/free/chat/persistent", {
          method: "POST",
          body: JSON.stringify({
            message: userMessage.content, model: selectedModel, reasoning_mode: reasoningMode, web: webEnabled,
            attachments: await encodeFreeAttachments(attachments),
            conversation_id: conversationId, current_message_id: userMessage.id,
          }),
          signal: freeController.signal,
        });
        if (!response.success || !response.message?.trim()) throw new Error("La réponse gratuite n'a pas été confirmée.");
        answerText = response.message;
        serverPersistedMessageId = response.server_persisted === true && response.assistant_message_id
          ? response.assistant_message_id : null;
        reconciliationRequired = response.requires_reconciliation === true;''', '''        streamedAssistantId = crypto.randomUUID();
        const pendingAssistantId = streamedAssistantId;
        setMessages((current) => activeConversationRef.current === conversationId
          ? [...current, {id: pendingAssistantId, conversationId, role: "assistant", content: "", createdAt: new Date().toISOString()}]
          : current);
        const stream = await apiFreeStreamFetch({
          message: userMessage.content, model: selectedModel,
          reasoning_mode: reasoningMode, web: webEnabled,
          attachments: await encodeFreeAttachments(attachments),
          conversation_id: conversationId, current_message_id: userMessage.id,
        }, freeController.signal);
        const reader = stream.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let liveText = "";
        let finalResult: {
          success: boolean; message: string; requires_reconciliation?: boolean;
          server_persisted?: boolean; assistant_message_id?: string;
        } | null = null;
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, {stream: true}).replace(/\\r\\n/g, "\\n");
          const rawEvents = buffer.split("\\n\\n");
          buffer = rawEvents.pop() || "";
          for (const rawEvent of rawEvents) {
            if (!rawEvent.trim() || rawEvent.startsWith(":")) continue;
            let eventName = "message";
            const dataLines: string[] = [];
            for (const line of rawEvent.split("\\n")) {
              if (line.startsWith("event:")) eventName = line.slice(6).trim();
              if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
            }
            if (!dataLines.length) continue;
            const data = JSON.parse(dataLines.join("\\n")) as Record<string, unknown>;
            if (eventName === "delta" && typeof data.content === "string") {
              liveText += data.content;
              const renderedText = liveText;
              setChatStatusStep(null);
              setMessages((current) => current.map((entry) => entry.id === pendingAssistantId
                ? {...entry, content: renderedText} : entry));
            } else if (eventName === "error") {
              throw new Error(typeof data.detail === "string" ? data.detail : "Streaming gratuit interrompu.");
            } else if (eventName === "done") {
              finalResult = data as typeof finalResult;
            }
          }
        }
        if (!finalResult?.success || !finalResult.message?.trim()) {
          throw new Error("Usage final gratuit non confirme. Consulte le solde avant de retenter.");
        }
        answerText = finalResult.message;
        serverPersistedMessageId = finalResult.server_persisted === true && finalResult.assistant_message_id
          ? finalResult.assistant_message_id : null;
        reconciliationRequired = finalResult.requires_reconciliation === true;''')
replace(FRONT, '''      setMessages((current) => activeConversationRef.current === conversationId ? [...current, answer] : current);''', '''      setMessages((current) => activeConversationRef.current === conversationId
        ? streamedAssistantId
          ? current.map((entry) => entry.id === streamedAssistantId ? answer : entry)
          : [...current, answer]
        : current);''')
replace(FRONT, '''      console.error("ORIA gratuit : erreur d'envoi", error);''', '''      if (streamedAssistantId) {
        const failedId = streamedAssistantId;
        setMessages((current) => current.filter((entry) => entry.id !== failedId));
      }
      console.error("ORIA gratuit : erreur d'envoi", error);''')

def main() -> None:
    parser = argparse.ArgumentParser(description="Applique les correctifs ORIA sur une copie locale du dépôt.")
    parser.add_argument("--dry-run", action="store_true", help="Vérifie toutes les ancres sans écrire")
    args = parser.parse_args()
    for path, value in changes.items():
        if path.endswith(".py"):
            try:
                ast.parse(value, filename=path)
            except SyntaxError as error:
                raise RuntimeError(f"Erreur Python {path}:{error.lineno}: {error.msg}") from error
    print(f"{len(changes)} fichiers préparés, {sum(counts.values())} substitutions vérifiées.")
    for path in changes:
        print(" -", path, "(", counts[path], "modifications )")
    if args.dry_run:
        print("Contrôle terminé : aucune écriture.")
        return
    backups: dict[str, bytes | None] = {}
    try:
        for path, content in changes.items():
            target = ROOT / path
            backups[path] = target.read_bytes() if target.exists() else None
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8", newline="")
    except Exception:
        for path, data in backups.items():
            if data is None:
                (ROOT / path).unlink(missing_ok=True)
            else:
                (ROOT / path).write_bytes(data)
        raise
    print("Modifications écrites. Vérifier ensuite les tests et déploiements.")

if __name__ == "__main__":
    try:
        main()
    except RuntimeError as error:
        print("ERREUR :", error, file=sys.stderr)
        sys.exit(1)
