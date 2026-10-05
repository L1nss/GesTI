create table if not exists public.company_member_invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  invite_token uuid not null unique default gen_random_uuid(),
  email text not null,
  display_name text not null,
  role text not null check (role in ('Admin','TI','Gerência','Supervisor','Funcionário')),
  capabilities jsonb not null default '{}'::jsonb,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz
);
create index if not exists company_member_invites_open_email_idx
  on public.company_member_invites(company_id,lower(email),created_at desc) where accepted_at is null;
create index if not exists company_member_invites_creator_idx on public.company_member_invites(created_by);
alter table public.company_member_invites enable row level security;
create policy company_member_invites_read_manager on public.company_member_invites
  for select to authenticated using (private.has_capability(company_id,'managePeople'));
create policy company_member_invites_insert_manager on public.company_member_invites
  for insert to authenticated with check (
    private.has_capability(company_id,'managePeople') and created_by=(select auth.uid())
    and (private.has_capability(company_id,'manageCompany') or role not in ('Admin','Dono da empresa'))
  );
create policy company_member_invites_update_manager on public.company_member_invites
  for update to authenticated using (private.has_capability(company_id,'managePeople')) with check (
    private.has_capability(company_id,'managePeople')
    and (private.has_capability(company_id,'manageCompany') or role not in ('Admin','Dono da empresa'))
  );
create policy company_member_invites_delete_manager on public.company_member_invites
  for delete to authenticated using (private.has_capability(company_id,'managePeople'));
grant select,insert,update,delete on public.company_member_invites to authenticated;

create or replace function private.accept_company_invite_impl(p_invite_token uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_invite public.company_member_invites%rowtype; v_email text;
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  select u.email into v_email from auth.users u
  where u.id=(select auth.uid()) and u.email_confirmed_at is not null;
  if v_email is null then raise exception 'confirm your email before accepting this invitation'; end if;
  select * into v_invite from public.company_member_invites i
  where i.invite_token=p_invite_token and lower(i.email)=lower(v_email)
    and i.accepted_at is null and i.expires_at > now()
    and i.id=(select latest.id from public.company_member_invites latest
      where latest.company_id=i.company_id and lower(latest.email)=lower(i.email)
        and latest.accepted_at is null and latest.expires_at > now()
      order by latest.created_at desc limit 1)
  for update;
  if not found then raise exception 'invitation is invalid, expired, already used, or belongs to another email'; end if;
  insert into public.memberships(company_id,user_id,display_name,role,capabilities,available)
  values (v_invite.company_id,(select auth.uid()),v_invite.display_name,v_invite.role,v_invite.capabilities,false)
  on conflict (company_id,user_id) do nothing;
  insert into public.technician_presence(company_id,user_id,available,max_active_tickets)
  values (v_invite.company_id,(select auth.uid()),false,3)
  on conflict (company_id,user_id) do nothing;
  update public.company_member_invites set accepted_at=now() where id=v_invite.id;
  return v_invite.company_id;
end;
$$;
revoke all on function private.accept_company_invite_impl(uuid) from public, anon;
grant execute on function private.accept_company_invite_impl(uuid) to authenticated;
create or replace function public.accept_company_invite(p_invite_token uuid)
returns uuid language sql security invoker set search_path = '' as $$
  select private.accept_company_invite_impl(p_invite_token);
$$;
revoke all on function public.accept_company_invite(uuid) from public, anon;
grant execute on function public.accept_company_invite(uuid) to authenticated;
