import assert from 'node:assert/strict';
import test from 'node:test';
import { findIntentHashKeying, scanRepo } from './check-intent-hash-keying.mjs';

const triggers = [
  ...[
    'updateOne',
    'updateMany',
    'replaceOne',
    'findOneAndUpdate',
    'findOneAndReplace',
    'findOneAndDelete',
    'deleteOne',
    'deleteMany',
    'findOne',
    'upsert',
  ].flatMap(method => [
    `db.${method}({ intentHash });`,
    `db.${method}({ intentHash: value }, update);`,
    `db.${method}(\n{ intent_hash: value, }\n);`,
  ]),
  ...['createIndex', 'ensureIndex'].map(method => `db.${method}({ intentHash: 1 }, { unique: true });`),
  ...['set', 'get', 'has', 'delete'].flatMap(method => [
    `cache.${method}(intentHash${method === 'set' ? ', value' : ''});`,
    `cache.${method}(item.intentHash${method === 'set' ? ', value' : ''});`,
  ]),
  'new Map(xs.map(x => [x.intentHash, x]));',
  'new WeakMap(xs.map((x) => [x.intentHash, x]));',
  'new Set(xs.map(x => x.intentHash));',
  ...['uniqBy', 'keyBy', 'groupBy', 'dedupe'].flatMap(method => [
    `${method}(xs, 'intentHash');`,
    `${method}(xs, x => x.intentHash);`,
    `${method}(xs, (x) => x.intentHash);`,
  ]),
  'obj[intentHash] = value;',
  'obj[x.intentHash] = value;',
  'db.findOne({ intent_hash });',
  'cache.get(x.intent_hash);',
];
for (const source of triggers) {
  test(`flags ${source}`, () => {
    const hits = findIntentHashKeying(source);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].line, 1);
    assert.equal(hits[0].text, source.split('\n')[0]);
    assert.ok(hits[0].rule);
  });
}

const safe = [
  'db.findOne({ intentHash, open: true });',
  'db.updateOne({ intentHash: x, open }, update);',
  'db.deleteOne({ txHash, logIndex });',
  `cache.set(\`${'${'}intentHash}:${'${'}open}\`, value);`,
  'cache.get([intentHash, open]);',
  'new Map(xs.map(x => [[x.intentHash, x.open], x]));',
  `new Set(xs.map(x => \`${'${'}x.intentHash}:${'${'}x.open}\`));`,
  'db.createIndex({ intentHash: 1, open: 1 }, { unique: true });',
  'db.createIndex({ txHash: 1, logIndex: 1 }, { unique: true });',
  'db.createIndex({ intentHash: 1 }, { unique: false });',
  `uniqBy(xs, x => \`${'${'}x.intentHash}:${'${'}x.open}\`);`,
  `obj[\`${'${'}intentHash}:${'${'}open}\`] = value;`,
  `fetch(\`/intent/${'${'}intentHash}\`); getIntentByHash(intentHash); console.log(intentHash);`,
  'useQuery({ queryKey: ["intent", intentHash] });',
  '// cache.get(intentHash);\n/* db.findOne({ intentHash }); */',
  'const example = "cache.get(intentHash)";',
  'obj[intentHash] === value;',
];
for (const source of safe) {
  test(`allows ${source}`, () => assert.deepEqual(findIntentHashKeying(source), []));
}

test('strips comments without losing lines or treating URLs as comments', () => {
  const source =
    '/* ignored\ncache.get(intentHash); */\nconst url = "https://example.org"; cache.get(/* key */ intentHash);';
  assert.deepEqual(findIntentHashKeying(source), [{ line: 3, rule: 'collection-key', text: source.split('\n')[2] }]);
});

test('suppression on the same or preceding line requires a reason', () => {
  const call = 'cache.get(intentHash);';
  for (const comment of [
    '// sodax-allow-intenthash-key: scoped lifetime',
    '/* sodax-allow-intenthash-key: scoped lifetime */',
  ]) {
    assert.deepEqual(findIntentHashKeying(`${call} ${comment}`), []);
    assert.deepEqual(findIntentHashKeying(`${comment}\n${call}`), []);
  }
  for (const source of [
    `${call} // sodax-allow-intenthash-key:`,
    `${call} /* sodax-allow-intenthash-key: */`,
    `// sodax-allow-intenthash-key:   \n${call}`,
    `// sodax-allow-intenthash-key: scoped lifetime\n\n${call}`,
  ])
    assert.equal(findIntentHashKeying(source).length, 1);
});

test('repository has no intentHash-only keying', () => {
  const result = scanRepo();
  assert.ok(result.filesScanned > 0);
  assert.deepEqual(result.violations, []);
});
