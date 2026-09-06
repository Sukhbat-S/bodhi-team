import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

export interface ProjectRoute {
  key: string;
  nativeLabels: string[];
  pathLeaves: string[];
  preferredPathLeaf: string;
  aliases: string[];
}

export interface NativeProjectDescriptor {
  projectId: string;
  label: string;
  path: string;
  hostId: string;
  gitCapable: boolean;
}

export interface NativeTaskDescriptor {
  taskId: string;
  projectId: string | null;
  hostId: string;
  cwd: string;
  gitCommonDirectory?: string | null;
}

export type TargetSource = "explicit" | "alias" | "relationship";

export type TargetResolution =
  | { kind: "resolved"; source: TargetSource; projectKey: string; route: ProjectRoute; nativeProject: NativeProjectDescriptor }
  | { kind: "unsaved"; source: TargetSource; projectKey: string; route: ProjectRoute }
  | { kind: "admission-required"; source: "explicit"; proposedProjectKey: string; nativeProject: NativeProjectDescriptor }
  | { kind: "ambiguous"; source: TargetSource; projectKeys: string[] }
  | { kind: "projectless-artifact" }
  | { kind: "control-room" }
  | { kind: "unresolved" };

export interface ResolveTargetInput {
  objective: string;
  explicitTarget?: string;
  relationshipProjectKeys?: string[];
  routes: readonly ProjectRoute[];
  nativeProjects: readonly NativeProjectDescriptor[];
  projectlessArtifact?: boolean;
  controlRoomOnly?: boolean;
}

function normalizePhrase(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizePath(value: string): string {
  return value.normalize("NFKC").replaceAll("\\", "/").replace(/\/+$/, "").toLocaleLowerCase("en-US");
}

function exactPhraseAppears(text: string, phrase: string): boolean {
  const normalizedText = ` ${normalizePhrase(text)} `;
  const normalizedAlias = normalizePhrase(phrase);
  return normalizedAlias.length > 0 && normalizedText.includes(` ${normalizedAlias} `);
}

function routeTokens(route: ProjectRoute): string[] {
  return [route.key, ...route.pathLeaves, ...route.nativeLabels, ...route.aliases].map(normalizePhrase);
}

function routesForExplicitTarget(target: string, routes: readonly ProjectRoute[]): ProjectRoute[] {
  const phrase = normalizePhrase(target);
  const leaf = normalizePhrase(basename(normalizePath(target)));
  return routes.filter((route) => routeTokens(route).includes(phrase) || routeTokens(route).includes(leaf));
}

function nativeProjectsForRoute(
  route: ProjectRoute,
  nativeProjects: readonly NativeProjectDescriptor[],
): NativeProjectDescriptor[] {
  const labels = new Set(route.nativeLabels.map(normalizePhrase));
  const expectedLeaves = new Set(route.pathLeaves.map(normalizePhrase));
  return nativeProjects.filter((project) =>
    labels.has(normalizePhrase(project.label))
    || expectedLeaves.has(normalizePhrase(basename(normalizePath(project.path)))),
  );
}

function finishRoute(
  route: ProjectRoute,
  source: TargetSource,
  nativeProjects: readonly NativeProjectDescriptor[],
  explicitTarget?: string,
): TargetResolution {
  const matches = nativeProjectsForRoute(route, nativeProjects);
  if (matches.length === 0) return { kind: "unsaved", source, projectKey: route.key, route };
  if (matches.length > 1 && explicitTarget) {
    const exact = nativeProjectsForExactTarget(explicitTarget, matches);
    if (exact.length === 1) return { kind: "resolved", source, projectKey: route.key, route, nativeProject: exact[0] };
  }
  if (matches.length > 1) {
    const preferred = normalizePhrase(route.preferredPathLeaf);
    const preferredMatches = matches.filter((project) =>
      normalizePhrase(basename(normalizePath(project.path))) === preferred,
    );
    if (preferredMatches.length === 1) {
      return { kind: "resolved", source, projectKey: route.key, route, nativeProject: preferredMatches[0] };
    }
    return { kind: "ambiguous", source, projectKeys: [route.key] };
  }
  return { kind: "resolved", source, projectKey: route.key, route, nativeProject: matches[0] };
}

function syntheticRoute(target: string): ProjectRoute {
  const leaf = normalizePhrase(basename(normalizePath(target)) || target).replaceAll(" ", "-");
  return {
    key: leaf,
    nativeLabels: [target],
    pathLeaves: [leaf],
    preferredPathLeaf: leaf,
    aliases: [],
  };
}

function nativeProjectsForExactTarget(
  target: string,
  nativeProjects: readonly NativeProjectDescriptor[],
): NativeProjectDescriptor[] {
  const phrase = normalizePhrase(target);
  const path = normalizePath(target);
  return nativeProjects.filter((project) =>
    normalizePhrase(project.label) === phrase
    || normalizePath(project.path) === path,
  );
}

/** Resolve one writable target without storing native project IDs or paths in configuration. */
export function resolveProjectTarget(input: ResolveTargetInput): TargetResolution {
  if (input.explicitTarget?.trim()) {
    const configured = routesForExplicitTarget(input.explicitTarget, input.routes);
    if (configured.length > 1) {
      return { kind: "ambiguous", source: "explicit", projectKeys: configured.map((route) => route.key).sort() };
    }
    if (configured.length === 1) return finishRoute(configured[0], "explicit", input.nativeProjects, input.explicitTarget);

    const nativeMatches = nativeProjectsForExactTarget(input.explicitTarget, input.nativeProjects);
    const route = syntheticRoute(input.explicitTarget);
    if (nativeMatches.length === 1) {
      return {
        kind: "admission-required",
        source: "explicit",
        proposedProjectKey: route.key,
        nativeProject: nativeMatches[0],
      };
    }
    if (nativeMatches.length > 1) {
      return { kind: "ambiguous", source: "explicit", projectKeys: [route.key] };
    }
    return { kind: "unsaved", source: "explicit", projectKey: route.key, route };
  }

  const aliasMatches = input.routes.filter((route) =>
    [route.key, ...route.aliases].some((alias) => exactPhraseAppears(input.objective, alias)),
  );
  if (aliasMatches.length > 1) {
    return { kind: "ambiguous", source: "alias", projectKeys: aliasMatches.map((route) => route.key).sort() };
  }
  if (aliasMatches.length === 1) return finishRoute(aliasMatches[0], "alias", input.nativeProjects);

  const relationshipMatches = [...new Set((input.relationshipProjectKeys ?? []).map(normalizePhrase))]
    .flatMap((key) => input.routes.filter((route) => normalizePhrase(route.key) === key));
  if (relationshipMatches.length > 1) {
    return {
      kind: "ambiguous",
      source: "relationship",
      projectKeys: relationshipMatches.map((route) => route.key).sort(),
    };
  }
  if (relationshipMatches.length === 1) {
    return finishRoute(relationshipMatches[0], "relationship", input.nativeProjects);
  }

  if (input.projectlessArtifact) return { kind: "projectless-artifact" };
  if (input.controlRoomOnly) return { kind: "control-room" };
  return { kind: "unresolved" };
}

export type SeparateTaskConstraint =
  | "distinct-saved-project-worktree"
  | "isolation"
  | "recurring-execution"
  | "independent-activity-item";

export type SessionLocationDecision =
  | { kind: "in-place" }
  | {
      kind: "separate-task";
      reason: "user-requested" | SeparateTaskConstraint;
      explainBoundary: true;
      confirmationRequired: boolean;
      navigate: boolean;
    };

export interface DecideSessionLocationInput {
  /** Context only. A project mention must never select a separate task. */
  projectMentioned?: boolean;
  userRequestedSeparateTask?: boolean;
  userRequestedHandoff?: boolean;
  nativeConstraint?: SeparateTaskConstraint;
}

/** Keep work in the originating task unless the user or a concrete native constraint says otherwise. */
export function decideSessionLocation(input: DecideSessionLocationInput): SessionLocationDecision {
  if (input.userRequestedSeparateTask || input.userRequestedHandoff) {
    return {
      kind: "separate-task",
      reason: "user-requested",
      explainBoundary: true,
      confirmationRequired: false,
      navigate: input.userRequestedHandoff === true,
    };
  }
  if (input.nativeConstraint) {
    return {
      kind: "separate-task",
      reason: input.nativeConstraint,
      explainBoundary: true,
      confirmationRequired: true,
      navigate: false,
    };
  }
  return { kind: "in-place" };
}

export type SessionTaskContext = "in-place" | "routing-only" | "separate-target";
export type SessionCheckpointDisposition = "reuse" | "not-required" | "binding-unavailable";

/** Missing target bindings are errors only for tasks known to be separate targets. */
export function decideSessionCheckpointDisposition(input: {
  taskContext: SessionTaskContext;
  applicableCheckpointExists: boolean;
}): SessionCheckpointDisposition {
  if (input.applicableCheckpointExists) return "reuse";
  return input.taskContext === "separate-target" ? "binding-unavailable" : "not-required";
}

export type CollisionConclusion =
  | "Likely conflict"
  | "Possible overlap"
  | "No saved overlap observed — unsaved or not-yet-written edits cannot be ruled out.";

export function concludeCollision(input: {
  samePathChangedInAnotherWorktree: boolean;
  activeTasksShareWorkingDirectory: boolean;
}): CollisionConclusion {
  if (input.samePathChangedInAnotherWorktree) return "Likely conflict";
  if (input.activeTasksShareWorkingDirectory) return "Possible overlap";
  return "No saved overlap observed — unsaved or not-yet-written edits cannot be ruled out.";
}

export type TaskLifecycleDecision =
  | { kind: "resume"; taskId: string }
  | { kind: "create" }
  | { kind: "disambiguate"; taskIds: string[] };

export function decideTaskLifecycle(candidates: readonly {
  taskId: string;
  sameSavedProject: boolean;
  exactUnfinishedObjective: boolean;
}[]): TaskLifecycleDecision {
  const exact = candidates.filter((candidate) => candidate.sameSavedProject && candidate.exactUnfinishedObjective);
  if (exact.length === 0) return { kind: "create" };
  if (exact.length === 1) return { kind: "resume", taskId: exact[0].taskId };
  return { kind: "disambiguate", taskIds: exact.map((candidate) => candidate.taskId) };
}

/**
 * Desktop may omit projectId on a native task created from a saved project.
 * In that case, prove ownership from the same host plus Git common-directory
 * linkage (or an exact saved-project cwd for non-worktree local/remote tasks).
 */
export function nativeTaskMatchesSavedProject(
  task: NativeTaskDescriptor,
  project: NativeProjectDescriptor,
): boolean {
  if (task.hostId !== project.hostId) return false;
  if (task.projectId) return task.projectId === project.projectId;
  if (task.gitCommonDirectory) {
    const common = normalizePath(task.gitCommonDirectory);
    const repository = basename(common) === ".git" ? dirname(common) : common;
    return repository === normalizePath(project.path);
  }
  return normalizePath(task.cwd) === normalizePath(project.path);
}

function pathIsWithin(path: string, root: string): boolean {
  const candidate = resolve(path);
  const boundary = resolve(root);
  const child = relative(boundary, candidate);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

export function assertSessionWriteAllowed(input:
  | { effect: "bodhi-api" }
  | {
      effect: "file";
      path?: string;
      targetRoot: string;
      artifactRoot?: string;
      targetWritable: boolean;
      mutationAuthorized: boolean;
      collisionChecked: boolean;
    }
): void {
  if (input.effect === "bodhi-api") return;
  if (!input.path) throw new Error("file write requires an absolute target path");
  if (!isAbsolute(input.path) || !isAbsolute(input.targetRoot)) {
    throw new Error("file write requires an exact absolute target root and path");
  }
  if (input.artifactRoot && !isAbsolute(input.artifactRoot)) {
    throw new Error("artifact root must be absolute when provided");
  }
  if (!input.targetWritable) throw new Error("file write requires a writable exact target root");
  if (!input.mutationAuthorized) throw new Error("file write is not authorized for the exact target");
  if (!input.collisionChecked) throw new Error("file write requires the saved-collision preflight");
  const allowed = pathIsWithin(input.path, input.targetRoot)
    || Boolean(input.artifactRoot && pathIsWithin(input.path, input.artifactRoot));
  if (!allowed) throw new Error("file write escaped its exact target root and declared artifact root");
}
