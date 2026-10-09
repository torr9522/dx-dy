export type ReleaseRefPolicy =
  | { kind: "local" }
  | { kind: "pull-request"; base: "master" }
  | { kind: "branch"; branch: "master" }
  | { kind: "tag"; tag: string };

export function releaseRefPolicy(
  env: Record<string, string | undefined>,
  version: string,
): ReleaseRefPolicy;

export function validateTagProvenance(input: {
  head: string;
  tagObject: string | undefined;
  tagTarget: string | undefined;
  remoteMaster: string;
}): void;

export function validateRepositoryRef(options?: {
  cwd?: string;
  env?: Record<string, string | undefined>;
  version?: string;
  allowLocalDetached?: boolean;
  fetch?: boolean;
}): ReleaseRefPolicy;
