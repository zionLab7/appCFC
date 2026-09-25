-- New events carry their author and correlation ID alongside the audit event.
-- Existing development rows remain nullable because they predate this migration.
ALTER TABLE outbox_event ADD COLUMN actor_user_id uuid REFERENCES app_user(id);
ALTER TABLE outbox_event ADD COLUMN correlation_id uuid;
