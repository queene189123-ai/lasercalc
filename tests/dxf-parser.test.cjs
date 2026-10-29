const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(new URL('../index.html', `file://${__filename}`), 'utf8');
const scriptMatch = html.match(/<script>([\\s\\S]*?)<\\/script>/);
assert.ok(scriptMatch, 'main script must exist');
assert.doesNotThrow(() => new vm.Script(scriptMatch[1]), 'main script must have valid JavaScript syntax');
console.log('PASS main script syntax');
const start = html.indexOf('function parseDxf(text){');
const end = html.indexOf('async function unzipEntries(buffer){', start);
assert.ok(start >= 0 && end > start, 'parseDxf function must exist in index.html');

const parserSource = html.slice(start, end) + '\nthis.parseDxf = parseDxf;';
const context = {};
vm.runInNewContext(parserSource, context);
const parseDxf = context.parseDxf;

const fixtures = [
  {
    name: 'LINE uses Euclidean length',
    dxf: '0\nSECTION\n2\nENTITIES\n0\nLINE\n10\n0\n20\n0\n11\n3\n21\n4\n0\nENDSEC\n0\nEOF',
    length: 5,
    entities: 1,
  },
  {
    name: 'CIRCLE circumference',
    dxf: '0\nSECTION\n2\nENTITIES\n0\nCIRCLE\n10\n0\n20\n0\n40\n7\n0\nENDSEC\n0\nEOF',
    length: 2 * Math.PI * 7,
    entities: 1,
  },
  {
    name: 'ARC quarter circumference',
    dxf: '0\nSECTION\n2\nENTITIES\n0\nARC\n10\n0\n20\n0\n40\n10\n50\n0\n51\n90\n0\nENDSEC\n0\nEOF',
    length: 5 * Math.PI,
    entities: 1,
  },
  {
    name: 'closed rectangular LWPOLYLINE',
    dxf: '0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n90\n4\n70\n1\n10\n0\n20\n0\n10\n10\n20\n0\n10\n10\n20\n5\n10\n0\n20\n5\n0\nENDSEC\n0\nEOF',
    length: 30,
    entities: 1,
  },
  {
    name: 'LWPOLYLINE bulge semicircle',
    dxf: '0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n90\n2\n70\n0\n10\n0\n20\n0\n42\n1\n10\n10\n20\n0\n0\nENDSEC\n0\nEOF',
    length: 5 * Math.PI,
    entities: 1,
  },
  {
    name: 'ignores geometry in BLOCKS section',
    dxf: '0\nSECTION\n2\nBLOCKS\n0\nLINE\n10\n0\n20\n0\n11\n100\n21\n0\n0\nENDBLK\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLINE\n10\n0\n20\n0\n11\n3\n21\n4\n0\nENDSEC\n0\nEOF',
    length: 5,
    entities: 1,
  },
];

for (const test of fixtures) {
  const actual = parseDxf(test.dxf);
  assert.ok(Math.abs(actual.length - test.length) < 1e-6,
    `${test.name}: expected ${test.length}, got ${actual.length}`);
  assert.equal(actual.entities, test.entities, `${test.name}: entity count`);
  console.log(`PASS ${test.name}`);
}
console.log(`\\n${fixtures.length} DXF parser regression tests passed.`);
