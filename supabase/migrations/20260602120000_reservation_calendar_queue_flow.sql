alter type public.reservation_status add value if not exists 'reserved';
alter type public.reservation_status add value if not exists 'queued';
alter type public.reservation_status add value if not exists 'picked_up';
alter type public.reservation_status add value if not exists 'returned';
