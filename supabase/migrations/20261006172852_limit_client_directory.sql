-- O diretório de clientes inclui dados pessoais e não é necessário ao perfil Funcionário.
drop policy if exists workspace_records_read on public.workspace_records;
create policy workspace_records_read on public.workspace_records for select to authenticated
using (
  private.is_company_member(company_id) and case entity_type
    when 'clients' then private.has_capability(company_id,'manageClients') or private.has_capability(company_id,'claimTickets')
    when 'inventory' then private.has_capability(company_id,'manageStock')
    when 'services' then private.has_capability(company_id,'manageServices')
    when 'expenses' then private.has_capability(company_id,'viewCosts')
    when 'invoices' then private.has_capability(company_id,'viewCosts') or private.has_capability(company_id,'claimTickets')
    when 'movements' then private.has_capability(company_id,'manageStock')
    else false end
);
