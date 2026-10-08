-- Os RPCs públicos são SECURITY INVOKER e precisam executar os helpers protegidos.
grant execute on function private.activate_employee_first_login_impl() to authenticated;
grant execute on function private.complete_employee_password_setup_impl(uuid) to authenticated;
