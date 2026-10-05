drop policy if exists memberships_update_manager on public.memberships;
revoke update on public.memberships from authenticated;

create or replace function private.update_member_capabilities_impl(p_company_id uuid,p_user_id uuid,p_capabilities jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_role text; v_key text; v_value jsonb;
begin
  if (select auth.uid()) is null or not private.has_capability(p_company_id,'managePeople') then raise exception 'company access denied'; end if;
  if jsonb_typeof(p_capabilities) <> 'object' then raise exception 'capabilities must be an object'; end if;
  for v_key,v_value in select key,value from jsonb_each(p_capabilities) loop
    if v_key not in ('viewCosts','manageStock','manageTickets','claimTickets','approve','manageCompany','managePeople','manageServices','clearLogs','backup','manageClients') then raise exception 'unknown capability'; end if;
    if jsonb_typeof(v_value) <> 'boolean' then raise exception 'capability values must be boolean'; end if;
    if v_value = 'true'::jsonb and not private.has_capability(p_company_id,v_key) then raise exception 'cannot grant a capability you do not hold'; end if;
  end loop;
  select m.role into v_role from public.memberships m where m.company_id=p_company_id and m.user_id=p_user_id for update;
  if not found then raise exception 'member not found'; end if;
  if v_role='Dono da empresa' then raise exception 'owner capabilities are protected'; end if;
  update public.memberships set capabilities=p_capabilities where company_id=p_company_id and user_id=p_user_id;
end;
$$;
revoke all on function private.update_member_capabilities_impl(uuid,uuid,jsonb) from public, anon;
grant execute on function private.update_member_capabilities_impl(uuid,uuid,jsonb) to authenticated;
create or replace function public.update_member_capabilities(p_company_id uuid,p_user_id uuid,p_capabilities jsonb)
returns void language sql security invoker set search_path = '' as $$
  select private.update_member_capabilities_impl(p_company_id,p_user_id,p_capabilities);
$$;
revoke all on function public.update_member_capabilities(uuid,uuid,jsonb) from public, anon;
grant execute on function public.update_member_capabilities(uuid,uuid,jsonb) to authenticated;
