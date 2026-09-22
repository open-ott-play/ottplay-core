const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/provenance.json'), 'utf8'));
for (const [name, expected] of Object.entries(manifest.files)) {
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex'), expected, name + ' has changed');
}
for (const file of fs.readdirSync(path.join(root, 'src'))) {
    const code = fs.readFileSync(path.join(root, 'src', file), 'utf8');
    assert(!/stbPlayer\.js|\.\.\/ottplay-foss\//.test(code), 'Runtime must not depend on old player: ' + file);
}
console.log('PASS: ' + Object.keys(manifest.files).length + ' resource hashes; independent runtime');
