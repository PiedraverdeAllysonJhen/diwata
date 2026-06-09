create or replace function public.cancel_own_reservation(
  target_reservation_id uuid
)
returns table (
  reservation_id uuid,
  book_id uuid,
  was_cancelled boolean,
  message text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target public.reservations%rowtype;
  was_counted_available boolean;
begin
  if current_user_id is null then
    raise exception 'Authentication is required';
  end if;

  select *
    into target
  from public.reservations
  where id = target_reservation_id
    and user_id = current_user_id
    and status in ('pending', 'approved', 'ready_for_pickup', 'reserved', 'queued')
  for update;

  if not found then
    return query
    select target_reservation_id, null::uuid, false, 'Reservation cannot be cancelled.';
    return;
  end if;

  was_counted_available := target.status in ('approved', 'ready_for_pickup', 'reserved', 'pending');

  update public.reservations
  set status = 'cancelled',
      cancelled_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = target.id;

  if target.copy_id is not null then
    update public.book_copies
    set status = 'available',
        updated_at = timezone('utc', now())
    where id = target.copy_id
      and status = 'reserved';
  end if;

  if was_counted_available then
    update public.books as b
    set available_copies = least(b.total_copies, b.available_copies + 1),
        updated_at = timezone('utc', now())
    where b.id = target.book_id;

    perform public.promote_next_queued_reservation(target.book_id);
  end if;

  insert into public.notifications (user_id, type, title, message, action_url, metadata)
  values (
    current_user_id,
    'reservation_cancelled',
    'Reservation cancelled',
    'Your reservation has been cancelled.',
    '/reservations',
    jsonb_build_object('channel', 'in_app', 'reservation_id', target.id)
  );

  return query
  select target.id, target.book_id, true, 'Reservation cancelled successfully.';
end;
$$;

grant execute on function public.cancel_own_reservation(uuid) to authenticated;

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
  was_counted_available boolean;
begin
  if not public.is_staff() then
    raise exception 'Staff access is required';
  end if;

  select *
    into target
  from public.reservations
  where id = target_reservation_id
      and status in ('approved', 'ready_for_pickup', 'reserved', 'queued')
  for update;

  if not found then
    return query
    select target_reservation_id, null::uuid, null::uuid, null::text, false;
    return;
  end if;

  was_counted_available := target.status in ('approved', 'ready_for_pickup', 'reserved');

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

  if was_counted_available then
    update public.books as b
    set available_copies = least(b.total_copies, b.available_copies + 1),
        updated_at = timezone('utc', now())
    where b.id = target.book_id;

    perform public.promote_next_queued_reservation(target.book_id);
  end if;

  select books.title into title from public.books where books.id = target.book_id;

  return query
  select target.id, target.user_id, target.book_id, coalesce(title, 'Untitled book'), true;
end;
$$;

create or replace function public.admin_mark_reservation_picked_up(
  target_reservation_id uuid,
  checkout_by uuid default null,
  due_timestamp timestamptz default null
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
  due_at_value timestamptz;
begin
  if not public.is_staff() then
    raise exception 'Staff access is required';
  end if;

  select *
    into target
  from public.reservations
  where id = target_reservation_id
    and status in ('reserved', 'approved', 'ready_for_pickup')
  for update;

  if not found then
    return query select null::uuid, null::uuid, null::uuid, null::uuid, null::text, false;
    return;
  end if;

  due_at_value := coalesce(
    due_timestamp,
    target.reservation_end_date::timestamptz,
    (coalesce(target.reservation_start_date, target.requested_at::date) + 7)::timestamptz
  );

  select bc.id
    into assigned_copy
  from public.book_copies bc
  where bc.book_id = target.book_id
    and bc.status in ('available', 'reserved')
  order by case when bc.id = target.copy_id then 0 when bc.status = 'reserved' then 1 else 2 end, bc.created_at
  limit 1
  for update skip locked;

  if assigned_copy is null then
    return query select null::uuid, target.user_id, target.book_id, null::uuid, null::text, false;
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
    due_at_value,
    'picked_up'
  )
  returning id into created_loan;

  update public.reservations
  set status = 'picked_up',
      reservation_start_date = coalesce(reservation_start_date, requested_at::date),
      reservation_end_date = coalesce(reservation_end_date, requested_at::date + 7),
      picked_up_at = timezone('utc', now()),
      copy_id = assigned_copy,
      updated_at = timezone('utc', now())
  where id = target.id;

  update public.book_copies
  set status = 'checked_out',
      updated_at = timezone('utc', now())
  where id = assigned_copy;

  select books.title into title from public.books where books.id = target.book_id;

  insert into public.notifications (user_id, type, title, message, action_url, metadata)
  values
    (
      target.user_id,
      'loan_checked_out',
      'Book picked up',
      'You picked up ' || coalesce(title, 'your book') || ' on ' || to_char(timezone('utc', now()), 'Mon DD, YYYY') || '. Please return it on or before ' || to_char(due_at_value, 'Mon DD, YYYY') || '. Late returns will be fined PHP 50 per day.',
      '/reservations',
      jsonb_build_object('channel', 'in_app', 'reservation_id', target.id, 'loan_id', created_loan)
    ),
    (
      target.user_id,
      'loan_checked_out_email',
      'Email queued: book picked up',
      'You picked up ' || coalesce(title, 'your book') || ' on ' || to_char(timezone('utc', now()), 'Mon DD, YYYY') || '. Please return it on or before ' || to_char(due_at_value, 'Mon DD, YYYY') || '. Late returns will be fined PHP 50 per day.',
      '/reservations',
      jsonb_build_object('channel', 'email', 'reservation_id', target.id, 'loan_id', created_loan)
    );

  return query select created_loan, target.user_id, target.book_id, assigned_copy, coalesce(title, 'Untitled book'), true;
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
  overdue_days integer;
  fine numeric(10,2);
begin
  if not public.is_staff() then
    raise exception 'Staff access is required';
  end if;

  select *
    into target
  from public.loans
  where id = target_loan_id
    and status in ('active', 'picked_up', 'overdue')
  for update;

  if not found then
    return query select target_loan_id, null::uuid, null::uuid, null::uuid, null::text, false;
    return;
  end if;

  select bc.book_id, b.title
    into resolved_book_id, title
  from public.book_copies bc
  join public.books b on b.id = bc.book_id
  where bc.id = target.copy_id
  for update;

  overdue_days := greatest(0, (current_date - target.due_at::date));
  fine := overdue_days * 50;

  update public.loans
  set status = 'returned',
      returned_at = timezone('utc', now()),
      fine_amount = fine,
      last_overdue_notice_at = null,
      updated_at = timezone('utc', now())
  where id = target.id;

  update public.reservations
  set status = 'returned',
      returned_at = timezone('utc', now()),
      fine_amount = fine,
      updated_at = timezone('utc', now())
  where id = target.reservation_id;

  update public.book_copies
  set status = 'available',
      updated_at = timezone('utc', now())
  where id = target.copy_id;

  insert into public.notifications (user_id, type, title, message, action_url, metadata)
  values (
    target.user_id,
    'loan_returned',
    'Book returned',
    coalesce(title, 'Your book') || ' was returned on ' || to_char(timezone('utc', now()), 'Mon DD, YYYY') || '. Fine amount: PHP ' || fine::text || '.',
    '/reservations',
    jsonb_build_object('channel', 'in_app', 'loan_id', target.id, 'fine_amount', fine)
  );

  if resolved_book_id is not null then
    update public.books as b
    set available_copies = least(b.total_copies, b.available_copies + 1),
        updated_at = timezone('utc', now())
    where b.id = resolved_book_id;

    perform public.promote_next_queued_reservation(resolved_book_id);
  end if;

  return query select target.id, target.user_id, resolved_book_id, target.copy_id, coalesce(title, 'Untitled book'), true;
end;
$$;
