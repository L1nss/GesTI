-- Mantém o cliente relacionado e a origem da prioridade ao criar o chamado.
create or replace function private.prepare_ticket_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_actor text; v_text text; v_hours integer; v_customer text; v_customer_id text; v_manual boolean;
begin
  if (select auth.uid()) is null or new.requester_user_id <> (select auth.uid())
    or not private.is_company_member(new.company_id) then raise exception 'ticket creation denied'; end if;
  if char_length(trim(new.title)) not between 1 and 100 or char_length(new.description) > 500 then raise exception 'invalid ticket text'; end if;
  v_text := lower(new.title || ' ' || new.description);
  v_manual := private.has_capability(new.company_id,'claimTickets') and new.details->>'prioritySource'='manual';
  if not private.has_capability(new.company_id,'claimTickets') then
    new.priority := case
      when v_text ~ '(servidor|indisponível|indisponivel|fora do ar|não liga|nao liga|perda de dados|sem internet|ransomware|invasão|invasao|roubo|urgente|parado|sem acesso|bloqueado|caiu)' then 'Urgente'
      when v_text ~ '(não conecta|nao conecta|wi-fi|wifi|rede|impressora|monitor|teclado|mouse|notebook|computador|lento|travando|quebrado|queimado|sem imagem|não abre|nao abre|erro|falha|vírus|virus|não imprime|nao imprime)' then 'Alta'
      when v_text ~ '(atualização|atualizacao|instalar|instalação|instalacao|dúvida|duvida|melhoria|sugestão|sugestao|agendar|quando puder|rotina|backup|limpeza|consulta|pesquisa)' then 'Baixa'
      else 'Alta' end;
  end if;
  v_hours := case new.priority when 'Urgente' then 4 when 'Alta' then 8 when 'Baixa' then 40 else null end;
  if v_hours is null then raise exception 'invalid priority'; end if;
  select display_name into v_actor from public.memberships where company_id=new.company_id and user_id=(select auth.uid());
  v_customer := left(trim(coalesce(new.details->>'customerName',v_actor)),160);
  v_customer_id := nullif(new.details->>'customerId','');
  if v_customer_id is not null and not exists(select 1 from public.workspace_records
    where company_id=new.company_id and entity_type='clients' and entity_id=v_customer_id) then v_customer_id := null; end if;
  new.status := 'Aberto'; new.assignee_user_id := null; new.assignment_status := 'unassigned';
  new.created_at := now(); new.updated_at := new.created_at; new.due_at := new.created_at+(v_hours || ' hours')::interval;
  new.details := jsonb_build_object('customerName',v_customer,'customerId',v_customer_id,
    'prioritySource',case when v_manual then 'manual' else 'auto' end,
    'priorityBy',case when v_manual then v_actor else 'Sistema' end,
    'history',jsonb_build_array(jsonb_build_object('status','Aberto','person',v_actor,'date',new.created_at,'note','Chamado criado.')));
  return new;
end;
$$;
grant insert (details) on public.tickets to authenticated;
