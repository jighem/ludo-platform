CREATE TABLE rate_limits (
 bucket CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 hits INT UNSIGNED NOT NULL, expires_at DATETIME(6) NOT NULL,
 INDEX(expires_at)
) ENGINE=InnoDB;
ALTER TABLE outbox_events ADD COLUMN lease_until DATETIME(6) NULL;
ALTER TABLE outbox_events ADD COLUMN last_error VARCHAR(250) NULL;
