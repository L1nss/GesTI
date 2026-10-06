-- Atribuições e aceite ficam visíveis no histórico após recarregar a página.
create or replace function private.record_ticket_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_actor text; v_assignee text; v_note text;
begin
  if old.assignment_status is not distinct from new.assignment_status
    and old.assignee_user_id is not distinct from new.assignee_user_id then return new; end if;
  select display_name into v_actor from public.memberships
    where company_id=new.company_id and user_id=(select auth.uid());
  if new.assignee_user_id is not null then
    select display_name into v_assignee from public.memberships
      where company_id=new.company_id and user_id=new.assignee_user_id;
  end if;
  v_note := case
    when new.assignment_status='accepted' then 'Atribuição aceita pelo técnico.'
    when new.assignment_status='declined' then 'Atribuição recusada pelo técnico.'
    when new.assignment_status='pending_acceptance' then 'Encaminhado para ' || coalesce(v_assignee,'técnico') || '; aguardando aceite.'
    else 'Chamado sem técnico disponível.' end;
  new.details := jsonb_set(coalesce(new.details,'{}'::jsonb),'{history}',
    coalesce(new.details->'history','[]'::jsonb) ||
    jsonb_build_array(jsonb_build_object('status',new.status,'person',coalesce(v_actor,'Sistema'),
      'date',now(),'note',v_note)));
  return new;
end;
$$;
drop trigger if exists record_ticket_assignment on public.tickets;
create trigger record_ticket_assignment before update on public.tickets
for each row execute function private.record_ticket_assignment();
