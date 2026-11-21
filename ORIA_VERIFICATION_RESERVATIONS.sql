-- ORIA : diagnostic LECTURE SEULE des réservations du compte gratuit.
-- Une réserve non rapprochée ne doit JAMAIS être libérée sans preuve.
-- Exécuter sur Supabase, et vérifier aussi les logs Render et l'usage fournisseur.
SELECT id, user_id, action, status, created_at,
       reserved_free, reserved_purchased, reserved_api_xaf
FROM public.oria_free_credit_reservations
WHERE status IN ('reserved', 'review')
ORDER BY created_at ASC
LIMIT 100;
