-- Reissue the artwork and field layout through the normal Wallet update workers.
UPDATE wallet_passes SET fingerprint = '';
UPDATE google_wallet_objects SET fingerprint = '';
