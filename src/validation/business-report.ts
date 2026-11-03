export interface BusinessIssue {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export interface BusinessReport {
  readonly version: string;
  readonly status: 'passed' | 'passed-with-warnings' | 'failed';
  readonly issues: readonly BusinessIssue[];
}
