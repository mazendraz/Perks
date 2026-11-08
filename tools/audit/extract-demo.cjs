// Read-only extraction of the original standalone exports. No application code is rewritten.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'docs/execution/evidence/extracted');
fs.mkdirSync(out, { recursive: true });
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const inventory = [];
for (const file of fs.readdirSync(path.join(root, 'standalone')).filter(f => f.endsWith('.html')).sort()) {
  const original = fs.readFileSync(path.join(root, 'standalone', file));
  const html = original.toString('utf8');
  const read = type => {
    const match = html.match(new RegExp('<script type="__bundler/' + type + '">\\s*([\\s\\S]*?)\\s*</script>'));
    if (!match) throw new Error(`${file}: missing ${type}`);
    return JSON.parse(match[1]);
  };
  const name = file.replace('Nuqta - ', '').replace('.html', '').toLowerCase().replaceAll(' ', '-');
  const template = read('template');
  fs.writeFileSync(path.join(out, name + '.template.html'), template);
  const application = [...template.matchAll(/<script[^>]*type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
  fs.writeFileSync(path.join(out, name + '.app.js'), application);
  const resources = read('ext_resources');
  const assets = [];
  for (const [uuid, entry] of Object.entries(read('manifest'))) {
    const raw = Buffer.from(entry.data, 'base64');
    const bytes = entry.compressed ? zlib.gunzipSync(raw) : raw;
    const content = /javascript|html/.test(entry.mime) ? bytes.toString('utf8') : '';
    let extracted;
    if (content.startsWith('/* Nuqta demo')) extracted = 'mock-repository.js';
    if (content.startsWith('// GENERATED from dc-runtime')) extracted = 'dc-runtime.js';
    if (resources.find(r => r.uuid === uuid)?.id === './LoyaltyCard.dc.html') extracted = 'LoyaltyCard.dc.html';
    if (extracted) {
      const dest = path.join(out, extracted);
      if (fs.existsSync(dest) && hash(fs.readFileSync(dest)) !== hash(bytes)) throw new Error(`Divergent shared asset: ${extracted}`);
      fs.writeFileSync(dest, bytes);
    }
    assets.push({ uuid, mime: entry.mime, bytes: bytes.length, sha256: hash(bytes), source: resources.find(r => r.uuid === uuid)?.id, extracted });
  }
  inventory.push({ file: 'standalone/' + file, bytes: original.length, sha256: hash(original), template: name + '.template.html', application: name + '.app.js', assets });
}
fs.writeFileSync(path.join(out, '../inventory.json'), JSON.stringify(inventory, null, 2) + '\n');
console.log(JSON.stringify(inventory.map(({file,bytes,sha256,assets}) => ({file,bytes,sha256,assets:assets.length})), null, 2));
