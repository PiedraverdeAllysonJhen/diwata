alter table public.reservations
  add column if not exists reservation_start_date date,
  add column if not exists reservation_end_date date,
  add column if not exists picked_up_at timestamptz,
  add column if not exists returned_at timestamptz,
  add column if not exists fine_amount numeric(10,2) not null default 0;

create index if not exists reservations_book_date_status_idx
  on public.reservations (book_id, reservation_start_date, reservation_end_date, status);

drop index if exists reservations_active_unique_per_user_book_idx;

create unique index if not exists reservations_active_unique_per_user_book_idx
  on public.reservations (user_id, book_id)
  where status in ('approved', 'ready_for_pickup', 'reserved', 'queued', 'picked_up');

create or replace function public.reservation_overlap_count(
  target_book_id uuid,
  target_start date,
  target_end date
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with active_reservations as (
    select r.id
    from public.reservations r
    where r.book_id = target_book_id
      and r.status in ('reserved', 'picked_up', 'approved', 'ready_for_pickup')
      and coalesce(r.reservation_start_date, r.requested_at::date) <= target_end
      -- One grace day is reserved after the due date before another reservation can start.
      and (coalesce(r.reservation_end_date, r.expires_at::date, r.requested_at::date) + 1) >= target_start
  ),
  active_loans as (
    select l.id
    from public.loans l
    join public.book_copies bc on bc.id = l.copy_id
    left join public.reservations r on r.id = l.reservation_id
    where bc.book_id = target_book_id
      and l.status in ('active', 'picked_up', 'overdue')
      and l.checked_out_at::date <= target_end
      and (l.due_at::date + 1) >= target_start
      and (r.id is null or r.status not in ('reserved', 'picked_up', 'approved', 'ready_for_pickup'))
  )
  select ((select count(*) from active_reservations) + (select count(*) from active_loans))::integer;
$$;

create or replace function public.get_book_reservation_availability(
  target_book_id uuid,
  window_start date default current_date,
  days_to_check integer default 60
)
returns table (
  start_date date,
  end_date date,
  available_copies integer,
  total_copies integer,
  is_available boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  total integer;
  available integer;
begin
  select b.total_copies, b.available_copies into total, available
  from public.books b
  where b.id = target_book_id;

  if total is null then
    raise exception 'Book not found';
  end if;

  return query
  select
    d::date as start_date,
    (d::date + 7) as end_date,
    greatest(0, available) as available_copies,
    total as total_copies,
    available > 0 as is_available
  from generate_series(window_start, window_start + greatest(1, days_to_check - 1), interval '1 day') as d;
end;
$$;

create or replace function public.create_student_reservation(
  target_book_id uuid,
  desired_start date,
  join_queue_when_full boolean default true
)
returns table (
  reservation_id uuid,
  status text,
  start_date date,
  end_date date,
  available_copies integer,
  message text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  total integer;
  occupied integer;
  available integer;
  desired_end date := desired_start + 7;
  created_id uuid;
  book_title text;
  next_queue_position integer;
begin
  if current_user_id is null then
    raise exception 'Authentication is required';
  end if;

  if desired_start < current_date then
    raise exception 'Reservation start date cannot be in the past';
  end if;

  -- Lock the book row so concurrent reservations for the final copy are serialized.
  select b.available_copies, b.title
    into total, book_title
  from public.books b
  where b.id = target_book_id
  for update;

  if total is null then
    raise exception 'Book not found';
  end if;

  if exists (
    select 1
    from public.reservations r
    where r.user_id = current_user_id
      and r.book_id = target_book_id
      and r.status in ('reserved', 'queued', 'picked_up', 'approved', 'ready_for_pickup')
  ) then
    raise exception 'You already have an active reservation for this book.';
  end if;

  occupied := 0;
  available := greatest(0, total);

  if available > 0 then
    insert into public.reservations (
      user_id,
      book_id,
      status,
      reservation_start_date,
      reservation_end_date,
      requested_at,
      expires_at
    )
    values (
      current_user_id,
      target_book_id,
      'reserved',
      desired_start,
      desired_end,
      timezone('utc', now()),
      desired_end::timestamptz
    )
    returning id into created_id;

    update public.books as b
    set available_copies = greatest(0, b.available_copies - 1),
        updated_at = timezone('utc', now())
    where b.id = target_book_id;

    insert into public.notifications (user_id, type, title, message, action_url, metadata)
    values
      (
        current_user_id,
        'reservation_confirmed',
        'Reservation confirmed',
        'Your reservation for ' || coalesce(book_title, 'this book') || ' is confirmed. You may pick it up starting ' || to_char(desired_start, 'Mon DD, YYYY') || '. Please pick it up during library hours.',
        '/reservations',
        jsonb_build_object('channel', 'in_app', 'reservation_id', created_id)
      ),
      (
        current_user_id,
        'reservation_confirmed_email',
        'Email queued: reservation confirmed',
        'Your reservation for ' || coalesce(book_title, 'this book') || ' is confirmed. You may pick it up starting ' || to_char(desired_start, 'Mon DD, YYYY') || '. Please pick it up during library hours.',
        '/reservations',
        jsonb_build_object('channel', 'email', 'reservation_id', created_id)
      );

    return query select created_id, 'reserved', desired_start, desired_end, available - 1, 'Reservation confirmed';
    return;
  end if;

  if not join_queue_when_full then
    return query select null::uuid, 'unavailable', desired_start, desired_end, 0, 'No copies are available for that date range';
    return;
  end if;

  select coalesce(max(queue_position), 0) + 1
    into next_queue_position
  from public.reservations
  where book_id = target_book_id
    and status = 'queued';

  insert into public.reservations (
    user_id,
    book_id,
    status,
    queue_position,
    reservation_start_date,
    reservation_end_date,
    requested_at,
    expires_at
  )
  values (
    current_user_id,
    target_book_id,
    'queued',
    next_queue_position,
    desired_start,
    desired_end,
    timezone('utc', now()),
    desired_end::timestamptz
  )
  returning id into created_id;

  insert into public.notifications (user_id, type, title, message, action_url, metadata)
  values
    (
      current_user_id,
      'reservation_queued',
      'Added to reservation queue',
      'No copies are available for ' || coalesce(book_title, 'this book') || ' on your selected dates. You have been added to the queue.',
      '/reservations',
      jsonb_build_object('channel', 'in_app', 'reservation_id', created_id)
    ),
    (
      current_user_id,
      'reservation_queued_email',
      'Email queued: reservation queue',
      'No copies are available for ' || coalesce(book_title, 'this book') || ' on your selected dates. You have been added to the queue.',
      '/reservations',
      jsonb_build_object('channel', 'email', 'reservation_id', created_id)
    );

  return query select created_id, 'queued', desired_start, desired_end, 0, 'Added to waitlist';
end;
$$;

create or replace function public.promote_next_queued_reservation(target_book_id uuid)
returns table (
  reservation_id uuid,
  user_id uuid,
  book_title text,
  promoted boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  queued_row public.reservations%rowtype;
  title text;
  total integer;
  available integer;
begin
  select b.available_copies, b.title into total, title
  from public.books b
  where b.id = target_book_id
  for update;

  if total is null then
    return;
  end if;

  for queued_row in
    select *
    from public.reservations
    where book_id = target_book_id
      and status = 'queued'
    order by queue_position nulls last, requested_at
    for update skip locked
  loop
    available := greatest(0, total);

    if available > 0 then
      update public.reservations
      set status = 'reserved',
          queue_position = null,
          updated_at = timezone('utc', now())
      where id = queued_row.id;

      update public.books as b
      set available_copies = greatest(0, b.available_copies - 1),
          updated_at = timezone('utc', now())
      where b.id = target_book_id;

      insert into public.notifications (user_id, type, title, message, action_url, metadata)
      values
        (
          queued_row.user_id,
          'reservation_queue_promoted',
          'Book available for pickup',
          'The book ' || coalesce(title, 'you requested') || ' is now available for pickup for your requested reservation date ' || to_char(queued_row.reservation_start_date, 'Mon DD, YYYY') || '.',
          '/reservations',
          jsonb_build_object('channel', 'in_app', 'reservation_id', queued_row.id)
        ),
        (
          queued_row.user_id,
          'reservation_queue_promoted_email',
          'Email queued: book available',
          'The book ' || coalesce(title, 'you requested') || ' is now available for pickup for your requested reservation date ' || to_char(queued_row.reservation_start_date, 'Mon DD, YYYY') || '.',
          '/reservations',
          jsonb_build_object('channel', 'email', 'reservation_id', queued_row.id)
        );

      return query select queued_row.id, queued_row.user_id, coalesce(title, 'Untitled book'), true;
      return;
    end if;
  end loop;

  return query select null::uuid, null::uuid, coalesce(title, 'Untitled book'), false;
end;
$$;

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

update public.reservations
set status = 'reserved',
    updated_at = timezone('utc', now())
where status = 'pending';

with unavailable_counts as (
  select book_id, count(*)::integer as unavailable
  from public.reservations
  where status in ('reserved', 'approved', 'ready_for_pickup', 'picked_up')
  group by book_id
),
active_loan_counts as (
  select bc.book_id, count(*)::integer as unavailable
  from public.loans l
  join public.book_copies bc on bc.id = l.copy_id
  left join public.reservations r on r.id = l.reservation_id
  where l.status in ('active', 'picked_up', 'overdue')
    and (r.id is null or r.status not in ('reserved', 'approved', 'ready_for_pickup', 'picked_up'))
  group by bc.book_id
)
update public.books b
set available_copies = greatest(
      0,
      b.total_copies
        - coalesce(ur.unavailable, 0)
        - coalesce(ul.unavailable, 0)
    ),
    updated_at = timezone('utc', now())
from public.books target_book
left join unavailable_counts ur on ur.book_id = target_book.id
left join active_loan_counts ul on ul.book_id = target_book.id
where b.id = target_book.id;
