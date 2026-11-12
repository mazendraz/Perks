-- Wallet artwork now mirrors the merchant's card design: reissue every saved pass.
UPDATE wallet_passes SET fingerprint = '';
UPDATE google_wallet_objects SET fingerprint = '';
