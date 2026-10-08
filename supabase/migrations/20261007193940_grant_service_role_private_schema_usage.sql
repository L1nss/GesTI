-- The first-login Edge Function uses the service role for RPCs whose
-- implementations are isolated in the non-exposed private schema.
grant usage on schema private to service_role;
