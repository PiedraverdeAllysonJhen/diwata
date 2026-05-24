drop index if exists reservations_active_unique_per_user_book_idx;

create unique index if not exists reservations_active_unique_per_user_book_idx
  on public.reservations (user_id, book_id)
  where status in ('pending', 'approved', 'ready_for_pickup');

drop index if exists loans_active_unique_copy_idx;

create unique index if not exists loans_active_unique_copy_idx
  on public.loans (copy_id)
  where status in ('active', 'picked_up', 'overdue');

create or replace function public.admin_cancel_reservation(
  target_reservation_id uuid,
  cancel_reason text default 'manual'
)
returns table (
  reservation_id uuid,
  user_id uuid,
  book_id uuid,
  book_title text,
  was_cancelled boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.reservations%rowtype;
  title text;
begin
  select *
    into target
  from public.reservations
  where id = target_reservation_id
    and status in ('pending', 'approved', 'ready_for_pickup')
  for update;

  if not found then
    return query
    select target_reservation_id, null::uuid, null::uuid, null::text, false;
    return;
  end if;

  update public.reservations
  set status = 'cancelled',
      cancelled_at = timezone('utc', now()),
      updated_at = timezone('utc', now()),
      notes = coalesce(notes, '') || case when cancel_reason is null or cancel_reason = '' then '' else E'\nCancellation reason: ' || cancel_reason end
  where id = target.id;

  if target.copy_id is not null then
    update public.book_copies
    set status = 'available',
        updated_at = timezone('utc', now())
    where id = target.copy_id
      and status = 'reserved';
  end if;

  update public.books
  set available_copies = least(total_copies, available_copies + 1),
      updated_at = timezone('utc', now())
  where id = target.book_id;

  select books.title into title from public.books where books.id = target.book_id;

  return query
  select target.id, target.user_id, target.book_id, coalesce(title, 'Untitled book'), true;
end;
$$;

create or replace function public.admin_mark_reservation_picked_up(
  target_reservation_id uuid,
  checkout_by uuid,
  due_timestamp timestamptz
)
returns table (
  loan_id uuid,
  user_id uuid,
  book_id uuid,
  copy_id uuid,
  book_title text,
  was_checked_out boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.reservations%rowtype;
  assigned_copy uuid;
  created_loan uuid;
  title text;
begin
  select *
    into target
  from public.reservations
  where id = target_reservation_id
    and status = 'approved'
  for update;

  if not found then
    return query
    select null::uuid, null::uuid, null::uuid, null::uuid, null::text, false;
    return;
  end if;

  assigned_copy := target.copy_id;

  if assigned_copy is null then
    select id
      into assigned_copy
    from public.book_copies
    where book_id = target.book_id
      and status in ('available', 'reserved')
    order by case when status = 'reserved' then 0 else 1 end, created_at
    limit 1
    for update skip locked;
  else
    perform 1
    from public.book_copies
    where id = assigned_copy
      and status in ('available', 'reserved')
    for update;
  end if;

  if assigned_copy is null then
    return query
    select null::uuid, target.user_id, target.book_id, null::uuid, null::text, false;
    return;
  end if;

  insert into public.loans (
    reservation_id,
    user_id,
    copy_id,
    checked_out_by,
    checked_out_at,
    picked_up_at,
    due_at,
    status
  )
  values (
    target.id,
    target.user_id,
    assigned_copy,
    checkout_by,
    timezone('utc', now()),
    timezone('utc', now()),
    due_timestamp,
    'picked_up'
  )
  returning id into created_loan;

  update public.reservations
  set status = 'fulfilled',
      fulfilled_at = timezone('utc', now()),
      copy_id = assigned_copy,
      updated_at = timezone('utc', now())
  where id = target.id;

  update public.book_copies
  set status = 'checked_out',
      updated_at = timezone('utc', now())
  where id = assigned_copy;

  update public.books
  set available_copies = greatest(0, available_copies - 1),
      updated_at = timezone('utc', now())
  where id = target.book_id;

  select books.title into title from public.books where books.id = target.book_id;

  return query
  select created_loan, target.user_id, target.book_id, assigned_copy, coalesce(title, 'Untitled book'), true;
end;
$$;

create or replace function public.admin_process_loan_return(target_loan_id uuid)
returns table (
  loan_id uuid,
  user_id uuid,
  book_id uuid,
  copy_id uuid,
  book_title text,
  was_returned boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.loans%rowtype;
  resolved_book_id uuid;
  title text;
begin
  select *
    into target
  from public.loans
  where id = target_loan_id
    and status in ('active', 'picked_up', 'overdue')
  for update;

  if not found then
    return query
    select target_loan_id, null::uuid, null::uuid, null::uuid, null::text, false;
    return;
  end if;

  select bc.book_id, b.title
    into resolved_book_id, title
  from public.book_copies bc
  join public.books b on b.id = bc.book_id
  where bc.id = target.copy_id
  for update;

  update public.loans
  set status = 'returned',
      returned_at = timezone('utc', now()),
      last_overdue_notice_at = null,
      updated_at = timezone('utc', now())
  where id = target.id;

  update public.book_copies
  set status = 'available',
      updated_at = timezone('utc', now())
  where id = target.copy_id;

  if resolved_book_id is not null then
    update public.books
    set available_copies = least(total_copies, available_copies + 1),
        updated_at = timezone('utc', now())
    where id = resolved_book_id;
  end if;

  return query
  select target.id, target.user_id, resolved_book_id, target.copy_id, coalesce(title, 'Untitled book'), true;
end;
$$;
