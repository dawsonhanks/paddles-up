-- Block direct Data API access to PostGIS system catalog objects in public.
-- REVOKE/RLS on spatial_ref_sys requires supabase_admin (PostGIS-owned table);
-- this pre-request hook enforces the same restriction at the API layer.

CREATE OR REPLACE FUNCTION public.block_postgis_system_api_access()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req_path text := current_setting('request.path', true);
BEGIN
  IF req_path IN ('/spatial_ref_sys', '/geometry_columns', '/geography_columns') THEN
    RAISE sqlstate 'PGRST' USING
      message = json_build_object(
        'code', '42501',
        'message', 'Forbidden',
        'details', 'Direct access to PostGIS system objects is not allowed'
      )::text,
      detail = json_build_object(
        'status', 403,
        'headers', json_build_object()
      )::text;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.block_postgis_system_api_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.block_postgis_system_api_access() TO anon, authenticated, service_role, authenticator;

ALTER ROLE authenticator
  SET pgrst.db_pre_request = 'public.block_postgis_system_api_access';

NOTIFY pgrst, 'reload config';
