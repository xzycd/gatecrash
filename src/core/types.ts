export type OutputFormat = 'terminal' | 'json' | 'markdown';

export interface TargetConfig {
  origin: string;
  requestsPerSecond: number;
  concurrency: number;
  timeoutMs: number;
  maxResponseBytes: number;
}

export interface ProfileConfig {
  name: string;
  level: number;
  headers: Record<string, string>;
  cookies: Record<string, string>;
}

export interface CompareConfig {
  baseline: string;
  against: string[];
  similarityThreshold: number;
  volatileJsonKeys: string[];
  control: boolean;
}

export interface ExcludeConfig {
  paths: string[];
  extensions: string[];
}

export interface SampleConfig {
  perPattern: number;
}

export interface GatecrashConfig {
  target: TargetConfig;
  profiles: ProfileConfig[];
  compare: CompareConfig;
  exclude: ExcludeConfig;
  sample: SampleConfig;
}

export interface CapturedRequest {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body?: string;
  source: string;
}

export interface PreparedRoute {
  id: string;
  reportId: string;
  method: string;
  url: URL;
  path: string;
  pattern: string;
  queryNames: string[];
  headers: Record<string, string>;
  body?: string;
  source: string;
}

export interface SkippedRoute {
  id: string;
  method: string;
  path: string;
  reason: 'duplicate' | 'excluded' | 'out-of-scope' | 'sampled' | 'unsafe-method';
  detail: string;
}

export type BodyKind = 'empty' | 'json' | 'html' | 'text' | 'binary';

export interface ResponseRecord {
  profile: string;
  status?: number;
  bytes: number;
  kind: BodyKind;
  truncated: boolean;
  durationMs: number;
  error?: string;
}

export interface InternalResponse extends ResponseRecord {
  normalized: string;
  structure: Set<string>;
  tokens: Set<string>;
  /**
   * How many bytes of this body could tell one session's data from another's.
   * An empty collection is identical for every caller, so an identical copy of
   * it arriving at a second session is not evidence about anything.
   */
  contentBytes: number;
}

export type ComparisonOutcome =
  | 'review'
  | 'public'
  | 'blocked'
  | 'changed'
  | 'same'
  | 'inconclusive'
  | 'error';

export interface Comparison {
  baseline: string;
  challenger: string;
  baselineStatus?: number;
  challengerStatus?: number;
  similarity: number;
  exact: boolean;
  outcome: ComparisonOutcome;
  reason: string;
}

export interface RouteReport {
  id: string;
  method: string;
  path: string;
  pattern: string;
  queryNames: string[];
  responses: ResponseRecord[];
  comparisons: Comparison[];
}

export type Confidence = 'high' | 'medium' | 'low';

export interface FindingCrossing {
  challenger: string;
  status: number;
  similarity: number;
  exact: boolean;
}

/**
 * One route, every session that got through it. Keyed by route rather than by
 * (route, session): a route open to four sessions is one thing to go and fix,
 * and printing it four times buries the next route under it.
 */
export interface Finding {
  id: string;
  routeId: string;
  method: string;
  path: string;
  baseline: string;
  baselineStatus: number;
  crossings: FindingCrossing[];
  /** The strongest crossing, which is the one that decides the confidence. */
  similarity: number;
  exact: boolean;
  confidence: Confidence;
  reason: string;
  evidence: string[];
}

export interface ReportSummary {
  // Capture entries.
  captured: number;
  skipped: number;
  sampled: number;
  // Routes.
  routes: number;
  findings: number;
  high: number;
  medium: number;
  low: number;
  // Requests sent.
  replays: number;
  // Comparisons: one per (route, challenger) pair.
  comparisons: number;
  reviews: number;
  publicResults: number;
  blocked: number;
  changed: number;
  errors: number;
}

export interface GatecrashReport {
  schemaVersion: number;
  toolVersion: string;
  run: {
    id: string;
    startedAt: string;
    durationMs: number;
    input: string;
    targetOrigin: string;
    /** Set when the operator stopped the run before the plan finished. */
    interrupted?: boolean;
  };
  config: {
    baseline: string;
    profiles: Array<{name: string; level: number}>;
    control: boolean;
    allowedMethods: string[];
    similarityThreshold: number;
    samplePerPattern: number;
  };
  summary: ReportSummary;
  routes: RouteReport[];
  findings: Finding[];
  skipped: SkippedRoute[];
}

export type RunStage = 'capture' | 'scope' | 'replay' | 'compare' | 'report';

export interface RunProgress {
  stage: RunStage;
  completed: number;
  total: number;
  detail: string;
  captured: number;
  routes: number;
  skipped: number;
  profiles: number;
  replays: number;
  baseline: string;
  challengers: string[];
  /** Milliseconds left at the configured rate, or undefined before replay. */
  remainingMs?: number;
}

export interface CheckOptions {
  inputLabel: string;
  allowedMethods: Set<string>;
  save: boolean;
  outputPath?: string;
  onProgress?: (progress: RunProgress) => void;
  /** Resolves when the operator interrupts, so the run stops and still reports. */
  signal?: AbortSignal;
}

export interface CheckResult {
  report: GatecrashReport;
  reportPath?: string;
  /** True when the operator interrupted and the report covers part of the plan. */
  interrupted?: boolean;
}

export interface InspectionResult {
  input: string;
  targetOrigin: string;
  baseline: string;
  challengers: string[];
  control: boolean;
  allowedMethods: string[];
  captured: number;
  routes: Array<{
    id: string;
    method: string;
    path: string;
    pattern: string;
    queryNames: string[];
  }>;
  /** In-scope routes folded by pattern, so 200 file IDs read as one family. */
  families: Array<{
    method: string;
    pattern: string;
    matched: number;
    replayed: number;
  }>;
  skipped: SkippedRoute[];
  profiles: number;
  replays: number;
  /** What the plan costs at target.requests_per_second, before any of it runs. */
  estimatedMs: number;
}
