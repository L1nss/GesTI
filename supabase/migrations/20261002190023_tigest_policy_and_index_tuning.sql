alter table public.companies add column if not exists profile_data jsonb not null default '{}'::jsonb;

create index if not exists memberships_user_idx on public.memberships(user_id);
create index if not exists ticket_requester_idx on public.tickets(requester_user_id);
create index if not exists ticket_assignee_idx on public.tickets(assignee_user_id);
create index if not exists supplier_company_idx on public.suppliers(company_id);
create index if not exists reply_templates_company_idx on public.reply_templates(company_id);
create index if not exists reply_templates_creator_idx on public.reply_templates(created_by);
create index if not exists audit_actor_idx on public.audit_events(actor_user_id);
create index if not exists app_errors_company_idx on public.app_errors(company_id);
create index if not exists app_errors_actor_idx on public.app_errors(actor_user_id);
create index if not exists onboarding_user_idx on public.onboarding_progress(user_id);

-- Evita políticas permissivas duplicadas: permissões de leitura mantêm seu escopo;
-- políticas de escrita cobrem apenas os comandos que alteram dados.
drop policy if exists suppliers_write_manager on public.suppliers;
create policy suppliers_insert_manager on public.suppliers for insert to authenticated with check (private.has_capability(company_id,'manageStock'));
create policy suppliers_update_manager on public.suppliers for update to authenticated using (private.has_capability(company_id,'manageStock')) with check (private.has_capability(company_id,'manageStock'));
create policy suppliers_delete_manager on public.suppliers for delete to authenticated using (private.has_capability(company_id,'manageStock'));

drop policy if exists budgets_read_costs on public.category_budgets;
drop policy if exists budgets_write_costs on public.category_budgets;
create policy budgets_cost_access on public.category_budgets for all to authenticated using (private.has_capability(company_id,'viewCosts')) with check (private.has_capability(company_id,'viewCosts'));

drop policy if exists replies_write_manager on public.reply_templates;
create policy replies_insert_manager on public.reply_templates for insert to authenticated with check (private.has_capability(company_id,'manageTickets'));
create policy replies_update_manager on public.reply_templates for update to authenticated using (private.has_capability(company_id,'manageTickets')) with check (private.has_capability(company_id,'manageTickets'));
create policy replies_delete_manager on public.reply_templates for delete to authenticated using (private.has_capability(company_id,'manageTickets'));

drop policy if exists onboarding_own_read on public.onboarding_progress;
drop policy if exists onboarding_own_write on public.onboarding_progress;
create policy onboarding_own_access on public.onboarding_progress for all to authenticated using (user_id = (select auth.uid()) and private.is_company_member(company_id)) with check (user_id = (select auth.uid()) and private.is_company_member(company_id));

drop policy if exists accounting_read_costs on public.accounting_entries;
drop policy if exists accounting_write_costs on public.accounting_entries;
create policy accounting_cost_access on public.accounting_entries for all to authenticated using (private.has_capability(company_id,'viewCosts')) with check (private.has_capability(company_id,'viewCosts'));

-- Operações elevadas permanecem em schema privado e validam auth.uid(); as rotas REST
-- públicas são invoker-only e não carregam privilégios do proprietário da função.
create or replace function private.bootstrap_company_impl(p_name text, p_display_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_company_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if char_length(trim(p_name)) < 2 or char_length(trim(p_display_name)) < 2 then raise exception 'company and user names are required'; end if;
  insert into public.companies(name) values (trim(p_name)) returning id into v_company_id;
  insert into public.memberships(company_id,user_id,display_name,role) values (v_company_id,(select auth.uid()),trim(p_display_name),'Dono da empresa');
  insert into public.technician_presence(company_id,user_id,available) values (v_company_id,(select auth.uid()),false);
  return v_company_id;
end;
$$;
revoke all on function private.bootstrap_company_impl(text,text) from public, anon;
grant execute on function private.bootstrap_company_impl(text,text) to authenticated;
create or replace function public.bootstrap_company(p_name text, p_display_name text)
returns uuid language sql security invoker set search_path = '' as $$
  select private.bootstrap_company_impl(p_name,p_display_name);
$$;
revoke all on function public.bootstrap_company(text,text) from public, anon;
grant execute on function public.bootstrap_company(text,text) to authenticated;

create or replace function private.assign_ticket_impl(p_company_id uuid, p_ticket_id text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_assignee uuid; v_requester uuid;
begin
  if (select auth.uid()) is null or not private.is_company_member(p_company_id) then raise exception 'company access denied'; end if;
  select requester_user_id into v_requester from public.tickets where company_id=p_company_id and id=p_ticket_id for update;
  if v_requester is null then raise exception 'ticket not found'; end if;
  if v_requester <> (select auth.uid()) and not private.has_capability(p_company_id,'claimTickets') then raise exception 'assignment not allowed'; end if;
  select m.user_id into v_assignee from public.memberships m
  join public.technician_presence p on p.company_id=m.company_id and p.user_id=m.user_id
  where m.company_id=p_company_id and m.role='TI' and p.available
    and (select count(*) from public.tickets t where t.company_id=p_company_id and t.assignee_user_id=m.user_id and t.status <> 'Resolvido') < p.max_active_tickets
  order by (select count(*) from public.tickets t where t.company_id=p_company_id and t.assignee_user_id=m.user_id and t.status <> 'Resolvido'), random()
  limit 1 for update of p skip locked;
  update public.tickets set assignee_user_id=v_assignee, assignment_status=case when v_assignee is null then 'unassigned' else 'pending_acceptance' end, updated_at=now()
    where company_id=p_company_id and id=p_ticket_id and status <> 'Resolvido';
  return v_assignee;
end;
$$;
revoke all on function private.assign_ticket_impl(uuid,text) from public, anon;
grant execute on function private.assign_ticket_impl(uuid,text) to authenticated;
create or replace function public.assign_ticket(p_company_id uuid,p_ticket_id text)
returns uuid language sql security invoker set search_path = '' as $$
  select private.assign_ticket_impl(p_company_id,p_ticket_id);
$$;
revoke all on function public.assign_ticket(uuid,text) from public, anon;
grant execute on function public.assign_ticket(uuid,text) to authenticated;

create or replace function private.respond_to_ticket_assignment_impl(p_company_id uuid,p_ticket_id text,p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not private.is_company_member(p_company_id) then raise exception 'company access denied'; end if;
  update public.tickets set assignment_status=case when p_accept then 'accepted' else 'declined' end,
    assignee_user_id=case when p_accept then (select auth.uid()) else null end,
    status=case when p_accept then 'Em processamento' else 'Aberto' end, updated_at=now()
  where company_id=p_company_id and id=p_ticket_id and assignee_user_id=(select auth.uid()) and assignment_status='pending_acceptance';
  if not found then raise exception 'assignment not found'; end if;
  if not p_accept then perform private.assign_ticket_impl(p_company_id,p_ticket_id); end if;
end;
$$;
revoke all on function private.respond_to_ticket_assignment_impl(uuid,text,boolean) from public, anon;
grant execute on function private.respond_to_ticket_assignment_impl(uuid,text,boolean) to authenticated;
create or replace function public.respond_to_ticket_assignment(p_company_id uuid,p_ticket_id text,p_accept boolean)
returns void language sql security invoker set search_path = '' as $$
  select private.respond_to_ticket_assignment_impl(p_company_id,p_ticket_id,p_accept);
$$;
revoke all on function public.respond_to_ticket_assignment(uuid,text,boolean) from public, anon;
grant execute on function public.respond_to_ticket_assignment(uuid,text,boolean) to authenticated;
