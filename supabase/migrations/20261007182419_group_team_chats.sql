-- Reuniões em grupo da equipe: participantes explícitos, com leitura isolada por conversa.
create table public.team_conversations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 2 and 80),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, created_by) references public.memberships(company_id, user_id) on delete cascade
);

create table public.team_conversation_members (
  company_id uuid not null,
  conversation_id uuid not null,
  user_id uuid not null,
  joined_at timestamptz not null default now(),
  primary key (company_id, conversation_id, user_id),
  foreign key (company_id, conversation_id) references public.team_conversations(company_id, id) on delete cascade,
  foreign key (company_id, user_id) references public.memberships(company_id, user_id) on delete cascade
);
create index team_conversation_members_user_idx on public.team_conversation_members(company_id, user_id, conversation_id);

create table public.team_group_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  conversation_id uuid not null,
  sender_user_id uuid not null,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  foreign key (company_id, conversation_id) references public.team_conversations(company_id, id) on delete cascade,
  foreign key (company_id, conversation_id, sender_user_id) references public.team_conversation_members(company_id, conversation_id, user_id) on delete cascade
);
create index team_group_messages_thread_idx on public.team_group_messages(company_id, conversation_id, created_at);

alter table public.team_conversations enable row level security;
alter table public.team_conversation_members enable row level security;
alter table public.team_group_messages enable row level security;
revoke all on public.team_conversations, public.team_conversation_members, public.team_group_messages from anon, authenticated;
grant select on public.team_conversations, public.team_conversation_members, public.team_group_messages to authenticated;
grant insert(company_id, conversation_id, sender_user_id, body) on public.team_group_messages to authenticated;

create or replace function private.is_team_conversation_member(p_company_id uuid, p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.team_conversation_members m
    where m.company_id = p_company_id and m.conversation_id = p_conversation_id and m.user_id = (select auth.uid())
  );
$$;
revoke all on function private.is_team_conversation_member(uuid,uuid) from public, anon;
grant execute on function private.is_team_conversation_member(uuid,uuid) to authenticated;

create policy team_conversations_read_participant on public.team_conversations
  for select to authenticated using ((select private.is_team_conversation_member(company_id, id)));
create policy team_conversation_members_read_participant on public.team_conversation_members
  for select to authenticated using ((select private.is_team_conversation_member(company_id, conversation_id)));
create policy team_group_messages_read_participant on public.team_group_messages
  for select to authenticated using ((select private.is_team_conversation_member(company_id, conversation_id)));
create policy team_group_messages_send_participant on public.team_group_messages
  for insert to authenticated with check (
    sender_user_id = (select auth.uid())
    and private.is_team_conversation_member(company_id, conversation_id)
  );

create or replace function private.create_team_conversation_impl(p_company_id uuid, p_title text, p_member_ids uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid := (select auth.uid()); v_conversation_id uuid; v_count integer;
begin
  if v_user_id is null or not private.has_capability(p_company_id, 'createTeamChats') then
    raise exception 'team chat creation denied';
  end if;
  if p_title is null or char_length(trim(p_title)) not between 2 and 80 then
    raise exception 'conversation title must be between 2 and 80 characters';
  end if;
  if p_member_ids is null or cardinality(p_member_ids) not between 1 and 29 then
    raise exception 'select between 1 and 29 colleagues';
  end if;
  if v_user_id = any(p_member_ids) then raise exception 'creator is added automatically'; end if;
  select count(distinct participant_id) into v_count from unnest(p_member_ids) as participants(participant_id);
  if v_count <> cardinality(p_member_ids) then raise exception 'duplicate participants are not allowed'; end if;
  select count(*) into v_count from public.memberships m
    where m.company_id = p_company_id and m.user_id = any(p_member_ids);
  if v_count <> cardinality(p_member_ids) then raise exception 'all participants must belong to this company'; end if;

  insert into public.team_conversations(company_id, title, created_by)
    values (p_company_id, trim(p_title), v_user_id) returning id into v_conversation_id;
  insert into public.team_conversation_members(company_id, conversation_id, user_id)
    values (p_company_id, v_conversation_id, v_user_id);
  insert into public.team_conversation_members(company_id, conversation_id, user_id)
    select p_company_id, v_conversation_id, m.user_id from public.memberships m
    where m.company_id = p_company_id and m.user_id = any(p_member_ids);
  return v_conversation_id;
end $$;
revoke all on function private.create_team_conversation_impl(uuid,text,uuid[]) from public, anon;
grant execute on function private.create_team_conversation_impl(uuid,text,uuid[]) to authenticated;

create or replace function public.create_team_conversation(p_company_id uuid, p_title text, p_member_ids uuid[])
returns uuid language sql security invoker set search_path = '' as $$
  select private.create_team_conversation_impl(p_company_id, p_title, p_member_ids);
$$;
revoke all on function public.create_team_conversation(uuid,text,uuid[]) from public, anon;
grant execute on function public.create_team_conversation(uuid,text,uuid[]) to authenticated;

-- O dono recebe inicialmente esta permissão para poder distribuí-la aos cargos necessários.
update public.company_roles
set capabilities = jsonb_set(capabilities, '{createTeamChats}', 'true'::jsonb, true)
where name in ('Dono', 'Dono da empresa', 'Admin') and capabilities->>'manageCompany' = 'true';

create or replace function private.seed_company_roles() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.company_roles(company_id,name,capabilities,is_default) values
    (new.id,'Dono','{"viewCosts":true,"manageStock":true,"manageTickets":true,"claimTickets":true,"approve":true,"manageCompany":true,"managePeople":true,"manageServices":true,"clearLogs":true,"backup":true,"manageClients":true,"manageCalendar":true,"createTeamChats":true}'::jsonb,true),
    (new.id,'TI','{"manageStock":true,"manageTickets":true,"claimTickets":true,"manageServices":true}'::jsonb,true),
    (new.id,'Gerência','{"viewCosts":true,"manageStock":true,"manageTickets":true,"approve":true,"managePeople":true,"manageServices":true,"clearLogs":true,"manageClients":true,"manageCalendar":true}'::jsonb,true),
    (new.id,'Funcionário','{}'::jsonb,true)
  on conflict(company_id,name) do nothing;
  return new;
end $$;

create or replace function private.employee_registration_allowed(p_company_id uuid, p_role text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_role_caps jsonb; v_key text; v_value jsonb;
begin
  if (select auth.uid()) is null or not private.has_capability(p_company_id, 'managePeople') then return false; end if;
  if p_role in ('Dono','Dono da empresa','Admin') then return false; end if;
  select capabilities into v_role_caps from public.company_roles where company_id=p_company_id and name=p_role;
  if not found then return false; end if;
  for v_key,v_value in select key,value from jsonb_each(v_role_caps) loop
    if v_key not in ('viewCosts','manageStock','manageTickets','claimTickets','approve','manageCompany','managePeople','manageServices','clearLogs','backup','manageClients','manageCalendar','createTeamChats') or jsonb_typeof(v_value)<>'boolean' then return false; end if;
    if v_value='true'::jsonb and not private.has_capability(p_company_id,v_key) then return false; end if;
  end loop;
  return true;
end $$;
revoke all on function private.employee_registration_allowed(uuid,text) from public, anon;
grant execute on function private.employee_registration_allowed(uuid,text) to authenticated;
