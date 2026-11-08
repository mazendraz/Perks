-- PostgreSQL row locks require UPDATE privilege even when the command only reads.
-- Business mutations still pass through explicit authorization and RLS.
GRANT UPDATE(status) ON memberships TO nuqta_runtime;
