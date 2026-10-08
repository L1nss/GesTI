alter table public.employee_first_login_requests
  add column if not exists claim_code_hash text,
  add column if not exists claim_expires_at timestamptz,
  add column if not exists claim_attempts integer not null default 0,
  add column if not exists claim_locked_until timestamptz;

alter table public.employee_first_login_requests
  add constraint employee_first_login_claim_hash_format
  check (claim_code_hash is null or claim_code_hash ~ '^[0-9a-f]{64}$');

drop policy if exists employee_first_login_request_insert_manager on public.employee_first_login_requests;
revoke insert (company_id, email, display_name, role, created_by)
  on public.employee_first_login_requests from authenticated;

drop function if exists public.register_employee_first_login(uuid,text,text,text);
drop function if exists private.register_employee_first_login_impl(uuid,text,text,text);

create or replace function private.register_employee_first_login_impl(
  p_company_id uuid,
  p_email text,
  p_display_name text,
  p_role text,
  p_claim_code_hash text
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
  if p_claim_code_hash is null or p_claim_code_hash !~ '^[0-9a-f]{64}$' then raise exception 'valid access code required'; end if;
  if not private.employee_registration_allowed(p_company_id,p_role) then raise exception 'employee registration is not allowed'; end if;

  insert into public.employee_first_login_requests(company_id,email,display_name,role,created_by,claim_code_hash,claim_expires_at,claim_attempts,claim_locked_until)
  values(p_company_id,v_email,trim(p_display_name),p_role,v_user_id,p_claim_code_hash,now()+interval '24 hours',0,null)
  on conflict(email) do update set
    company_id=excluded.company_id,
    display_name=excluded.display_name,
    role=excluded.role,
    created_by=excluded.created_by,
    claim_code_hash=excluded.claim_code_hash,
    claim_expires_at=excluded.claim_expires_at,
    claim_attempts=0,
    claim_locked_until=null,
    created_at=now()
  where employee_first_login_requests.company_id=excluded.company_id
  returning id into v_request_id;

  if v_request_id is null then raise exception 'email is already registered for another company'; end if;
  return v_request_id;
end
$$;
revoke all on function private.register_employee_first_login_impl(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function private.register_employee_first_login_impl(uuid,text,text,text,text) to authenticated;

create or replace function public.register_employee_first_login(
  p_company_id uuid,
  p_email text,
  p_display_name text,
  p_role text,
  p_claim_code_hash text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.register_employee_first_login_impl(p_company_id,p_email,p_display_name,p_role,p_claim_code_hash);
$$;
revoke all on function public.register_employee_first_login(uuid,text,text,text,text) from public,anon;
grant execute on function public.register_employee_first_login(uuid,text,text,text,text) to authenticated;

create or replace function private.verify_employee_first_login_claim_impl(p_email text,p_claim_code_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.employee_first_login_requests%rowtype;
  v_user_id uuid;
begin
  select * into v_request
  from public.employee_first_login_requests r
  where r.email=lower(trim(p_email))
  for update;
  if not found or v_request.claim_code_hash is null or v_request.claim_expires_at<=now() then
    return jsonb_build_object('ok',false);
  end if;
  if v_request.claim_locked_until is not null and v_request.claim_locked_until>now() then
    return jsonb_build_object('ok',false,'locked',true);
  end if;
  if v_request.claim_code_hash<>p_claim_code_hash then
    update public.employee_first_login_requests
      set claim_attempts=claim_attempts+1,
          claim_locked_until=case when claim_attempts+1>=8 then now()+interval '15 minutes' else null end
      where id=v_request.id;
    return jsonb_build_object('ok',false);
  end if;

  select u.id into v_user_id from auth.users u where lower(u.email)=lower(v_request.email) limit 1;
  update public.employee_first_login_requests set claim_attempts=0,claim_locked_until=null where id=v_request.id;
  return jsonb_build_object(
    'ok',true,
    'company_id',v_request.company_id,
    'email',v_request.email,
    'display_name',v_request.display_name,
    'role',v_request.role,
    'user_id',v_user_id
  );
end
$$;
revoke all on function private.verify_employee_first_login_claim_impl(text,text) from public,anon,authenticated;
grant execute on function private.verify_employee_first_login_claim_impl(text,text) to service_role;

create or replace function public.verify_employee_first_login_claim(p_email text,p_claim_code_hash text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.verify_employee_first_login_claim_impl(p_email,p_claim_code_hash); $$;
revoke all on function public.verify_employee_first_login_claim(text,text) from public,anon,authenticated;
grant execute on function public.verify_employee_first_login_claim(text,text) to service_role;

create or replace function private.complete_employee_first_login_claim_impl(
  p_email text,
  p_claim_code_hash text,
  p_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_request public.employee_first_login_requests%rowtype;
begin
  select * into v_request from public.employee_first_login_requests r
  where r.email=lower(trim(p_email)) and r.claim_code_hash=p_claim_code_hash and r.claim_expires_at>now()
  for update;
  if not found then raise exception 'access code invalid or expired'; end if;
  if exists(select 1 from public.memberships m where m.company_id=v_request.company_id and m.user_id=p_user_id) then
    raise exception 'employee is already in this company';
  end if;

  insert into public.memberships(company_id,user_id,display_name,role,capabilities,password_setup_required)
  values(v_request.company_id,p_user_id,v_request.display_name,v_request.role,'{}'::jsonb,false);
  insert into public.technician_presence(company_id,user_id,available,max_active_tickets)
  values(v_request.company_id,p_user_id,false,3) on conflict(company_id,user_id) do nothing;
  delete from public.employee_first_login_requests where id=v_request.id;
  return v_request.company_id;
end
$$;
revoke all on function private.complete_employee_first_login_claim_impl(text,text,uuid) from public,anon,authenticated;
grant execute on function private.complete_employee_first_login_claim_impl(text,text,uuid) to service_role;

create or replace function public.complete_employee_first_login_claim(p_email text,p_claim_code_hash text,p_user_id uuid)
returns uuid
language sql
security invoker
set search_path = ''
as $$ select private.complete_employee_first_login_claim_impl(p_email,p_claim_code_hash,p_user_id); $$;
revoke all on function public.complete_employee_first_login_claim(text,text,uuid) from public,anon,authenticated;
grant execute on function public.complete_employee_first_login_claim(text,text,uuid) to service_role;
