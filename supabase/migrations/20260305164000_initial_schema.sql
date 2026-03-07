-- DIWATA initial schema for Supabase
-- Created: 2026-03-05

create extension if not exists pgcrypto;

-- =========================================================
-- ENUMS
-- =========================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('student', 'librarian', 'admin');
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'account_status') then
    create type public.account_status as enum ('active', 'suspended', 'archived');
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'copy_status') then
    create type public.copy_status as enum ('available', 'reserved', 'checked_out', 'lost', 'maintenance');
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'reservation_status') then
    create type public.reservation_status as enum ('pending', 'ready_for_pickup', 'fulfilled', 'cancelled', 'expired');
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'loan_status') then
    create type public.loan_status as enum ('active', 'returned', 'overdue', 'lost');
  end if;
end
$$;

-- =========================================================
-- TABLES (USER DATA)
-- =========================================================

create table if not exists public.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text unique,
  student_number text unique,
  first_name text,
  middle_name text,
  last_name text,
  avatar_url text,
  phone_number text,
  college text,
  course text,
  year_level smallint,
  role public.app_role not null default 'student',
  account_status public.account_status not null default 'active',
  bio text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint user_profiles_student_number_format_chk check (
    student_number is null or student_number ~ '^[A-Za-z0-9-]{4,32}$'
  ),
  constraint user_profiles_year_level_chk check (
    year_level is null or year_level between 1 and 10
  )
);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email_notifications_enabled boolean not null default true,
  sms_notifications_enabled boolean not null default false,
  push_notifications_enabled boolean not null default true,
  preferred_language text not null default 'en',
  timezone text not null default 'Asia/Manila',
  theme text not null default 'system',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.user_activity_logs (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  action text not null,
  resource_type text,
  resource_id uuid,
  ip_address inet,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists user_profiles_role_idx on public.user_profiles (role);
create index if not exists user_profiles_college_course_idx on public.user_profiles (college, course);
create index if not exists user_activity_logs_user_id_created_at_idx on public.user_activity_logs (user_id, created_at desc);

-- =========================================================
-- TABLES (BOOK CATALOG + TRANSACTIONS)
-- =========================================================

create table if not exists public.authors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (name)
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (name)
);

create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  isbn text unique,
  title text not null,
  subtitle text,
  description text,
  publisher text,
  publication_year integer,
  language text,
  cover_image_url text,
  total_copies integer not null default 1,
  available_copies integer not null default 1,
  tags text[] not null default '{}',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint books_total_copies_chk check (total_copies >= 0),
  constraint books_available_copies_chk check (available_copies >= 0 and available_copies <= total_copies)
);

create table if not exists public.book_authors (
  book_id uuid not null references public.books (id) on delete cascade,
  author_id uuid not null references public.authors (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (book_id, author_id)
);

create table if not exists public.book_categories (
  book_id uuid not null references public.books (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (book_id, category_id)
);

create table if not exists public.book_copies (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books (id) on delete cascade,
  accession_number text unique,
  barcode text unique,
  shelf_location text,
  status public.copy_status not null default 'available',
  acquired_at date,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  copy_id uuid references public.book_copies (id) on delete set null,
  status public.reservation_status not null default 'pending',
  queue_position integer,
  notes text,
  requested_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz,
  fulfilled_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid unique references public.reservations (id) on delete set null,
  user_id uuid not null references auth.users (id) on delete cascade,
  copy_id uuid not null references public.book_copies (id) on delete restrict,
  checked_out_by uuid references auth.users (id) on delete set null,
  checked_out_at timestamptz not null default timezone('utc', now()),
  due_at timestamptz not null,
  returned_at timestamptz,
  status public.loan_status not null default 'active',
  fine_amount numeric(10,2) not null default 0,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint loans_fine_amount_chk check (fine_amount >= 0)
);

create table if not exists public.bookmarks (
  user_id uuid not null references auth.users (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, book_id)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  title text not null,
  message text not null,
  action_url text,
  metadata jsonb not null default '{}'::jsonb,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists books_title_idx on public.books (title);
create index if not exists books_publication_year_idx on public.books (publication_year);
create index if not exists book_copies_book_id_status_idx on public.book_copies (book_id, status);
create index if not exists reservations_user_id_status_idx on public.reservations (user_id, status);
create index if not exists reservations_book_id_status_idx on public.reservations (book_id, status);
create index if not exists loans_user_id_status_idx on public.loans (user_id, status);
create index if not exists loans_due_at_status_idx on public.loans (due_at, status);
create index if not exists notifications_user_id_read_created_idx on public.notifications (user_id, is_read, created_at desc);

create unique index if not exists reservations_active_unique_per_user_book_idx
  on public.reservations (user_id, book_id)
  where status in ('pending', 'ready_for_pickup');

create unique index if not exists loans_active_unique_copy_idx
  on public.loans (copy_id)
  where status = 'active';

-- =========================================================
-- FUNCTIONS + TRIGGERS
-- =========================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (
    id,
    email,
    first_name,
    last_name,
    avatar_url,
    student_number,
    metadata
  )
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'first_name', ''),
    nullif(new.raw_user_meta_data ->> 'last_name', ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    nullif(new.raw_user_meta_data ->> 'student_number', ''),
    coalesce(new.raw_user_meta_data, '{}'::jsonb)
  )
  on conflict (id) do nothing;

  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create or replace function public.sync_user_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update public.user_profiles
    set email = new.email,
        updated_at = timezone('utc', now())
    where id = new.id;
  end if;
  return new;
end;
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles p
    where p.id = auth.uid()
      and p.role in ('librarian', 'admin')
      and p.account_status = 'active'
  );
$$;

grant execute on function public.is_staff() to authenticated;

-- updated_at triggers

drop trigger if exists user_profiles_set_updated_at on public.user_profiles;
create trigger user_profiles_set_updated_at
before update on public.user_profiles
for each row execute procedure public.set_updated_at();

drop trigger if exists user_settings_set_updated_at on public.user_settings;
create trigger user_settings_set_updated_at
before update on public.user_settings
for each row execute procedure public.set_updated_at();

drop trigger if exists books_set_updated_at on public.books;
create trigger books_set_updated_at
before update on public.books
for each row execute procedure public.set_updated_at();

drop trigger if exists book_copies_set_updated_at on public.book_copies;
create trigger book_copies_set_updated_at
before update on public.book_copies
for each row execute procedure public.set_updated_at();

drop trigger if exists reservations_set_updated_at on public.reservations;
create trigger reservations_set_updated_at
before update on public.reservations
for each row execute procedure public.set_updated_at();

drop trigger if exists loans_set_updated_at on public.loans;
create trigger loans_set_updated_at
before update on public.loans
for each row execute procedure public.set_updated_at();

-- auth.users triggers

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
after update of email on auth.users
for each row execute procedure public.sync_user_email();

-- =========================================================
-- ROW LEVEL SECURITY
-- =========================================================

alter table public.user_profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.user_activity_logs enable row level security;
alter table public.authors enable row level security;
alter table public.categories enable row level security;
alter table public.books enable row level security;
alter table public.book_authors enable row level security;
alter table public.book_categories enable row level security;
alter table public.book_copies enable row level security;
alter table public.reservations enable row level security;
alter table public.loans enable row level security;
alter table public.bookmarks enable row level security;
alter table public.notifications enable row level security;

-- user_profiles

drop policy if exists user_profiles_select_own on public.user_profiles;
create policy user_profiles_select_own
  on public.user_profiles
  for select
  to authenticated
  using (id = auth.uid());

drop policy if exists user_profiles_insert_own on public.user_profiles;
create policy user_profiles_insert_own
  on public.user_profiles
  for insert
  to authenticated
  with check (id = auth.uid());

drop policy if exists user_profiles_update_own on public.user_profiles;
create policy user_profiles_update_own
  on public.user_profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists user_profiles_staff_all on public.user_profiles;
create policy user_profiles_staff_all
  on public.user_profiles
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- user_settings

drop policy if exists user_settings_select_own on public.user_settings;
create policy user_settings_select_own
  on public.user_settings
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists user_settings_insert_own on public.user_settings;
create policy user_settings_insert_own
  on public.user_settings
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists user_settings_update_own on public.user_settings;
create policy user_settings_update_own
  on public.user_settings
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists user_settings_staff_all on public.user_settings;
create policy user_settings_staff_all
  on public.user_settings
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- user_activity_logs

drop policy if exists user_activity_logs_select_own on public.user_activity_logs;
create policy user_activity_logs_select_own
  on public.user_activity_logs
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists user_activity_logs_insert_own on public.user_activity_logs;
create policy user_activity_logs_insert_own
  on public.user_activity_logs
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists user_activity_logs_staff_select on public.user_activity_logs;
create policy user_activity_logs_staff_select
  on public.user_activity_logs
  for select
  to authenticated
  using (public.is_staff());

-- catalog tables

drop policy if exists authors_select_all_authenticated on public.authors;
create policy authors_select_all_authenticated
  on public.authors
  for select
  to authenticated
  using (true);

drop policy if exists authors_staff_modify on public.authors;
create policy authors_staff_modify
  on public.authors
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists categories_select_all_authenticated on public.categories;
create policy categories_select_all_authenticated
  on public.categories
  for select
  to authenticated
  using (true);

drop policy if exists categories_staff_modify on public.categories;
create policy categories_staff_modify
  on public.categories
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists books_select_all_authenticated on public.books;
create policy books_select_all_authenticated
  on public.books
  for select
  to authenticated
  using (true);

drop policy if exists books_staff_modify on public.books;
create policy books_staff_modify
  on public.books
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists book_authors_select_all_authenticated on public.book_authors;
create policy book_authors_select_all_authenticated
  on public.book_authors
  for select
  to authenticated
  using (true);

drop policy if exists book_authors_staff_modify on public.book_authors;
create policy book_authors_staff_modify
  on public.book_authors
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists book_categories_select_all_authenticated on public.book_categories;
create policy book_categories_select_all_authenticated
  on public.book_categories
  for select
  to authenticated
  using (true);

drop policy if exists book_categories_staff_modify on public.book_categories;
create policy book_categories_staff_modify
  on public.book_categories
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists book_copies_select_all_authenticated on public.book_copies;
create policy book_copies_select_all_authenticated
  on public.book_copies
  for select
  to authenticated
  using (true);

drop policy if exists book_copies_staff_modify on public.book_copies;
create policy book_copies_staff_modify
  on public.book_copies
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- reservations

drop policy if exists reservations_select_own on public.reservations;
create policy reservations_select_own
  on public.reservations
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists reservations_insert_own on public.reservations;
create policy reservations_insert_own
  on public.reservations
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists reservations_update_own on public.reservations;
create policy reservations_update_own
  on public.reservations
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists reservations_staff_all on public.reservations;
create policy reservations_staff_all
  on public.reservations
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- loans

drop policy if exists loans_select_own on public.loans;
create policy loans_select_own
  on public.loans
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists loans_staff_all on public.loans;
create policy loans_staff_all
  on public.loans
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- bookmarks

drop policy if exists bookmarks_select_own on public.bookmarks;
create policy bookmarks_select_own
  on public.bookmarks
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists bookmarks_insert_own on public.bookmarks;
create policy bookmarks_insert_own
  on public.bookmarks
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists bookmarks_delete_own on public.bookmarks;
create policy bookmarks_delete_own
  on public.bookmarks
  for delete
  to authenticated
  using (user_id = auth.uid());

-- notifications

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own
  on public.notifications
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own
  on public.notifications
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists notifications_staff_insert on public.notifications;
create policy notifications_staff_insert
  on public.notifications
  for insert
  to authenticated
  with check (public.is_staff());

-- =========================================================
-- Helpful notes
-- =========================================================
-- Promote first admin user manually after signup:
-- update public.user_profiles
-- set role = 'admin'
-- where email = 'your-admin-email@example.com';
