-- ============================================================
-- Jugando (juegos en curso)
-- Pegar en Supabase > SQL Editor > New query > Run. Se puede volver a correr.
--
-- Un pendiente de la wishlist pasa por: pendiente → jugando → completado.
-- Al completarlo se crea el juego en "games" y el pendiente queda enlazado (completed_game_id)
-- y deja de mostrarse; si ese juego se borra, vuelve a su estado (pendiente o jugando).
-- ============================================================

alter table public.wishlist
  add column if not exists status text not null default 'pendiente';

alter table public.wishlist drop constraint if exists wishlist_status_check;
alter table public.wishlist
  add constraint wishlist_status_check check (status in ('pendiente', 'jugando'));

-- cuándo lo empezaste y cuántas horas llevás (pasan al juego completado)
alter table public.wishlist add column if not exists started_at timestamptz;
alter table public.wishlist add column if not exists hours numeric not null default 0;

alter table public.wishlist drop constraint if exists wishlist_hours_check;
alter table public.wishlist add constraint wishlist_hours_check check (hours >= 0);
