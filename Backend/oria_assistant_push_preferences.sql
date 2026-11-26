-- ORIA Assistant : préférences globales de notifications Push par propriétaire.
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
