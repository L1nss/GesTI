create index if not exists team_conversations_company_creator_idx
  on public.team_conversations(company_id, created_by);

create index if not exists team_group_messages_company_conversation_sender_idx
  on public.team_group_messages(company_id, conversation_id, sender_user_id);
