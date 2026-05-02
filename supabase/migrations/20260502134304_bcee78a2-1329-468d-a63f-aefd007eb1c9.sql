-- Revoke public/anon access to SECURITY DEFINER helper functions.
-- Only authenticated users (and service_role) should be able to execute them.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.are_friends(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_blocked(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.shares_with(uuid, uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_trade(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.respond_to_trade(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mark_thread_read(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mark_message_read(uuid) FROM PUBLIC, anon;