create or replace function private.register_employee_first_login_impl(
  p_company_id uuid,
  p_email text,
  p_display_name text,
  p_role text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_email text := lower(trim(p_email));
  v_request_id uuid;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or char_length(v_email)>254 then
    raise exception 'valid email required';
  end if;
  if char_length(trim(p_display_name)) not between 2 and 120 then raise exception 'valid display name required'; end if;
  if not private.employee_registration_allowed(p_company_id,p_role) then raise exception 'employee registration is not allowed'; end if;

  insert into public.employee_first_login_requests(company_id,email,display_name,role,created_by)
  values(p_company_id,v_email,trim(p_display_name),p_role,v_user_id)
  on conflict(email) do update set
    display_name=excluded.display_name,
    role=excluded.role,
    created_by=excluded.created_by,
    created_at=now()
  where employee_first_login_requests.company_id=excluded.company_id
  returning id into v_request_id;

  if v_request_id is null then raise exception 'email is already registered for another company'; end if;
  return v_request_id;
end
$$;
revoke all on function private.register_employee_first_login_impl(uuid,text,text,text) from public,anon,authenticated;
grant execute on function private.register_employee_first_login_impl(uuid,text,text,text) to authenticated;

create or replace function public.register_employee_first_login(
  p_company_id uuid,
  p_email text,
  p_display_name text,
  p_role text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.register_employee_first_login_impl(p_company_id,p_email,p_display_name,p_role);
$$;
revoke all on function public.register_employee_first_login(uuid,text,text,text) from public,anon;
grant execute on function public.register_employee_first_login(uuid,text,text,text) to authenticated;
