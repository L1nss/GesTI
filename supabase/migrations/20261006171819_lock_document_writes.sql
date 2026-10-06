-- Documentos demonstrativos devem passar pela transação de estoque.
create or replace function private.can_write_workspace_record(p_company_id uuid,p_type text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_company_member(p_company_id) and case p_type
    when 'clients' then private.has_capability(p_company_id,'manageClients')
    when 'inventory' then private.has_capability(p_company_id,'manageStock')
    when 'services' then private.has_capability(p_company_id,'manageServices')
    when 'expenses' then private.has_capability(p_company_id,'approve')
    when 'movements' then private.has_capability(p_company_id,'manageStock')
    else false end;
$$;
