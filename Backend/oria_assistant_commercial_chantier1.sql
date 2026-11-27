-- ORIA Assistant — Chantier 1 : socle commercial et gestion des ventes.
-- Migration additive. À exécuter une seule fois dans le SQL Editor Supabase
-- AVANT de déployer le backend qui dépend de ces colonnes et tables.

begin;

-- Le fuseau horaire appartient à l'assistant (un propriétaire peut en avoir plusieurs).
alter table public.oria_assistants
    add column if not exists timezone text not null default 'Africa/Libreville';

-- Résultat commercial saisi par le propriétaire pour une demande confirmée.
-- Une demande ne peut porter qu'un seul résultat commercial V1, modifiable ensuite.
create table if not exists public.oria_assistant_sales (
    id uuid primary key default gen_random_uuid(),
    owner_user_id uuid not null references auth.users(id) on delete cascade,
    assistant_id uuid not null,
    request_id uuid not null,
    outcome text not null check (outcome in ('open', 'won', 'lost')),
    product_or_service text,
    quoted_amount numeric(18,2),
    collected_amount numeric(18,2) not null default 0,
    currency varchar(3) not null default 'XAF',
    sale_date date,
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint oria_assistant_sales_one_result_per_request unique (request_id),
    constraint oria_assistant_sales_quoted_nonnegative check (quoted_amount is null or quoted_amount >= 0),
    constraint oria_assistant_sales_collected_nonnegative check (collected_amount >= 0),
    constraint oria_assistant_sales_currency_format check (currency ~ '^[A-Z]{3}$'),
    constraint oria_assistant_sales_product_length check (product_or_service is null or char_length(product_or_service) <= 180),
    constraint oria_assistant_sales_notes_length check (notes is null or char_length(notes) <= 3000)
);

create index if not exists oria_assistant_sales_owner_date_idx
    on public.oria_assistant_sales (owner_user_id, sale_date desc);
create index if not exists oria_assistant_sales_owner_assistant_date_idx
    on public.oria_assistant_sales (owner_user_id, assistant_id, sale_date desc);
create index if not exists oria_assistant_sales_owner_outcome_idx
    on public.oria_assistant_sales (owner_user_id, outcome);

-- Snapshot des données calculées + analyse IA. Les anciens rapports restent
-- indépendants des futures modifications de demandes et de ventes.
create table if not exists public.oria_assistant_commercial_reports (
    id uuid primary key default gen_random_uuid(),
    owner_user_id uuid not null references auth.users(id) on delete cascade,
    assistant_id uuid,
    period_start date not null,
    period_end date not null,
    source_snapshot jsonb not null default '{}'::jsonb,
    analysis_content jsonb not null default '{}'::jsonb,
    generated_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint oria_assistant_commercial_reports_period_valid check (period_end >= period_start),
    constraint oria_assistant_commercial_reports_snapshot_object check (jsonb_typeof(source_snapshot) = 'object'),
    constraint oria_assistant_commercial_reports_analysis_object check (jsonb_typeof(analysis_content) = 'object')
);

create index if not exists oria_assistant_commercial_reports_owner_generated_idx
    on public.oria_assistant_commercial_reports (owner_user_id, generated_at desc);
create index if not exists oria_assistant_commercial_reports_owner_assistant_period_idx
    on public.oria_assistant_commercial_reports (owner_user_id, assistant_id, period_start, period_end);

-- Vérifie l'appartenance de la demande et de l'assistant, même si un appel
-- SQL est exécuté en dehors du service Python. Les relations ne sont pas
-- déclarées en FK vers les tables métier pour ne pas modifier leurs règles
-- actuelles de suppression ou d'archivage.
create or replace function public.oria_assistant_sales_guard_owner_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    request_owner uuid;
    request_assistant uuid;
    assistant_owner uuid;
begin
    select r.owner_user_id, r.assistant_id
      into request_owner, request_assistant
      from public.oria_assistant_requests r
     where r.id = new.request_id;

    if not found then
        raise exception 'ORIA assistant request not found' using errcode = '23503';
    end if;

    if request_owner is distinct from new.owner_user_id
       or request_assistant is distinct from new.assistant_id then
        raise exception 'ORIA commercial sale ownership mismatch' using errcode = '42501';
    end if;

    select a.owner_user_id
      into assistant_owner
      from public.oria_assistants a
     where a.id = new.assistant_id;

    if not found or assistant_owner is distinct from new.owner_user_id then
        raise exception 'ORIA assistant owner mismatch' using errcode = '42501';
    end if;

    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists oria_assistant_sales_guard_owner_v1 on public.oria_assistant_sales;
create trigger oria_assistant_sales_guard_owner_v1
before insert or update on public.oria_assistant_sales
for each row execute function public.oria_assistant_sales_guard_owner_v1();

create or replace function public.oria_assistant_commercial_reports_guard_owner_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    assistant_owner uuid;
begin
    if new.assistant_id is not null then
        select a.owner_user_id
          into assistant_owner
          from public.oria_assistants a
         where a.id = new.assistant_id;

        if not found or assistant_owner is distinct from new.owner_user_id then
            raise exception 'ORIA commercial report assistant owner mismatch' using errcode = '42501';
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists oria_assistant_commercial_reports_guard_owner_v1 on public.oria_assistant_commercial_reports;
create trigger oria_assistant_commercial_reports_guard_owner_v1
before insert or update on public.oria_assistant_commercial_reports
for each row execute function public.oria_assistant_commercial_reports_guard_owner_v1();

-- Les lectures/écritures passent par l'API Python authentifiée utilisant
-- SUPABASE_SERVICE_ROLE_KEY. Aucun accès direct au navigateur n'est ouvert.
alter table public.oria_assistant_sales enable row level security;
alter table public.oria_assistant_commercial_reports enable row level security;
revoke all on table public.oria_assistant_sales from anon, authenticated;
revoke all on table public.oria_assistant_commercial_reports from anon, authenticated;
grant all on table public.oria_assistant_sales to service_role;
grant all on table public.oria_assistant_commercial_reports to service_role;

comment on table public.oria_assistant_sales is
    'Résultats commerciaux déclarés manuellement par le propriétaire ORIA Assistant, un enregistrement maximum par demande confirmée.';
comment on table public.oria_assistant_commercial_reports is
    'Rapports commerciaux ORIA Assistant avec snapshot immuable des agrégats et analyse IA.';
comment on column public.oria_assistant_sales.collected_amount is
    'Montant réellement encaissé déclaré par le propriétaire ; jamais déduit d’un devis ou d’une demande.';
comment on column public.oria_assistant_sales.quoted_amount is
    'Montant du devis ou de l’offre, séparé des encaissements réels.';
comment on column public.oria_assistants.timezone is
    'Fuseau IANA utilisé pour les périodes et regroupements temporels du Bilan commercial.';

commit;
