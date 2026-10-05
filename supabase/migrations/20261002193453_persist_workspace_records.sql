create table if not exists public.workspace_records (
  company_id uuid not null references public.companies(id) on delete cascade,
  entity_type text not null check (entity_type in ('clients','inventory','services','expenses','invoices','movements')),
  entity_id text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id,entity_type,entity_id)
);
create index if not exists workspace_records_company_type_idx on public.workspace_records(company_id,entity_type);
alter table public.workspace_records enable row level security;

create policy workspace_records_read on public.workspace_records for select to authenticated
using (
  private.is_company_member(company_id) and case entity_type
    when 'clients' then private.has_capability(company_id,'manageClients')
    when 'inventory' then private.has_capability(company_id,'manageStock')
    when 'services' then private.has_capability(company_id,'manageServices')
    when 'expenses' then private.has_capability(company_id,'viewCosts')
    when 'invoices' then private.has_capability(company_id,'viewCosts') or private.has_capability(company_id,'claimTickets')
    when 'movements' then private.has_capability(company_id,'manageStock')
    else false end
);
create policy workspace_records_insert on public.workspace_records for insert to authenticated
with check (
  private.is_company_member(company_id) and updated_by=(select auth.uid()) and case entity_type
    when 'clients' then private.has_capability(company_id,'manageClients')
    when 'inventory' then private.has_capability(company_id,'manageStock')
    when 'services' then private.has_capability(company_id,'manageServices')
    when 'expenses' then private.has_capability(company_id,'viewCosts')
    when 'invoices' then private.has_capability(company_id,'viewCosts') or private.has_capability(company_id,'claimTickets')
    when 'movements' then private.has_capability(company_id,'manageStock')
    else false end
);
create policy workspace_records_update on public.workspace_records for update to authenticated
using (
  private.is_company_member(company_id) and case entity_type
    when 'clients' then private.has_capability(company_id,'manageClients')
    when 'inventory' then private.has_capability(company_id,'manageStock')
    when 'services' then private.has_capability(company_id,'manageServices')
    when 'expenses' then private.has_capability(company_id,'viewCosts')
    when 'invoices' then private.has_capability(company_id,'viewCosts') or private.has_capability(company_id,'claimTickets')
    when 'movements' then private.has_capability(company_id,'manageStock')
    else false end
) with check (private.is_company_member(company_id) and updated_by=(select auth.uid()));
create policy workspace_records_delete on public.workspace_records for delete to authenticated
using (
  private.is_company_member(company_id) and case entity_type
    when 'clients' then private.has_capability(company_id,'manageClients')
    when 'inventory' then private.has_capability(company_id,'manageStock')
    when 'services' then private.has_capability(company_id,'manageServices')
    when 'expenses' then private.has_capability(company_id,'viewCosts')
    when 'invoices' then private.has_capability(company_id,'viewCosts') or private.has_capability(company_id,'claimTickets')
    when 'movements' then private.has_capability(company_id,'manageStock')
    else false end
);
grant select,insert,update,delete on public.workspace_records to authenticated;
comment on table public.workspace_records is 'Company-scoped JSON payloads for core GesTI modules without exposing local auth material.';
