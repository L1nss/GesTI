-- Técnicos precisam identificar os demais membros ao receber chamados.
drop policy if exists memberships_read_company on public.memberships;
create policy memberships_read_company on public.memberships for select to authenticated
using (private.is_company_member(company_id));

-- Vínculos em chamados são gravados em uma operação protegida pelo banco.
create or replace function private.update_ticket_link_impl(
  p_company_id uuid,p_ticket_id text,p_kind text,p_entity_id text,p_add boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ticket public.tickets%rowtype; v_entity jsonb; v_details jsonb; v_actor text;
  v_key text; v_ids jsonb; v_note text; v_price numeric;
begin
  if (select auth.uid()) is null or not private.is_company_member(p_company_id) then raise exception 'company access denied'; end if;
  if p_kind not in ('service','invoice') or char_length(coalesce(p_entity_id,'')) not between 1 and 100 then raise exception 'invalid link'; end if;
  if p_kind='service' and not (private.has_capability(p_company_id,'manageServices') or private.has_capability(p_company_id,'claimTickets')) then raise exception 'service link denied'; end if;
  if p_kind='invoice' and not private.has_capability(p_company_id,'approve') then raise exception 'document link denied'; end if;
  select * into v_ticket from public.tickets where company_id=p_company_id and id=p_ticket_id for update;
  if not found then raise exception 'ticket not found'; end if;
  if p_kind='service' and v_ticket.status='Resolvido' and p_add then raise exception 'ticket already resolved'; end if;
  select payload into v_entity from public.workspace_records
    where company_id=p_company_id and entity_type=case when p_kind='service' then 'services' else 'invoices' end
      and entity_id=p_entity_id;
  if not found then raise exception 'linked record not found'; end if;
  if p_kind='service' and p_add and coalesce((v_entity->>'active')::boolean,true)=false then raise exception 'service inactive'; end if;
  v_key := case when p_kind='service' then 'serviceIds' else 'invoiceIds' end;
  v_details := coalesce(v_ticket.details,'{}'::jsonb);
  v_ids := coalesce(v_details->v_key,'[]'::jsonb);
  if p_add and not v_ids ? p_entity_id then v_ids := v_ids || to_jsonb(p_entity_id); end if;
  if not p_add then select coalesce(jsonb_agg(value),'[]'::jsonb) into v_ids
    from jsonb_array_elements(v_ids) value where value <> to_jsonb(p_entity_id); end if;
  v_details := jsonb_set(v_details,array[v_key],v_ids);
  if p_kind='service' and p_add then
    v_price := coalesce((v_entity->>'price')::numeric,0);
    v_details := jsonb_set(v_details,'{servicePrices}',coalesce(v_details->'servicePrices','{}'::jsonb) || jsonb_build_object(p_entity_id,v_price));
  end if;
  select display_name into v_actor from public.memberships where company_id=p_company_id and user_id=(select auth.uid());
  v_note := case when p_kind='service' then case when p_add then 'Serviço aplicado: ' else 'Serviço removido: ' end || coalesce(v_entity->>'name',p_entity_id)
    else 'Documento vinculado: ' || p_entity_id end;
  v_details := jsonb_set(v_details,'{history}',coalesce(v_details->'history','[]'::jsonb) ||
    jsonb_build_array(jsonb_build_object('status',v_ticket.status,'person',v_actor,'date',now(),'note',v_note)));
  update public.tickets set details=v_details,updated_at=now() where company_id=p_company_id and id=p_ticket_id;
  return v_details;
end;
$$;
revoke all on function private.update_ticket_link_impl(uuid,text,text,text,boolean) from public, anon;
grant execute on function private.update_ticket_link_impl(uuid,text,text,text,boolean) to authenticated;
create or replace function public.update_ticket_link(
  p_company_id uuid,p_ticket_id text,p_kind text,p_entity_id text,p_add boolean
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.update_ticket_link_impl(p_company_id,p_ticket_id,p_kind,p_entity_id,p_add);
$$;
revoke all on function public.update_ticket_link(uuid,text,text,text,boolean) from public, anon;
grant execute on function public.update_ticket_link(uuid,text,text,text,boolean) to authenticated;
