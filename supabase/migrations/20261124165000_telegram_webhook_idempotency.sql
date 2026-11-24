-- Durable idempotency for Telegram webhook delivery after removing the Windows router database.
create table if not exists public.telegram_webhook_updates (
  update_id bigint primary key,
  status text not null default 'processing'
    check (status in ('processing','processed','failed')),
  claimed_at timestamptz not null default now(),
  processed_at timestamptz,
  error_code text
);
alter table public.telegram_webhook_updates enable row level security;
revoke all on table public.telegram_webhook_updates from public, anon, authenticated;
grant all on table public.telegram_webhook_updates to service_role;

create or replace function public.telegram_claim_webhook_update(
  p_update_id bigint, p_stale_seconds integer default 120
)
returns boolean language plpgsql security definer
set search_path = public, pg_temp
as $function$
declare v_claimed bigint;
begin
  insert into public.telegram_webhook_updates(update_id,status,claimed_at,error_code)
  values (p_update_id,'processing',now(),null)
  on conflict (update_id) do update
    set status='processing', claimed_at=now(), processed_at=null, error_code=null
    where public.telegram_webhook_updates.status='failed'
       or (public.telegram_webhook_updates.status='processing'
           and public.telegram_webhook_updates.claimed_at <
             now() - make_interval(secs => greatest(coalesce(p_stale_seconds,120),30)))
  returning update_id into v_claimed;
  return v_claimed is not null;
end;
$function$;

create or replace function public.telegram_complete_webhook_update(
  p_update_id bigint, p_success boolean, p_error_code text default null
)
returns void language plpgsql security definer
set search_path = public, pg_temp
as $function$
begin
  update public.telegram_webhook_updates
  set status = case when p_success then 'processed' else 'failed' end,
      processed_at = case when p_success then now() else null end,
      error_code = case when p_success then null else left(coalesce(p_error_code,'handler_failed'),80) end
  where update_id = p_update_id;
end;
$function$;

revoke all on function public.telegram_claim_webhook_update(bigint,integer) from public, anon, authenticated;
revoke all on function public.telegram_complete_webhook_update(bigint,boolean,text) from public, anon, authenticated;
grant execute on function public.telegram_claim_webhook_update(bigint,integer) to service_role;
grant execute on function public.telegram_complete_webhook_update(bigint,boolean,text) to service_role;
