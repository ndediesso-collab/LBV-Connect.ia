"""
TEST COMPLET : REGISTER -> /profile/phone -> auth.users.phone

Ce fichier est autonome et ne contient volontairement AUCUNE reference
a NEXT_PUBLIC_SUPABASE_ANON_KEY.

Il charge les variables depuis :
    ../Frontend/.env.local

Variables attendues :
    NEXT_PUBLIC_SUPABASE_URL
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    SUPABASE_SERVICE_ROLE_KEY

API backend :
    NEXT_PUBLIC_API_URL
    ou NEXT_PUBLIC_BACKEND_URL
    ou fallback https://lbv-connect-api.onrender.com
"""

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
import requests
from supabase import Client, create_client


# ============================================================
# 1. ENVIRONNEMENT
# ============================================================

PROJECT_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_ENV = PROJECT_ROOT / "Frontend" / ".env.local"

if not FRONTEND_ENV.exists():
    print(
        f"[ERROR] .env.local introuvable : {FRONTEND_ENV}"
    )
    sys.exit(1)

load_dotenv(FRONTEND_ENV, override=False)


SUPABASE_URL = os.getenv(
    "NEXT_PUBLIC_SUPABASE_URL"
)

SUPABASE_PUBLISHABLE_KEY = os.getenv(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
)

SUPABASE_SERVICE_ROLE_KEY = os.getenv(
    "SUPABASE_SERVICE_ROLE_KEY"
)

API_URL = (
    os.getenv("NEXT_PUBLIC_API_URL")
    or os.getenv("NEXT_PUBLIC_BACKEND_URL")
    or "https://lbv-connect-api.onrender.com"
).rstrip("/")


# ============================================================
# 2. DONNEES DE TEST
# ============================================================

TEST_FIRST_NAME = "jojo"
TEST_LAST_NAME = "ESSO"
TEST_COUNTRY_ISO2 = "GA"
TEST_PHONE = "77379848"
TEST_PHONE_INTERNATIONAL = "+24177379848"

TEST_EMAIL = os.getenv(
    "TEST_EMAIL",
    "essojojo01@gmail.com",
)

TEST_PASSWORD = os.getenv(
    "TEST_PASSWORD",
    "*Jnk_ll_2008*_",
)


# ============================================================
# 3. OUTILS
# ============================================================

def fail(message: str) -> None:
    print(f"\n[ERROR] {message}")
    sys.exit(1)


def create_public_client() -> Client:
    if not SUPABASE_URL:
        fail(
            "NEXT_PUBLIC_SUPABASE_URL est absente de "
            "Frontend/.env.local."
        )

    if not SUPABASE_PUBLISHABLE_KEY:
        fail(
            "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY est absente "
            "de Frontend/.env.local."
        )

    return create_client(
        SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY,
    )


def create_admin_client() -> Client:
    if not SUPABASE_URL:
        fail(
            "NEXT_PUBLIC_SUPABASE_URL est absente."
        )

    if not SUPABASE_SERVICE_ROLE_KEY:
        fail(
            "SUPABASE_SERVICE_ROLE_KEY est absente de "
            "Frontend/.env.local."
        )

    return create_client(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
    )


# ============================================================
# 4. TEST
# ============================================================

def main() -> None:
    print("=" * 70)
    print("TEST REGISTER -> auth.users.phone")
    print("=" * 70)

    # --------------------------------------------------------
    # ETAPE 1
    # --------------------------------------------------------

    print("\n[1/7] Configuration")

    print(
        f"  Supabase URL : {SUPABASE_URL}"
    )
    print(
        f"  API URL      : {API_URL}"
    )

    if not SUPABASE_URL:
        fail(
            "NEXT_PUBLIC_SUPABASE_URL est absente."
        )

    if not SUPABASE_PUBLISHABLE_KEY:
        fail(
            "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY est absente."
        )

    if not SUPABASE_SERVICE_ROLE_KEY:
        fail(
            "SUPABASE_SERVICE_ROLE_KEY est absente."
        )

    print("  [OK] Variables Supabase trouvees.")

    # --------------------------------------------------------
    # ETAPE 2
    # --------------------------------------------------------

    print("\n[2/7] Donnees simulees du register")

    print(
        f"  first_name          = {TEST_FIRST_NAME}"
    )
    print(
        f"  last_name           = {TEST_LAST_NAME}"
    )
    print(
        f"  country_iso2        = {TEST_COUNTRY_ISO2}"
    )
    print(
        f"  phone               = {TEST_PHONE}"
    )
    print(
        f"  phone_international = "
        f"{TEST_PHONE_INTERNATIONAL}"
    )
    print(
        f"  email               = {TEST_EMAIL}"
    )

    # --------------------------------------------------------
    # ETAPE 3
    # --------------------------------------------------------
    # On utilise la publishable key exactement comme le frontend.
    # Le but est de reproduire signUp(), pas de contourner Auth.

    print(
        "\n[3/7] Simulation exacte du signUp frontend"
    )

    supabase = create_public_client()

    try:
        result = supabase.auth.sign_up(
            {
                "email": TEST_EMAIL,
                "password": TEST_PASSWORD,
                "options": {
                    "data": {
                        "first_name": TEST_FIRST_NAME,
                        "last_name": TEST_LAST_NAME,
                        "phone": TEST_PHONE_INTERNATIONAL,
                        "country_iso2": TEST_COUNTRY_ISO2,
                    }
                },
            }
        )
    except Exception as exc:
        fail(
            f"signUp() a echoue : {exc}"
        )

    user = result.user
    session = result.session

    if user is None:
        fail(
            "Supabase n'a retourne aucun user."
        )

    print(
        f"  user_id = {user.id}"
    )

    metadata = user.user_metadata or {}

    print(
        "  metadata.phone = "
        f"{metadata.get('phone')}"
    )
    print(
        "  metadata.country_iso2 = "
        f"{metadata.get('country_iso2')}"
    )

    if metadata.get("phone") != TEST_PHONE_INTERNATIONAL:
        fail(
            "Le numero n'a pas ete place dans "
            "raw_user_meta_data.phone."
        )

    # --------------------------------------------------------
    # ETAPE 4
    # --------------------------------------------------------

    print(
        "\n[4/7] Verification de la session"
    )

    if session is None:
        print(
            "[ERROR] signUp() a cree le compte mais aucune "
            "session n'est disponible."
        )
        print(
            "Cela indique normalement que la confirmation "
            "e-mail est activee."
        )
        print(
            "La route /profile/phone exige un Bearer token, "
            "donc elle ne peut pas etre appelee a cette etape."
        )
        sys.exit(2)

    print("  [OK] Session obtenue.")

    # --------------------------------------------------------
    # ETAPE 5
    # --------------------------------------------------------

    print(
        "\n[5/7] Appel de PUT /profile/phone"
    )

    try:
        response = requests.put(
            f"{API_URL}/profile/phone",
            headers={
                "Authorization":
                    f"Bearer {session.access_token}",
                "user-id": user.id,
                "Content-Type": "application/json",
            },
            json={
                "phone": TEST_PHONE_INTERNATIONAL,
                "country_iso2": TEST_COUNTRY_ISO2,
            },
            timeout=30,
        )
    except Exception as exc:
        fail(
            f"Impossible d'appeler {API_URL}/profile/phone : "
            f"{exc}"
        )

    print(
        f"  HTTP = {response.status_code}"
    )

    try:
        body = response.json()
    except ValueError:
        body = {
            "raw_response": response.text
        }

    print(
        f"  response = {body}"
    )

    if not response.ok:
        fail(
            "La route /profile/phone a retourne une erreur."
        )

    print(
        "  [OK] Route /profile/phone acceptee."
    )

    # --------------------------------------------------------
    # ETAPE 6
    # --------------------------------------------------------

    print(
        "\n[6/7] Lecture Admin de auth.users.phone"
    )

    admin = create_admin_client()

    try:
        admin_result = (
            admin.auth.admin.get_user_by_id(
                user.id
            )
        )
    except Exception as exc:
        fail(
            f"Lecture Admin impossible : {exc}"
        )

    admin_user = getattr(
        admin_result,
        "user",
        None,
    )

    if admin_user is None:
        fail(
            "Supabase Admin n'a retourne aucun utilisateur."
        )

    native_phone = getattr(
        admin_user,
        "phone",
        None,
    )

    print(
        f"  auth.users.phone = {native_phone}"
    )

    if native_phone != TEST_PHONE_INTERNATIONAL:
        fail(
            "ECHEC FINAL : auth.users.phone est incorrect. "
            f"Obtenu={native_phone!r}; "
            f"Attendu={TEST_PHONE_INTERNATIONAL!r}"
        )

    print(
        "  [OK] auth.users.phone est correctement renseigne."
    )

    # --------------------------------------------------------
    # ETAPE 7
    # --------------------------------------------------------

    print(
        "\n[7/7] RESULTAT"
    )

    print(
        f"  user_id      = {user.id}"
    )
    print(
        f"  email        = {TEST_EMAIL}"
    )
    print(
        f"  phone        = {native_phone}"
    )
    print(
        f"  country_iso2 = {TEST_COUNTRY_ISO2}"
    )

    print("\n" + "=" * 70)
    print("TEST TERMINE AVEC SUCCES")
    print("=" * 70)


if __name__ == "__main__":
    main()