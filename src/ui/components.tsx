import React, {useEffect, useRef, useState} from 'react';
import {Box, Text, useApp, useStdout} from 'ink';
import {
  COMMAND_NAME,
  COMPACT_MARK,
  DESCRIPTION,
  LOGO_LINES,
  TAGLINE,
} from '../brand.js';
import {errorMessage, GatecrashError} from '../core/errors.js';
import type {
  CheckResult,
  Comparison,
  Finding,
  GatecrashReport,
  InspectionResult,
  ResponseRecord,
  RouteReport,
  RunProgress,
  RunStage,
} from '../core/types.js';
import {formatDuration, plural, truncateMiddle} from '../utils/format.js';
import {terminalText} from '../utils/security.js';
import {VERSION} from '../version.js';
import {glyph, palette} from './theme.js';

const STAGES: Array<{name: RunStage; label: string}> = [
  {name: 'capture', label: 'READ'},
  {name: 'scope', label: 'SCOPE'},
  {name: 'replay', label: 'REPLAY'},
  {name: 'compare', label: 'COMPARE'},
  {name: 'report', label: 'REPORT'},
];

const SPINNER_FRAMES = ['◆', '◇'];

function stageIndex(stage: RunStage): number {
  return STAGES.findIndex(({name}) => name === stage);
}

function Spinner(): React.JSX.Element {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(
      () => setIndex((value) => (value + 1) % SPINNER_FRAMES.length),
      140,
    );
    return () => clearInterval(timer);
  }, []);
  return <Text color={palette.live}>{SPINNER_FRAMES[index]}</Text>;
}

function Mark(): React.JSX.Element {
  return <Text bold color={palette.live}>{COMPACT_MARK}</Text>;
}

export function Brand({mode, full = false}: {mode: string; full?: boolean}): React.JSX.Element {
  const {stdout} = useStdout();
  const width = stdout.columns ?? 100;
  const expanded = full && width >= 58;

  if (!expanded) {
    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Mark />
          <Text bold color={palette.text}>{COMMAND_NAME}</Text>
          <Text color={palette.faint}>/ {mode.toLowerCase()}</Text>
        </Box>
        {full ? <Text color={palette.dim}>{TAGLINE}</Text> : null}
      </Box>
    );
  }

  return (
    <Box gap={2}>
      <Box flexDirection="column">
        {LOGO_LINES.map((line, index) => (
          <Text key={line} bold color={index === 1 ? palette.live : palette.text}>{line}</Text>
        ))}
      </Box>
      <Box flexDirection="column">
        <Box gap={1}>
          <Text bold color={palette.text}>{COMMAND_NAME}</Text>
          <Text color={palette.faint}>/ {mode.toLowerCase()}</Text>
        </Box>
        <Text color={palette.dim}>{TAGLINE}</Text>
        <Text color={palette.faint}>v{VERSION}  authorization boundary mapper</Text>
      </Box>
    </Box>
  );
}

export function WelcomeView(): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Brand mode="welcome" full />
      <Box marginTop={1} flexDirection="column">
        <Text color={palette.text}>{DESCRIPTION}</Text>
        <Text color={palette.dim}>Built for authorized tests, labs, and repeatable access reviews.</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Box><Box width={10}><Text bold color={palette.live}>TRY IT</Text></Box><Text>{COMMAND_NAME} demo</Text></Box>
        <Box><Box width={10}><Text color={palette.dim}>SET UP</Text></Box><Text>{COMMAND_NAME} init</Text></Box>
        <Box><Box width={10}><Text color={palette.dim}>PREVIEW</Text></Box><Text>{COMMAND_NAME} inspect capture.har</Text></Box>
      </Box>
      <Box marginTop={1}>
        <Text color={palette.faint}>help  {COMMAND_NAME} --help</Text>
      </Box>
    </Box>
  );
}

function ProgressBar({completed, total, width = 28}: {completed: number; total: number; width?: number}): React.JSX.Element {
  const ratio = total === 0 ? 0 : Math.min(1, completed / total);
  const filled = Math.round(ratio * width);
  return (
    <Text>
      <Text color={palette.live}>{glyph.barFull.repeat(filled)}</Text>
      <Text color={palette.rail}>{glyph.barEmpty.repeat(width - filled)}</Text>
    </Text>
  );
}

function stageDetail(stage: RunStage, progress: RunProgress): string {
  if (stage === 'capture' && progress.captured > 0) {
    return plural(progress.captured, 'captured request');
  }
  if (stage === 'scope' && progress.routes > 0) {
    return `${plural(progress.routes, 'route')} · ${progress.skipped} skipped`;
  }
  if (stage === 'report' && progress.stage === 'report') {
    return progress.detail;
  }
  return '';
}

function ProgressRail({progress}: {progress: RunProgress}): React.JSX.Element {
  const {stdout} = useStdout();
  const width = Math.max(44, stdout.columns ?? 100);
  const active = stageIndex(progress.stage);
  const expectedReplays = progress.replays || progress.routes * progress.profiles;

  return (
    <Box flexDirection="column" marginTop={1}>
      {progress.routes > 0 ? (
        <Box flexDirection={width < 70 ? 'column' : 'row'}>
          <Box width={width < 70 ? undefined : 34}>
            <Text color={palette.dim}>plan  </Text>
            <Text color={palette.text}>{plural(progress.routes, 'route')} × {plural(progress.profiles, 'session')}</Text>
          </Box>
          <Text color={palette.dim}>
            {terminalText(progress.baseline)} {glyph.arrow} {progress.challengers.map(terminalText).join(', ')}
          </Text>
        </Box>
      ) : null}
      <Box flexDirection="column" marginTop={1}>
        {STAGES.map((stage, index) => {
          const complete = index < active;
          const current = index === active;
          const detail = current
            ? progress.detail
            : complete
              ? stageDetail(stage.name, progress)
              : '';
          return (
            <Box key={stage.name}>
              <Box width={3}>
                {complete ? (
                  <Text color={palette.success}>{glyph.check}</Text>
                ) : current ? (
                  <Spinner />
                ) : (
                  <Text color={palette.faint}>{glyph.pending}</Text>
                )}
              </Box>
              <Box width={11}>
                <Text bold={current} color={current ? palette.text : complete ? palette.dim : palette.faint}>
                  {stage.label}
                </Text>
              </Box>
              {detail === '' ? null : (
                <Text color={current ? palette.dim : palette.faint}>
                  {truncateMiddle(terminalText(detail), Math.max(12, width - 18))}
                </Text>
              )}
            </Box>
          );
        })}
      </Box>
      {progress.stage === 'replay' ? (
        <Box marginTop={1} marginLeft={3}>
          <ProgressBar
            completed={progress.completed}
            total={progress.total}
            width={Math.max(12, Math.min(28, width - 18))}
          />
          <Text color={palette.dim}>  {progress.completed}/{expectedReplays}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function responseFor(route: RouteReport, profile: string): ResponseRecord | undefined {
  return route.responses.find((response) => response.profile === profile);
}

function comparisonFor(route: RouteReport, profile: string): Comparison | undefined {
  return route.comparisons.find((comparison) => comparison.challenger === profile);
}

function cellFor(
  report: GatecrashReport,
  route: RouteReport,
  profile: string,
): {label: string; color: string} {
  const response = responseFor(route, profile);
  if (response?.error !== undefined) {
    return {label: `ERR ${glyph.error}`, color: palette.warning};
  }
  const status = response?.status === undefined ? '-' : String(response.status);
  if (profile === report.config.baseline) {
    return {
      label: `${status} ${glyph.baseline}`,
      color: response?.status !== undefined && response.status >= 200 && response.status < 300
        ? palette.live
        : palette.warning,
    };
  }

  const comparison = comparisonFor(route, profile);
  switch (comparison?.outcome) {
    case 'review': return {label: `${status} ${glyph.review}`, color: palette.review};
    case 'blocked': return {label: `${status} ${glyph.blocked}`, color: palette.dim};
    case 'changed': return {label: `${status} ${glyph.changed}`, color: palette.info};
    case 'same': return {label: `${status} ${glyph.same}`, color: palette.success};
    case 'error': return {label: `ERR ${glyph.error}`, color: palette.warning};
    default: return {label: `${status} ${glyph.unknown}`, color: palette.warning};
  }
}

function routePriority(route: RouteReport): number {
  if (route.comparisons.some(({outcome}) => outcome === 'review')) return 0;
  if (route.comparisons.some(({outcome}) => outcome === 'error')) return 1;
  if (route.comparisons.some(({outcome}) => outcome === 'inconclusive')) return 2;
  if (route.comparisons.some(({outcome}) => outcome === 'changed')) return 3;
  return 4;
}

function orderedRoutes(report: GatecrashReport): RouteReport[] {
  return [...report.routes].sort(
    (left, right) => routePriority(left) - routePriority(right) || left.path.localeCompare(right.path),
  );
}

function AccessLegend({width}: {width: number}): React.JSX.Element {
  if (width < 70) {
    return (
      <Box flexDirection="column">
        <Box gap={2}>
          <Text color={palette.dim}>{glyph.baseline} baseline</Text>
          <Text color={palette.review}>{glyph.review} review</Text>
          <Text color={palette.dim}>{glyph.blocked} blocked</Text>
        </Box>
        <Box gap={2}>
          <Text color={palette.info}>{glyph.changed} changed</Text>
          <Text color={palette.warning}>{glyph.unknown} inconclusive</Text>
        </Box>
      </Box>
    );
  }
  return (
    <Box gap={2} flexWrap="wrap">
      <Text color={palette.dim}>{glyph.baseline} baseline</Text>
      <Text color={palette.review}>{glyph.review} review</Text>
      <Text color={palette.dim}>{glyph.blocked} blocked</Text>
      <Text color={palette.info}>{glyph.changed} changed</Text>
      <Text color={palette.warning}>{glyph.unknown} inconclusive</Text>
    </Box>
  );
}

function AccessMatrix({report, width}: {report: GatecrashReport; width: number}): React.JSX.Element {
  const profiles = report.config.profiles.map(({name}) => name);
  const compact = width < 78 || profiles.length > 4;
  const routes = orderedRoutes(report).slice(0, compact ? 8 : 14);
  const hidden = report.routes.length - routes.length;

  if (compact) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Box gap={2}>
          <Text bold color={palette.text}>ACCESS MAP</Text>
          <Text color={palette.faint}>{plural(report.summary.routes, 'route')} · {plural(profiles.length, 'session')}</Text>
        </Box>
        {routes.map((route) => {
          const review = route.comparisons.some(({outcome}) => outcome === 'review');
          return (
            <Box key={route.id} flexDirection="column" marginTop={1}>
              <Text color={review ? palette.review : palette.text}>
                {review ? `${glyph.review} ` : '  '}{route.method} {truncateMiddle(terminalText(route.path), Math.max(24, width - 8))}
              </Text>
              <Box marginLeft={2} gap={2} flexWrap="wrap">
                {profiles.map((profile) => {
                  const cell = cellFor(report, route, profile);
                  return (
                    <Text key={profile} color={cell.color}>
                      {terminalText(profile)} {cell.label}
                    </Text>
                  );
                })}
              </Box>
            </Box>
          );
        })}
        {hidden > 0 ? <Text color={palette.dim}>  +{hidden} more routes in the report</Text> : null}
        <Box marginTop={1}><AccessLegend width={width} /></Box>
      </Box>
    );
  }

  const profileWidth = Math.max(12, Math.min(18, Math.floor((width - 42) / profiles.length)));
  const routeWidth = Math.max(30, width - 2 - profileWidth * profiles.length);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box gap={2}>
        <Text bold color={palette.text}>ACCESS MAP</Text>
        <Text color={palette.faint}>{plural(report.summary.routes, 'route')} · {plural(profiles.length, 'session')}</Text>
      </Box>
      <Box marginTop={1}>
        <Box width={routeWidth}><Text color={palette.faint}>REQUEST</Text></Box>
        {profiles.map((profile) => (
          <Box key={profile} width={profileWidth}>
            <Text color={profile === report.config.baseline ? palette.liveMuted : palette.faint}>
              {truncateMiddle(
                `${terminalText(profile)}${profile === report.config.baseline ? '/base' : ''}`,
                profileWidth - 1,
              )}
            </Text>
          </Box>
        ))}
      </Box>
      <Text color={palette.rail}>{glyph.route.repeat(Math.max(1, width - 2))}</Text>
      {routes.map((route) => {
        const review = route.comparisons.some(({outcome}) => outcome === 'review');
        return (
          <Box key={route.id}>
            <Box width={routeWidth}>
              <Text color={review ? palette.review : palette.text}>
                {review ? `${glyph.review} ` : '  '}
                {truncateMiddle(`${route.method} ${terminalText(route.path)}`, routeWidth - 2)}
              </Text>
            </Box>
            {profiles.map((profile) => {
              const cell = cellFor(report, route, profile);
              return (
                <Box key={profile} width={profileWidth}>
                  <Text color={cell.color}>{cell.label}</Text>
                </Box>
              );
            })}
          </Box>
        );
      })}
      {hidden > 0 ? <Text color={palette.dim}>  +{hidden} more routes in the report</Text> : null}
      <Box marginTop={1}><AccessLegend width={width} /></Box>
    </Box>
  );
}

function FindingRow({finding, width}: {finding: Finding; width: number}): React.JSX.Element {
  const route = truncateMiddle(`${terminalText(finding.method)} ${terminalText(finding.path)}`, Math.max(22, width - 28));
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box gap={1} flexWrap="wrap">
        <Text bold color={palette.review}>{glyph.review} {terminalText(finding.id)}</Text>
        <Text color={palette.faint}>{finding.confidence.toUpperCase()}</Text>
        <Text color={palette.text}>{route}</Text>
      </Box>
      <Box marginLeft={2} gap={1} flexWrap="wrap">
        <Text color={palette.dim}>{terminalText(finding.baseline)} {finding.baselineStatus}</Text>
        <Text color={palette.rail}>{glyph.route.repeat(width < 62 ? 3 : 7)}</Text>
        <Text color={palette.review}>{terminalText(finding.challenger)} {finding.challengerStatus}</Text>
        <Text color={palette.dim}>
          {finding.exact ? 'exact match' : `${Math.round(finding.similarity * 100)}% match`}
        </Text>
      </Box>
      <Box marginLeft={2}>
        <Text color={palette.text}>{terminalText(finding.reason)}</Text>
      </Box>
    </Box>
  );
}

function SummaryRail({report, width}: {report: GatecrashReport; width: number}): React.JSX.Element {
  const review = (
    <Text color={report.summary.reviews > 0 ? palette.review : palette.success}>
      {report.summary.reviews} REVIEW
    </Text>
  );
  const blocked = <Text color={palette.dim}>{report.summary.blocked} BLOCKED</Text>;
  const changed = <Text color={palette.info}>{report.summary.changed} CHANGED</Text>;
  const errors = (
    <Text color={report.summary.errors > 0 ? palette.warning : palette.dim}>
      {report.summary.errors} ERRORS
    </Text>
  );
  const skipped = <Text color={palette.faint}>{report.summary.skipped} SKIPPED</Text>;

  if (width < 70) {
    return (
      <Box flexDirection="column">
        <Box gap={2}>{review}{blocked}{changed}</Box>
        <Box gap={2}>{errors}{skipped}</Box>
      </Box>
    );
  }
  return (
    <Box columnGap={2} rowGap={0} flexWrap="wrap">
      {review}{blocked}{changed}{errors}{skipped}
    </Box>
  );
}

export function ReportView({result}: {result: CheckResult}): React.JSX.Element {
  const {stdout} = useStdout();
  const width = Math.max(44, Math.min(stdout.columns ?? 100, 140));
  const {report} = result;
  const visibleFindings = report.findings.slice(0, 5);
  return (
    <Box flexDirection="column">
      <Brand mode="check" />
      <Box marginTop={1} flexDirection={width < 72 ? 'column' : 'row'}>
        <Box width={width < 72 ? undefined : Math.max(32, width - 38)}>
          <Text color={palette.text}>{terminalText(report.run.targetOrigin)}</Text>
        </Box>
        <Text color={palette.dim}>
          {plural(report.summary.routes, 'route')} × {plural(report.config.profiles.length, 'session')} · {formatDuration(report.run.durationMs)}
        </Text>
      </Box>
      <AccessMatrix report={report} width={width} />
      {visibleFindings.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Box gap={width < 70 ? 0 : 2} flexDirection={width < 70 ? 'column' : 'row'}>
            <Text bold color={palette.review}>{visibleFindings.length === 1 ? '1 NEEDS REVIEW' : `${report.findings.length} NEED REVIEW`}</Text>
            <Text color={palette.faint}>verify against the intended access policy</Text>
          </Box>
          {visibleFindings.map((finding) => <FindingRow key={finding.id} finding={finding} width={width} />)}
          {report.findings.length > visibleFindings.length ? (
            <Text color={palette.dim}>  +{report.findings.length - visibleFindings.length} more findings in the report</Text>
          ) : null}
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column">
          <Text bold color={palette.success}>{glyph.check} NO MATCHING CROSSINGS</Text>
          <Text color={palette.dim}>No matching successful response crossed the configured profile boundary.</Text>
        </Box>
      )}
      <Box marginTop={1}><SummaryRail report={report} width={width} /></Box>
      {result.reportPath === undefined ? null : (
        <Text color={palette.dim}>report  {terminalText(result.reportPath)}</Text>
      )}
      {report.findings[0] === undefined ? null : (
        <Text color={palette.text}>
          <Text color={palette.live}>next</Text>    {COMMAND_NAME} explain {terminalText(report.findings[0].id)}
        </Text>
      )}
    </Box>
  );
}

export function ErrorView({error}: {error: unknown}): React.JSX.Element {
  const hint = error instanceof GatecrashError ? error.hint : undefined;
  return (
    <Box flexDirection="column">
      <Brand mode="error" />
      <Box marginTop={1} flexDirection="column">
        <Text bold color={palette.review}>ERROR</Text>
        <Text color={palette.text}>{terminalText(errorMessage(error))}</Text>
        {hint === undefined ? null : (
          <Box marginTop={1}>
            <Text color={palette.live}>fix  </Text>
            <Text color={palette.dim}>{terminalText(hint)}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}

interface CheckAppProps {
  execute: (onProgress: (progress: RunProgress) => void) => Promise<CheckResult>;
  onSettled: (value: {result?: CheckResult; error?: unknown}) => void;
}

export function CheckApp({execute, onSettled}: CheckAppProps): React.JSX.Element {
  const {exit} = useApp();
  const started = useRef(false);
  const [progress, setProgress] = useState<RunProgress>({
    stage: 'capture',
    completed: 0,
    total: 1,
    detail: 'Opening capture',
    captured: 0,
    routes: 0,
    skipped: 0,
    profiles: 0,
    replays: 0,
    baseline: '',
    challengers: [],
  });
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;
    void execute(setProgress)
      .then((value) => {
        onSettled({result: value});
        setFinished(true);
      })
      .catch((error: unknown) => {
        onSettled({error});
        setFinished(true);
      });
  }, [execute, onSettled]);

  useEffect(() => {
    if (finished) {
      const timer = setTimeout(() => exit(), 20);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [exit, finished]);

  return (
    <Box flexDirection="column">
      <Brand mode="check" full />
      <ProgressRail progress={progress} />
    </Box>
  );
}

export function ExplainView({finding, reportPath}: {finding: Finding; reportPath: string}): React.JSX.Element {
  const {stdout} = useStdout();
  const width = Math.max(44, Math.min(stdout.columns ?? 100, 120));
  return (
    <Box flexDirection="column">
      <Brand mode="explain" />
      <Box marginTop={1}>
        <Text bold color={palette.review}>{glyph.review} {terminalText(finding.id)}</Text>
        <Text color={palette.faint}>  {finding.confidence.toUpperCase()} CONFIDENCE</Text>
      </Box>
      <Text color={palette.text}>
        {truncateMiddle(`${terminalText(finding.method)} ${terminalText(finding.path)}`, width - 2)}
      </Text>
      <Box marginTop={1} gap={1}>
        <Text color={palette.dim}>{terminalText(finding.baseline)} {finding.baselineStatus}</Text>
        <Text color={palette.rail}>{glyph.route.repeat(7)}</Text>
        <Text color={palette.review}>{terminalText(finding.challenger)} {finding.challengerStatus}</Text>
        <Text color={palette.dim}>{finding.exact ? 'exact' : `${Math.round(finding.similarity * 100)}%`}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text color={palette.text}>{terminalText(finding.reason)}</Text>
        {finding.evidence.map((item) => (
          <Text key={item} color={palette.dim}>  {glyph.bullet} {terminalText(item)}</Text>
        ))}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text bold color={palette.warning}>VERIFY MANUALLY</Text>
        <Text color={palette.dim}>Check the intended policy and inspect the raw exchange in your proxy.</Text>
      </Box>
      <Text color={palette.faint}>report  {terminalText(reportPath)}</Text>
    </Box>
  );
}

function skipCounts(inspection: InspectionResult): string {
  const counts = new Map<string, number>();
  for (const skipped of inspection.skipped) {
    counts.set(skipped.reason, (counts.get(skipped.reason) ?? 0) + 1);
  }
  return [...counts.entries()].map(([reason, count]) => `${count} ${reason}`).join(' · ');
}

export function InspectView({inspection}: {inspection: InspectionResult}): React.JSX.Element {
  const {stdout} = useStdout();
  const width = Math.max(44, Math.min(stdout.columns ?? 100, 120));
  const visibleRoutes = inspection.routes.slice(0, 10);
  return (
    <Box flexDirection="column">
      <Brand mode="inspect" />
      <Box marginTop={1}>
        <Text bold color={palette.success}>NO REQUESTS SENT</Text>
        <Text color={palette.faint}>  safe preview</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={palette.text}>{terminalText(inspection.targetOrigin)}</Text>
        <Text color={palette.dim}>
          {plural(inspection.routes.length, 'route')} × {plural(inspection.profiles, 'session')} = {plural(inspection.replays, 'request')}
        </Text>
        <Text color={palette.dim}>
          {terminalText(inspection.baseline)} {glyph.arrow} {inspection.challengers.map(terminalText).join(', ')}
        </Text>
        <Text color={palette.faint}>methods  {inspection.allowedMethods.join(', ')}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text bold color={palette.text}>IN SCOPE</Text>
        {visibleRoutes.map((route) => (
          <Text key={route.id} color={palette.dim}>
            {glyph.rail} {route.method} {truncateMiddle(terminalText(route.path), Math.max(20, width - 10))}
          </Text>
        ))}
        {inspection.routes.length > visibleRoutes.length ? (
          <Text color={palette.faint}>{glyph.rail} +{inspection.routes.length - visibleRoutes.length} more</Text>
        ) : null}
      </Box>
      {inspection.skipped.length > 0 ? (
        <Box marginTop={1}>
          <Text color={palette.faint}>skipped  {skipCounts(inspection)}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color={palette.live}>run  </Text>
        <Text>{COMMAND_NAME} check {terminalText(inspection.input)}</Text>
      </Box>
    </Box>
  );
}
