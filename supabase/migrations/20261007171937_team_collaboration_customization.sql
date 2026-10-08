-- Cargos configuráveis com direitos aplicados também nas policies do banco.
create table if not exists public.company_roles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 40),
  capabilities jsonb not null default '{}'::jsonb check (jsonb_typeof(capabilities)='object'),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique(company_id,name), unique(company_id,id)
);
create table if not exists public.team_messages (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  sender_user_id uuid not null, recipient_user_id uuid not null, body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(), read_at timestamptz,
  foreign key(company_id,sender_user_id) references public.memberships(company_id,user_id) on delete cascade,
  foreign key(company_id,recipient_user_id) references public.memberships(company_id,user_id) on delete cascade,
  check(sender_user_id <> recipient_user_id)
);
create index if not exists team_messages_thread_idx on public.team_messages(company_id,sender_user_id,recipient_user_id,created_at desc);
create table if not exists public.team_events (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  created_by uuid not null, title text not null check(char_length(trim(title)) between 1 and 120),
  details text not null default '' check(char_length(details)<=1000), starts_at timestamptz not null, ends_at timestamptz not null,
  all_day boolean not null default false, color text not null default '#2c666e' check(color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(company_id,created_by) references public.memberships(company_id,user_id) on delete cascade,
  check(ends_at > starts_at)
);
create index if not exists team_events_company_start_idx on public.team_events(company_id,starts_at);
create table if not exists public.member_preferences (
  company_id uuid not null, user_id uuid not null, dashboard_metrics jsonb not null default '["open","overdue","processing"]'::jsonb,
  primary key(company_id,user_id), foreign key(company_id,user_id) references public.memberships(company_id,user_id) on delete cascade,
  check(jsonb_typeof(dashboard_metrics)='array')
);

create or replace function private.seed_company_roles() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.company_roles(company_id,name,capabilities,is_default) values
    (new.id,'Dono','{"viewCosts":true,"manageStock":true,"manageTickets":true,"claimTickets":true,"approve":true,"manageCompany":true,"managePeople":true,"manageServices":true,"clearLogs":true,"backup":true,"manageClients":true,"manageCalendar":true}'::jsonb,true),
    (new.id,'TI','{"manageStock":true,"manageTickets":true,"claimTickets":true,"manageServices":true}'::jsonb,true),
    (new.id,'Gerência','{"viewCosts":true,"manageStock":true,"manageTickets":true,"approve":true,"managePeople":true,"manageServices":true,"clearLogs":true,"manageClients":true,"manageCalendar":true}'::jsonb,true),
    (new.id,'Funcionário','{}'::jsonb,true)
  on conflict(company_id,name) do nothing;
  return new;
end $$;
drop trigger if exists seed_company_roles_after_insert on public.companies;
create trigger seed_company_roles_after_insert after insert on public.companies for each row execute function private.seed_company_roles();
insert into public.company_roles(company_id,name,capabilities,is_default)
select c.id, v.name, v.capabilities, true from public.companies c cross join (values
 ('Dono','{"viewCosts":true,"manageStock":true,"manageTickets":true,"claimTickets":true,"approve":true,"manageCompany":true,"managePeople":true,"manageServices":true,"clearLogs":true,"backup":true,"manageClients":true,"manageCalendar":true}'::jsonb),
 ('TI','{"manageStock":true,"manageTickets":true,"claimTickets":true,"manageServices":true}'::jsonb),
 ('Gerência','{"viewCosts":true,"manageStock":true,"manageTickets":true,"approve":true,"managePeople":true,"manageServices":true,"clearLogs":true,"manageClients":true,"manageCalendar":true}'::jsonb),
 ('Funcionário','{}'::jsonb)) as v(name,capabilities) on conflict(company_id,name) do nothing;
-- Compatibilidade dos espaços já existentes.
insert into public.company_roles(company_id,name,capabilities,is_default)
select c.id,v.name,v.capabilities,true from public.companies c cross join (values
 ('Dono da empresa','{"viewCosts":true,"manageStock":true,"manageTickets":true,"claimTickets":true,"approve":true,"manageCompany":true,"managePeople":true,"manageServices":true,"clearLogs":true,"backup":true,"manageClients":true,"manageCalendar":true}'::jsonb),
 ('Admin','{"viewCosts":true,"manageStock":true,"manageTickets":true,"claimTickets":true,"approve":true,"manageCompany":true,"managePeople":true,"manageServices":true,"clearLogs":true,"backup":true,"manageClients":true,"manageCalendar":true}'::jsonb),
 ('Supervisor','{"manageStock":true,"manageTickets":true,"manageServices":true}'::jsonb)) v(name,capabilities) on conflict(company_id,name) do nothing;
create or replace function private.prevent_used_role_delete() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.memberships m where m.company_id=old.company_id and m.role=old.name) then raise exception 'role is assigned to company members'; end if;
 return old;
end $$;
drop trigger if exists prevent_used_role_delete_before_delete on public.company_roles;
create trigger prevent_used_role_delete_before_delete before delete on public.company_roles for each row execute function private.prevent_used_role_delete();
alter table public.memberships drop constraint if exists memberships_role_check;
alter table public.memberships add constraint memberships_role_name_valid check(char_length(trim(role)) between 2 and 40);
alter table public.company_member_invites drop constraint if exists company_member_invites_role_check;
alter table public.company_member_invites add constraint company_member_invites_role_name_valid check(char_length(trim(role)) between 2 and 40);
create or replace function private.normalize_owner_role() returns trigger language plpgsql set search_path='' as $$
begin
 if new.role='Dono da empresa' then new.role:='Dono'; end if;
 if not exists(select 1 from public.company_roles r where r.company_id=new.company_id and r.name=new.role) then raise exception 'unknown company role'; end if;
 return new;
end $$;
drop trigger if exists normalize_owner_role_before_write on public.memberships;
create trigger normalize_owner_role_before_write before insert or update of role on public.memberships for each row execute function private.normalize_owner_role();
update public.memberships set role='Dono' where role='Dono da empresa';

create or replace function private.has_capability(p_company_id uuid,p_capability text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.memberships m
    left join public.company_roles r on r.company_id=m.company_id and r.name=m.role
    where m.company_id=p_company_id and m.user_id=(select auth.uid())
      and coalesce((m.capabilities->>p_capability)::boolean,(r.capabilities->>p_capability)::boolean,
        case when m.role in ('Admin','Dono da empresa') then true
          when p_capability='viewCosts' then m.role='Gerência'
          when p_capability in ('manageStock','manageTickets','manageServices') then m.role in ('TI','Gerência','Supervisor')
          when p_capability='claimTickets' then m.role='TI'
          when p_capability in ('approve','managePeople','clearLogs','manageClients') then m.role='Gerência'
          else false end));
$$;
create or replace function private.update_member_capabilities_impl(p_company_id uuid,p_user_id uuid,p_capabilities jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare v_role text; v_key text; v_value jsonb;
begin
 if (select auth.uid()) is null or not private.has_capability(p_company_id,'managePeople') then raise exception 'company access denied'; end if;
 if jsonb_typeof(p_capabilities)<>'object' then raise exception 'capabilities must be an object'; end if;
 for v_key,v_value in select key,value from jsonb_each(p_capabilities) loop
   if v_key not in ('viewCosts','manageStock','manageTickets','claimTickets','approve','manageCompany','managePeople','manageServices','clearLogs','backup','manageClients','manageCalendar') or jsonb_typeof(v_value)<>'boolean' then raise exception 'unknown or invalid capability'; end if;
   if v_value='true'::jsonb and not private.has_capability(p_company_id,v_key) then raise exception 'cannot grant a capability you do not hold'; end if;
 end loop;
 select role into v_role from public.memberships where company_id=p_company_id and user_id=p_user_id for update;
 if not found then raise exception 'member not found'; end if;
 if v_role in ('Dono','Dono da empresa') then raise exception 'owner capabilities are protected'; end if;
 update public.memberships set capabilities=p_capabilities where company_id=p_company_id and user_id=p_user_id;
end $$;
create or replace function private.invite_access_allowed(p_company_id uuid,p_role text,p_capabilities jsonb)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_key text; v_value jsonb; v_role_caps jsonb;
begin
 if (select auth.uid()) is null or not private.has_capability(p_company_id,'managePeople') or jsonb_typeof(p_capabilities)<>'object' then return false; end if;
 select capabilities into v_role_caps from public.company_roles where company_id=p_company_id and name=p_role;
 if not found then return false; end if;
 for v_key,v_value in select key,value from jsonb_each(v_role_caps || p_capabilities) loop
   if v_key not in ('viewCosts','manageStock','manageTickets','claimTickets','approve','manageCompany','managePeople','manageServices','clearLogs','backup','manageClients','manageCalendar') or jsonb_typeof(v_value)<>'boolean' then return false; end if;
   if v_value='true'::jsonb and not private.has_capability(p_company_id,v_key) then return false; end if;
 end loop;
 return true;
end $$;

alter table public.company_roles enable row level security;
alter table public.team_messages enable row level security;
alter table public.team_events enable row level security;
alter table public.member_preferences enable row level security;
revoke all on public.company_roles,public.team_messages,public.team_events,public.member_preferences from anon,authenticated;
grant select on public.company_roles to authenticated;
grant insert(company_id,name,capabilities),delete on public.company_roles to authenticated;
grant update(capabilities) on public.company_roles to authenticated;
grant select on public.team_messages to authenticated;
grant insert(company_id,sender_user_id,recipient_user_id,body) on public.team_messages to authenticated;
grant update(read_at) on public.team_messages to authenticated;
grant select,delete on public.team_events to authenticated;
grant insert(company_id,created_by,title,details,starts_at,ends_at,all_day,color) on public.team_events to authenticated;
grant update(title,details,starts_at,ends_at,all_day,color) on public.team_events to authenticated;
grant select on public.member_preferences to authenticated;
grant insert(company_id,user_id,dashboard_metrics) on public.member_preferences to authenticated;
grant update(dashboard_metrics) on public.member_preferences to authenticated;
create policy company_roles_read_member on public.company_roles for select to authenticated using(private.is_company_member(company_id));
create policy company_roles_insert_owner on public.company_roles for insert to authenticated with check(private.has_capability(company_id,'manageCompany') and not is_default);
create policy company_roles_update_owner on public.company_roles for update to authenticated using(private.has_capability(company_id,'manageCompany')) with check(private.has_capability(company_id,'manageCompany'));
create policy company_roles_delete_custom on public.company_roles for delete to authenticated using(private.has_capability(company_id,'manageCompany') and not is_default);
create policy team_messages_read_participant on public.team_messages for select to authenticated using(private.is_company_member(company_id) and (sender_user_id=(select auth.uid()) or recipient_user_id=(select auth.uid())));
create policy team_messages_send_member on public.team_messages for insert to authenticated with check(sender_user_id=(select auth.uid()) and recipient_user_id<>(select auth.uid()) and private.is_company_member(company_id));
create policy team_messages_mark_read on public.team_messages for update to authenticated using(recipient_user_id=(select auth.uid())) with check(recipient_user_id=(select auth.uid()));
create policy team_events_read_member on public.team_events for select to authenticated using(private.is_company_member(company_id));
create policy team_events_insert_manager on public.team_events for insert to authenticated with check(created_by=(select auth.uid()) and private.has_capability(company_id,'manageCalendar'));
create policy team_events_update_manager on public.team_events for update to authenticated using(private.has_capability(company_id,'manageCalendar')) with check(private.has_capability(company_id,'manageCalendar'));
create policy team_events_delete_manager on public.team_events for delete to authenticated using(private.has_capability(company_id,'manageCalendar'));
create policy member_preferences_self on public.member_preferences for all to authenticated using(user_id=(select auth.uid()) and private.is_company_member(company_id)) with check(user_id=(select auth.uid()) and private.is_company_member(company_id));

create or replace function public.set_member_role(p_company_id uuid,p_user_id uuid,p_role text)
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
revoke all on function public.set_member_role(uuid,uuid,text) from public,anon;
grant execute on function public.set_member_role(uuid,uuid,text) to authenticated;

create or replace function public.rename_company_role(p_company_id uuid,p_old_name text,p_new_name text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if (select auth.uid()) is null or not private.has_capability(p_company_id,'manageCompany') then raise exception 'company access denied'; end if;
 if char_length(trim(p_new_name)) not between 2 and 40 or p_new_name<>trim(p_new_name) then raise exception 'invalid role name'; end if;
 if not exists(select 1 from public.company_roles where company_id=p_company_id and name=p_old_name and not is_default) then raise exception 'custom role not found'; end if;
 if exists(select 1 from public.company_roles where company_id=p_company_id and lower(name)=lower(p_new_name)) then raise exception 'role name already exists'; end if;
 update public.company_roles set name=p_new_name where company_id=p_company_id and name=p_old_name;
 update public.memberships set role=p_new_name where company_id=p_company_id and role=p_old_name;
end $$;
revoke all on function public.rename_company_role(uuid,text,text) from public,anon;
grant execute on function public.rename_company_role(uuid,text,text) to authenticated;
