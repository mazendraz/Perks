import forge from 'node-forge';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Test-only stand-ins for Apple's WWDR CA and a Pass Type ID certificate.
export function testWalletCertificates(passTypeId: string) {
  const dir = mkdtempSync(join(tmpdir(), 'perks-wallet-'));
  const caKeys = forge.pki.rsa.generateKeyPair(2048),
    passKeys = forge.pki.rsa.generateKeyPair(2048);
  const ca = forge.pki.createCertificate();
  ca.publicKey = caKeys.publicKey;
  ca.serialNumber = '01';
  ca.validity.notBefore = new Date(Date.now() - 86400000);
  ca.validity.notAfter = new Date(Date.now() + 86400000 * 30);
  const caName = [{ name: 'commonName', value: 'Test WWDR CA' }];
  ca.setSubject(caName);
  ca.setIssuer(caName);
  ca.setExtensions([{ name: 'basicConstraints', cA: true }]);
  ca.sign(caKeys.privateKey, forge.md.sha256.create());
  const pass = forge.pki.createCertificate();
  pass.publicKey = passKeys.publicKey;
  pass.serialNumber = '02';
  pass.validity.notBefore = ca.validity.notBefore;
  pass.validity.notAfter = ca.validity.notAfter;
  pass.setSubject([
    { type: '0.9.2342.19200300.100.1.1', value: passTypeId },
    { name: 'commonName', value: 'Pass Type ID: ' + passTypeId },
  ]);
  pass.setIssuer(caName);
  pass.sign(caKeys.privateKey, forge.md.sha256.create());
  const files = {
    APPLE_PASS_CERT_FILE: join(dir, 'pass.cer'),
    APPLE_PASS_KEY_FILE: join(dir, 'pass.key'),
    APPLE_WWDR_CERT_FILE: join(dir, 'wwdr.pem'),
  };
  // Apple hands out DER certificates; exercise that path for the pass certificate.
  writeFileSync(
    files.APPLE_PASS_CERT_FILE,
    Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(pass)).getBytes(), 'binary'),
  );
  writeFileSync(files.APPLE_PASS_KEY_FILE, forge.pki.privateKeyToPem(passKeys.privateKey), {
    mode: 0o600,
  });
  writeFileSync(files.APPLE_WWDR_CERT_FILE, forge.pki.certificateToPem(ca));
  return { dir, files };
}
