import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  GATE_PATHS,
  isAiFile,
  knowledgeTargets,
  NO_SKILL_PACKAGES,
  PACKAGE_SEGMENT,
  scopeAiDrift,
  SEGMENT_ALIASES,
  SKILL_BY_PACKAGE,
  stepOutputs,
} from './ai-drift-scope.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// The subset of the real tree the routing decisions depend on.
const WORKSPACE_FILES = [
  'AGENTS.md',
  'apps/demo/AGENTS.md',
  'packages/libs/AGENTS.md',
  'packages/sdk/AGENTS.md',
  'packages/dapp-kit/AGENTS.md',
  'packages/skills/skills/sodax-sdk/SKILL.md',
  'packages/skills/skills/sodax-sdk/swap/SKILL.md',
  'packages/skills/skills/sodax-sdk/integration/knowledge/ai-rules.md',
  'packages/skills/skills/sodax-sdk/integration/knowledge/architecture.md',
  'packages/skills/skills/sodax-sdk/integration/knowledge/features/swap.md',
  'packages/skills/skills/sodax-sdk/integration/knowledge/reference/error-codes.md',
  'packages/skills/skills/sodax-sdk/migration-v1-to-v2/knowledge/features/swap.md',
  'packages/skills/skills/sodax-dapp-kit/SKILL.md',
  'packages/skills/skills/sodax-dapp-kit/money-market/SKILL.md',
  'packages/skills/skills/sodax-dapp-kit/integration/knowledge/features/money-market.md',
];

const createWorkspace = (t, extra = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'ai-drift-scope-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const write = (path, content) => {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };

  for (const path of WORKSPACE_FILES) write(path, `# ${path}\n`);
  for (const [path, content] of Object.entries(extra)) write(path, content);

  return root;
};

const run = (t, changedFiles, { extra, ...options } = {}) =>
  scopeAiDrift({ root: createWorkspace(t, extra), changedFiles, ...options });

const labels = scope => scope.groups.map(group => group.label).sort();

test('routes a feature source change to that feature knowledge, granular skill and package guide', t => {
  const scope = run(t, ['packages/sdk/src/swap/HookService.ts']);

  assert.equal(scope.shouldRun, true);
  assert.deepEqual(scope.aiFiles.sort(), [
    'packages/sdk/AGENTS.md',
    'packages/skills/skills/sodax-sdk/integration/knowledge/features/swap.md',
    'packages/skills/skills/sodax-sdk/migration-v1-to-v2/knowledge/features/swap.md',
    'packages/skills/skills/sodax-sdk/swap/SKILL.md',
  ]);
  assert.equal(scope.groups.length, 1);
  assert.deepEqual(scope.groups[0].changed, ['packages/sdk/src/swap/HookService.ts']);
});

test('applies a segment alias so a directory name that differs from the knowledge filename still routes', t => {
  const dappKit = run(t, ['packages/dapp-kit/src/hooks/mm/useSupply.ts']);
  assert.ok(
    dappKit.aiFiles.includes('packages/skills/skills/sodax-dapp-kit/integration/knowledge/features/money-market.md'),
  );

  const sdk = run(t, ['packages/sdk/src/errors/index.ts']);
  assert.ok(sdk.aiFiles.includes('packages/skills/skills/sodax-sdk/integration/knowledge/reference/error-codes.md'));
});

test('falls back to package-wide knowledge when no single feature owns the change', t => {
  const scope = run(t, ['packages/sdk/src/shared/types/intent-types.ts']);

  assert.deepEqual(scope.aiFiles.sort(), [
    'packages/sdk/AGENTS.md',
    'packages/skills/skills/sodax-sdk/SKILL.md',
    'packages/skills/skills/sodax-sdk/integration/knowledge/ai-rules.md',
    'packages/skills/skills/sodax-sdk/integration/knowledge/architecture.md',
  ]);
});

// A shared helper alongside a feature change is the ordinary case. Treating it as "no feature owns
// this package" doubles the audit budget for nothing and starves the features that did resolve.
test('does not add package-wide knowledge when something in the package did resolve to a feature', t => {
  const scope = run(t, ['packages/sdk/src/swap/HookService.ts', 'packages/sdk/src/shared/utils.ts']);

  assert.deepEqual(labels(scope), ['packages/sdk:guide', 'packages/sdk:swap']);
  assert.ok(!scope.aiFiles.includes('packages/skills/skills/sodax-sdk/integration/knowledge/ai-rules.md'));
  assert.ok(scope.aiFiles.includes('packages/skills/skills/sodax-sdk/integration/knowledge/features/swap.md'));

  const guide = scope.groups.find(group => group.label === 'packages/sdk:guide');
  assert.deepEqual(guide.changed, ['packages/sdk/src/shared/utils.ts']);
  assert.deepEqual(guide.aiFiles, ['packages/sdk/AGENTS.md']);
});

// A package with no skill still has a guide describing the source that just moved.
test('audits a package or app guide even when the package routes to no skill', t => {
  const app = run(t, ['apps/demo/src/App.tsx']);
  assert.equal(app.shouldRun, true);
  assert.deepEqual(app.aiFiles, ['apps/demo/AGENTS.md']);

  const libs = run(t, ['packages/libs/src/index.ts']);
  assert.deepEqual(libs.aiFiles, ['packages/libs/AGENTS.md']);
});

test('skips PRs that change no source an AI file describes', t => {
  const lockfileOnly = run(t, ['pnpm-lock.yaml']);
  assert.equal(lockfileOnly.shouldRun, false);
  assert.deepEqual(lockfileOnly.aiFiles, []);

  // Tests describe the code, not the public surface; a test-only diff cannot invalidate prose.
  const testOnly = run(t, ['packages/sdk/src/swap/SwapService.test.ts']);
  assert.equal(testOnly.shouldRun, false);
});

test('audits an edited AI file itself, so a new claim must be backed by current source', t => {
  const scope = run(t, ['packages/skills/skills/sodax-sdk/integration/knowledge/features/swap.md']);

  assert.equal(scope.shouldRun, true);
  assert.deepEqual(scope.aiFiles, ['packages/skills/skills/sodax-sdk/integration/knowledge/features/swap.md']);
  assert.equal(scope.groups[0].label, 'ai-files-changed');
});

test('pulls in a dev skill when the PR changes a source file that skill cites', t => {
  const scope = run(t, ['packages/types/src/chains/tokens.ts'], {
    extra: {
      '.claude/skills/add-token/SKILL.md': 'Define the token in `packages/types/src/chains/tokens.ts` first.\n',
      '.claude/skills/add-chain/SKILL.md': 'Register the chain in `packages/types/src/chains/chains.ts`.\n',
    },
  });

  assert.ok(scope.aiFiles.includes('.claude/skills/add-token/SKILL.md'));
  assert.ok(!scope.aiFiles.includes('.claude/skills/add-chain/SKILL.md'));
});

test('audits root guidance only when the workspace layout, scripts or CI move', t => {
  const ci = run(t, ['.github/workflows/ci.yml']);
  assert.deepEqual(ci.aiFiles, ['AGENTS.md']);

  const source = run(t, ['packages/sdk/src/swap/HookService.ts']);
  assert.ok(!source.aiFiles.includes('AGENTS.md'));
});

test('drops the least specific files first when the audit budget is exceeded, and reports them', t => {
  const scope = run(t, ['packages/sdk/src/shared/types/intent-types.ts'], { maxFiles: 3 });

  assert.equal(scope.aiFiles.length, 3);
  assert.ok(scope.dropped.length > 0);
  // The package guide outranks package-wide knowledge, which is what gets cut.
  assert.ok(scope.aiFiles.includes('packages/sdk/AGENTS.md'));
  assert.ok(scope.dropped.includes('packages/skills/skills/sodax-sdk/SKILL.md'));
});

// A flat global sort tie-breaks on path, so one package would be audited exhaustively while another
// is never opened at all.
test('spreads a tight budget across every touched feature instead of alphabetically', t => {
  const scope = run(t, ['packages/dapp-kit/src/hooks/mm/useSupply.ts', 'packages/sdk/src/swap/HookService.ts'], {
    maxFiles: 2,
  });

  assert.equal(scope.aiFiles.length, 2);
  assert.equal(scope.aiFiles.filter(path => path.includes('sodax-sdk')).length, 1, 'the SDK feature must keep a file');
  assert.equal(
    scope.aiFiles.filter(path => path.includes('sodax-dapp-kit')).length,
    1,
    'the dapp-kit feature must keep a file',
  );
});

test('keeps a starved group in the output so the auditor is told it was touched but not read', t => {
  const scope = run(t, ['packages/dapp-kit/src/hooks/mm/useSupply.ts', 'packages/sdk/src/swap/HookService.ts'], {
    maxFiles: 1,
  });

  assert.equal(scope.aiFiles.length, 1);
  assert.deepEqual(labels(scope), ['packages/dapp-kit:money-market', 'packages/sdk:swap']);

  const starved = scope.groups.filter(group => group.aiFiles.length === 0);
  assert.equal(starved.length, 1);
  assert.ok(starved[0].droppedAiFiles.length > 0);
});

test('honours the byte budget as well as the file count', t => {
  const unbounded = run(t, ['packages/sdk/src/swap/HookService.ts']);
  const budget = unbounded.bytes - 1;
  const scope = run(t, ['packages/sdk/src/swap/HookService.ts'], { maxBytes: budget });

  assert.ok(scope.aiFiles.length > 0);
  assert.ok(scope.aiFiles.length < unbounded.aiFiles.length);
  assert.ok(scope.dropped.length > 0);
  assert.ok(scope.bytes <= budget);
});

test('flags a pull request that edits any part of the gate, which the auditor cannot audit honestly', t => {
  for (const path of GATE_PATHS) {
    assert.equal(run(t, [path]).gateSelfEdited, true, path);
  }

  assert.equal(run(t, ['.github/workflows/ci.yml']).gateSelfEdited, false);
});

// A pull request that only touches the gate must still produce a run, or the report step never gets
// the chance to say that nothing was audited.
test('a gate-only pull request still scopes root guidance rather than exiting silently', t => {
  const scope = run(t, ['scripts/ai-drift-report.mjs', '.github/ai-drift-prompt.md']);

  assert.equal(scope.shouldRun, true);
  assert.equal(scope.gateSelfEdited, true);
  assert.deepEqual(scope.aiFiles, ['AGENTS.md']);
});

// The workflow skips the prompt load and the audit on gate_self_edited. A flag computed here but
// never exported is a skip that never happens, and the pull request audits its own rewritten rules.
test('exports both flags the workflow branches on', t => {
  assert.equal(stepOutputs(run(t, ['scripts/ai-drift-scope.mjs'])), 'should_run=true\ngate_self_edited=true\n');
  assert.equal(
    stepOutputs(run(t, ['packages/sdk/src/swap/HookService.ts'])),
    'should_run=true\ngate_self_edited=false\n',
  );
});

test('classifies AI files and leaves vendored skills and ordinary docs out', t => {
  for (const path of [
    'AGENTS.md',
    'packages/sdk/AGENTS.md',
    'apps/demo/CLAUDE.md',
    'packages/skills/skills/sodax-sdk/integration/knowledge/features/swap.md',
    '.claude/skills/add-token/SKILL.md',
  ]) {
    assert.equal(isAiFile(path), true, path);
  }

  for (const path of [
    'packages/sdk/docs/SWAPS.md',
    'README.md',
    'packages/sdk/src/swap/SwapService.ts',
    '.claude/skills/cloudflare/SKILL.md',
  ]) {
    assert.equal(isAiFile(path), false, path);
  }
});

// Rot guard: the routing tables name real directories in the real tree. A rename in
// packages/skills would otherwise silently downgrade a feature audit to package-wide guidance.
test('every routing table entry resolves against the current repository', () => {
  const exists = path => existsSync(join(REPO_ROOT, path));

  for (const [pkg, skill] of Object.entries(SKILL_BY_PACKAGE)) {
    assert.ok(exists(pkg), `${pkg} is missing`);
    assert.ok(exists(`packages/skills/skills/${skill}`), `skill ${skill} is missing (routed from ${pkg})`);
  }

  for (const [skill, aliases] of Object.entries(SEGMENT_ALIASES)) {
    for (const [segment, target] of Object.entries(aliases)) {
      assert.ok(
        knowledgeTargets(exists, skill, target).length > 0,
        `alias ${skill}:${segment} -> ${target} resolves to no knowledge file`,
      );
    }
  }

  for (const [pkg, segment] of Object.entries(PACKAGE_SEGMENT)) {
    const skill = SKILL_BY_PACKAGE[pkg];
    assert.ok(
      knowledgeTargets(exists, skill, segment).length > 0,
      `${pkg} -> ${skill}:${segment} resolves to no knowledge file`,
    );
  }

  for (const path of GATE_PATHS) {
    assert.ok(exists(path), `gate file ${path} is missing; the self-edit notice would never fire`);
  }
});

// The guard above only checks map -> disk. Without the reverse a new package silently gets no
// routing at all, which is how apps/ and packages/libs went unaudited for their own guides.
test('every package with source is either routed to a skill or listed as deliberately unrouted', () => {
  const unrouted = readdirSync(join(REPO_ROOT, 'packages'))
    .map(name => `packages/${name}`)
    .filter(pkg => existsSync(join(REPO_ROOT, pkg, 'src')) && statSync(join(REPO_ROOT, pkg, 'src')).isDirectory())
    .filter(pkg => !SKILL_BY_PACKAGE[pkg] && !NO_SKILL_PACKAGES.has(pkg));

  assert.deepEqual(unrouted, [], 'add these to SKILL_BY_PACKAGE or to NO_SKILL_PACKAGES');

  for (const pkg of NO_SKILL_PACKAGES) {
    assert.ok(existsSync(join(REPO_ROOT, pkg)), `${pkg} is listed as unrouted but does not exist`);
  }
});
