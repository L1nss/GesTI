-- Mantém as mesmas capacidades padrão do cliente web, com exceções por membro.
create or replace function private.has_capability(p_company_id uuid, p_capability text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.company_id = p_company_id and m.user_id = (select auth.uid())
      and coalesce((m.capabilities ->> p_capability)::boolean,
        case
          when m.role in ('Admin','Dono da empresa') then true
          when p_capability = 'viewCosts' then m.role = 'Gerência'
          when p_capability in ('manageStock','manageTickets','manageServices') then m.role in ('TI','Gerência','Supervisor')
          when p_capability = 'claimTickets' then m.role = 'TI'
          when p_capability in ('approve','managePeople','clearLogs','manageClients') then m.role = 'Gerência'
          else false
        end)
  );
$$;

create or replace function private.submit_ticket_satisfaction_impl(
  p_company_id uuid, p_ticket_id text, p_score smallint, p_comment text default ''
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not private.is_company_member(p_company_id) then
    raise exception 'company access denied';
  end if;
  if p_score < 1 or p_score > 5 or char_length(coalesce(p_comment,'')) > 1000 then
    raise exception 'invalid satisfaction response';
  end if;
  update public.tickets set satisfaction_score=p_score, satisfaction_comment=coalesce(p_comment,''), updated_at=now()
  where company_id=p_company_id and id=p_ticket_id and requester_user_id=(select auth.uid())
    and status='Resolvido' and satisfaction_score is null
    and exists (select 1 from public.memberships m where m.company_id=p_company_id and m.user_id=(select auth.uid()) and m.role <> 'TI');
  if not found then raise exception 'ticket is not eligible for satisfaction feedback'; end if;
end;
$$;
revoke all on function private.submit_ticket_satisfaction_impl(uuid,text,smallint,text) from public, anon;
grant execute on function private.submit_ticket_satisfaction_impl(uuid,text,smallint,text) to authenticated;

create or replace function public.submit_ticket_satisfaction(
  p_company_id uuid, p_ticket_id text, p_score smallint, p_comment text default ''
) returns void language sql security invoker set search_path = '' as $$
  select private.submit_ticket_satisfaction_impl(p_company_id,p_ticket_id,p_score,p_comment);
$$;
revoke all on function public.submit_ticket_satisfaction(uuid,text,smallint,text) from public, anon;
grant execute on function public.submit_ticket_satisfaction(uuid,text,smallint,text) to authenticated;

create or replace function private.update_ticket_status_impl(p_company_id uuid,p_ticket_id text,p_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not private.is_company_member(p_company_id) then raise exception 'company access denied'; end if;
  if p_status not in ('Aberto','Em processamento','Resolvido') then raise exception 'invalid ticket status'; end if;
  update public.tickets set status=p_status,
    resolved_at=case when p_status='Resolvido' then now() else null end,
    assignee_user_id=case when p_status='Aberto' then null else assignee_user_id end,
    assignment_status=case when p_status='Aberto' then 'unassigned' when p_status='Em processamento' then 'accepted' else assignment_status end,
    updated_at=now()
  where company_id=p_company_id and id=p_ticket_id
    and (assignee_user_id=(select auth.uid()) or private.has_capability(p_company_id,'manageTickets'));
  if not found then raise exception 'ticket update not allowed'; end if;
end;
$$;
revoke all on function private.update_ticket_status_impl(uuid,text,text) from public, anon;
grant execute on function private.update_ticket_status_impl(uuid,text,text) to authenticated;

create or replace function public.update_ticket_status(p_company_id uuid,p_ticket_id text,p_status text)
returns void language sql security invoker set search_path = '' as $$
  select private.update_ticket_status_impl(p_company_id,p_ticket_id,p_status);
$$;
revoke all on function public.update_ticket_status(uuid,text,text) from public, anon;
grant execute on function public.update_ticket_status(uuid,text,text) to authenticated;

-- A satisfação só pode ser gravada pelo RPC acima; retiramos update direto em tickets.
revoke update on public.tickets from authenticated;
