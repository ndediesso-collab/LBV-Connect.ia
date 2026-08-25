import os
from pathlib import Path

from dotenv import load_dotenv
from supabase import Client, create_client


PROJECT_ROOT = Path(__file__).resolve().parents[3]
FRONTEND_ENV = PROJECT_ROOT / "Frontend" / ".env.local"

load_dotenv(FRONTEND_ENV)


def create_supabase_client() -> Client:
    supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    if not supabase_url:
        raise RuntimeError(
            "SUPABASE_URL n'est pas configurée."
        )

    if not supabase_key:
        raise RuntimeError(
            "SUPABASE_SERVICE_ROLE_KEY n'est pas configurée."
        )

    return create_client(
        supabase_url,
        supabase_key,
    )


supabase: Client = create_supabase_client()