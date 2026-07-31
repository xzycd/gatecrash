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
}

export interface ExcludeConfig {
  paths: string[];
  extensions: string[];
}

export interface GuestlistConfig {
  target: TargetConfig;
  profiles: ProfileConfig[];
  compare: CompareConfig;
  exclude: ExcludeConfig;
}

export interface CapturedRequest {
  id: string;
  method: string;
  url: URL;
  headers: Record<string, string>;
  body?: string;
  source: string;
}

export interface PreparedRoute {
  id: string;
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
  reason: 'duplicate' | 'excluded' | 'out-of-scope' | 'unsafe-method';
  detail: string;
}

export type BodyKind = 'empty' | 'json' | 'html' | 'text' | 'binary';

export interface ResponseRecord {
  profile: string;
  status?: number;
  contentType?: string;
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
}

export type ComparisonOutcome =
  | 'review'
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

export interface Finding {
  id: string;
  routeId: string;
  method: string;
  path: string;
  baseline: string;
  challenger: string;
  baselineStatus: number;
  challengerStatus: number;
  similarity: number;
  exact: boolean;
  confidence: 'high' | 'medium';
  reason: string;
  evidence: string[];
}

export interface ReportSummary {
  captured: number;
  routes: number;
  replays: number;
  reviews: number;
  blocked: number;
  changed: number;
  errors: number;
  skipped: number;
}

export interface GuestlistReport {
  schemaVersion: number;
  toolVersion: string;
  run: {
    id: string;
    startedAt: string;
    durationMs: number;
    input: string;
    targetOrigin: string;
  };
  config: {
    baseline: string;
    profiles: Array<{name: string; level: number}>;
    allowedMethods: string[];
    similarityThreshold: number;
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
}

export interface CheckOptions {
  inputLabel: string;
  allowedMethods: Set<string>;
  save: boolean;
  outputPath?: string;
  onProgress?: (progress: RunProgress) => void;
}

export interface CheckResult {
  report: GuestlistReport;
  reportPath?: string;
}
