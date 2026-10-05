create or replace function private.remove_company_member_impl(p_company_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not private.has_capability(p_company_id,'managePeople') then raise exception 'company access denied'; end if;
  if p_user_id=(select auth.uid()) then raise exception 'cannot remove your own active membership'; end if;
  delete from public.memberships m where m.company_id=p_company_id and m.user_id=p_user_id
    and m.role not in ('Dono da empresa');
  if not found then raise exception 'member not found or owner membership is protected'; end if;
end;
$$;
revoke all on function private.remove_company_member_impl(uuid,uuid) from public, anon;
grant execute on function private.remove_company_member_impl(uuid,uuid) to authenticated;
create or replace function public.remove_company_member(p_company_id uuid,p_user_id uuid)
returns void language sql security invoker set search_path = '' as $$
  select private.remove_company_member_impl(p_company_id,p_user_id);
$$;
revoke all on function public.remove_company_member(uuid,uuid) from public, anon;
grant execute on function public.remove_company_member(uuid,uuid) to authenticated;
