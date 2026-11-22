import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { test } from 'node:test';
import { promptHidden } from './prompt-hidden.js';

test('keeps the key hidden while editing and resizing the terminal', async t => {
  const term = process.env.TERM;
  process.env.TERM = 'xterm';
  t.after(() => {
    if (term === undefined) delete process.env.TERM;
    else process.env.TERM = term;
  });

  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {} });
  let captured = '';
  const output = Object.assign(
    new Writable({
      write(chunk, _encoding, callback) {
        captured += String(chunk);
        callback();
      },
    }),
    { isTTY: true, columns: 80 },
  );

  const question = 'Private key (input hidden): ';
  const key = `0x${'0123456789abcdef'.repeat(4)}`;
  const pending = promptHidden(question, { input, output });
  for (const char of key) input.write(char);
  input.write('\x7f');
  output.columns = 40;
  output.emit('resize');
  input.write('\r');

  assert.equal(await pending, key.slice(0, -1));
  assert.ok(captured.includes(question));
  for (let i = 0; i <= key.length - 6; i++) {
    assert.ok(!captured.includes(key.slice(i, i + 6)), 'terminal output contains part of the key');
  }
  assert.equal(captured, `${question}\n`);
});
