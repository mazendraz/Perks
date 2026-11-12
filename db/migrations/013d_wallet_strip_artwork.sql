-- New stamp strip artwork: reissue every saved pass through the normal Wallet update workers.
UPDATE wallet_passes SET fingerprint = '';
UPDATE google_wallet_objects SET fingerprint = '';
