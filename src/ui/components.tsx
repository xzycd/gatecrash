import React, {useEffect, useRef, useState} from 'react';
import {Box, Text, useApp, useStdout} from 'ink';
import {errorMessage, GuestlistError} from '../core/errors.js';
import type {
  CheckResult,
  Finding,
  GuestlistReport,
  ResponseRecord,
  RouteReport,
  RunProgress,
  RunStage,
} from '../core/types.js';
import {formatDuration, plural, truncateMiddle} from '../utils/format.js';
import {glyph, palette} from './theme.js';

const STAGES: Array<{name: RunStage; label: string}> = [
  {name: 'capture', label: 'Read capture'},
  {name: 'scope', label: 'Apply scope'},
  {name: 'replay', label: 'Replay sessions'},
  {name: 'compare', label: 'Compare bodies'},
  {name: 'report', label: 'Write report'},
];

function stageIndex(stage: RunStage): number {
  return STAGES.findIndex(({name}) => name === stage);
}

function Spinner(): React.JSX.Element {
  const frames = ['◒', '◐', '◓', '◑'];
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setIndex((value) => (value + 1) % frames.length), 90);
    return () => clearInterval(timer);
  }, [frames.length]);
  return <Text color={palette.brand}>{frames[index]}</Text>;
}

export function Brand({mode}: {mode: string}): React.JSX.Element {
  return (
    <Box>
      <Text bold color={palette.brand}>guestlist</Text>
      <Text color={palette.faint}>  {mode.toLowerCase()}</Text>
    </Box>
  );
}

function ProgressBar({completed, total, width = 24}: {completed: number; total: number; width?: number}): React.JSX.Element {
  const ratio = total === 0 ? 0 : Math.min(1, completed / total);
  const filled = Math.round(ratio * width);
  return (
    <Text>
      <Text color={palette.brand}>{glyph.barFull.repeat(filled)}</Text>
      <Text color={palette.faint}>{glyph.barEmpty.repeat(width - filled)}</Text>
    </Text>
  );
}

function ProgressRail({progress}: {progress: RunProgress}): React.JSX.Element {
  const active = stageIndex(progress.stage);
  return (
    <Box flexDirection="column" marginTop={1}>
      {STAGES.map((stage, index) => {
        const complete = index < active;
        const current = index === active;
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
            <Box width={19}>
              <Text color={current ? palette.text : complete ? palette.dim : palette.faint}>
                {stage.label}
              </Text>
            </Box>
            {current ? (
              <Text color={palette.dim}>{truncateMiddle(progress.detail, 62)}</Text>
            ) : null}
          </Box>
        );
      })}
      {progress.stage === 'replay' ? (
        <Box marginTop={1} marginLeft={3}>
          <ProgressBar completed={progress.completed} total={progress.total} />
          <Text color={palette.dim}>  {progress.completed}/{progress.total}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function statusColor(status: number | undefined): string {
  if (status === undefined) {
    return palette.warning;
  }
  if (status >= 200 && status < 300) {
    return palette.success;
  }
  if (status === 401 || status === 403 || status === 404) {
    return palette.dim;
  }
  if (status >= 500) {
    return palette.review;
  }
  return palette.warning;
}

function responseFor(route: RouteReport, profile: string): ResponseRecord | undefined {
  return route.responses.find((response) => response.profile === profile);
}

function responseLabel(route: RouteReport, profile: string): string {
  const response = responseFor(route, profile);
  if (response?.error !== undefined) {
    return 'error';
  }
  if (response?.status === undefined) {
    return '·';
  }

  const comparison = route.comparisons.find((item) => item.challenger === profile);
  if (comparison?.outcome === 'review') {
    return `${response.status} ${Math.round(comparison.similarity * 100)}%`;
  }
  return String(response.status);
}

function orderedRoutes(report: GuestlistReport): RouteReport[] {
  return [...report.routes].sort((left, right) => {
    const leftReview = left.comparisons.some(({outcome}) => outcome === 'review');
    const rightReview = right.comparisons.some(({outcome}) => outcome === 'review');
    return Number(rightReview) - Number(leftReview) || left.path.localeCompare(right.path);
  });
}

function AccessMatrix({report, width}: {report: GuestlistReport; width: number}): React.JSX.Element {
  const profiles = report.config.profiles.map(({name}) => name);
  const compact = width < 76;
  const routes = orderedRoutes(report).slice(0, compact ? 8 : 12);
  const hidden = report.routes.length - routes.length;

  if (compact) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color={palette.dim}>access map</Text>
        {routes.map((route) => (
          <Box key={route.id} flexDirection="column" marginTop={1}>
            <Text color={route.comparisons.some(({outcome}) => outcome === 'review') ? palette.review : palette.text}>
              {route.comparisons.some(({outcome}) => outcome === 'review') ? `${glyph.current} ` : ''}{route.method} {truncateMiddle(route.path, Math.max(24, width - 8))}
            </Text>
            <Box marginLeft={2} gap={2} flexWrap="wrap">
              {profiles.map((profile) => {
                const response = responseFor(route, profile);
                return (
                  <Text key={profile} color={statusColor(response?.status)}>
                    {profile} {responseLabel(route, profile)}
                  </Text>
                );
              })}
            </Box>
          </Box>
        ))}
        {hidden > 0 ? <Text color={palette.dim}>  +{hidden} more routes in the report</Text> : null}
      </Box>
    );
  }

  const profileWidth = Math.max(12, Math.min(18, Math.floor((width - 39) / profiles.length)));
  const routeWidth = Math.max(28, width - 3 - profileWidth * profiles.length);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={palette.dim}>access map</Text>
      <Box marginTop={1}>
        <Box width={routeWidth}><Text color={palette.faint}>request</Text></Box>
        {profiles.map((profile) => (
          <Box key={profile} width={profileWidth}><Text color={palette.faint}>{truncateMiddle(profile, profileWidth - 1)}</Text></Box>
        ))}
      </Box>
      {routes.map((route) => {
        const review = route.comparisons.some(({outcome}) => outcome === 'review');
        return (
          <Box key={route.id}>
            <Box width={routeWidth}>
              <Text color={review ? palette.review : palette.text}>
                {review ? `${glyph.current} ` : '  '}{truncateMiddle(`${route.method} ${route.path}`, routeWidth - 2)}
              </Text>
            </Box>
            {profiles.map((profile) => {
              const response = responseFor(route, profile);
              return (
                <Box key={profile} width={profileWidth}>
                  <Text color={statusColor(response?.status)}>{responseLabel(route, profile)}</Text>
                </Box>
              );
            })}
          </Box>
        );
      })}
      {hidden > 0 ? <Text color={palette.dim}>  +{hidden} more routes in the report</Text> : null}
    </Box>
  );
}

function FindingCard({finding}: {finding: Finding}): React.JSX.Element {
  return (
    <Box flexDirection="column" marginTop={1} paddingLeft={2} borderStyle="single" borderLeft borderRight={false} borderTop={false} borderBottom={false} borderColor={palette.review}>
      <Box gap={1}>
        <Text bold color={palette.review}>{finding.id}</Text>
        <Text color={palette.text}>{finding.method} {finding.path}</Text>
      </Box>
      <Text color={palette.dim}>{finding.baseline} {finding.baselineStatus} {glyph.arrow} {finding.challenger} {finding.challengerStatus}  {finding.exact ? 'exact body match' : `${Math.round(finding.similarity * 100)}% body match`}</Text>
      <Text color={palette.text}>{finding.reason}</Text>
    </Box>
  );
}

export function ReportView({result}: {result: CheckResult}): React.JSX.Element {
  const {stdout} = useStdout();
  const width = Math.max(44, Math.min(stdout.columns ?? 100, 120));
  const {report} = result;
  const visibleFindings = report.findings.slice(0, 5);
  return (
    <Box flexDirection="column">
      <Brand mode="check" />
      <Box marginTop={1} gap={2} flexWrap="wrap">
        <Text color={palette.text}>{report.run.targetOrigin}</Text>
        <Text color={palette.dim}>{plural(report.summary.routes, 'route')} · {plural(report.config.profiles.length, 'profile')} · {formatDuration(report.run.durationMs)}</Text>
      </Box>
      <AccessMatrix report={report} width={width} />
      {visibleFindings.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={palette.review}>review</Text>
          {visibleFindings.map((finding) => <FindingCard key={finding.id} finding={finding} />)}
          {report.findings.length > visibleFindings.length ? (
            <Text color={palette.dim}>  +{report.findings.length - visibleFindings.length} more findings in the report</Text>
          ) : null}
        </Box>
      ) : (
        <Box marginTop={1}><Text color={palette.success}>{glyph.check} No matching successful responses crossed the configured profile boundary.</Text></Box>
      )}
      {width < 70 ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={report.summary.reviews > 0 ? palette.review : palette.success}>
            {plural(report.summary.reviews, 'result')} to review
          </Text>
          <Text color={palette.dim}>{report.summary.blocked} blocked · {report.summary.changed} changed · {report.summary.skipped} skipped</Text>
        </Box>
      ) : (
        <Box marginTop={1} gap={1}>
          <Text color={report.summary.reviews > 0 ? palette.review : palette.success}>
            {plural(report.summary.reviews, 'result')} to review
          </Text>
          <Text color={palette.faint}>·</Text>
          <Text color={palette.dim}>{report.summary.blocked} blocked · {report.summary.changed} changed · {report.summary.skipped} skipped</Text>
        </Box>
      )}
      {result.reportPath === undefined ? null : (
        <Text color={palette.dim}>report  {result.reportPath}</Text>
      )}
      {report.findings[0] === undefined ? null : (
        <Text color={palette.dim}>next    guestlist explain {report.findings[0].id}</Text>
      )}
    </Box>
  );
}

export function ErrorView({error}: {error: unknown}): React.JSX.Element {
  const hint = error instanceof GuestlistError ? error.hint : undefined;
  return (
    <Box flexDirection="column">
      <Brand mode="error" />
      <Box marginTop={1} paddingLeft={2} borderStyle="single" borderLeft borderRight={false} borderTop={false} borderBottom={false} borderColor={palette.review} flexDirection="column">
        <Text color={palette.review}>{errorMessage(error)}</Text>
        {hint === undefined ? null : <Text color={palette.dim}>{hint}</Text>}
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
  });
  const [result, setResult] = useState<CheckResult>();
  const [failure, setFailure] = useState<unknown>();

  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;
    void execute(setProgress)
      .then((value) => {
        setResult(value);
        onSettled({result: value});
      })
      .catch((error: unknown) => {
        setFailure(error);
        onSettled({error});
      });
  }, [execute, onSettled]);

  useEffect(() => {
    if (result !== undefined || failure !== undefined) {
      const timer = setTimeout(() => exit(), 20);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [exit, failure, result]);

  if (failure !== undefined) {
    return <ErrorView error={failure} />;
  }
  if (result !== undefined) {
    return <ReportView result={result} />;
  }

  return (
    <Box flexDirection="column">
      <Brand mode="check" />
      <Text color={palette.dim}>Same request. Different session.</Text>
      <ProgressRail progress={progress} />
    </Box>
  );
}

export function ExplainView({finding, reportPath}: {finding: Finding; reportPath: string}): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Brand mode="explain" />
      <Box marginTop={1} gap={1}>
        <Text bold color={palette.review}>{finding.id}</Text>
        <Text color={palette.text}>{finding.method} {finding.path}</Text>
      </Box>
      <Text color={palette.dim}>{finding.baseline} {finding.baselineStatus} {glyph.arrow} {finding.challenger} {finding.challengerStatus}</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text color={palette.text}>{finding.reason}</Text>
        {finding.evidence.map((item) => (
          <Text key={item} color={palette.dim}>  {glyph.bullet} {item}</Text>
        ))}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text color={palette.warning}>Treat this as a lead, not a vulnerability verdict.</Text>
        <Text color={palette.dim}>Check the intended access policy, then inspect the raw exchange in your proxy.</Text>
      </Box>
      <Text color={palette.faint}>report  {reportPath}</Text>
    </Box>
  );
}
