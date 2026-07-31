#!/usr/bin/env node
import {Command, Option} from 'commander';
import {runCheckCommand, type CheckCommandOptions} from './commands/check.js';
import {runDemoCommand, type DemoCommandOptions} from './commands/demo.js';
import {runExplainCommand, type ExplainCommandOptions} from './commands/explain.js';
import {runInitCommand, type InitCommandOptions} from './commands/init.js';
import {GuestlistError} from './core/errors.js';
import {plainError} from './ui/plain.js';
import {VERSION} from './version.js';

function commonOutputOptions(command: Command): Command {
  return command
    .addOption(new Option('-f, --format <format>', 'terminal, json, or markdown').default('terminal'))
    .option('-o, --out <path>', 'save the report at a specific path')
    .option('--no-save', 'do not save a JSON report')
    .option('--plain', 'disable the interactive terminal interface', false);
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name('guestlist')
    .description('Replay captured web requests across sessions and inspect access-control differences.')
    .version(VERSION)
    .showHelpAfterError()
    .configureHelp({sortSubcommands: true, sortOptions: true});

  commonOutputOptions(
    program
      .command('check')
      .description('replay a HAR, URL list, or Katana JSONL capture')
      .argument('<capture>', 'path to a capture file')
      .option('-c, --config <path>', 'configuration file', 'guestlist.yml')
      .option('--allow-method <method...>', 'explicitly allow extra HTTP methods')
      .option('--fail-on-review', 'exit with code 2 when a result needs review', false),
  ).action(async (capture: string, options: CheckCommandOptions) => {
    await runCheckCommand(capture, options);
  });

  commonOutputOptions(
    program
      .command('demo')
      .description('run Guestlist against the built-in vulnerable doorlab'),
  ).action(async (options: DemoCommandOptions) => {
    await runDemoCommand(options);
  });

  program
    .command('init')
    .description('write a small starter configuration')
    .argument('[path]', 'configuration path', 'guestlist.yml')
    .option('--force', 'replace an existing file', false)
    .action(async (path: string, options: InitCommandOptions) => {
      await runInitCommand(path, options);
    });

  program
    .command('explain')
    .description('show the evidence behind a saved finding')
    .argument('<finding>', 'finding id, such as GST-A13F22')
    .option('-r, --report <path>', 'saved JSON report; defaults to the latest')
    .option('--plain', 'disable styled terminal output', false)
    .action(async (id: string, options: ExplainCommandOptions) => {
      await runExplainCommand(id, options);
    });

  await program.parseAsync(process.argv);
}

void main().catch((error: unknown) => {
  process.stderr.write(plainError(error));
  process.exitCode = error instanceof GuestlistError ? error.exitCode : 1;
});
