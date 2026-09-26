ALTER TABLE outbox_event ADD COLUMN next_attempt_at timestamptz;
ALTER TABLE outbox_event ADD COLUMN lease_until timestamptz;
ALTER TABLE outbox_event ADD COLUMN lease_token uuid;
ALTER TABLE outbox_event ADD COLUMN last_error_code text;

CREATE INDEX outbox_dispatch_idx ON outbox_event(next_attempt_at,occurred_at,id)
  WHERE published_at IS NULL;
