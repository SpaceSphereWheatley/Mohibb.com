// encoding.test.js
// The Spotkick GAS data pipeline (AggregatePenalties.gs, StatsBombRebuild.gs)
// round-trips penalties.json through GitHub's base64-encoded Contents API.
// Apps Script globals (Utilities, UrlFetchApp) don't exist in Node, so these
// files can't be executed directly here. This test instead pins down the
// UTF-8 round-trip contract those functions must follow — encode a JS string
// as UTF-8 bytes before base64, decode the same way — using Node's Buffer as
// a stand-in for Utilities.base64Encode/base64Decode/Blob.getDataAsString.
// A charset mismatch (e.g. decoding UTF-8 bytes as latin1) reproduces the
// exact mojibake seen in the live data ("Víctor Valdés" -> "VÃ­ctor ValdÃ©s").
const test = require('node:test');
const assert = require('node:assert/strict');

const NAMES = [
  'Víctor Valdés Arribas',
  'Damián Emiliano Martínez',
  'Dominik Livaković',
  'Shūichi Gonda',
  'Unai Simón Mendibil',
  'Fabian Lukas Schär',
  'João Félix',
  'Ousmane Dembélé',
];

function encodeUtf8(jsonString) {
  return Buffer.from(jsonString, 'utf8').toString('base64');
}

function decodeUtf8(base64) {
  return Buffer.from(base64, 'base64').toString('utf8');
}

function decodeLatin1(base64) {
  return Buffer.from(base64, 'base64').toString('latin1');
}

test('UTF-8 encode -> UTF-8 decode round-trips non-ASCII names exactly', () => {
  for (const name of NAMES) {
    const payload = JSON.stringify({ taker: name });
    const roundTripped = JSON.parse(decodeUtf8(encodeUtf8(payload)));
    assert.equal(roundTripped.taker, name);
  }
});

test('decoding UTF-8-encoded bytes with the wrong charset corrupts non-ASCII names', () => {
  const name = 'Víctor Valdés';
  const encoded = encodeUtf8(JSON.stringify({ taker: name }));
  const corrupted = JSON.parse(decodeLatin1(encoded));
  assert.notEqual(corrupted.taker, name);
  assert.ok(corrupted.taker.includes('Ã'), 'expected latin1-on-utf8 mojibake pattern');
});

test('full penalties array of non-ASCII names survives an encode/decode cycle', () => {
  const original = NAMES.map(taker => ({ taker }));
  const roundTripped = JSON.parse(decodeUtf8(encodeUtf8(JSON.stringify(original))));
  assert.deepEqual(roundTripped, original);
});
