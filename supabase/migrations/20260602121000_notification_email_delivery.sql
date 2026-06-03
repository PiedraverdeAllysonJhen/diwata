alter table public.notifications
  add column if not exists email_status text not null default 'not_applicable',
  add column if not exists email_sent_at timestamptz,
  add column if not exists email_error text;

create index if not exists notifications_email_status_created_idx
  on public.notifications (email_status, created_at desc);
