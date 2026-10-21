#!/bin/bash
# Parse DATABASE_URL from /var/www/mavrion-api/.env into PG* vars.
# Password may contain un-encoded '@' — split on the LAST '@'.
DB_URL=$(grep -E '^DATABASE_URL=' /var/www/mavrion-api/.env | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
proto_removed=${DB_URL#*://}
hostpart=${proto_removed##*@}
userpass=${proto_removed%@"$hostpart"}
export PGUSER=${userpass%%:*}
export PGPASSWORD=${userpass#*:}
hostport=${hostpart%%/*}
dbq=${hostpart#*/}
export PGDATABASE=${dbq%%\?*}
export PGHOST=${hostport%%:*}
port=${hostport##*:}
[ "$port" = "$hostport" ] && port=5432
export PGPORT=$port
