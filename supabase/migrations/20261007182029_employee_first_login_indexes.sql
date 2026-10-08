create index if not exists employee_first_login_company_role_idx
  on public.employee_first_login_requests(company_id, role);
create index if not exists employee_first_login_created_by_idx
  on public.employee_first_login_requests(created_by);
