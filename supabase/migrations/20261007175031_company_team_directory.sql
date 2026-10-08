create table if not exists public.company_directory (
  company_id uuid not null,
  user_id uuid not null,
  display_name text not null check(char_length(trim(display_name)) between 1 and 120),
  role text not null check(char_length(trim(role)) between 2 and 40),
  primary key(company_id,user_id),
  foreign key(company_id,user_id) references public.memberships(company_id,user_id) on delete cascade
);
alter table public.company_directory enable row level security;
revoke all on public.company_directory from anon,authenticated;
grant select on public.company_directory to authenticated;
create policy company_directory_read_member on public.company_directory for select to authenticated using(private.is_company_member(company_id));

create or replace function private.sync_company_directory()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.company_directory(company_id,user_id,display_name,role)
  values(new.company_id,new.user_id,new.display_name,new.role)
  on conflict(company_id,user_id) do update set display_name=excluded.display_name,role=excluded.role;
  return new;
end $$;
revoke all on function private.sync_company_directory() from public,anon,authenticated;
drop trigger if exists sync_company_directory_after_membership_write on public.memberships;
create trigger sync_company_directory_after_membership_write after insert or update of display_name,role on public.memberships
for each row execute function private.sync_company_directory();

insert into public.company_directory(company_id,user_id,display_name,role)
select company_id,user_id,display_name,role from public.memberships
on conflict(company_id,user_id) do update set display_name=excluded.display_name,role=excluded.role;
