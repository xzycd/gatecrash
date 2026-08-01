#!/usr/bin/env node
/*
THESIS: Gatecrash makes one access boundary visible and refuses the generic security dashboard.
OWN-WORLD: A midnight venue patch bay, with flat ink, live lamps, channel rails, and a broken-gate mark.
STORY: Preview the run, watch routes cross sessions, review matching successes, then inspect one finding.
FIRST VIEWPORT: The mark and task lead; during work a short stage rail frames the active request; results lead with the access map.
FORM: The fifth grounded direction, staged as a live patch field from seed 401e3c64.
*/
import {Command, Option} from 'commander';
import {
  COMMAND_NAME,
  COMPACT_MARK,
  DESCRIPTION,
  TAGLINE,
} from './brand.js';
import {runCheckCommand, type CheckCommandOptions} from './commands/check.js';
import {runDemoCommand, type DemoCommandOptions} from './commands/demo.js';
import {runExplainCommand, type ExplainCommandOptions} from './commands/explain.js';
import {runInitCommand, type InitCommandOptions} from './commands/init.js';
import {runInspectCommand, type InspectCommandOptions} from './commands/inspect.js';
import {runUpdateCommand, type UpdateCommandOptions} from './commands/update.js';
import {GatecrashError} from './core/errors.js';
import {writeError, writeWelcome} from './ui/surface.js';
import {VERSION} from './version.js';

function commonOutputOptions(command: Command): Command {
  return command
    .addOption(
      new Option('-f, --format <format>', 'terminal, json, or markdown')
        .choices(['terminal', 'json', 'markdown'])
        .default('terminal'),
    )
    .option('-o, --out <path>', 'save the report at a specific path')
    .option('--no-save', 'do not save a JSON report')
    .option('--plain', 'disable the live terminal interface', false);
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name(COMMAND_NAME)
    .description(DESCRIPTION)
    .version(VERSION, '-v, --version')
    .showHelpAfterError()
    .showSuggestionAfterError()
    .configureHelp({sortSubcommands: true, sortOptions: true})
    .addHelpText('beforeAll', `${COMPACT_MARK} ${COMMAND_NAME}\n${TAGLINE}\n`)
    .addHelpText(
      'afterAll',
      `\nStart safely:\n  ${COMMAND_NAME} demo\n  ${COMMAND_NAME} inspect capture.har\n`,
    )
    .action(() => {
      writeWelcome();
    });

  commonOutputOptions(
    program
      .command('check')
      .description('replay a capture across configured sessions')
      .argument('<capture>', 'HAR, URL list, or crawler JSONL file')
      .option('-c, --config <path>', 'configuration file', 'gatecrash.yml')
      .option('--allow-method <method...>', 'explicitly allow extra HTTP methods')
      .option('--fail-on-review', 'exit with code 2 when a result needs review', false),
  ).action(async (capture: string, options: CheckCommandOptions) => {
    await runCheckCommand(capture, options);
  });

  program
    .command('inspect')
    .description('preview scope and request count without sending traffic')
    .argument('<capture>', 'HAR, URL list, or crawler JSONL file')
    .option('-c, --config <path>', 'configuration file', 'gatecrash.yml')
    .addOption(
      new Option('-f, --format <format>', 'terminal or json')
        .choices(['terminal', 'json'])
        .default('terminal'),
    )
    .option('--allow-method <method...>', 'preview extra HTTP methods')
    .option('--plain', 'disable styled terminal output', false)
    .action(async (capture: string, options: InspectCommandOptions) => {
      await runInspectCommand(capture, options);
    });

  commonOutputOptions(
    program
      .command('demo')
      .description('run Gatecrash against the built-in doorlab'),
  ).action(async (options: DemoCommandOptions) => {
    await runDemoCommand(options);
  });

  program
    .command('init')
    .description('write a small starter configuration')
    .argument('[path]', 'configuration path', 'gatecrash.yml')
    .option('--force', 'replace an existing file', false)
    .action(async (path: string, options: InitCommandOptions) => {
      await runInitCommand(path, options);
    });

  program
    .command('explain')
    .description('show the evidence behind a saved finding')
    .argument('<finding>', 'finding id, such as GTC-A13F22')
    .option('-r, --report <path>', 'saved JSON report; defaults to the latest')
    .option('--plain', 'disable styled terminal output', false)
    .action(async (id: string, options: ExplainCommandOptions) => {
      await runExplainCommand(id, options);
    });

  program
    .command('update')
    .description('install a verified Gatecrash release from GitHub')
    .argument('[version]', 'specific stable version; defaults to latest')
    .option('--check', 'show the available version without installing', false)
    .option('--force', 'allow reinstalling or installing an older version', false)
    .action(async (version: string | undefined, options: UpdateCommandOptions) => {
      await runUpdateCommand(version, options);
    });

  await program.parseAsync(process.argv);
}

void main().catch((error: unknown) => {
  writeError(error);
  process.exitCode = error instanceof GatecrashError ? error.exitCode : 1;
});
