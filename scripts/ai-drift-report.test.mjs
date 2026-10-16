import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { auditCoverage, renderReport, verifyFindings } from './ai-drift-report.mjs';

const SCRIPT = fileURLToPath(new URL('./ai-drift-report.mjs', import.meta.url));

const AI_FILE = 'packages/skills/skills/sodax-sdk/integration/knowledge/features/swap.md';
const SOURCE_FILE = 'packages/sdk/src/swap/SwapService.ts';
const SOURCE_DIR = 'packages/sdk/src/swap';

const AI_CONTENT = [
  '# Swap',
  '',
  'Supported hook kinds are `deposit` and `withdraw`.',
  '',
  'Slippage defaults to 1%.',
  '',
  '| Chain | Provider |',
  '| --- | --- |',
  '| Sonic | EvmWalletProvider |',
  '| Solana | SolanaWalletProvider |',
  '',
  '```ts',
  'const slippage = 100;',
  '```',
];
const SOURCE_CONTENT = ['export const HOOK_KINDS = [', "  'deposit',", "  'withdraw',", "  'flint-rwa',", '];'];

const createWorkspace = t => {
  const root = mkdtempSync(join(tmpdir(), 'ai-drift-report-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  for (const [path, content] of [
    [AI_FILE, AI_CONTENT.join('\n')],
    [SOURCE_FILE, SOURCE_CONTENT.join('\n')],
  ]) {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), `${content}\n`);
  }

  return root;
};

const SCOPE = { aiFiles: [AI_FILE], dropped: [] };

const finding = overrides => ({
  severity: 'contradiction',
  ai_file: AI_FILE,
  ai_line: 3,
  ai_quote: 'Supported hook kinds are `deposit` and `withdraw`',
  source_file: SOURCE_FILE,
  source_line: 4,
  source_quote: "'flint-rwa'",
  explanation: 'The documented hook-kind list omits a kind the source defines.',
  ...overrides,
});

const verify = (t, findings, scope = SCOPE) =>
  verifyFindings({ root: createWorkspace(t), scope, result: { findings } });

test('keeps a finding whose quotes resolve in both files', t => {
  const { contradictions, discarded } = verify(t, [finding()]);

  assert.equal(discarded.length, 0);
  assert.equal(contradictions.length, 1);
  assert.equal(contradictions[0].ai_file, AI_FILE);
});

test('corrects a line number the auditor got slightly wrong rather than discarding the finding', t => {
  const { contradictions, discarded } = verify(t, [finding({ ai_line: 41, source_line: 900 })]);

  assert.equal(discarded.length, 0);
  assert.equal(contradictions[0].ai_line, 3);
  assert.equal(contradictions[0].source_line, 4);
});

// A quote spanning a markdown table is exactly what an auditor cites; discarding it under the same
// heading as a fabrication trains reviewers to distrust the discard list.
test('resolves a quote spanning many lines and reports the line it starts on', t => {
  const spanning = AI_CONTENT.slice(4).join(' ').replace(/\s+/g, ' ').trim();
  const { contradictions, discarded } = verify(t, [finding({ ai_quote: spanning })]);

  assert.equal(discarded.length, 0);
  assert.equal(contradictions[0].ai_line, 5);
});

test('tolerates a capitalisation slip in a transcribed quote', t => {
  const { contradictions, discarded } = verify(t, [finding({ ai_quote: 'supported HOOK kinds are `deposit`' })]);

  assert.equal(discarded.length, 0);
  assert.equal(contradictions[0].ai_line, 3);
});

test('discards a finding whose quoted text appears nowhere in the AI file', t => {
  const { contradictions, discarded } = verify(t, [
    finding({ ai_quote: 'Supported hook kinds are `deposit`, `withdraw` and `bridge`' }),
  ]);

  assert.equal(contradictions.length, 0);
  assert.equal(discarded.length, 1);
  assert.match(discarded[0].reason, /quoted text is not present in/);
});

test('discards a finding whose source quote does not exist, or whose source file does not', t => {
  const fabricatedQuote = verify(t, [finding({ source_quote: "'solana-rwa'" })]);
  assert.equal(fabricatedQuote.discarded.length, 1);
  assert.match(fabricatedQuote.discarded[0].reason, /not present in packages\/sdk\/src\/swap\/SwapService\.ts/);

  const missingFile = verify(t, [finding({ source_file: 'packages/sdk/src/swap/Imagined.ts' })]);
  assert.equal(missingFile.discarded.length, 1);
  assert.match(missingFile.discarded[0].reason, /is not a file in this repository/);
});

// Citing a directory is an easy slip when the auditor means "the swap service". Reading it throws,
// and an uncaught throw would kill the run before the report is written.
test('discards a citation that names a directory instead of crashing the run', t => {
  const { discarded, contradictions } = verify(t, [finding({ source_file: SOURCE_DIR })]);

  assert.equal(contradictions.length, 0);
  assert.equal(discarded.length, 1);
  assert.match(discarded[0].reason, /is not a file in this repository/);
});

test('discards a finding about a file this run was not scoped to audit', t => {
  const { discarded } = verify(t, [finding({ ai_file: 'packages/sdk/AGENTS.md' })]);

  assert.equal(discarded.length, 1);
  assert.match(discarded[0].reason, /is not one of the AI files this run audits/);
});

test('discards a finding that omits required evidence or uses an unknown severity', t => {
  const noQuote = verify(t, [finding({ source_quote: '' })]);
  assert.match(noQuote.discarded[0].reason, /missing required field\(s\): source_quote/);

  const badSeverity = verify(t, [finding({ severity: 'nitpick' })]);
  assert.match(badSeverity.discarded[0].reason, /unknown severity/);
});

// Verification is the entire reason this may fail a build. A quote short enough to occur by accident
// verifies nothing, and a document cannot be the source of truth that disproves itself.
test('discards evidence too thin to identify a claim', t => {
  const shortPassage = verify(t, [finding({ ai_quote: 'Swap' })]);
  assert.equal(shortPassage.contradictions.length, 0);
  assert.match(shortPassage.discarded[0].reason, /under 4 words/);

  const shortSource = verify(t, [finding({ source_quote: '];' })]);
  assert.equal(shortSource.contradictions.length, 0);
  assert.match(shortSource.discarded[0].reason, /under 6 characters/);
});

test('discards a finding that cites the AI file as its own source of truth', t => {
  const { contradictions, discarded } = verify(t, [
    finding({ source_file: AI_FILE, source_quote: 'Slippage defaults to 1%' }),
  ]);

  assert.equal(contradictions.length, 0);
  assert.match(discarded[0].reason, /the cited source of truth is the AI file itself/);
});

test('separates blocking contradictions from advisory gaps', t => {
  const { contradictions, gaps } = verify(t, [finding(), finding({ severity: 'gap' })]);

  assert.equal(contradictions.length, 1);
  assert.equal(gaps.length, 1);
});

test('reports discarded findings and unaudited files instead of hiding them', t => {
  const scope = { aiFiles: [AI_FILE], dropped: ['packages/skills/skills/sodax-sdk/SKILL.md'] };
  const verdict = verify(t, [finding({ ai_quote: 'a sentence nobody ever wrote' })], scope);
  const report = renderReport({ scope, result: { findings: [], notes: 'Read 1 file.' }, verdict });

  assert.match(report, /^<!-- ai-drift-check -->/);
  assert.match(report, /Discarded — the citation did not resolve \(1\)/);
  assert.match(report, /Not audited — outside this run's budget \(1\)/);
  assert.match(report, /packages\/skills\/skills\/sodax-sdk\/SKILL\.md/);
  assert.match(report, /Read 1 file\./);
});

// An audit that opened a third of its scope and reports "clean" makes the same claim the scope step
// refuses to make when it truncates.
test('never reports a clean run for files the auditor did not open', t => {
  const other = 'packages/skills/skills/sodax-sdk/swap/SKILL.md';
  const scope = { aiFiles: [AI_FILE, other], dropped: [] };
  const result = { findings: [], audited_files: [AI_FILE] };
  const coverage = auditCoverage({ scope, result });

  assert.deepEqual(coverage.unaudited, [other]);

  const report = renderReport({ scope, result, verdict: verify(t, [], scope), coverage });
  assert.match(report, /Audited \*\*1 of 2\*\*/);
  assert.match(report, /Not read by the auditor \(1\)/);
  assert.doesNotMatch(report, /No drift found/);
});

test('says so when the auditor did not report what it read at all', t => {
  const scope = { aiFiles: [AI_FILE], dropped: [] };
  const result = { findings: [] };
  const report = renderReport({
    scope,
    result,
    verdict: verify(t, [], scope),
    coverage: auditCoverage({ scope, result }),
  });

  assert.match(report, /Coverage unknown/);
});

test('surfaces an auditor verdict that none of its own findings support', t => {
  const scope = { aiFiles: [AI_FILE], dropped: [] };
  const result = { findings: [], verdict: 'contradictions', audited_files: [AI_FILE] };
  const report = renderReport({
    scope,
    result,
    verdict: verify(t, [], scope),
    coverage: auditCoverage({ scope, result }),
  });

  assert.match(report, /Auditor disagreement/);
});

test('names the blocking findings and the escape hatch once enforcement is on', t => {
  const verdict = verify(t, [finding()]);
  const scope = { aiFiles: [AI_FILE], dropped: [] };

  const enforced = renderReport({ scope, result: { findings: [] }, verdict, enforcing: true });
  assert.match(enforced, /Contradictions — these block the merge \(1\)/);
  assert.match(enforced, /no-ai-drift/);
  assert.match(enforced, /packages\/sdk\/src\/swap\/SwapService\.ts:4/);

  const advisory = renderReport({ scope, result: { findings: [] }, verdict });
  assert.match(advisory, /advisory until `AI_DRIFT_ENFORCE` is set/);
});

test('shows the claim against the source as a diff, and folds the reasoning away', t => {
  const verdict = verify(t, [finding({ ai_quote: 'Slippage defaults to 1%' })]);
  const report = renderReport({ scope: SCOPE, result: { findings: [] }, verdict });

  assert.match(report, /^```diff$/m);
  assert.match(report, /^- doc {3}Slippage defaults to 1%$/m);
  assert.match(report, /^\+ code {2}'flint-rwa'$/m);
  assert.match(report, /<details><summary>Why<\/summary>/);
  // Counts a reviewer can read before scrolling.
  assert.match(report, /\*\*1 contradiction\*\* · 0 gaps · 0 discarded findings/);
});

// A quote carrying a fence would close a three-backtick block early and spill the rest of the
// comment into the page as markdown.
test('opens the diff fence wider than any backtick run inside the quotes', t => {
  const verdict = verify(t, [finding({ ai_quote: '```ts const slippage = 100; ```' })]);
  const report = renderReport({ scope: SCOPE, result: { findings: [] }, verdict });

  assert.equal(verdict.discarded.length, 0);
  assert.match(report, /^````diff$/m);
  assert.doesNotMatch(report, /^```diff$/m);
});

test('links every citation to the exact line when running in Actions', t => {
  const verdict = verify(t, [finding()]);
  const base = 'https://github.com/icon-project/sodax-sdks/blob/abc123';

  const linked = renderReport({ scope: SCOPE, result: { findings: [] }, verdict, blobBase: base });
  assert.match(linked, new RegExp(`\\[\`${SOURCE_FILE}:4\`\\]\\(${base}/${SOURCE_FILE}#L4\\)`));

  // Locally there is no commit to link to, so the path stays plain for an editor to jump to.
  const plain = renderReport({ scope: SCOPE, result: { findings: [] }, verdict });
  assert.doesNotMatch(plain, /\]\(https:/);
  assert.match(plain, /`packages\/sdk\/src\/swap\/SwapService\.ts:4`/);
});

test('folds the auditor notes away instead of burying the findings under them', t => {
  const scope = { aiFiles: [AI_FILE], dropped: [] };
  const report = renderReport({
    scope,
    result: { findings: [], notes: 'Read the whole service.' },
    verdict: verify(t, [], scope),
  });

  assert.match(report, /<details><summary>What the auditor checked<\/summary>\n\nRead the whole service\./);
});

// The auditor can go silent three ways, and they must not be treated the same: it declines to run on
// a pull request that edits the gate, the audit step itself can fail, and it can simply break.
const runCli = (t, { scope = SCOPE, result = null, env = {} } = {}) => {
  const root = createWorkspace(t);
  writeFileSync(join(root, 'scope.json'), JSON.stringify(scope));

  const args = [SCRIPT, '--scope', 'scope.json', '--comment-out', 'comment.md'];
  if (result !== null) {
    writeFileSync(join(root, 'result.json'), JSON.stringify(result));
    args.push('--result', 'result.json');
  }

  const run = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, AI_DRIFT_RESULT: '', GITHUB_STEP_SUMMARY: '', AI_DRIFT_ENFORCE: '', ...env },
  });

  return { ...run, comment: readFileSync(join(root, 'comment.md'), 'utf8') };
};

test('warns without blocking when the pull request edits the gate the auditor validates', t => {
  const { status, stdout, comment } = runCli(t, { scope: { ...SCOPE, gateSelfEdited: true } });

  assert.equal(status, 0);
  assert.match(stdout, /::warning title=AI files drift::/);
  assert.match(comment, /nothing was audited/);
});

test('warns without blocking when the audit step itself failed', t => {
  const { status, stdout, comment } = runCli(t, { env: { AUDIT_OUTCOME: 'failure', AI_DRIFT_ENFORCE: 'true' } });

  assert.equal(status, 0);
  assert.match(stdout, /::warning title=AI files drift::/);
  assert.match(comment, /did not complete/);
});

test('blocks when the auditor returned nothing usable and enforcement is on', t => {
  const enforced = runCli(t, { env: { AI_DRIFT_ENFORCE: 'true' } });
  assert.equal(enforced.status, 1);
  assert.match(enforced.stdout, /::error title=AI files drift::/);
  assert.match(enforced.comment, /no usable result/);

  const advisory = runCli(t);
  assert.equal(advisory.status, 0);
  assert.match(advisory.stdout, /::warning title=AI files drift::/);
});

test('fails the build on a verified contradiction only once enforcement is on', t => {
  const result = { verdict: 'contradictions', audited_files: [AI_FILE], findings: [finding()] };

  const enforced = runCli(t, { result, env: { AI_DRIFT_ENFORCE: 'true' } });
  assert.equal(enforced.status, 1);
  assert.match(enforced.stdout, /::error file=.*title=AI files drift::/);
  assert.match(enforced.comment, /Contradictions — these block the merge \(1\)/);

  const advisory = runCli(t, { result });
  assert.equal(advisory.status, 0);
  assert.match(advisory.stdout, /::warning file=/);
  assert.match(advisory.stdout, /AI_DRIFT_ENFORCE is not set/);
});

test('reports gaps and clean runs without failing, and always writes the comment', t => {
  const gapOnly = runCli(t, {
    result: { verdict: 'gaps_only', audited_files: [AI_FILE], findings: [finding({ severity: 'gap' })] },
    env: { AI_DRIFT_ENFORCE: 'true' },
  });
  assert.equal(gapOnly.status, 0);
  assert.match(gapOnly.stdout, /::warning file=.*title=AI files coverage gap::/);
  assert.match(gapOnly.comment, /Coverage gaps — advisory \(1\)/);

  const clean = runCli(t, { result: { verdict: 'clean', audited_files: [AI_FILE], findings: [] } });
  assert.equal(clean.status, 0);
  assert.match(clean.comment, /No drift found in the 1 AI file\(s\)/);
});
