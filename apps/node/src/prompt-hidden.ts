import { createInterface } from 'node:readline';
import { type Readable, Writable } from 'node:stream';

/** Read a line in terminal mode with all readline output muted. */
export function promptHidden(
  question: string,
  { input, output }: { input: Readable; output: Writable } = { input: process.stdin, output: process.stdout },
): Promise<string> {
  return new Promise((resolve, reject) => {
    output.write(question);
    const muted = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    const rl = createInterface({ input, output: muted, terminal: true, historySize: 0 });
    const onClose = () => {
      output.write('\n');
      reject(new Error('Private key prompt closed before Enter'));
    };
    rl.once('close', onClose);
    rl.question('', answer => {
      rl.off('close', onClose);
      rl.close();
      output.write('\n');
      resolve(answer.trim());
    });
  });
}
