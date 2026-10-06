-- Registro demonstrativo e baixa de estoque em uma transação.
create or replace function private.save_demo_document_impl(p_company_id uuid,p_document jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_item jsonb; v_stock public.workspace_records%rowtype; v_available numeric;
  v_needed numeric; v_id text; v_document_id text; v_status text; v_update jsonb;
  v_inventory jsonb := '[]'::jsonb; v_movements jsonb := '[]'::jsonb; v_movement jsonb;
  v_actor text; v_ticket_id text;
begin
  if (select auth.uid()) is null or not private.has_capability(p_company_id,'approve') then raise exception 'document access denied'; end if;
  if jsonb_typeof(p_document) <> 'object' or pg_column_size(p_document) > 200000 then raise exception 'invalid document'; end if;
  v_document_id := p_document->>'id'; v_status := p_document->>'status';
  if char_length(coalesce(v_document_id,'')) not between 1 and 100 or v_status not in ('Emitida','Rascunho')
    or jsonb_typeof(p_document->'items') <> 'array' or jsonb_array_length(p_document->'items') not between 1 and 100
    or coalesce((p_document->>'total')::numeric,-1) < 0 then raise exception 'invalid document'; end if;
  if coalesce((p_document->'customer'->>'name'),'') = '' then raise exception 'customer required'; end if;
  select display_name into v_actor from public.memberships where company_id=p_company_id and user_id=(select auth.uid());
  select id into strict v_id from public.companies where id=p_company_id for update;
  if exists(select 1 from public.workspace_records where company_id=p_company_id and entity_type='invoices'
    and (entity_id=v_document_id or (payload->>'number'=p_document->>'number' and payload->>'series'=p_document->>'series')))
    then raise exception 'document number already exists'; end if;
  if v_status='Emitida' then
    for v_id, v_needed in
      select item->>'inventoryId', sum((item->>'quantity')::numeric)
      from jsonb_array_elements(p_document->'items') item
      where nullif(item->>'inventoryId','') is not null
      group by item->>'inventoryId' order by item->>'inventoryId'
    loop
      if v_needed <= 0 or v_needed > 1000000 then raise exception 'invalid stock quantity'; end if;
      select * into v_stock from public.workspace_records where company_id=p_company_id and entity_type='inventory' and entity_id=v_id for update;
      if not found then raise exception 'stock item not found'; end if;
      v_available := coalesce((v_stock.payload->>'quantity')::numeric,0);
      if v_available < v_needed then raise exception 'insufficient stock'; end if;
      v_update := jsonb_set(v_stock.payload,'{quantity}',to_jsonb(v_available-v_needed));
      update public.workspace_records set payload=v_update,updated_by=(select auth.uid()),updated_at=now()
        where company_id=p_company_id and entity_type='inventory' and entity_id=v_id;
      v_inventory := v_inventory || jsonb_build_array(v_update);
      v_movement := jsonb_build_object('id','MOV-'||gen_random_uuid(),'item',v_stock.payload->>'name',
        'quantity',-v_needed,'person',v_actor,'date',now(),'documentId',v_document_id);
      insert into public.workspace_records(company_id,entity_type,entity_id,payload,updated_by)
        values(p_company_id,'movements',v_movement->>'id',v_movement,(select auth.uid()));
      v_movements := v_movements || jsonb_build_array(v_movement);
    end loop;
  end if;
  insert into public.workspace_records(company_id,entity_type,entity_id,payload,updated_by)
    values(p_company_id,'invoices',v_document_id,p_document,(select auth.uid()));
  v_ticket_id := nullif(p_document->>'ticketId','');
  if v_ticket_id is not null then
    perform private.update_ticket_link_impl(p_company_id,v_ticket_id,'invoice',v_document_id,true);
  end if;
  return jsonb_build_object('inventory',v_inventory,'movements',v_movements);
end;
$$;
revoke all on function private.save_demo_document_impl(uuid,jsonb) from public, anon;
grant execute on function private.save_demo_document_impl(uuid,jsonb) to authenticated;
create or replace function public.save_demo_document(p_company_id uuid,p_document jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.save_demo_document_impl(p_company_id,p_document);
$$;
revoke all on function public.save_demo_document(uuid,jsonb) from public, anon;
grant execute on function public.save_demo_document(uuid,jsonb) to authenticated;
