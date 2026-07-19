-- Track last motion detection separately from last_event_at.
-- last_event_at follows YoLink stateChangedAt (including transitions to 'normal');
-- last_motion_at is only advanced while the sensor reports state === 'alert'.
alter table public.court_sensors
  add column if not exists last_motion_at timestamptz;
