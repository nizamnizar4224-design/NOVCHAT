/*
# Enable scheduler extensions

Plain-English summary
Turns on the two built-in Postgres helpers that let the database wake up the pipeline on a timer
and send web requests to it.

1. Extensions
- `pg_cron`: runs a database job on a schedule (every minute here).
- `pg_net`: sends HTTP requests from inside the database.

2. Security
- No table or policy changes. The scheduled job reads its secret from a server-only table.

3. Important Notes
- Safe to re-run; both statements are idempotent.
*/

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;
