'use strict';

/**
 * god authors a spawn request's `command` as a full command LINE, but the PTY
 * layer takes one executable plus argv. The unsplit line made node-pty exec a
 * binary literally named `claude --model … --permission-mode …` → ENOENT → the
 * worker died in under a second WHILE its request archived as `.done`. A
 * failure that presents as success is exactly what a unit test is for.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { buildWorkerLaunch, copilotRuntimeArgs } = loadTs('src/main/workerLaunch.ts');
const { tokenizeCommand } = loadTs('src/shared/commandLine.ts');

const launch = (over = {}) => buildWorkerLaunch({ autoMode: false, ...over });

test('every worker runs Copilot CLI, regardless of configured engine', () => {
  const l = launch({ requestCommand: 'claude' });
  assert.equal(l.bin, 'copilot');
  assert.deepEqual(l.args, []);
});

test('provider-specific command flags are not passed to Copilot', () => {
  const l = launch({ requestCommand: 'claude --permission-mode plan --verbose' });
  assert.equal(l.bin, 'copilot');
  assert.deepEqual(l.args, []);
});

test('runtime strips foreign flags and only keeps compatible Copilot options', () => {
  assert.deepEqual(
    copilotRuntimeArgs(
      ['--permission-mode', 'plan', '--model', 'gpt-5.4', '--resume', 'session-1', '--allow-all-tools'],
      true
    ),
    ['--model', 'gpt-5.4', '--resume', 'session-1', '--allow-all-tools']
  );
  assert.deepEqual(copilotRuntimeArgs(['--model', 'claude-fable-5'], false), []);
});

test('provider-specific models are not passed to Copilot', () => {
  const l = launch({ requestCommand: 'agy --model "Gemini 3.1 Pro (High)"' });
  assert.equal(l.bin, 'copilot');
  assert.deepEqual(l.args, []);
});

test('Copilot commands retain their model and the separate model field fills it when absent', () => {
  const applied = launch({ requestCommand: 'copilot', requestProvider: 'copilot', requestModel: 'gpt-5.4' });
  assert.deepEqual(applied.args, ['--model', 'gpt-5.4']);
  const deduped = launch({
    requestCommand: 'copilot --model claude-sonnet-4.5',
    requestProvider: 'copilot',
    requestModel: 'gpt-5.4'
  });
  assert.deepEqual(deduped.args, ['--model', 'claude-sonnet-4.5'], 'the command line wins over raw.model');
});

test('auto-mode enables unattended Copilot tools without print mode', () => {
  const l = launch({ requestCommand: 'claude', autoMode: true });
  assert.equal(l.bin, 'copilot');
  assert.deepEqual(l.args, ['--allow-all-tools', '--no-ask-user']);
  assert.ok(!l.args.includes('-p'));
});

test('foreign permission stances are discarded, while Copilot options are retained', () => {
  const l = launch({ requestCommand: 'claude --permission-mode plan', autoMode: true });
  assert.deepEqual(l.args, ['--allow-all-tools', '--no-ask-user']);
  const copilot = launch({
    requestCommand: 'copilot --allow-all-tools --no-ask-user',
    requestProvider: 'copilot',
    autoMode: true
  });
  assert.deepEqual(copilot.args, ['--allow-all-tools', '--no-ask-user']);
});

test('auto-mode OFF appends nothing', () => {
  assert.deepEqual(launch({ requestCommand: 'claude', autoMode: false }).args, []);
  assert.deepEqual(launch({ requestCommand: 'codex', autoMode: false }).args, []);
});

test('custom and invalid providers cannot override the Copilot runtime', () => {
  const custom = launch({ requestProvider: 'custom', defaultCommand: 'company-agent', autoMode: true });
  assert.equal(custom.bin, 'copilot');
  assert.deepEqual(custom.args, ['--allow-all-tools', '--no-ask-user']);
  assert.equal(launch({ requestProvider: null, defaultCommand: 'opencode' }).bin, 'copilot');
});

test('a missing command still resolves to Copilot, and compatible Copilot flags survive', () => {
  assert.equal(launch({ defaultCommand: 'codex --full-auto' }).bin, 'copilot');
  assert.equal(launch({}).bin, 'copilot');
  assert.deepEqual(
    launch({ requestCommand: 'copilot --model gpt-5.4 -p ignored', requestProvider: 'copilot' }).args,
    ['--model', 'gpt-5.4']
  );
});

test('main and renderer split with the SAME tokenizer (shared module)', () => {
  // The old inline copy was byte-identical to the renderer's; now it IS the
  // renderer's. One example locks the routing through the shared function.
  assert.deepEqual(tokenizeCommand(`a "b c" 'd e' f`), ['a', 'b c', 'd e', 'f']);
});
