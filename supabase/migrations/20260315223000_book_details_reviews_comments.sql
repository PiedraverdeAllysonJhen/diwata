-- DW.010.004: Book details page data (reviews/comments) + reservation trigger compatibility hotfix

create table if not exists public.book_reviews (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  rating smallint not null,
  review_text text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint book_reviews_rating_chk check (rating between 1 and 5),
  constraint book_reviews_review_text_len_chk check (
    review_text is null or char_length(trim(review_text)) between 1 and 2000
  ),
  unique (book_id, user_id)
);

create table if not exists public.book_comments (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  comment_text text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint book_comments_text_len_chk check (char_length(trim(comment_text)) between 1 and 2000)
);

create index if not exists book_reviews_book_created_idx
  on public.book_reviews (book_id, created_at desc);

create index if not exists book_reviews_user_idx
  on public.book_reviews (user_id, created_at desc);

create index if not exists book_comments_book_created_idx
  on public.book_comments (book_id, created_at desc);

create index if not exists book_comments_user_idx
  on public.book_comments (user_id, created_at desc);

drop trigger if exists book_reviews_set_updated_at on public.book_reviews;
create trigger book_reviews_set_updated_at
before update on public.book_reviews
for each row execute procedure public.set_updated_at();

drop trigger if exists book_comments_set_updated_at on public.book_comments;
create trigger book_comments_set_updated_at
before update on public.book_comments
for each row execute procedure public.set_updated_at();

alter table public.book_reviews enable row level security;
alter table public.book_comments enable row level security;

drop policy if exists book_reviews_select_all_authenticated on public.book_reviews;
create policy book_reviews_select_all_authenticated
  on public.book_reviews
  for select
  to authenticated
  using (true);

drop policy if exists book_reviews_insert_own on public.book_reviews;
create policy book_reviews_insert_own
  on public.book_reviews
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists book_reviews_update_own on public.book_reviews;
create policy book_reviews_update_own
  on public.book_reviews
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists book_reviews_delete_own on public.book_reviews;
create policy book_reviews_delete_own
  on public.book_reviews
  for delete
  to authenticated
  using (user_id = auth.uid());

drop policy if exists book_reviews_staff_all on public.book_reviews;
create policy book_reviews_staff_all
  on public.book_reviews
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists book_comments_select_all_authenticated on public.book_comments;
create policy book_comments_select_all_authenticated
  on public.book_comments
  for select
  to authenticated
  using (true);

drop policy if exists book_comments_insert_own on public.book_comments;
create policy book_comments_insert_own
  on public.book_comments
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists book_comments_update_own on public.book_comments;
create policy book_comments_update_own
  on public.book_comments
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists book_comments_delete_own on public.book_comments;
create policy book_comments_delete_own
  on public.book_comments
  for delete
  to authenticated
  using (user_id = auth.uid());

drop policy if exists book_comments_staff_all on public.book_comments;
create policy book_comments_staff_all
  on public.book_comments
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- Compatibility fix for legacy notifier trigger:
-- If a previous branch created a reservation trigger that inserts into
-- notification_dispatch_queue with an incompatible enum cast, reservation writes fail.
-- We remove only triggers on public.reservations whose function references that queue table.
do $$
declare trigger_row record;
begin
  for trigger_row in
    select t.tgname
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where n.nspname = 'public'
      and c.relname = 'reservations'
      and not t.tgisinternal
      and pg_get_functiondef(p.oid) ilike '%notification_dispatch_queue%'
  loop
    execute format('drop trigger if exists %I on public.reservations', trigger_row.tgname);
  end loop;
end $$;
