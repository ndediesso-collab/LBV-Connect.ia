#!/usr/bin/env python3
# coding: utf-8
"""Correctif ciblé ORIA: inscription Web/Expo, reprise Chariow Découverte,
CTA chat. Ne touche pas à l'activation financière ni aux packs classiques.
Mode --check: prévisualisation; mode --apply: sauvegarde + application atomique.
"""
import argparse
import datetime as dt
import difflib
import os
import re
from pathlib import Path
import sys

STAMP = "ORIA_UX_INSCRIPTION_REPRISE_V1"
FILES = (
    "mobile/src/app/register/index.tsx",
    "Frontend/app/register/page.tsx",
    "mobile/src/app/chat/index.tsx",
    "Frontend/app/chat/page.tsx",
    "Frontend/app/packs/page.tsx",
    "Backend/app/routes.py",
)


def replace_once(s: str, old: str, new: str, label: str) -> str:
    n = s.count(old)
    if n != 1:
        raise ValueError(f"{label}: motif attendu 1 fois, trouvé {n}. Fichier modifié ?")
    return s.replace(old, new, 1)


def replace_between(s: str, start: str, end: str, replacement: str, label: str) -> str:
    if s.count(start) != 1 or s.count(end) != 1:
        raise ValueError(f"{label}: bornes non uniques ou absentes.")
    a = s.index(start)
    b = s.index(end, a)
    return s[:a] + replacement + s[b:]


def mobile_register(s: str) -> str:
    s = replace_once(s,
        'import React, { useCallback, useMemo, useState } from "react";',
        'import React, { useCallback, useMemo, useRef, useState } from "react";',
        'registration mobile: import')
    s = replace_once(s,
        '  const [\n    loading,\n    setLoading,\n  ] = useState(false);',
        '  const [\n    loading,\n    setLoading,\n  ] = useState(false);\n  // Empêche deux créations concurrentes avant le prochain rendu React.\n  const submitInFlight = useRef(false);',
        'registration mobile: anti double clic')
    s = replace_once(s,
        '    setLoading(true);\n\n    try {\n      /*\n       * Création du compte Supabase.',
        '''    if (submitInFlight.current) return;
    submitInFlight.current = true;
    let navigated = false;
    setLoading(true);

    try {
      // Si une tentative précédente a créé la session, ne jamais relancer signUp.
      const existing = await supabase.auth.getSession();
      if (existing.data.session?.user.email?.trim().toLowerCase() === normalizedEmail) {
        router.replace("/chat" as any);
        navigated = true;
        return;
      }
      /*
       * Création du compte Supabase.''',
        'registration mobile: session déjà créée')
    s = replace_once(s,
        '''      if (signUpError) {
        setError(
          localizeRegisterError(signUpError.message || t.accountCreationFailed, language),
        );

        return;
      }
''',
        '''      if (signUpError) {
        // Une inscription antérieure peut avoir réussi sans redirection (ancien bug).
        // On se connecte avec le mot de passe saisi, sans créer un second compte.
        if (/already registered|user already registered/i.test(signUpError.message || "")) {
          const resumed = await supabase.auth.signInWithPassword({
            email: normalizedEmail, password: passwordValue,
          });
          if (!resumed.error && resumed.data.session?.user.email?.trim().toLowerCase() === normalizedEmail) {
            router.replace("/chat" as any);
            navigated = true;
            return;
          }
        }
        setError(localizeRegisterError(signUpError.message || t.accountCreationFailed, language));
        return;
      }
''',
        'registration mobile: récupération compte créé')
    start='''      /*
       * Dans l'application mobile, l'URL backend est fournie'''
    end='''
      return;
    } catch (caughtError) {'''
    replacement='''      // Le compte ET la session sont créés : le téléphone est déjà conservé
      // dans user_metadata, exploité par /payments/checkout en cas de besoin.
      // Une erreur de PUT /profile/phone ne doit plus bloquer l'inscription.
      const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL ||
        process.env.EXPO_PUBLIC_BACKEND_URL ||
        "https://lbv-connect-api.onrender.com";
      if (apiBaseUrl) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        void fetch(`${apiBaseUrl.replace(/\\/$/, "")}/profile/phone`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${data.session.access_token}`,
            "user-id": data.user.id,
          },
          body: JSON.stringify({ phone: phoneInternational, country_iso2: selectedCountry.iso2 }),
          signal: controller.signal,
        }).then((response) => {
          if (!response.ok) console.warn("ORIA: téléphone non synchronisé, métadonnées conservées.");
        }).catch(() => {
          console.warn("ORIA: synchronisation téléphone reportée, inscription validée.");
        }).finally(() => clearTimeout(timer));
      }

      setMessage(t.success);
      // La réussite de l'authentification suffit pour accéder directement au chat.
      router.replace("/chat" as any);
      navigated = true;'''
    s = replace_between(s,start,end,replacement,'registration mobile: téléphone non bloquant')
    s = replace_once(s,
        '''    } finally {
      setLoading(false);
    }
  }

  /**
   * Sélection d'un pays.''',
        '''    } finally {
      // Conserver le verrou jusqu'au démontage de l'écran après navigation.
      if (!navigated) {
        submitInFlight.current = false;
        setLoading(false);
      }
    }
  }

  /**
   * Sélection d'un pays.''',
        'registration mobile: fin du verrou')
    return s


def web_register(s: str) -> str:
    s=replace_once(s,
        'import { FormEvent, useEffect, useState } from "react";',
        'import { FormEvent, useEffect, useRef, useState } from "react";',
        'registration web: import')
    s=replace_once(s,
        '  const [loading, setLoading] = useState(false);',
        '  const [loading, setLoading] = useState(false);\n  const submitInFlight = useRef(false);',
        'registration web: verrou')
    s=replace_once(s,
        '''    setLoading(true);

    try {
      const supabase =
        createClient();''',
        '''    if (submitInFlight.current) return;
    submitInFlight.current = true;
    let navigated = false;
    setLoading(true);

    try {
      const supabase = createClient();
      // Une inscription interrompue peut avoir déjà créé un compte et une session.
      const existing = await supabase.auth.getSession();
      if (existing.data.session?.user.email?.trim().toLowerCase() === email) {
        navigated = true;
        window.location.replace("/chat");
        return;
      }''',
        'registration web: session déjà créée')
    s=replace_once(s,
        '''      if (signUpError) {
        setError(
          signUpError.message ||
            UI[language].createAccountError,
        );
        return;
      }
''',
        '''      if (signUpError) {
        // Évite le faux "compte existant" après une inscription déjà réussie.
        if (/already registered|user already registered/i.test(signUpError.message || "")) {
          const resumed = await supabase.auth.signInWithPassword({ email, password });
          if (!resumed.error && resumed.data.session?.user.email?.trim().toLowerCase() === email) {
            navigated = true;
            window.location.replace("/chat");
            return;
          }
        }
        setError(signUpError.message || UI[language].createAccountError);
        return;
      }
''',
        'registration web: reprise compte créé')
    start='''      const apiBaseUrl =
        process.env.NEXT_PUBLIC_API_URL ||'''
    end='''
      return;
    } catch (error) {'''
    replacement='''      // Le backend lit déjà le numéro dans user_metadata si auth.users.phone
      // n'est pas encore synchronisé : ne jamais bloquer l'accès au chat.
      const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ||
        process.env.NEXT_PUBLIC_BACKEND_URL;
      if (apiBaseUrl) {
        void fetch(`${apiBaseUrl.replace(/\\/$/, "")}/profile/phone`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${data.session.access_token}`,
            "user-id": data.user.id,
          },
          body: JSON.stringify({ phone: phoneInternational, country_iso2: country.iso2 }),
          keepalive: true,
        }).then((response) => {
          if (!response.ok) console.warn("ORIA: téléphone non synchronisé, métadonnées conservées.");
        }).catch(() => console.warn("ORIA: synchronisation téléphone différée."));
      }

      setMessage(UI[language].accountCreated);
      navigated = true;
      window.location.replace("/chat");'''
    s=replace_between(s,start,end,replacement,'registration web: téléphone non bloquant')
    s=replace_once(s,
        '''    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-dvh''',
        '''    } finally {
      if (!navigated) {
        submitInFlight.current = false;
        setLoading(false);
      }
    }
  }

  return (
    <main className="min-h-dvh''',
        'registration web: fin verrou')
    return s


def mobile_chat(s: str) -> str:
    s=replace_once(s,
        '''      setError(requestError instanceof Error
        ? requestError.message : "Impossible de charger les crédits.");
    } finally {
      setIsLoadingWallet(false);
    }
  }

  async function loadTrials()''',
        '''      // 404 est normal pour un nouvel inscrit n'ayant jamais acheté de pack.
      // Le Chat reste accessible en lecture, sans envoyer de requêtes IA payantes.
      if (requestError instanceof Error &&
          requestError.message === "Aucun portefeuille de crédits trouvé pour cet utilisateur.") {
        setWallet(null);
      } else {
        setError(requestError instanceof Error
          ? requestError.message : "Impossible de charger les crédits.");
      }
    } finally {
      setIsLoadingWallet(false);
    }
  }

  async function loadTrials()''',
        'chat mobile: 404 portefeuille normal')
    s=replace_once(s,
        '''              <Text style={styles.emptyDescription}>
                {t.welcomeDescription}
              </Text>
              {showReturnWelcome && activeConversationId ? (''',
        '''              <Text style={styles.emptyDescription}>
                {t.welcomeDescription}
              </Text>
              {!isLoadingWallet && !hasActivePack && currentUserId ? (
                <View style={{ marginTop: 28, padding: 22, borderRadius: 20,
                  backgroundColor: isDark ? "#202020" : "#F5F5F5", gap: 13 }}>
                  <Text style={{ color: isDark ? "#FFFFFF" : "#171717", fontSize: 17,
                    fontWeight: "700", lineHeight: 24 }}>
                    {language === "fr" ? "Pour discuter avec ORIA, achetez d'abord un pack." :
                      "To chat with ORIA, first purchase a plan."}
                  </Text>
                  <Pressable accessibilityRole="button" onPress={() => router.push("/packs" as any)}
                    style={{ backgroundColor: isDark ? "#FFFFFF" : "#151515", borderRadius: 14,
                      paddingVertical: 15, alignItems: "center" }}>
                    <Text style={{ color: isDark ? "#111111" : "#FFFFFF", fontSize: 15,
                      fontWeight: "700" }}>
                      {language === "fr" ? "Acheter un pack pour discuter" : "Buy a plan to chat"}
                    </Text>
                  </Pressable>
                </View>
              ) : null}
              {showReturnWelcome && activeConversationId ? (''',
        'chat mobile: message achat pack')
    return s


def web_chat(s: str) -> str:
    s=replace_once(s,
        '''  const packCtaIsPrimary = !isLoadingWallet && (
    wallet?.is_pack_active === false ||
    (wallet?.is_pack_active === true && availableBalance <= 0)
  );''',
        '''  const packCtaIsPrimary = !isLoadingWallet && (
    !wallet || wallet.is_pack_active === false ||
    (wallet.is_pack_active === true && availableBalance <= 0)
  );''',
        'chat web: CTA primaire comptes sans wallet')
    s=replace_once(s,
        '''    : isLoadingWallet || !wallet
    ? (language === "fr" ? "Voir les packs" : "View plans")
    : !wallet.is_pack_active''',
        '''    : isLoadingWallet
    ? (language === "fr" ? "Chargement…" : "Loading…")
    : !wallet || !wallet.is_pack_active''',
        'chat web: libellé nouveaux comptes')
    return s


def backend(s: str) -> str:
    anchor='''def _discovery_has_prior_paid_pack(user_id: str) -> bool:'''
    helper='''def _discovery_resume_checkout(user_id: str, *, column: str, product_id: str) -> dict:
    """Reprend une commande en attente, SANS en créer une autre.

    60 secondes = délai UX, PAS une expiration de paiement.
    Une commande ancienne sans URL enregistrée exige une vérification Chariow.
    """
    if column not in {"pack_id", "addon_id"}:
        raise RuntimeError("Colonne de produit invalide")
    rows = (supabase.table("payment_transactions")
            .select("created_at,metadata")
            .eq("user_id", user_id).eq(column, product_id)
            .in_("status", ["pending", "processing"])
            .order("created_at", desc=True).limit(1).execute())
    row = (rows.data or [None])[0]
    if not row:
        return {"url": None, "wait": 0, "needs_review": False}
    created = row.get("created_at")
    age = 0.0
    try:
        when = datetime.fromisoformat(str(created).replace("Z", "+00:00"))
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        age = max(0.0, (datetime.now(timezone.utc) - when).total_seconds())
    except (TypeError, ValueError, OverflowError):
        pass  # Horodatage inconnu : jamais de reprise automatique.
    wait = max(0, int(60 - age + 0.999))
    data = row.get("metadata")
    url = data.get("checkout_url") if isinstance(data, dict) else None
    # Cette URL provient uniquement de l'API Chariow et a été enregistrée côté serveur.
    valid_url = isinstance(url, str) and url.startswith("https://")
    return {
        "url": url if valid_url and wait == 0 else None,
        "wait": wait,
        "needs_review": wait == 0 and not valid_url,
    }


'''
    s=replace_once(s,anchor,helper+anchor,'backend: reprise basée sur commande originale')
    s=replace_once(s,
        '''    pending_topup = _discovery_has_transaction(
        uid, column="addon_id", product_id=_DISCOVERY_TOPUP_ID, statuses=("pending", "processing"))
    active = bool(wallet and wallet.pack_id == _DISCOVERY_PRIMARY_ID and wallet.is_pack_active)''',
        '''    pending_topup = _discovery_has_transaction(
        uid, column="addon_id", product_id=_DISCOVERY_TOPUP_ID, statuses=("pending", "processing"))
    primary_resume = (_discovery_resume_checkout(uid, column="pack_id", product_id=_DISCOVERY_PRIMARY_ID)
                      if pending_purchase else {"url": None, "wait": 0, "needs_review": False})
    topup_resume = (_discovery_resume_checkout(uid, column="addon_id", product_id=_DISCOVERY_TOPUP_ID)
                    if pending_topup else {"url": None, "wait": 0, "needs_review": False})
    active = bool(wallet and wallet.pack_id == _DISCOVERY_PRIMARY_ID and wallet.is_pack_active)''',
        'backend: reprise statut')
    s=replace_once(s,
        '''            "topup_pending": pending_topup, "balance": wallet.balance if active else 0}''',
        '''            "topup_pending": pending_topup, "balance": wallet.balance if active else 0,
            "resume_checkout_url": primary_resume["url"],
            "resume_after_seconds": primary_resume["wait"],
            "purchase_needs_review": primary_resume["needs_review"],
            "resume_topup_url": topup_resume["url"],
            "topup_resume_after_seconds": topup_resume["wait"],
            "topup_needs_review": topup_resume["needs_review"]}''',
        'backend: champs reprise statut')
    s=replace_once(s,
        '''    checkout_url = chariow_checkout[
        "checkout_url"
    ]

    # ========================================================
    # 16. RÉPONSE FRONTEND''',
        '''    checkout_url = chariow_checkout[
        "checkout_url"
    ]

    # Sauvegarder le lien de reprise privé sur LA transaction existante.
    # Aucun nouveau paiement ni crédit n'est créé ici.
    if request.product_id in _DISCOVERY_IDS and checkout_url:
        try:
            existing_metadata = transaction.get("metadata") or {}
            if not isinstance(existing_metadata, dict):
                existing_metadata = {}
            updated = (supabase.table("payment_transactions")
                .update({"metadata": {**existing_metadata, "checkout_url": checkout_url}})
                .eq("reference", reference)
                .eq("user_id", authenticated_user_id)
                .eq("status", "pending").execute())
            if not updated.data:
                # Statut éventuellement déjà modifié par le webhook ; ne pas le réinitialiser.
                print("[DISCOVERY CHECKOUT] lien non conservé (statut modifié)", flush=True)
        except Exception:
            # Checkout déjà ouvert : ne pas provoquer une deuxième commande.
            print("[DISCOVERY CHECKOUT] lien de reprise indisponible", flush=True)

    # ========================================================
    # 16. RÉPONSE FRONTEND''',
        'backend: stocker lien de la commande')
    return s


def web_packs(s: str) -> str:
    s=replace_once(s,
        '''  purchase_pending?: boolean;
  active_discovery: boolean;''',
        '''  purchase_pending?: boolean;
  resume_checkout_url?: string | null;
  resume_after_seconds?: number;
  purchase_needs_review?: boolean;
  resume_topup_url?: string | null;
  topup_resume_after_seconds?: number;
  topup_needs_review?: boolean;
  active_discovery: boolean;''',
        'packs web: réponse reprise')
    s=replace_once(s,
        '''                  disabled={isPaying !== null || discoverySession === "error" ||
                    (discoverySession === "authenticated" && discoveryStatus?.can_buy !== true)}
                  onClick={() => void startPayment({ type: "primary_pack", id: DISCOVERY_PACK_ID })}''',
        '''                  disabled={isPaying !== null || discoverySession === "error" ||
                    (discoverySession === "authenticated" && discoveryStatus?.can_buy !== true &&
                      !(discoveryStatus?.purchase_pending && discoveryStatus?.resume_checkout_url))}
                  onClick={() => {
                    if (discoveryStatus?.purchase_pending && discoveryStatus.resume_checkout_url) {
                      window.location.assign(discoveryStatus.resume_checkout_url);
                    } else {
                      void startPayment({ type: "primary_pack", id: DISCOVERY_PACK_ID });
                    }
                  }}''',
        'packs web: reprise sans nouveau POST')
    s=replace_once(s,
        '''                      ? discoveryStatus?.purchase_pending
                        ? language === "fr" ? "Paiement en attente" : "Payment pending"
                        : language === "fr" ? "Non éligible" : "Not eligible"''',
        '''                      ? discoveryStatus?.purchase_pending
                        ? discoveryStatus.resume_checkout_url
                          ? language === "fr" ? "Reprendre le paiement" : "Resume payment"
                          : language === "fr" ? "Paiement en attente" : "Payment pending"
                        : language === "fr" ? "Non éligible" : "Not eligible"''',
        'packs web: libellé reprise')
    s=replace_once(s,
        '''                        ? "Une commande Découverte est déjà en attente de confirmation."
                        : "A Discovery order is already awaiting confirmation."''',
        '''                        ? discoveryStatus.purchase_needs_review
                          ? "Cette ancienne tentative doit être vérifiée avant de réessayer. Consultez l'assistance ORIA."
                          : discoveryStatus.resume_checkout_url
                            ? "Votre première commande est prête : reprenez le même paiement sans nouvel achat."
                            : `Commande en attente : reprise possible après ${discoveryStatus.resume_after_seconds ?? 60} s si Chariow a fourni un lien.`
                        : discoveryStatus.purchase_needs_review
                          ? "The previous checkout needs verification before another attempt. Contact ORIA support."
                          : discoveryStatus.resume_checkout_url
                            ? "Resume your previous checkout without creating another order."
                            : `Payment pending: retry in ${discoveryStatus.resume_after_seconds ?? 60}s if the checkout link is available.`''',
        'packs web: message statut UX')
    s=replace_once(s,
        '''            {language === "fr" ? "Paiement Découverte en attente de confirmation. Aucun nouvel achat ne peut être initié." : "Discovery payment awaiting confirmation. No new checkout is available."}''',
        '''            {discoveryStatus.resume_checkout_url
              ? (language === "fr" ? "Vous pouvez reprendre la même commande Chariow, sans nouvel achat." : "You can resume the same Chariow checkout without a new order.")
              : discoveryStatus.purchase_needs_review
                ? (language === "fr" ? "Cette commande ancienne exige une vérification avant toute nouvelle tentative." : "This older order requires verification before another attempt.")
                : (language === "fr" ? "Paiement en attente : reprise disponible après une minute si le lien Chariow est enregistré." : "Pending payment: resume after one minute if the Chariow link is saved.")}''',
        'packs web: encart reprise')
    s=replace_once(s,
        '''                ) : (
                  <p role="status" className="mt-4 text-sm text-muted">{discoveryStatus?.topup_pending''',
        '''                ) : discoveryStatus?.topup_pending && discoveryStatus.resume_topup_url ? (
                  <button type="button" onClick={() => window.location.assign(discoveryStatus.resume_topup_url!)}
                    className="mt-5 rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground">
                    {language === "fr" ? "Reprendre la recharge" : "Resume top-up"}
                  </button>
                ) : (
                  <p role="status" className="mt-4 text-sm text-muted">{discoveryStatus?.topup_pending''',
        'packs web: reprise recharge')
    # Si la création Chariow ne répond pas sous 60 s, libérer le spinner
    # mais ne jamais relancer silencieusement POST /checkout.
    pattern = re.compile(
        r'(?m)^      const response = await fetch\(\s*`\$\{apiUrl\}/payments/checkout`,.*?^      \);',
        re.DOTALL,
    )
    matches = list(pattern.finditer(s))
    if len(matches) != 1:
        raise ValueError(f"packs web: appel checkout introuvable ou ambigu ({len(matches)})")
    original_call = matches[0].group(0)
    if original_call.count('method: "POST",') != 1:
        raise ValueError("packs web: options checkout non reconnues")
    timed_call = original_call.replace('const response = await fetch(', 'response = await fetch(', 1)
    timed_call = timed_call.replace('method: "POST",',
        'method: "POST",\n          signal: checkoutController.signal,',1)
    timed_call = ('      const checkoutController = new AbortController();\n'
        '      const checkoutTimer = discoveryTarget ? window.setTimeout(() => checkoutController.abort(), 60000) : null;\n'
        '      let response: Response;\n      try {\n'
        + timed_call + '\n      } finally {\n'
        '        if (checkoutTimer !== null) window.clearTimeout(checkoutTimer);\n      }')
    s=s[:matches[0].start()]+timed_call+s[matches[0].end():]
    # L'AbortError doit être compréhensible ; le statut serveur reste prioritaire.
    old_alert = re.compile(
        r'(?m)^      window\.alert\(\s*error instanceof Error\s*\? error\.message\s*'
        r': "Impossible d\'initialiser le paiement\.",\s*\);',
        re.DOTALL,
    )
    alert_matches=list(old_alert.finditer(s))
    if len(alert_matches)!=1:
        raise ValueError("packs web: alerte checkout introuvable")
    new_alert='''      window.alert(
        error instanceof Error && error.name === "AbortError"
          ? "Une minute sans réponse. ORIA vérifie la commande en cours ; ne lancez pas un second débit. Revenez sur cette page pour reprendre le paiement."
          : error instanceof Error ? error.message : "Impossible d'initialiser le paiement.",
      );
      if (discoveryTarget) void refreshDiscoveryStatus();'''
    s=old_alert.sub(lambda _:new_alert,s,count=1)
    return s

TRANSFORMS = {
    FILES[0]: mobile_register,
    FILES[1]: web_register,
    FILES[2]: mobile_chat,
    FILES[3]: web_chat,
    FILES[4]: web_packs,
    FILES[5]: backend,
}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=Path.cwd(),help='Racine du dépôt LBV-Connect.ia')
    g=parser.add_mutually_exclusive_group()
    g.add_argument('--check',action='store_true',help='Vérifier sans modifier')
    g.add_argument('--apply',action='store_true',help='Appliquer après sauvegarde (explicite)')
    args=parser.parse_args()
    root=args.root.expanduser().resolve()
    orig={}
    changed={}
    for relative in FILES:
        file=root/relative
        if not file.is_file():
            parser.error(f'Fichier introuvable : {file}')
        data=file.read_bytes()
        bom=b'\xef\xbb\xbf' if data.startswith(b'\xef\xbb\xbf') else b''
        raw=data[len(bom):].decode('utf-8')
        newline='\r\n' if '\r\n' in raw else '\n'
        s=raw.replace('\r\n','\n')
        if STAMP in s:
            parser.error(f'Correctif déjà appliqué dans {relative}. Ne pas le réappliquer.')
        try:
            new=TRANSFORMS[relative](s)
        except ValueError as e:
            parser.error(f'Arrêt AVANT écriture dans {relative} : {e}')
        if new == s:
            parser.error(f'Aucun changement détecté dans {relative}')
        orig[relative]=data
        changed[relative]=bom+new.replace('\n',newline).encode('utf-8')
        print(f'OK prévalidation: {relative} (+{new.count(chr(10))-s.count(chr(10))} lignes)')
    if not args.apply:
        print('\nTous les motifs ciblés correspondent. AUCUN fichier modifié.')
        print('Pour appliquer : python appliquer_correctif.py --apply')
        return
    stamp=dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d_%H%M%S')
    backup=root.parent/f'ORIA_UX_BACKUP_{stamp}'
    backup.mkdir(parents=True,exist_ok=False)
    diffs=[]
    for rel in FILES:
        f=backup/rel
        f.parent.mkdir(parents=True,exist_ok=True)
        f.write_bytes(orig[rel])
        diff=difflib.unified_diff(orig[rel].decode('utf-8-sig').replace('\r\n','\n').splitlines(True),
            changed[rel].decode('utf-8-sig').replace('\r\n','\n').splitlines(True),
            fromfile='a/'+rel,tofile='b/'+rel)
        diffs.extend(diff)
    (backup/'ORIA_UX_CHANGEMENTS.patch').write_text(''.join(diffs),encoding='utf-8')
    written=[]
    try:
        for rel in FILES:
            dest=root/rel
            tmp=dest.with_name(dest.name+'.oria-ux-temporary')
            tmp.write_bytes(changed[rel])
            os.replace(tmp,dest)
            written.append(rel)
    except Exception as e:
        for rel in written:
            (root/rel).write_bytes(orig[rel])
        raise SystemExit('ERREUR : tous les fichiers déjà modifiés ont été restaurés. '+str(e))
    print('\nSUCCÈS : 6 fichiers ciblés modifiés. Sauvegarde et diff :', backup)
    print('Vérifiez git diff --check, le build et les scénarios décrits dans README.')

if __name__=='__main__':
    main()
