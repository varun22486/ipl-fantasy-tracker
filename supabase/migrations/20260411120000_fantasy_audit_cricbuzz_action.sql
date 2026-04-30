-- Allow Cricbuzz fallback scorecard audit rows (debugging)
alter table fantasy_audit_events drop constraint if exists fantasy_audit_events_action_check;

alter table fantasy_audit_events
  add constraint fantasy_audit_events_action_check
  check (action in ('lineup_change', 'manual_score', 'cricbuzz_scorecard'));
