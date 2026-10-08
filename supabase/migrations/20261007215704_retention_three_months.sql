-- Exclui diariamente registros operacionais, mensagens e logs após três meses.
-- Contas empresariais e vínculos ativos permanecem enquanto o serviço estiver ativo.

create extension if not exists pg_cron with schema pg_catalog;

create or replace function private.purge_expired_workspace_data()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz := now() - interval '3 months';
begin
  delete from public.audit_events where created_at < v_cutoff;
  delete from public.app_errors where created_at < v_cutoff;
  delete from public.team_messages where created_at < v_cutoff;
  delete from public.team_group_messages where created_at < v_cutoff;
  delete from public.team_events where created_at < v_cutoff;
  delete from public.company_member_invites where expires_at < now();
  delete from public.employee_first_login_requests
    where created_at < v_cutoff or claim_expires_at < now();
  delete from public.workspace_records where created_at < v_cutoff;
  delete from public.accounting_entries where created_at < v_cutoff;
  delete from public.tickets where created_at < v_cutoff;
  delete from public.category_budgets where created_at < v_cutoff;
  delete from public.suppliers where created_at < v_cutoff;
  delete from public.reply_templates where created_at < v_cutoff;
end;
$$;

revoke all on function private.purge_expired_workspace_data() from public, anon, authenticated;

select cron.unschedule(jobid)
from cron.job
where jobname = 'gesti-retention-three-months';

select cron.schedule(
  'gesti-retention-three-months',
  '17 3 * * *',
  $job$select private.purge_expired_workspace_data();$job$
);
