alter table public.memberships
  add column if not exists password_setup_required boolean not null default false;

create table if not exists public.employee_first_login_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null check (email = lower(trim(email)) and char_length(email) <= 254),
  display_name text not null check (char_length(trim(display_name)) between 2 and 120),
  role text not null check (char_length(trim(role)) between 2 and 40),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (email),
  foreign key (company_id, role) references public.company_roles(company_id, name) on update cascade on delete restrict
);

alter table public.employee_first_login_requests enable row level security;
revoke all on public.employee_first_login_requests from anon, authenticated;
grant insert (company_id, email, display_name, role, created_by)
  on public.employee_first_login_requests to authenticated;

create or replace function private.employee_registration_allowed(p_company_id uuid, p_role text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_role_caps jsonb; v_key text; v_value jsonb;
begin
  if (select auth.uid()) is null or not private.has_capability(p_company_id, 'managePeople') then return false; end if;
  if p_role in ('Dono','Dono da empresa','Admin') then return false; end if;
  select capabilities into v_role_caps from public.company_roles where company_id=p_company_id and name=p_role;
  if not found then return false; end if;
  for v_key,v_value in select key,value from jsonb_each(v_role_caps) loop
    if v_key not in ('viewCosts','manageStock','manageTickets','claimTickets','approve','manageCompany','managePeople','manageServices','clearLogs','backup','manageClients','manageCalendar') or jsonb_typeof(v_value)<>'boolean' then return false; end if;
    if v_value='true'::jsonb and not private.has_capability(p_company_id,v_key) then return false; end if;
  end loop;
  return true;
end $$;
revoke all on function private.employee_registration_allowed(uuid,text) from public,anon,authenticated;
grant execute on function private.employee_registration_allowed(uuid,text) to authenticated;

create policy employee_first_login_request_insert_manager
  on public.employee_first_login_requests for insert to authenticated
  with check (
    created_by=(select auth.uid())
    and email=lower(trim(email))
    and private.employee_registration_allowed(company_id,role)
  );

create or replace function private.activate_employee_first_login_impl()
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_email text; v_request public.employee_first_login_requests%rowtype;
begin
  select lower(email) into v_email from auth.users
  where id=(select auth.uid()) and email_confirmed_at is not null;
  if v_email is null then raise exception 'verified email required'; end if;

  select * into v_request from public.employee_first_login_requests r
  where r.email=v_email order by r.created_at desc limit 1 for update;
  if not found then return null; end if;
  if not exists(select 1 from public.company_roles r where r.company_id=v_request.company_id and r.name=v_request.role) then
    raise exception 'employee role is no longer available';
  end if;
  if exists(select 1 from public.memberships m where m.company_id=v_request.company_id and m.user_id=(select auth.uid())) then
    delete from public.employee_first_login_requests where id=v_request.id;
    return v_request.company_id;
  end if;

  insert into public.memberships(company_id,user_id,display_name,role,capabilities,password_setup_required)
  values(v_request.company_id,(select auth.uid()),v_request.display_name,v_request.role,'{}'::jsonb,true);
  insert into public.technician_presence(company_id,user_id,available,max_active_tickets)
  values(v_request.company_id,(select auth.uid()),false,3) on conflict(company_id,user_id) do nothing;
  delete from public.employee_first_login_requests where id=v_request.id;
  return v_request.company_id;
end $$;
revoke all on function private.activate_employee_first_login_impl() from public,anon,authenticated;

create or replace function public.activate_employee_first_login()
returns uuid language sql security invoker set search_path = '' as $$
  select private.activate_employee_first_login_impl();
$$;
revoke all on function public.activate_employee_first_login() from public,anon;
grant execute on function public.activate_employee_first_login() to authenticated;

create or replace function private.complete_employee_password_setup_impl(p_company_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.memberships set password_setup_required=false
  where company_id=p_company_id and user_id=(select auth.uid()) and password_setup_required=true;
  if not found then raise exception 'password setup is not pending'; end if;
end $$;
revoke all on function private.complete_employee_password_setup_impl(uuid) from public,anon,authenticated;

create or replace function public.complete_employee_password_setup(p_company_id uuid)
returns void language sql security invoker set search_path = '' as $$
  select private.complete_employee_password_setup_impl(p_company_id);
$$;
revoke all on function public.complete_employee_password_setup(uuid) from public,anon;
grant execute on function public.complete_employee_password_setup(uuid) to authenticated;
