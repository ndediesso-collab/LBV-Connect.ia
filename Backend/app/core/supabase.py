"""Client Supabase partagé pour le backend ORIA.

Test de stabilisation : HTTP/1.1 au lieu de HTTP/2.
Compatible avec supabase==2.31.0, postgrest==2.31.0 et httpx==0.28.1.
"""

import os
from pathlib import Path

import httpx
from dotenv import load_dotenv
from supabase import Client, create_client
from supabase.lib.client_options import SyncClientOptions


PROJECT_ROOT = Path(__file__).resolve().parents[3]
FRONTEND_ENV = PROJECT_ROOT / "Frontend" / ".env.local"

load_dotenv(FRONTEND_ENV)


def create_supabase_client() -> Client:
    supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    if not supabase_url:
        raise RuntimeError("SUPABASE_URL n'est pas configurée.")

    if not supabase_key:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY n'est pas configurée.")

    # Le même client HTTP est partagé par les services du SDK Supabase.
    # Par défaut, HTTP/2 est désactivé pour tester les erreurs de lecture
    # observées dans les logs Render. ORIA_SUPABASE_HTTP2=1 permet de revenir
    # au comportement HTTP/2 sans modifier le code.
    http2_enabled = os.getenv("ORIA_SUPABASE_HTTP2", "0").strip() == "1"

    http_client = httpx.Client(
        http2=http2_enabled,
        follow_redirects=True,
        timeout=httpx.Timeout(
            connect=5.0,
            read=30.0,
            write=60.0,
            pool=5.0,
        ),
        limits=httpx.Limits(
            max_connections=30,
            max_keepalive_connections=10,
            keepalive_expiry=10.0,
        ),
    )

    options = SyncClientOptions(httpx_client=http_client)

    try:
        return create_client(supabase_url, supabase_key, options=options)
    except Exception:
        http_client.close()
        raise


supabase: Client = create_supabase_client()
