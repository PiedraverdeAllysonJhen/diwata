alter type public.reservation_status add value if not exists 'approved';
alter type public.loan_status add value if not exists 'picked_up';

alter table public.reservations
  add column if not exists approved_at timestamptz;

alter table public.loans
  add column if not exists picked_up_at timestamptz,
  add column if not exists last_overdue_notice_at timestamptz;
