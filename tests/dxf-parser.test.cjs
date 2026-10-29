const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(new URL('../index.html', `file://${__filename}`), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
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


// Build a tiny stored ZIP archive so the LXDS parser is tested without publishing
// customer drawings or adding third-party test dependencies.
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function storedZip(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, nameBytes);
    localOffset += local.length + nameBytes.length + data.length;
  }
  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, central, end]);
}

async function testSyntheticCypCutArchive() {
  const archiveGeometry = Buffer.alloc(128);
  archiveGeometry.writeDoubleLE(7, 84); // Circle radius at the parser's GeoAddr offset.
  const archive = storedZip({
    'Shapes2D/content.xml': '<Shapes><Circle Handle="C1" GeoAddr="0"/></Shapes>',
    'Model2D/content.xml': '<Model><Shape Class="Circle" Handle="C1"/></Model>',
    'Geometry2D/data.bin': archiveGeometry,
  });
  const unzipStart = html.indexOf('async function unzipEntries(buffer){');
  const unzipEnd = html.indexOf('function speed(', unzipStart);
  assert.ok(unzipStart >= 0 && unzipEnd > unzipStart, 'LXDS parser functions must exist');
  const cypSource = html.slice(unzipStart, unzipEnd) + '\nthis.readCypFile = readCypFile;';
  const cypContext = { TextDecoder, Uint8Array, DataView, Blob, Response, DecompressionStream };
  vm.runInNewContext(cypSource, cypContext);
  const item = {
    file: { arrayBuffer: async () => archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) },
  };
  await cypContext.readCypFile(item);
  assert.equal(item.parseError, undefined, item.parseError || 'LXDS parser should not report an error');
  assert.ok(item.geometry, 'LXDS parser should produce geometry');
  assert.ok(Math.abs(item.geometry.length - 2 * Math.PI * 7) < 1e-6,
    `LXDS circle length: expected ${2 * Math.PI * 7}, got ${item.geometry.length}`);
  assert.equal(item.geometry.entities, 1);
  console.log('PASS synthetic CypCut/LXDS ZIP import');

  const nestedGeometry = Buffer.alloc(256);
  nestedGeometry.writeUInt32LE(1, 80);
  nestedGeometry.writeUInt32LE(4, 84);
  [[0, 0], [10, 0], [10, 5], [0, 5]].forEach(([x, y], index) => {
    const offset = 88 + index * 32;
    nestedGeometry.writeDoubleLE(x, offset + 4);
    nestedGeometry.writeDoubleLE(y, offset + 12);
    nestedGeometry.writeDoubleLE(0, offset + 20);
  });
  const nestedArchive = storedZip({
    'Shapes2D/content.xml': '<Shapes><LwPolyline Handle="P1" GeoAddr="0"/></Shapes>',
    'Nest2D/Parts/content.xml': '<Parts><NestPart AmountUsed="2"><Shape Handle="P1"/></NestPart></Parts>',
    'Blocks/content.xml': '<Blocks/>',
    'Geometry2D/data.bin': nestedGeometry,
  });
  const nestedItem = {
    file: { arrayBuffer: async () => nestedArchive.buffer.slice(nestedArchive.byteOffset, nestedArchive.byteOffset + nestedArchive.byteLength) },
  };
  await cypContext.readCypFile(nestedItem);
  assert.equal(nestedItem.parseError, undefined, nestedItem.parseError || 'Nested CypNest parser should not report an error');
  assert.ok(nestedItem.geometry, 'Nested CypNest parser should produce geometry');
  assert.ok(Math.abs(nestedItem.geometry.length - 60) < 1e-6,
    `CypNest quantity length: expected 60, got ${nestedItem.geometry.length}`);
  assert.equal(nestedItem.geometry.entities, 2);
  console.log('PASS synthetic CypNest nested parts and quantity');
}

testSyntheticCypCutArchive().then(() => {
  console.log('PASS all parser regression tests completed');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
