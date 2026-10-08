-- Removes expired group-chat threads and dependent membership/message rows.
select cron.schedule(
  'gesti-group-chat-retention',
  '17 3 * * *',
  $job$delete from public.team_conversations where created_at < now() - interval '3 months';$job$
);
