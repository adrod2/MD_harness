/**
 * How a god-hired worker's spawn request becomes a Copilot CLI executable +
 * argv, as a pure function.
 */
import {
  AGENT_RUNTIME_PROVIDER,
  autoModeFlagForProvider,
  hasAutoModeStance,
  inferAgentProvider
} from '../shared/agentProvider';
import { tokenizeCommand } from '../shared/commandLine';

export interface WorkerLaunch {
  /** The executable name alone — what the PTY layer resolves and spawns. */
  bin: string;
  /** Everything else, in argv form, model flag included when applicable. */
  args: string[];
  /** The full effective command line, for display and floor cards. */
  command: string;
}

/** Drop arguments from a previously configured provider before launching Copilot.
 *  Only the Copilot model, permission, and compatible session flags are retained. */
export function copilotRuntimeArgs(args: string[] | undefined, preserveCopilotOptions: boolean): string[] {
  const safe: string[] = [];
  for (let i = 0; i < (args?.length ?? 0); i++) {
    const arg = args?.[i] ?? '';
    const next = args?.[i + 1];
    if (preserveCopilotOptions && arg === '--model' && next) {
      safe.push(arg, next);
      i++;
    } else if (preserveCopilotOptions && arg === '--resume' && next) {
      safe.push(arg, next);
      i++;
    } else if (preserveCopilotOptions && arg.startsWith('--resume=')) {
      safe.push(arg);
    } else if (arg === '--allow-all-tools' || arg === '--no-ask-user') {
      safe.push(arg);
    }
  }
  return safe;
}

export function buildWorkerLaunch(opts: {
  /** `command` from the spawn request — god authors a full command LINE. */
  requestCommand?: unknown;
  requestProvider?: unknown;
  /** Separate `model` field from the request, if any. */
  requestModel?: unknown;
  defaultCommand?: string;
  /** The app's auto (skip-permissions) setting. */
  autoMode: boolean;
}): WorkerLaunch {
  const requestProvider = inferAgentProvider(
    typeof opts.requestCommand === 'string' ? opts.requestCommand : undefined,
    opts.requestProvider
  );
  const provider = AGENT_RUNTIME_PROVIDER;
  const requestedCommand =
    typeof opts.requestCommand === 'string' && opts.requestCommand.trim()
      ? opts.requestCommand.trim()
      : '';
  const requestedTokens = requestedCommand ? tokenizeCommand(requestedCommand) : [];
  const preserveCopilotOptions = requestProvider === provider;
  let command = provider;
  // Inherit the app's auto mode: headless workers have no human to approve
  // tool use. Discard non-Copilot flags rather than passing invalid options.
  const autoFlag = opts.autoMode ? autoModeFlagForProvider(provider) : '';
  if (autoFlag && !hasAutoModeStance(preserveCopilotOptions ? requestedTokens : tokenizeCommand(command), provider)) {
    command += ` ${autoFlag}`;
  }
  // Copilot is always the executable; the shared tokenizer lets a Copilot
  // command retain supported options without forwarding a provider binary.
  const flags = [
    ...(preserveCopilotOptions ? requestedTokens.slice(1) : []),
    ...tokenizeCommand(command).slice(1)
  ];
  // A separate `model` field only applies when the command line didn't pick a
  // model itself (spawnAgentCore likewise skips its default-model injection
  // when argv already carries --model).
  const model =
    requestProvider === provider &&
    typeof opts.requestModel === 'string' &&
    opts.requestModel.trim()
      ? opts.requestModel.trim()
      : '';
  const args = copilotRuntimeArgs(
    [...flags, ...(model && !flags.includes('--model') ? ['--model', model] : [])],
    preserveCopilotOptions
  );
  const tokens = tokenizeCommand(command);
  const bin = tokens[0] || command;
  const displayCommand = [bin, ...args]
    .map((arg) => (/\s/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg))
    .join(' ');
  return { bin, args, command: displayCommand };
}
