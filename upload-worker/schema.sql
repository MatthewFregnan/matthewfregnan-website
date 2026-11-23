-- Anonymous page views for the admin's Traffic page. No cookies, no IP addresses, nothing that
-- identifies a person: `visit` is a random ID that only lives for one browser tab session.
CREATE TABLE IF NOT EXISTS views (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      INTEGER NOT NULL,          -- when (ms since 1970, UTC)
  visit   TEXT    NOT NULL,          -- random per-tab visit ID
  seq     INTEGER NOT NULL,          -- 1 = first page of the visit, 2 = second, ...
  path    TEXT    NOT NULL,          -- e.g. /social/kia-shipyard/
  source  TEXT,                      -- where the visit came from (first page only): LinkedIn, Google, ...
  country TEXT,                      -- two-letter country code from Cloudflare
  device  TEXT,                      -- phone / tablet / computer
  secs    INTEGER,                   -- seconds spent on the page (filled in when they leave it)
  city    TEXT                       -- rough location from Cloudflare (e.g. Melbourne); the IP is never stored
);
-- Added later; on an existing database run:  ALTER TABLE views ADD COLUMN city TEXT;
CREATE INDEX IF NOT EXISTS views_ts ON views (ts);
CREATE INDEX IF NOT EXISTS views_visit ON views (visit, seq);

-- Messages sent with the contact form on the site (shown in the admin's Inbox, and emailed). `who` is a
-- one-way fingerprint of the sender's connection that changes daily, only used to limit how many
-- messages one sender can send in an hour; the IP address itself is never stored.
CREATE TABLE IF NOT EXISTS messages (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      INTEGER NOT NULL,          -- when (ms since 1970, UTC)
  name    TEXT    NOT NULL,
  email   TEXT    NOT NULL,
  message TEXT    NOT NULL,
  page    TEXT,                      -- the page they sent it from
  country TEXT,
  city    TEXT,
  device  TEXT,
  who     TEXT,
  read    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS messages_ts ON messages (ts);
CREATE INDEX IF NOT EXISTS messages_who ON messages (who, ts);
