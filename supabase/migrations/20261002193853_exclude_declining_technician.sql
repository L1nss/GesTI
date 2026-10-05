create or replace function private.respond_to_ticket_assignment_impl(p_company_id uuid,p_ticket_id text,p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_assignee uuid;
begin
  if (select auth.uid()) is null or not private.is_company_member(p_company_id) then raise exception 'company access denied'; end if;
  update public.tickets set
    assignment_status=case when p_accept then 'accepted' else 'declined' end,
    assignee_user_id=case when p_accept then (select auth.uid()) else null end,
    status=case when p_accept then 'Em processamento' else 'Aberto' end,
    updated_at=now()
  where company_id=p_company_id and id=p_ticket_id and assignee_user_id=(select auth.uid()) and assignment_status='pending_acceptance';
  if not found then raise exception 'assignment not found'; end if;
  if not p_accept then
    select m.user_id into v_assignee from public.memberships m
    join public.technician_presence p on p.company_id=m.company_id and p.user_id=m.user_id
    where m.company_id=p_company_id and m.role='TI' and m.user_id <> (select auth.uid()) and p.available
      and (select count(*) from public.tickets t where t.company_id=p_company_id and t.assignee_user_id=m.user_id and t.status <> 'Resolvido') < p.max_active_tickets
    order by (select count(*) from public.tickets t where t.company_id=p_company_id and t.assignee_user_id=m.user_id and t.status <> 'Resolvido'), random()
    limit 1 for update of p skip locked;
    update public.tickets set assignee_user_id=v_assignee,
      assignment_status=case when v_assignee is null then 'unassigned' else 'pending_acceptance' end,
      updated_at=now()
    where company_id=p_company_id and id=p_ticket_id;
  end if;
end;
$$;
