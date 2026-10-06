-- Convites não podem conferir privilégios que o criador não possui.
create or replace function private.invite_access_allowed(
  p_company_id uuid, p_role text, p_capabilities jsonb
) returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_key text; v_value jsonb; v_defaults jsonb;
begin
  if (select auth.uid()) is null or not private.has_capability(p_company_id, 'managePeople') then return false; end if;
  if jsonb_typeof(p_capabilities) <> 'object' then return false; end if;
  v_defaults := case p_role
    when 'Admin' then '{"viewCosts":true,"manageStock":true,"manageTickets":true,"claimTickets":true,"approve":true,"manageCompany":true,"managePeople":true,"manageServices":true,"clearLogs":true,"backup":true,"manageClients":true}'::jsonb
    when 'TI' then '{"manageStock":true,"manageTickets":true,"claimTickets":true,"manageServices":true}'::jsonb
    when 'Gerência' then '{"viewCosts":true,"manageStock":true,"manageTickets":true,"approve":true,"managePeople":true,"manageServices":true,"clearLogs":true,"manageClients":true}'::jsonb
    when 'Supervisor' then '{"manageStock":true,"manageTickets":true,"manageServices":true}'::jsonb
    when 'Funcionário' then '{}'::jsonb
    else null
  end;
  if v_defaults is null then return false; end if;
  for v_key, v_value in select key, value from jsonb_each(v_defaults || p_capabilities) loop
    if v_key not in ('viewCosts','manageStock','manageTickets','claimTickets','approve','manageCompany','managePeople','manageServices','clearLogs','backup','manageClients')
      or jsonb_typeof(v_value) <> 'boolean' then return false; end if;
    if v_value = 'true'::jsonb and not private.has_capability(p_company_id,v_key) then return false; end if;
  end loop;
  return true;
end;
$$;
revoke all on function private.invite_access_allowed(uuid,text,jsonb) from public, anon;
grant execute on function private.invite_access_allowed(uuid,text,jsonb) to authenticated;

drop policy if exists company_member_invites_insert_manager on public.company_member_invites;
create policy company_member_invites_insert_manager on public.company_member_invites
for insert to authenticated with check (
  created_by=(select auth.uid()) and private.invite_access_allowed(company_id,role,capabilities)
);
drop policy if exists company_member_invites_update_manager on public.company_member_invites;
create policy company_member_invites_update_manager on public.company_member_invites
for update to authenticated using (private.has_capability(company_id,'managePeople'))
with check (private.invite_access_allowed(company_id,role,capabilities));
revoke insert, update on public.company_member_invites from authenticated;
grant insert (company_id,email,display_name,role,capabilities,created_by,expires_at)
  on public.company_member_invites to authenticated;
grant update (email,display_name,role,capabilities,expires_at)
  on public.company_member_invites to authenticated;

-- A API deve respeitar o mesmo limite de visibilidade da interface.
drop policy if exists tickets_read_member on public.tickets;
create policy tickets_read_member on public.tickets for select to authenticated
using (private.is_company_member(company_id) and (
  requester_user_id=(select auth.uid())
  or assignee_user_id=(select auth.uid())
  or private.has_capability(company_id,'manageTickets')
  or private.has_capability(company_id,'claimTickets')
));

-- Políticas antigas com FOR ALL são permissivas e se somam às novas.
drop policy if exists suppliers_write_manager on public.suppliers;
drop policy if exists budgets_write_costs on public.category_budgets;
drop policy if exists accounting_write_costs on public.accounting_entries;
drop policy if exists replies_write_manager on public.reply_templates;
drop policy if exists tickets_update_allowed on public.tickets;
drop policy if exists memberships_update_manager on public.memberships;
drop policy if exists company_member_invites_delete_manager on public.company_member_invites;
drop policy if exists budgets_cost_access on public.category_budgets;
create policy budgets_read_approved on public.category_budgets for select to authenticated
using (private.has_capability(company_id,'viewCosts'));
create policy budgets_write_approved on public.category_budgets for insert to authenticated
with check (private.has_capability(company_id,'approve'));
create policy budgets_update_approved on public.category_budgets for update to authenticated
using (private.has_capability(company_id,'approve')) with check (private.has_capability(company_id,'approve'));
create policy budgets_delete_approved on public.category_budgets for delete to authenticated
using (private.has_capability(company_id,'approve'));
drop policy if exists accounting_cost_access on public.accounting_entries;
create policy accounting_read_approved on public.accounting_entries for select to authenticated
using (private.has_capability(company_id,'viewCosts'));
create policy accounting_write_approved on public.accounting_entries for insert to authenticated
with check (private.has_capability(company_id,'approve'));
create policy accounting_update_approved on public.accounting_entries for update to authenticated
using (private.has_capability(company_id,'approve')) with check (private.has_capability(company_id,'approve'));
create policy accounting_delete_approved on public.accounting_entries for delete to authenticated
using (private.has_capability(company_id,'approve'));

-- Leitura de custos não concede escrita de despesas ou notas.
create or replace function private.can_write_workspace_record(p_company_id uuid,p_type text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_company_member(p_company_id) and case p_type
    when 'clients' then private.has_capability(p_company_id,'manageClients')
    when 'inventory' then private.has_capability(p_company_id,'manageStock')
    when 'services' then private.has_capability(p_company_id,'manageServices')
    when 'expenses' then private.has_capability(p_company_id,'approve')
    when 'invoices' then private.has_capability(p_company_id,'approve')
    when 'movements' then private.has_capability(p_company_id,'manageStock')
    else false end;
$$;
revoke all on function private.can_write_workspace_record(uuid,text) from public, anon;
grant execute on function private.can_write_workspace_record(uuid,text) to authenticated;
drop policy if exists workspace_records_insert on public.workspace_records;
create policy workspace_records_insert on public.workspace_records for insert to authenticated
with check (updated_by=(select auth.uid()) and private.can_write_workspace_record(company_id,entity_type));
drop policy if exists workspace_records_update on public.workspace_records;
create policy workspace_records_update on public.workspace_records for update to authenticated
using (private.can_write_workspace_record(company_id,entity_type))
with check (updated_by=(select auth.uid()) and private.can_write_workspace_record(company_id,entity_type));
drop policy if exists workspace_records_delete on public.workspace_records;
create policy workspace_records_delete on public.workspace_records for delete to authenticated
using (private.can_write_workspace_record(company_id,entity_type));

-- Conversas e histórico de chamados deixam de depender do navegador.
alter table public.tickets add column if not exists details jsonb not null default '{}'::jsonb;
alter table public.tickets add constraint ticket_details_object
  check (jsonb_typeof(details) = 'object' and pg_column_size(details) < 2500000);

create or replace function private.prepare_ticket_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_actor text; v_text text; v_hours integer;
begin
  if (select auth.uid()) is null or new.requester_user_id <> (select auth.uid())
    or not private.is_company_member(new.company_id) then raise exception 'ticket creation denied'; end if;
  if char_length(trim(new.title)) not between 1 and 100 or char_length(new.description) > 500 then raise exception 'invalid ticket text'; end if;
  v_text := lower(new.title || ' ' || new.description);
  if not private.has_capability(new.company_id,'claimTickets') then
    new.priority := case
      when v_text ~ '(servidor|indisponível|indisponivel|fora do ar|não liga|nao liga|perda de dados|sem internet|ransomware|invasão|invasao|roubo|urgente|parado|sem acesso|bloqueado|caiu)' then 'Urgente'
      when v_text ~ '(não conecta|nao conecta|wi-fi|wifi|rede|impressora|monitor|teclado|mouse|notebook|computador|lento|travando|quebrado|queimado|sem imagem|não abre|nao abre|erro|falha|vírus|virus|não imprime|nao imprime)' then 'Alta'
      when v_text ~ '(atualização|atualizacao|instalar|instalação|instalacao|dúvida|duvida|melhoria|sugestão|sugestao|agendar|quando puder|rotina|backup|limpeza|consulta|pesquisa)' then 'Baixa'
      else 'Alta' end;
  end if;
  v_hours := case new.priority when 'Urgente' then 4 when 'Alta' then 8 when 'Baixa' then 40 else null end;
  if v_hours is null then raise exception 'invalid priority'; end if;
  select display_name into v_actor from public.memberships where company_id=new.company_id and user_id=(select auth.uid());
  new.status := 'Aberto'; new.assignee_user_id := null; new.assignment_status := 'unassigned';
  new.created_at := now(); new.updated_at := new.created_at; new.due_at := new.created_at+(v_hours || ' hours')::interval;
  new.details := jsonb_build_object('history',jsonb_build_array(jsonb_build_object('status','Aberto','person',v_actor,'date',new.created_at,'note','Chamado criado.')));
  return new;
end;
$$;
drop trigger if exists prepare_ticket_insert on public.tickets;
create trigger prepare_ticket_insert before insert on public.tickets for each row execute function private.prepare_ticket_insert();
revoke insert on public.tickets from authenticated;
grant insert (company_id,id,title,description,category,priority,requester_user_id) on public.tickets to authenticated;

create or replace function private.append_ticket_comment_impl(
  p_company_id uuid,p_ticket_id text,p_text text,p_attachment jsonb default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ticket public.tickets%rowtype; v_actor text; v_stamp timestamptz := now(); v_details jsonb; v_attachment jsonb;
begin
  if (select auth.uid()) is null or not private.is_company_member(p_company_id) then raise exception 'company access denied'; end if;
  select * into v_ticket from public.tickets where company_id=p_company_id and id=p_ticket_id for update;
  if not found or not (v_ticket.requester_user_id=(select auth.uid()) or v_ticket.assignee_user_id=(select auth.uid()) or private.has_capability(p_company_id,'manageTickets'))
    then raise exception 'ticket access denied'; end if;
  if char_length(coalesce(p_text,'')) > 1500 then raise exception 'comment too long'; end if;
  if p_attachment is null and trim(coalesce(p_text,'')) = '' then raise exception 'empty update'; end if;
  select display_name into v_actor from public.memberships where company_id=p_company_id and user_id=(select auth.uid());
  v_details := coalesce(v_ticket.details,'{}'::jsonb);
  if p_attachment is not null then
    if jsonb_typeof(p_attachment) <> 'object'
      or char_length(coalesce(p_attachment->>'name','')) not between 1 and 160
      or coalesce((p_attachment->>'size')::integer,0) not between 1 and 524288
      or char_length(coalesce(p_attachment->>'data','')) > 720000
      or coalesce(p_attachment->>'type','') not in ('image/png','image/jpeg','image/gif','image/webp','application/pdf','text/plain')
      or not (p_attachment->>'data' like ('data:' || (p_attachment->>'type') || ';base64,%'))
      or jsonb_array_length(coalesce(v_details->'attachments','[]'::jsonb)) >= 3
      then raise exception 'invalid attachment'; end if;
    v_attachment := jsonb_build_object('id',gen_random_uuid(),'name',p_attachment->>'name','type',p_attachment->>'type','size',(p_attachment->>'size')::integer,'data',p_attachment->>'data','person',v_actor,'date',v_stamp);
    v_details := jsonb_set(v_details,'{attachments}',coalesce(v_details->'attachments','[]'::jsonb) || jsonb_build_array(v_attachment));
  end if;
  if trim(coalesce(p_text,'')) <> '' then
    v_details := jsonb_set(v_details,'{comments}',coalesce(v_details->'comments','[]'::jsonb) ||
      jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'text',trim(p_text),'person',v_actor,'date',v_stamp)));
  end if;
  v_details := jsonb_set(v_details,'{history}',coalesce(v_details->'history','[]'::jsonb) ||
    jsonb_build_array(jsonb_build_object('status',v_ticket.status,'person',v_actor,'date',v_stamp,'note',
      case when p_attachment is null then 'Comentário: ' || trim(p_text) else 'Anexo adicionado: ' || (p_attachment->>'name') end)));
  update public.tickets set details=v_details, updated_at=v_stamp where company_id=p_company_id and id=p_ticket_id;
  return v_details;
end;
$$;
revoke all on function private.append_ticket_comment_impl(uuid,text,text,jsonb) from public, anon;
grant execute on function private.append_ticket_comment_impl(uuid,text,text,jsonb) to authenticated;
create or replace function public.append_ticket_comment(
  p_company_id uuid,p_ticket_id text,p_text text,p_attachment jsonb default null
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.append_ticket_comment_impl(p_company_id,p_ticket_id,p_text,p_attachment);
$$;
revoke all on function public.append_ticket_comment(uuid,text,text,jsonb) from public, anon;
grant execute on function public.append_ticket_comment(uuid,text,text,jsonb) to authenticated;

create or replace function private.change_ticket_priority_impl(
  p_company_id uuid,p_ticket_id text,p_priority text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_ticket public.tickets%rowtype; v_actor text; v_hours integer; v_details jsonb;
begin
  if (select auth.uid()) is null or not (private.has_capability(p_company_id,'claimTickets') or private.has_capability(p_company_id,'manageTickets'))
    then raise exception 'priority change denied'; end if;
  v_hours := case p_priority when 'Urgente' then 4 when 'Alta' then 8 when 'Baixa' then 40 else null end;
  if v_hours is null then raise exception 'invalid priority'; end if;
  select * into v_ticket from public.tickets where company_id=p_company_id and id=p_ticket_id for update;
  if not found then raise exception 'ticket not found'; end if;
  select display_name into v_actor from public.memberships where company_id=p_company_id and user_id=(select auth.uid());
  v_details := coalesce(v_ticket.details,'{}'::jsonb);
  v_details := jsonb_set(v_details,'{history}',coalesce(v_details->'history','[]'::jsonb) ||
    jsonb_build_array(jsonb_build_object('status',v_ticket.status,'person',v_actor,'date',now(),'note',
      'Prioridade ajustada: ' || v_ticket.priority || ' → ' || p_priority || '.')));
  v_details := v_details || jsonb_build_object('prioritySource','manual','priorityBy',v_actor);
  update public.tickets set priority=p_priority,due_at=created_at+(v_hours || ' hours')::interval,
    details=v_details,updated_at=now() where company_id=p_company_id and id=p_ticket_id;
end;
$$;
revoke all on function private.change_ticket_priority_impl(uuid,text,text) from public, anon;
grant execute on function private.change_ticket_priority_impl(uuid,text,text) to authenticated;
create or replace function public.change_ticket_priority(p_company_id uuid,p_ticket_id text,p_priority text)
returns void language sql security invoker set search_path = '' as $$
  select private.change_ticket_priority_impl(p_company_id,p_ticket_id,p_priority);
$$;
revoke all on function public.change_ticket_priority(uuid,text,text) from public, anon;
grant execute on function public.change_ticket_priority(uuid,text,text) to authenticated;

create or replace function private.update_ticket_status_with_note_impl(
  p_company_id uuid,p_ticket_id text,p_status text,p_note text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_ticket public.tickets%rowtype; v_actor text; v_details jsonb;
begin
  if (select auth.uid()) is null or not private.is_company_member(p_company_id) then raise exception 'company access denied'; end if;
  if p_status not in ('Aberto','Em processamento','Resolvido') or char_length(coalesce(p_note,'')) > 2000 then raise exception 'invalid status update'; end if;
  select * into v_ticket from public.tickets where company_id=p_company_id and id=p_ticket_id for update;
  if not found then raise exception 'ticket not found'; end if;
  if p_status='Aberto' and not private.has_capability(p_company_id,'manageTickets') then raise exception 'reopen denied'; end if;
  if p_status<>'Aberto' and not (v_ticket.assignee_user_id=(select auth.uid()) or private.has_capability(p_company_id,'manageTickets')) then raise exception 'status update denied'; end if;
  if p_status='Em processamento' and v_ticket.assignee_user_id is null then raise exception 'assignee required'; end if;
  if p_status='Resolvido' and (v_ticket.status<>'Em processamento' or trim(coalesce(p_note,''))='') then raise exception 'solution required'; end if;
  select display_name into v_actor from public.memberships where company_id=p_company_id and user_id=(select auth.uid());
  v_details := jsonb_set(coalesce(v_ticket.details,'{}'::jsonb),'{history}',coalesce(v_ticket.details->'history','[]'::jsonb) ||
    jsonb_build_array(jsonb_build_object('status',p_status,'person',v_actor,'date',now(),'note',trim(coalesce(p_note,'')))));
  update public.tickets set status=p_status,details=v_details,
    resolved_at=case when p_status='Resolvido' then now() else null end,
    assignee_user_id=case when p_status='Aberto' then null else assignee_user_id end,
    assignment_status=case when p_status='Aberto' then 'unassigned' when p_status='Em processamento' then 'accepted' else assignment_status end,
    updated_at=now() where company_id=p_company_id and id=p_ticket_id;
end;
$$;
revoke all on function private.update_ticket_status_with_note_impl(uuid,text,text,text) from public, anon;
grant execute on function private.update_ticket_status_with_note_impl(uuid,text,text,text) to authenticated;
create or replace function public.update_ticket_status_with_note(p_company_id uuid,p_ticket_id text,p_status text,p_note text)
returns void language sql security invoker set search_path = '' as $$
  select private.update_ticket_status_with_note_impl(p_company_id,p_ticket_id,p_status,p_note);
$$;
revoke all on function public.update_ticket_status_with_note(uuid,text,text,text) from public, anon;
grant execute on function public.update_ticket_status_with_note(uuid,text,text,text) to authenticated;
revoke execute on function public.update_ticket_status(uuid,text,text) from authenticated;
