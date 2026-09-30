-- ============================================================
-- Wishlist (juegos pendientes)
-- Pegar en Supabase > SQL Editor > New query > Run. Se puede volver a correr.
-- ============================================================

create table if not exists public.wishlist (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title             text not null,
  platform          text not null default '',
  cover             text not null default '',
  note              text not null default '',
  mc                integer not null default 0,
  rawg_slug         text not null default '',
  release_year      text not null default '',
  priority          text not null default 'normal' check (priority in ('alta', 'normal')),
  -- al completarlo se enlaza con el juego creado en "games"; si ese juego se borra, vuelve a pendiente
  completed_game_id uuid references public.games (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists wishlist_user_id_idx on public.wishlist (user_id);

drop trigger if exists wishlist_touch on public.wishlist;
create trigger wishlist_touch before update on public.wishlist
  for each row execute function public.touch_updated_at();

alter table public.wishlist enable row level security;

drop policy if exists "cada uno su wishlist" on public.wishlist;
create policy "cada uno su wishlist" on public.wishlist
  for all to authenticated
  using (user_id = auth.uid() and public.is_allowed())
  with check (user_id = auth.uid() and public.is_allowed());

revoke all on public.wishlist from anon;
grant select, insert, update, delete on public.wishlist to authenticated;
