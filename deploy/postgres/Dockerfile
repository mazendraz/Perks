FROM postgres:17-trixie
RUN apt-get update && apt-get install -y --no-install-recommends pgbackrest restic python3 \
    && rm -rf /var/lib/apt/lists/* \
    && install -d -o postgres -g postgres -m 700 /var/lib/pgbackrest \
    && install -d -o postgres -g postgres -m 755 /var/lib/nuqta-backup-state \
    && install -d -o postgres -g postgres -m 700 /var/lib/nuqta-restore \
    && install -d -o 1000 -g 1000 -m 700 /var/lib/restic /var/lib/nuqta-file-backup-state /var/lib/nuqta/files
COPY deploy/postgres/postgresql.conf /etc/nuqta/postgresql.conf
COPY deploy/postgres/pgbackrest.conf /etc/pgbackrest/pgbackrest.conf
COPY deploy/backup /opt/nuqta-backup
COPY deploy/restore-drill.sh /opt/nuqta-backup/restore-drill.sh
