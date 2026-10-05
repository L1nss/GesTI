-- GesTI multiempresa: dados do workspace, atendimento e integrações.
-- O JWT do Supabase Auth é a única identidade confiável; não usamos user_metadata.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 160),
  branding jsonb not null default '{"primaryColor":"#6750a4"}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.memberships (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('Admin','Dono da empresa','TI','Gerência','Supervisor','Funcionário')),
  capabilities jsonb not null default '{}'::jsonb,
  available boolean not null default false,
  max_active_tickets integer not null default 3 check (max_active_tickets between 1 and 50),
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create table if not exists public.technician_presence (
  company_id uuid not null,
  user_id uuid not null,
  available boolean not null default false,
  max_active_tickets integer not null default 3 check (max_active_tickets between 1 and 50),
  updated_at timestamptz not null default now(),
  primary key (company_id,user_id),
  foreign key (company_id,user_id) references public.memberships(company_id,user_id) on delete cascade
);

create or replace function private.is_company_member(p_company_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m where m.company_id = p_company_id and m.user_id = (select auth.uid()));
$$;

create or replace function private.has_capability(p_company_id uuid, p_capability text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.company_id = p_company_id and m.user_id = (select auth.uid())
      and coalesce((m.capabilities ->> p_capability)::boolean,
        case
          when m.role in ('Admin','Dono da empresa') then true
          when p_capability = 'viewCosts' then m.role = 'Gerência'
          when p_capability in ('manageStock','manageTickets','manageServices') then m.role in ('TI','Gerência','Supervisor')
          when p_capability = 'claimTickets' then m.role = 'TI'
          when p_capability in ('approve','managePeople','clearLogs','manageClients') then m.role = 'Gerência'
          when p_capability in ('manageCompany','backup') then false
          else false
        end)
  );
$$;
revoke all on function private.is_company_member(uuid) from public, anon;
revoke all on function private.has_capability(uuid,text) from public, anon;
grant execute on function private.is_company_member(uuid) to authenticated;
grant execute on function private.has_capability(uuid,text) to authenticated;

create table if not exists public.tickets (
  company_id uuid not null references public.companies(id) on delete cascade,
  id text not null,
  title text not null,
  description text not null default '',
  category text not null default 'Outro',
  status text not null default 'Aberto' check (status in ('Aberto','Em processamento','Resolvido')),
  priority text not null default 'Alta' check (priority in ('Baixa','Alta','Urgente')),
  requester_user_id uuid not null references auth.users(id),
  assignee_user_id uuid references auth.users(id),
  assignment_status text not null default 'unassigned' check (assignment_status in ('unassigned','pending_acceptance','accepted','declined')),
  due_at timestamptz,
  resolved_at timestamptz,
  satisfaction_score smallint check (satisfaction_score between 1 and 5),
  satisfaction_comment text check (char_length(satisfaction_comment) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, id)
);
create index if not exists tickets_company_status_idx on public.tickets(company_id,status,created_at desc);
create index if not exists tickets_assignee_open_idx on public.tickets(company_id,assignee_user_id) where status <> 'Resolvido';

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  document text,
  email text,
  phone text,
  notes text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(company_id, name)
);

create table if not exists public.category_budgets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  category text not null,
  month date not null,
  limit_amount numeric(12,2) not null check (limit_amount > 0),
  created_at timestamptz not null default now(),
  unique(company_id, category, month)
);

create table if not exists public.reply_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  title text not null,
  body text not null check (char_length(body) between 1 and 2000),
  active boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_user_id uuid default auth.uid() references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_events_company_date_idx on public.audit_events(company_id,created_at desc);

create table if not exists public.app_errors (
  id bigint generated always as identity primary key,
  company_id uuid references public.companies(id) on delete cascade,
  actor_user_id uuid default auth.uid() references auth.users(id),
  error_name text not null,
  message text not null,
  route text not null default '',
  stack text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists app_errors_created_idx on public.app_errors(created_at desc);

create table if not exists public.onboarding_progress (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  completed_at timestamptz,
  current_step integer not null default 0,
  primary key (company_id,user_id)
);

create table if not exists public.accounting_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_type text not null check (source_type in ('invoice','expense')),
  source_id text not null,
  document_date date not null,
  category text not null default '',
  description text not null,
  counterparty text not null default '',
  amount numeric(12,2) not null,
  status text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(company_id,source_type,source_id)
);

alter table public.companies enable row level security;
alter table public.memberships enable row level security;
alter table public.technician_presence enable row level security;
alter table public.tickets enable row level security;
alter table public.suppliers enable row level security;
alter table public.category_budgets enable row level security;
alter table public.reply_templates enable row level security;
alter table public.audit_events enable row level security;
alter table public.app_errors enable row level security;
alter table public.onboarding_progress enable row level security;
alter table public.accounting_entries enable row level security;

create policy companies_read_member on public.companies for select to authenticated using (private.is_company_member(id));
create policy companies_update_manager on public.companies for update to authenticated using (private.has_capability(id,'manageCompany')) with check (private.has_capability(id,'manageCompany'));
create policy memberships_read_company on public.memberships for select to authenticated using (user_id = (select auth.uid()) or private.has_capability(company_id,'managePeople'));
create policy memberships_update_manager on public.memberships for update to authenticated using (private.has_capability(company_id,'managePeople')) with check (private.has_capability(company_id,'managePeople'));
create policy presence_read_member on public.technician_presence for select to authenticated using (private.is_company_member(company_id));
create policy presence_update_self on public.technician_presence for update to authenticated using (user_id = (select auth.uid()) and private.is_company_member(company_id)) with check (user_id = (select auth.uid()) and private.is_company_member(company_id));
create policy presence_insert_self on public.technician_presence for insert to authenticated with check (user_id = (select auth.uid()) and private.is_company_member(company_id));
create policy tickets_read_member on public.tickets for select to authenticated using (private.is_company_member(company_id));
create policy tickets_insert_requester on public.tickets for insert to authenticated with check (private.is_company_member(company_id) and requester_user_id = (select auth.uid()));
create policy tickets_update_allowed on public.tickets for update to authenticated using (private.has_capability(company_id,'manageTickets') or requester_user_id = (select auth.uid()) or assignee_user_id = (select auth.uid())) with check (private.is_company_member(company_id));
create policy suppliers_read_member on public.suppliers for select to authenticated using (private.is_company_member(company_id));
create policy suppliers_write_manager on public.suppliers for all to authenticated using (private.has_capability(company_id,'manageStock')) with check (private.has_capability(company_id,'manageStock'));
create policy budgets_read_costs on public.category_budgets for select to authenticated using (private.has_capability(company_id,'viewCosts'));
create policy budgets_write_costs on public.category_budgets for all to authenticated using (private.has_capability(company_id,'viewCosts')) with check (private.has_capability(company_id,'viewCosts'));
create policy replies_read_member on public.reply_templates for select to authenticated using (private.is_company_member(company_id));
create policy replies_write_manager on public.reply_templates for all to authenticated using (private.has_capability(company_id,'manageTickets')) with check (private.has_capability(company_id,'manageTickets'));
create policy audit_read_manager on public.audit_events for select to authenticated using (private.has_capability(company_id,'clearLogs'));
create policy audit_insert_member on public.audit_events for insert to authenticated with check (private.is_company_member(company_id) and actor_user_id = (select auth.uid()));
create policy errors_insert_member on public.app_errors for insert to authenticated with check (company_id is null or private.is_company_member(company_id));
create policy errors_read_manager on public.app_errors for select to authenticated using (company_id is not null and private.has_capability(company_id,'clearLogs'));
create policy onboarding_own_read on public.onboarding_progress for select to authenticated using (user_id = (select auth.uid()) and private.is_company_member(company_id));
create policy onboarding_own_write on public.onboarding_progress for all to authenticated using (user_id = (select auth.uid()) and private.is_company_member(company_id)) with check (user_id = (select auth.uid()) and private.is_company_member(company_id));
create policy accounting_read_costs on public.accounting_entries for select to authenticated using (private.has_capability(company_id,'viewCosts'));
create policy accounting_write_costs on public.accounting_entries for all to authenticated using (private.has_capability(company_id,'viewCosts')) with check (private.has_capability(company_id,'viewCosts'));

grant select, update on public.companies to authenticated;
grant select, update on public.memberships to authenticated;
grant select, insert, update on public.technician_presence to authenticated;
grant select, insert, update on public.tickets to authenticated;
grant select, insert, update, delete on public.suppliers, public.category_budgets, public.reply_templates, public.onboarding_progress, public.accounting_entries to authenticated;
grant select, insert on public.audit_events, public.app_errors to authenticated;

-- Inicialização controlada: só cria workspace para o usuário autenticado da chamada.
create or replace function public.bootstrap_company(p_name text, p_display_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_company_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if char_length(trim(p_name)) < 2 or char_length(trim(p_display_name)) < 2 then raise exception 'company and user names are required'; end if;
  insert into public.companies(name) values (trim(p_name)) returning id into v_company_id;
  insert into public.memberships(company_id,user_id,display_name,role) values (v_company_id,(select auth.uid()),trim(p_display_name),'Dono da empresa');
  return v_company_id;
end;
$$;
revoke all on function public.bootstrap_company(text,text) from public, anon;
grant execute on function public.bootstrap_company(text,text) to authenticated;

-- Seleciona um técnico explicitamente disponível com menor carga; desempata aleatoriamente.
create or replace function public.assign_ticket(p_company_id uuid, p_ticket_id text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_assignee uuid; v_requester uuid;
begin
  if (select auth.uid()) is null or not private.is_company_member(p_company_id) then raise exception 'company access denied'; end if;
  select requester_user_id into v_requester from public.tickets where company_id=p_company_id and id=p_ticket_id for update;
  if v_requester is null then raise exception 'ticket not found'; end if;
  if v_requester <> (select auth.uid()) and not private.has_capability(p_company_id,'claimTickets') then raise exception 'assignment not allowed'; end if;
  select m.user_id into v_assignee from public.memberships m
  join public.technician_presence p on p.company_id=m.company_id and p.user_id=m.user_id
  where m.company_id=p_company_id and m.role='TI' and p.available
    and (select count(*) from public.tickets t where t.company_id=p_company_id and t.assignee_user_id=m.user_id and t.status <> 'Resolvido') < p.max_active_tickets
  order by (select count(*) from public.tickets t where t.company_id=p_company_id and t.assignee_user_id=m.user_id and t.status <> 'Resolvido'), random()
  limit 1 for update skip locked;
  update public.tickets set assignee_user_id=v_assignee, assignment_status=case when v_assignee is null then 'unassigned' else 'pending_acceptance' end, updated_at=now()
    where company_id=p_company_id and id=p_ticket_id and status <> 'Resolvido';
  return v_assignee;
end;
$$;
revoke all on function public.assign_ticket(uuid,text) from public, anon;
grant execute on function public.assign_ticket(uuid,text) to authenticated;

create or replace function public.respond_to_ticket_assignment(p_company_id uuid,p_ticket_id text,p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not private.is_company_member(p_company_id) then raise exception 'company access denied'; end if;
  update public.tickets set
    assignment_status=case when p_accept then 'accepted' else 'declined' end,
    assignee_user_id=case when p_accept then (select auth.uid()) else null end,
    status=case when p_accept then 'Em processamento' else 'Aberto' end,
    updated_at=now()
  where company_id=p_company_id and id=p_ticket_id and assignee_user_id=(select auth.uid()) and assignment_status='pending_acceptance';
  if not found then raise exception 'assignment not found'; end if;
  if not p_accept then perform public.assign_ticket(p_company_id,p_ticket_id); end if;
end;
$$;
revoke all on function public.respond_to_ticket_assignment(uuid,text,boolean) from public, anon;
grant execute on function public.respond_to_ticket_assignment(uuid,text,boolean) to authenticated;

comment on table public.accounting_entries is 'Normalized invoice and expense rows for generic accounting CSV export.';
comment on table public.app_errors is 'Sanitized frontend diagnostics; do not store user input, credentials, or PII.';
