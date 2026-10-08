create index if not exists team_events_company_creator_idx on public.team_events(company_id,created_by);
create index if not exists team_messages_company_recipient_idx on public.team_messages(company_id,recipient_user_id,sender_user_id,created_at desc);

create or replace function private.set_member_role_impl(p_company_id uuid,p_user_id uuid,p_role text)
returns void language plpgsql security definer set search_path='' as $$
declare v_target_role text;
begin
 if (select auth.uid()) is null or not private.has_capability(p_company_id,'manageCompany') then raise exception 'company access denied'; end if;
 if not exists(select 1 from public.company_roles where company_id=p_company_id and name=p_role) then raise exception 'role not found'; end if;
 if p_role in ('Dono','Dono da empresa') then raise exception 'owner role cannot be assigned'; end if;
 select role into v_target_role from public.memberships where company_id=p_company_id and user_id=p_user_id for update;
 if not found then raise exception 'member not found'; end if;
 if v_target_role in ('Dono','Dono da empresa') or p_user_id=(select auth.uid()) then raise exception 'owner role is protected'; end if;
 update public.memberships set role=p_role,capabilities='{}'::jsonb where company_id=p_company_id and user_id=p_user_id;
end $$;
revoke all on function private.set_member_role_impl(uuid,uuid,text) from public,anon;
grant execute on function private.set_member_role_impl(uuid,uuid,text) to authenticated;
create or replace function public.set_member_role(p_company_id uuid,p_user_id uuid,p_role text)
returns void language sql security invoker set search_path='' as $$
  select private.set_member_role_impl(p_company_id,p_user_id,p_role);
$$;
revoke all on function public.set_member_role(uuid,uuid,text) from public,anon;
grant execute on function public.set_member_role(uuid,uuid,text) to authenticated;

create or replace function private.rename_company_role_impl(p_company_id uuid,p_old_name text,p_new_name text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if (select auth.uid()) is null or not private.has_capability(p_company_id,'manageCompany') then raise exception 'company access denied'; end if;
 if char_length(trim(p_new_name)) not between 2 and 40 or p_new_name<>trim(p_new_name) then raise exception 'invalid role name'; end if;
 if not exists(select 1 from public.company_roles where company_id=p_company_id and name=p_old_name and not is_default) then raise exception 'custom role not found'; end if;
 if exists(select 1 from public.company_roles where company_id=p_company_id and lower(name)=lower(p_new_name)) then raise exception 'role name already exists'; end if;
 update public.company_roles set name=p_new_name where company_id=p_company_id and name=p_old_name;
 update public.memberships set role=p_new_name where company_id=p_company_id and role=p_old_name;
end $$;
revoke all on function private.rename_company_role_impl(uuid,text,text) from public,anon;
grant execute on function private.rename_company_role_impl(uuid,text,text) to authenticated;
create or replace function public.rename_company_role(p_company_id uuid,p_old_name text,p_new_name text)
returns void language sql security invoker set search_path='' as $$
  select private.rename_company_role_impl(p_company_id,p_old_name,p_new_name);
$$;
revoke all on function public.rename_company_role(uuid,text,text) from public,anon;
grant execute on function public.rename_company_role(uuid,text,text) to authenticated;
