import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Turns the drift auditor's structured output into a build verdict.
//
// The auditor is a language model, and a required status check cannot rest on one. So nothing it
// reports is trusted on its word: every finding must carry a quote from the AI file and a quote
// from the source, and this script re-reads both files to confirm those quotes exist. A finding
// whose citation does not resolve is discarded — and listed as discarded, because a filter that
// hides its own work is just a different way of being wrong.
//
// Only a surviving contradiction fails the build, and only once `AI_DRIFT_ENFORCE` is set. Coverage
// gaps are reported as warnings: "does this doc mention the new thing enough" has no objective
// answer, and gating on it would train people to route around the check.
//
// Every exit path writes the report first. A check that goes red with nothing on the pull request
// to explain it is indistinguishable from a broken check, and reviewers learn to ignore both.

const SEVERITIES = new Set(['contradiction', 'gap']);
const REQUIRED = ['severity', 'ai_file', 'ai_line', 'ai_quote', 'source_file', 'source_line', 'source_quote'];

// A quote short enough to occur by accident is not evidence. Prose claims are sentences; source
// quotes are often a single identifier, so they are measured in characters rather than words.
const MIN_AI_QUOTE_WORDS = 4;
const MIN_SOURCE_QUOTE_CHARS = 6;

const MARKER = '<!-- ai-drift-check -->';

const collapse = text => String(text).replace(/\s+/g, ' ').trim();
// Case is folded for matching only: a capitalisation slip in a transcribed quote is a transcription
// error, not a fabrication, and discarding a real finding over one helps nobody.
const fold = text => collapse(text).toLowerCase();

const wordCount = text => (collapse(text) === '' ? 0 : collapse(text).split(' ').length);
const letterCount = text => String(text).replace(/[^\p{L}\p{N}]/gu, '').length;

// Quote-in-file rather than quote-at-line: an off-by-one line number is a transcription slip, while
// a quote that appears nowhere in the file is a fabrication. Only the second one matters. The file
// is folded into one string so a quote spanning any number of lines still resolves, and the offset
// maps back to the line the quote actually starts on.
const locateQuote = (text, quote) => {
  const needle = fold(quote);
  if (!needle) return 0;

  let folded = '';
  const lineOf = [];

  text.split(/\r?\n/).forEach((line, index) => {
    const piece = fold(line);
    if (!piece) return;

    if (folded !== '') {
      folded += ' ';
      lineOf.push(index + 1);
    }
    folded += piece;
    for (let offset = 0; offset < piece.length; offset += 1) lineOf.push(index + 1);
  });

  const index = folded.indexOf(needle);
  return index === -1 ? 0 : lineOf[index];
};

export const verifyFindings = ({ root, scope, result }) => {
  const inScope = new Set(scope.aiFiles ?? []);
  const read = path => readFileSync(join(root, path), 'utf8');
  const verified = [];
  const discarded = [];

  for (const finding of result.findings ?? []) {
    const drop = reason => discarded.push({ finding, reason });

    // Any read can throw — a citation naming a directory, a symlink loop, a binary file. A citation
    // that cannot be read did not resolve, which is exactly what `drop` means.
    try {
      const missing = REQUIRED.filter(
        key => finding[key] === undefined || finding[key] === null || finding[key] === '',
      );
      if (missing.length > 0) {
        drop(`missing required field(s): ${missing.join(', ')}`);
        continue;
      }

      if (!SEVERITIES.has(finding.severity)) {
        drop(`unknown severity "${finding.severity}"`);
        continue;
      }

      if (!inScope.has(finding.ai_file)) {
        drop(`${finding.ai_file} is not one of the AI files this run audits`);
        continue;
      }

      if (finding.source_file === finding.ai_file) {
        drop('the cited source of truth is the AI file itself, so it disproves nothing');
        continue;
      }

      const sourcePath = join(root, finding.source_file);
      if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
        drop(`source file ${finding.source_file} is not a file in this repository`);
        continue;
      }

      if (wordCount(finding.ai_quote) < MIN_AI_QUOTE_WORDS) {
        drop(`the quoted passage is under ${MIN_AI_QUOTE_WORDS} words, too short to identify a claim`);
        continue;
      }

      if (letterCount(finding.source_quote) < MIN_SOURCE_QUOTE_CHARS) {
        drop(`the quoted source is under ${MIN_SOURCE_QUOTE_CHARS} characters, too short to be evidence`);
        continue;
      }

      const aiLine = locateQuote(read(finding.ai_file), finding.ai_quote);
      if (aiLine === 0) {
        drop(`quoted text is not present in ${finding.ai_file}`);
        continue;
      }

      const sourceLine = locateQuote(read(finding.source_file), finding.source_quote);
      if (sourceLine === 0) {
        drop(`quoted text is not present in ${finding.source_file}`);
        continue;
      }

      verified.push({ ...finding, ai_line: aiLine, source_line: sourceLine });
    } catch (error) {
      drop(`the citation could not be read: ${error.code ?? error.message}`);
    }
  }

  return {
    contradictions: verified.filter(finding => finding.severity === 'contradiction'),
    gaps: verified.filter(finding => finding.severity === 'gap'),
    discarded,
  };
};

// What the auditor says it read, against what it was given to read. An audit that covered a third of
// its scope and reports "clean" is the same failure the scope step refuses to commit when it
// truncates: a partial result that reads as a complete one.
export const auditCoverage = ({ scope, result }) => {
  const scoped = scope.aiFiles ?? [];
  const claimed = Array.isArray(result.audited_files) ? new Set(result.audited_files) : null;

  return {
    scoped,
    unaudited: claimed ? scoped.filter(path => !claimed.has(path)) : [],
    // No list at all is not evidence of full coverage; it is the absence of evidence either way.
    unknown: claimed === null && scoped.length > 0,
  };
};

// Long enough to carry the claim, short enough that the diff block does not scroll sideways. The
// permalink beside it goes to the untruncated line, so nothing is actually lost.
const QUOTE_DISPLAY_LIMIT = 240;

const shorten = text => {
  const flat = collapse(text);
  return flat.length > QUOTE_DISPLAY_LIMIT ? `${flat.slice(0, QUOTE_DISPLAY_LIMIT - 1)}…` : flat;
};

// A quote containing backticks would close a three-backtick fence early and spill the rest of the
// comment into the page as markdown. Open with one more backtick than the longest run inside.
const fenceFor = (...texts) => {
  const longest = texts.reduce(
    (max, text) => (String(text).match(/`+/g) ?? []).reduce((run, match) => Math.max(run, match.length), max),
    2,
  );
  return '`'.repeat(longest + 1);
};

const linkTo = (blobBase, path, line) =>
  blobBase ? `[\`${path}:${line}\`](${blobBase}/${path}#L${line})` : `\`${path}:${line}\``;

// Evidence first, reasoning last. A reviewer needs to see which line is wrong and what it should
// say; the argument for why only matters once they disagree, so it goes behind a fold.
const renderFinding = (finding, blobBase) => {
  const fence = fenceFor(finding.ai_quote, finding.source_quote);
  const icon = finding.severity === 'contradiction' ? '❌' : '⚠️';
  const name = finding.ai_file.split('/').pop();

  return [
    `#### ${icon} \`${name}\` — ${finding.severity === 'contradiction' ? 'contradicted by the source' : 'not covered'}`,
    '',
    `${fence}diff`,
    `- doc   ${shorten(finding.ai_quote)}`,
    `+ code  ${shorten(finding.source_quote)}`,
    fence,
    '',
    `${linkTo(blobBase, finding.ai_file, finding.ai_line)} → ${linkTo(blobBase, finding.source_file, finding.source_line)}`,
    ...(finding.suggested_fix ? ['', `**Fix:** ${finding.suggested_fix}`] : []),
    '',
    '<details><summary>Why</summary>',
    '',
    finding.explanation ?? 'no explanation given',
    '',
    '</details>',
  ].join('\n');
};

const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

export const renderReport = ({ scope, result, verdict, coverage, enforcing = false, blobBase = null }) => {
  const { contradictions, gaps, discarded } = verdict;
  const { scoped, unaudited, unknown } = coverage ?? { scoped: scope.aiFiles ?? [], unaudited: [], unknown: false };
  const read = scoped.length - unaudited.length;
  const lines = [MARKER, '## AI files drift check', ''];

  if (unaudited.length > 0) {
    lines.push(`Audited **${read} of ${scoped.length}** AI file(s) this change could affect.`);
  } else if (contradictions.length === 0 && gaps.length === 0) {
    lines.push(`No drift found in the ${scoped.length} AI file(s) this change could affect.`);
  } else {
    lines.push(`Audited ${scoped.length} AI file(s) that this change could affect.`);
  }

  // One line a reviewer can read without scrolling, before any of the detail below it.
  if (contradictions.length + gaps.length + discarded.length > 0) {
    lines.push(
      '',
      [
        contradictions.length > 0
          ? `**${plural(contradictions.length, 'contradiction')}**`
          : plural(0, 'contradiction'),
        plural(gaps.length, 'gap'),
        plural(discarded.length, 'discarded finding'),
        contradictions.length > 0 && !enforcing ? 'reported only — `AI_DRIFT_ENFORCE` is not set' : null,
      ]
        .filter(Boolean)
        .join(' · '),
    );
  }

  if (contradictions.length > 0) {
    const heading = enforcing
      ? `### Contradictions — these block the merge (${contradictions.length})`
      : `### Contradictions — advisory until \`AI_DRIFT_ENFORCE\` is set (${contradictions.length})`;
    lines.push('', heading, '');
    lines.push('The AI guidance states something the current source contradicts. Update the guidance, or');
    lines.push(
      enforcing
        ? 'add the `no-ai-drift` label if the finding is wrong.'
        : 'say in the thread that the finding is wrong, so the prompt can be tightened.',
      '',
    );
    lines.push(contradictions.map(finding => renderFinding(finding, blobBase)).join('\n\n---\n\n'));
  }

  if (gaps.length > 0) {
    lines.push('', `### Coverage gaps — advisory (${gaps.length})`, '');
    lines.push('This change adds public surface no audited AI file mentions. Worth documenting, not blocking.', '');
    lines.push(gaps.map(finding => renderFinding(finding, blobBase)).join('\n\n---\n\n'));
  }

  if (discarded.length > 0) {
    lines.push('', `### Discarded — the citation did not resolve (${discarded.length})`, '');
    for (const { finding, reason } of discarded) {
      lines.push(`- ${finding.severity ?? 'finding'} against \`${finding.ai_file ?? '?'}\`: ${reason}`);
    }
  }

  if (unaudited.length > 0) {
    lines.push('', `### Not read by the auditor (${unaudited.length})`, '');
    lines.push('These were in scope but the auditor did not report reading them, so nothing above covers them.', '');
    for (const path of unaudited) lines.push(`- \`${path}\``);
  }

  if (unknown) {
    lines.push('', '### Coverage unknown', '');
    lines.push('The auditor did not say which files it read, so treat the result above as a partial audit.');
  }

  if (result.verdict === 'contradictions' && contradictions.length === 0) {
    lines.push('', '### Auditor disagreement', '');
    lines.push('The auditor returned a `contradictions` verdict, but none of its findings survived verification.');
  }

  if (scope.dropped?.length > 0) {
    lines.push('', `### Not audited — outside this run's budget (${scope.dropped.length})`, '');
    for (const path of scope.dropped) lines.push(`- \`${path}\``);
  }

  // Worth keeping — it says what the auditor checked and found sound, not just what it flagged —
  // but it runs to paragraphs, so it does not belong above the findings.
  if (result.notes) {
    lines.push('', '### Auditor notes', '', '<details><summary>What the auditor checked</summary>', '');
    lines.push(result.notes, '', '</details>');
  }

  return `${lines.join('\n')}\n`;
};

export const renderNoAudit = ({ scope, message }) =>
  `${[MARKER, '## AI files drift check', '', message, '', `Files that were in scope: ${(scope.aiFiles ?? []).length}.`].join('\n')}\n`;

const annotate = ({ contradictions, gaps }, enforcing) => {
  const emit = (level, finding) => {
    const message = `${finding.explanation ?? 'AI guidance no longer matches the source'} (source of truth: ${finding.source_file}:${finding.source_line})`;
    const title = level === 'error' ? 'AI files drift' : 'AI files coverage gap';
    console.log(
      `::${level} file=${finding.ai_file},line=${finding.ai_line},title=${title}::${message.replace(/\r?\n/g, ' ')}`,
    );
  };

  for (const finding of contradictions) emit(enforcing ? 'error' : 'warning', finding);
  for (const finding of gaps) emit('warning', finding);
};

const parseArgs = argv => {
  const args = { scope: 'drift-scope.json', result: null, comment: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--scope') args.scope = argv[index + 1];
    if (argv[index] === '--result') args.result = argv[index + 1];
    if (argv[index] === '--comment-out') args.comment = argv[index + 1];
  }
  return args;
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const scope = JSON.parse(readFileSync(args.scope, 'utf8'));
  const raw = args.result ? readFileSync(args.result, 'utf8') : (process.env.AI_DRIFT_RESULT ?? '');
  // Blocking is opt-in per repository, so the gate can run advisory for a cycle and be promoted by a
  // settings change rather than by a follow-up nobody re-reads.
  const enforcing = process.env.AI_DRIFT_ENFORCE === 'true';

  // Every cited path becomes a link straight to the line. Absent outside Actions, where the report
  // is printed to a terminal and plain `path:line` is what an editor can jump to anyway.
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, HEAD_SHA } = process.env;
  const blobBase =
    GITHUB_SERVER_URL && GITHUB_REPOSITORY && HEAD_SHA
      ? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/blob/${HEAD_SHA}`
      : null;

  const publish = report => {
    if (args.comment) writeFileSync(args.comment, report);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
    else console.log(report);
  };

  let result;
  try {
    result = JSON.parse(raw);
  } catch {
    result = null;
  }

  if (!result || !Array.isArray(result.findings)) {
    // Three ways to end up here, and they are not the same event.
    //
    // A pull request that edits this gate cannot be audited by it: the workflow skips the audit on
    // `gate_self_edited`, because the prompt and these scripts run from the pull request's own
    // checkout and an audit reading them would be one the pull request wrote the rules for. Failing
    // the check instead would mean the gate can never be amended.
    //
    // The audit step failing outright — a provider outage, an expired token, the job timeout — is
    // not evidence of drift either, and blocking every open pull request on someone else's incident
    // is how a check gets disabled.
    //
    // What is left is an auditor that ran and returned nothing usable. That is a real malfunction,
    // and a blocking check that passes in that case reports "no drift" for a run that never looked.
    const [message, level] = scope.gateSelfEdited
      ? [
          'This pull request edits the drift check itself, so the audit was skipped and nothing was audited. Review the AI files by hand; the gate resumes on the next pull request that leaves it alone.',
          'warning',
        ]
      : process.env.AUDIT_OUTCOME === 'failure'
        ? ['The audit step did not complete, so nothing was audited. Re-run the job.', 'warning']
        : ['The drift auditor produced no usable result; nothing was verified.', enforcing ? 'error' : 'warning'];

    publish(renderNoAudit({ scope, message }));
    console.log(`::${level} title=AI files drift::${message}`);
    process.exit(level === 'error' ? 1 : 0);
  }

  let verdict;
  let coverage;

  // Nothing below should throw, but if it does the pull request still gets a comment saying so —
  // the one thing this script must never do is leave a red check with no explanation on it.
  try {
    verdict = verifyFindings({ root: process.cwd(), scope, result });
    coverage = auditCoverage({ scope, result });

    annotate(verdict, enforcing);
    publish(renderReport({ scope, result, verdict, coverage, enforcing, blobBase }));
  } catch (error) {
    const message = `The drift report could not be produced: ${error.message}`;
    publish(renderNoAudit({ scope, message }));
    console.log(`::${enforcing ? 'error' : 'warning'} title=AI files drift::${message}`);
    process.exit(enforcing ? 1 : 0);
  }

  const { contradictions, gaps, discarded } = verdict;
  console.log(
    `Drift audit: ${contradictions.length} contradiction(s), ${gaps.length} gap(s), ${discarded.length} discarded, ${coverage.unaudited.length} scoped file(s) unread.`,
  );

  if (contradictions.length > 0 && enforcing) process.exit(1);
  if (contradictions.length > 0) {
    console.log('AI_DRIFT_ENFORCE is not set, so contradictions are reported without failing the build.');
  }
}
