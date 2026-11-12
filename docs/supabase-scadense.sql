-- ============================================================
-- Scadense: schema Supabase (login + sincronizzazione cloud)
-- Da eseguire UNA volta nello SQL Editor di Supabase (e' idempotente:
-- si puo' rieseguire senza errori). Non tocca le tabelle delle altre app:
-- tutto cio' che crea inizia con "scadense_".
-- ============================================================

-- ------------------------------------------------------------
-- Tabelle. Chiave primaria (user_id, id): gli id delle categorie
-- predefinite (altro, casa...) sono uguali per tutti gli utenti.
-- Tutte le colonne dati sono nullable (serve per le cancellazioni).
--   updated_at = orologio del client (last-write-wins)
--   synced_at  = assegnato dal server (trigger), usato per il pull
--   deleted    = cancellazione logica propagata agli altri dispositivi
-- ------------------------------------------------------------

create table if not exists public.scadense_items (
  user_id        uuid not null references auth.users (id) on delete cascade,
  id             text not null,
  updated_at     timestamptz not null,
  synced_at      timestamptz not null default clock_timestamp(),
  deleted        boolean not null default false,
  title          text,
  category_id    text,
  due_date       text,
  recurrence     jsonb,
  amount         double precision,
  remind_days    integer,
  notes          text,
  reference      text,
  status         text,
  auto_pay       boolean,
  pay_method     text,
  end_date       text,
  paid_count     integer,
  paused         boolean,
  cancelled_on   text,
  closed_reason  text,
  created_at     timestamptz,
  primary key (user_id, id)
);

create table if not exists public.scadense_history (
  user_id     uuid not null references auth.users (id) on delete cascade,
  id          text not null,
  updated_at  timestamptz not null,
  synced_at   timestamptz not null default clock_timestamp(),
  deleted     boolean not null default false,
  item_id     text,
  done_on     text,
  due_was     text,
  amount      double precision,
  note        text,
  auto        boolean,
  primary key (user_id, id)
);

create table if not exists public.scadense_categories (
  user_id         uuid not null references auth.users (id) on delete cascade,
  id              text not null,
  updated_at      timestamptz not null,
  synced_at       timestamptz not null default clock_timestamp(),
  deleted         boolean not null default false,
  name            text,
  emoji           text,
  color           text,
  default_remind  integer,
  sort_order      integer,
  primary key (user_id, id)
);

-- Indici per il pull incrementale (per utente, ordinato per synced_at)
create index if not exists scadense_items_user_synced      on public.scadense_items      (user_id, synced_at);
create index if not exists scadense_history_user_synced    on public.scadense_history    (user_id, synced_at);
create index if not exists scadense_history_user_item      on public.scadense_history    (user_id, item_id);
create index if not exists scadense_categories_user_synced on public.scadense_categories (user_id, synced_at);

-- ------------------------------------------------------------
-- Trigger: protezione dalle scritture obsolete + synced_at
-- Se un dispositivo offline invia una versione piu' vecchia di quella gia'
-- presente, il server tiene i dati piu' recenti ma aggiorna synced_at, cosi'
-- il dispositivo obsoleto al prossimo pull riceve la versione vincente.
-- ------------------------------------------------------------
create or replace function public.scadense_sync_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    new := old; -- scrittura obsoleta: tieni i dati piu' recenti
  end if;
  new.synced_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists scadense_items_sync_guard on public.scadense_items;
create trigger scadense_items_sync_guard
  before insert or update on public.scadense_items
  for each row execute function public.scadense_sync_guard();

drop trigger if exists scadense_history_sync_guard on public.scadense_history;
create trigger scadense_history_sync_guard
  before insert or update on public.scadense_history
  for each row execute function public.scadense_sync_guard();

drop trigger if exists scadense_categories_sync_guard on public.scadense_categories;
create trigger scadense_categories_sync_guard
  before insert or update on public.scadense_categories
  for each row execute function public.scadense_sync_guard();

-- ------------------------------------------------------------
-- Row Level Security: ogni utente vede e modifica solo le proprie righe
-- ------------------------------------------------------------
alter table public.scadense_items      enable row level security;
alter table public.scadense_history    enable row level security;
alter table public.scadense_categories enable row level security;

-- scadense_items
drop policy if exists "scadense_items_select_own" on public.scadense_items;
create policy "scadense_items_select_own" on public.scadense_items
  for select using (auth.uid() = user_id);
drop policy if exists "scadense_items_insert_own" on public.scadense_items;
create policy "scadense_items_insert_own" on public.scadense_items
  for insert with check (auth.uid() = user_id);
drop policy if exists "scadense_items_update_own" on public.scadense_items;
create policy "scadense_items_update_own" on public.scadense_items
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "scadense_items_delete_own" on public.scadense_items;
create policy "scadense_items_delete_own" on public.scadense_items
  for delete using (auth.uid() = user_id);

-- scadense_history
drop policy if exists "scadense_history_select_own" on public.scadense_history;
create policy "scadense_history_select_own" on public.scadense_history
  for select using (auth.uid() = user_id);
drop policy if exists "scadense_history_insert_own" on public.scadense_history;
create policy "scadense_history_insert_own" on public.scadense_history
  for insert with check (auth.uid() = user_id);
drop policy if exists "scadense_history_update_own" on public.scadense_history;
create policy "scadense_history_update_own" on public.scadense_history
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "scadense_history_delete_own" on public.scadense_history;
create policy "scadense_history_delete_own" on public.scadense_history
  for delete using (auth.uid() = user_id);

-- scadense_categories
drop policy if exists "scadense_categories_select_own" on public.scadense_categories;
create policy "scadense_categories_select_own" on public.scadense_categories
  for select using (auth.uid() = user_id);
drop policy if exists "scadense_categories_insert_own" on public.scadense_categories;
create policy "scadense_categories_insert_own" on public.scadense_categories
  for insert with check (auth.uid() = user_id);
drop policy if exists "scadense_categories_update_own" on public.scadense_categories;
create policy "scadense_categories_update_own" on public.scadense_categories
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "scadense_categories_delete_own" on public.scadense_categories;
create policy "scadense_categories_delete_own" on public.scadense_categories
  for delete using (auth.uid() = user_id);
