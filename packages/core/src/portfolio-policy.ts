import { z } from "zod";
const Key = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const CompactText = z.string().trim().min(1).max(120);
const CommunicationChannel = z.enum(["gmail", "messenger", "telegram", "viber"]);
const Channel = Key;

const ProjectRouteSchema = z.object({
  key: Key,
  nativeLabels: z.array(CompactText).min(1).max(10),
  pathLeaves: z.array(CompactText).min(1).max(10),
  preferredPathLeaf: CompactText,
  aliases: z.array(CompactText).max(20),
}).strict();

export const ProjectRoutingV2Schema = z.object({
  version: z.literal(2),
  projects: z.array(ProjectRouteSchema).min(1).max(20),
}).strict();

const Project = z.object({
  key: Key,
  displayName: CompactText,
  organizationKey: Key.nullable(),
  stakeholderAliases: z.array(CompactText).max(20),
  groupDisplayNames: z.array(CompactText).max(10),
}).strict();

const Stakeholder = z.object({
  displayAlias: CompactText,
  organizationKey: Key.nullable(),
  projectKeys: z.array(Key).min(1).max(10),
  roles: z.array(CompactText).max(10),
  permittedChannels: z.array(CommunicationChannel).min(1).max(4),
}).strict();

const Organization = z.object({
  key: Key,
  displayName: CompactText,
  projectKeys: z.array(Key).min(1).max(20),
}).strict();

const ApprovedGroup = z.object({
  channel: Channel,
  displayName: CompactText,
  organizationKey: Key,
  projectKeys: z.array(Key).min(1).max(10),
}).strict();

const ChannelPolicy = z.object({
  channel: Channel,
  status: z.enum(["enabled", "deferred"]),
  transport: z.enum(["direct-connector", "authenticated-chrome-session", "installed-mac-app", "none"]),
  account: z.string().email().max(254).nullable(),
  scope: z.enum([
    "owner-calendar",
    "allowlisted-stakeholders",
    "allowlisted-stakeholders-and-approved-groups",
    "allowlisted-stakeholders-or-owner-confirmed-project-group",
    "deferred",
  ]),
  availabilityChecks: z.array(z.enum([
    "connector-available",
    "account-matches",
    "chrome-available",
    "mac-app-installed",
    "authenticated-session",
    "exact-display-match",
  ])).max(5),
}).strict();

export const PortfolioPolicyV1Schema = z.object({
  $schema: z.literal("PortfolioPolicyV1"),
  version: z.literal(1),
  owner: Key,
  timezone: CompactText,
  routingConfig: z.string().regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+\.json$/),
  attention: z.object({
    primaryOutcomes: z.number().int().min(1).max(5),
    maxSupportingOutcomes: z.number().int().min(0).max(10),
    maxFocusProjects: z.number().int().min(1).max(20),
    showAllProjects: z.boolean(),
  }).strict(),
  reviews: z.object({
    morningLocalTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    eveningLocalTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    calendarHorizonHours: z.number().int().min(1).max(720),
    communicationLookback: CompactText,
    maxCatchUpHours: z.number().int().min(1).max(720),
    missedRun: CompactText,
    weekendMode: CompactText,
    weeklyRebalanceDay: CompactText,
  }).strict(),
  replanning: z.object({
    triggers: z.array(CompactText).min(1).max(20),
    nonTrigger: CompactText,
    priorityOrder: z.array(CompactText).min(1).max(20),
  }).strict(),
  futureProjectAdmission: z.object({
    unmatchedNativeProject: z.literal("propose-only"),
    admission: z.literal("explicit-owner-confirmation"),
    requiredConfirmations: z.tuple([
      z.literal("canonical-key"),
      z.literal("organization"),
      z.literal("stakeholders"),
      z.literal("communication-sources"),
    ]),
  }).strict(),
  organizations: z.array(Organization).max(20),
  projects: z.array(Project).min(1).max(20),
  stakeholders: z.array(Stakeholder).max(50),
  approvedGroups: z.array(ApprovedGroup).max(20),
  channels: z.array(ChannelPolicy).min(1).max(50),
  durableEvidence: z.object({
    sources: z.array(z.enum([
      "native-codex-projects",
      "native-codex-tasks",
      "bodhi-goals",
      "bodhi-checkpoints",
      "bodhi-parking",
      "bodhi-receipts",
      "native-claude-code-sessions",
    ])).length(7),
    persist: z.array(z.enum([
      "durable-decisions",
      "durable-commitments",
      "checkpoint-state",
      "material-verification-receipts",
    ])).length(4),
    forbid: z.array(z.enum([
      "raw-messages",
      "conversation-history",
      "credentials",
      "contact-secrets",
      "native-task-state",
    ])).length(5),
  }).strict(),
  externalWrites: z.object({
    approval: z.literal("exact-envelope-once"),
    actions: z.array(z.enum(["send", "platform-draft", "calendar-mutation", "delete", "account-state-change"])).length(5),
    envelopeFields: z.tuple([
      z.literal("account"),
      z.literal("site-or-channel"),
      z.literal("destination-or-audience"),
      z.literal("action"),
      z.literal("complete-content-or-diff"),
      z.literal("attachments"),
      z.literal("visibility"),
      z.literal("material-side-effects"),
    ]),
    verifyDestination: z.literal(true),
    uncertainResult: z.literal("unverified-no-retry"),
  }).strict(),
}).strict();

export type PortfolioPolicyV1 = z.infer<typeof PortfolioPolicyV1Schema>;

export class PortfolioPolicyValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`invalid PortfolioPolicyV1 (${errors.length} errors): ${errors.join("; ")}`);
    this.name = "PortfolioPolicyValidationError";
  }
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

function duplicateErrors(values: readonly string[], label: string): string[] {
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const value of values) {
    const normalized = normalize(value);
    if (seen.has(normalized)) errors.push(`${label}: duplicate ${JSON.stringify(value)}`);
    seen.add(normalized);
  }
  return errors;
}

function listEquals(left: readonly string[], right: readonly string[]): boolean {
  return [...left].sort().join("\0") === [...right].sort().join("\0");
}

function compactSafetyErrors(policy: PortfolioPolicyV1): string[] {
  const json = JSON.stringify(policy);
  const errors: string[] = [];
  if (/"(?:projectId|hostId|taskId|threadId|phone|address|token|secret|credential|rawMessage|messageBody|conversationHistory)"\s*:/i.test(json)) {
    errors.push("policy: forbidden identity, secret, raw-content, or task-state field");
  }
  const displayValues = [
    ...policy.organizations.flatMap((item) => [item.displayName]),
    ...policy.projects.flatMap((item) => [item.displayName, ...item.stakeholderAliases, ...item.groupDisplayNames]),
    ...policy.stakeholders.flatMap((item) => [item.displayAlias]),
    ...policy.approvedGroups.flatMap((item) => [item.displayName]),
  ];
  if (displayValues.some((value) => /(?:\+?\d[\s().-]*){8,}/.test(value))) errors.push("policy: phone-shaped display value is forbidden");
  if (displayValues.some((value) => /\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/i.test(value))) errors.push("policy: opaque identifier-shaped display value is forbidden");
  return errors;
}

export function parsePortfolioPolicyV1(raw: unknown, rawRouting: unknown): PortfolioPolicyV1 {
  const parsed = PortfolioPolicyV1Schema.safeParse(raw);
  const parsedRouting = ProjectRoutingV2Schema.safeParse(rawRouting);
  if (!parsed.success || !parsedRouting.success) {
    const errors = [
      ...(parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join(".") || "policy"}: ${issue.message}`)),
      ...(parsedRouting.success ? [] : parsedRouting.error.issues.map((issue) => `routing.${issue.path.join(".") || "config"}: ${issue.message}`)),
    ];
    throw new PortfolioPolicyValidationError(errors);
  }

  const policy = parsed.data;
  const routes = parsedRouting.data.projects;
  const errors = compactSafetyErrors(policy);
  errors.push(...duplicateErrors(policy.projects.map((item) => item.key), "projects"));
  errors.push(...duplicateErrors(policy.projects.map((item) => item.displayName), "project display names"));
  errors.push(...duplicateErrors(policy.organizations.map((item) => item.key), "organizations"));
  errors.push(...duplicateErrors(policy.organizations.map((item) => item.displayName), "organization display names"));
  errors.push(...duplicateErrors(policy.stakeholders.map((item) => item.displayAlias), "stakeholders"));
  errors.push(...duplicateErrors(policy.channels.map((item) => item.channel), "channels"));
  errors.push(...duplicateErrors(policy.approvedGroups.map((item) => `${item.channel}:${item.displayName}`), "approvedGroups"));
  errors.push(...duplicateErrors(policy.replanning.triggers, "replanning triggers"));
  errors.push(...duplicateErrors(policy.replanning.priorityOrder, "replanning priorityOrder"));
  errors.push(...duplicateErrors(policy.futureProjectAdmission.requiredConfirmations, "future project confirmations"));
  errors.push(...duplicateErrors(policy.durableEvidence.sources, "durable evidence sources"));
  errors.push(...duplicateErrors(policy.durableEvidence.persist, "durable evidence persistence"));
  errors.push(...duplicateErrors(policy.durableEvidence.forbid, "durable evidence prohibitions"));
  errors.push(...duplicateErrors(policy.externalWrites.actions, "external write actions"));
  errors.push(...duplicateErrors(policy.externalWrites.envelopeFields, "external write envelopeFields"));

  const projectKeys = new Set(policy.projects.map((item) => item.key));
  const organizationKeys = new Set(policy.organizations.map((item) => item.key));
  const stakeholderAliases = new Set(policy.stakeholders.map((item) => normalize(item.displayAlias)));
  const approvedGroupNames = new Set(policy.approvedGroups.map((item) => normalize(item.displayName)));

  for (const organization of policy.organizations) {
    errors.push(...duplicateErrors(organization.projectKeys, `organization ${organization.key} projectKeys`));
    for (const key of organization.projectKeys) if (!projectKeys.has(key)) errors.push(`organization ${organization.key}: unknown project ${key}`);
  }
  for (const project of policy.projects) {
    if (project.organizationKey && !organizationKeys.has(project.organizationKey)) errors.push(`project ${project.key}: unknown organization ${project.organizationKey}`);
    errors.push(...duplicateErrors(project.stakeholderAliases, `project ${project.key} stakeholderAliases`));
    errors.push(...duplicateErrors(project.groupDisplayNames, `project ${project.key} groupDisplayNames`));
    for (const alias of project.stakeholderAliases) if (!stakeholderAliases.has(normalize(alias))) errors.push(`project ${project.key}: unknown stakeholder ${alias}`);
    for (const group of project.groupDisplayNames) if (!approvedGroupNames.has(normalize(group))) errors.push(`project ${project.key}: unknown approved group ${group}`);
  }
  for (const stakeholder of policy.stakeholders) {
    if (stakeholder.organizationKey && !organizationKeys.has(stakeholder.organizationKey)) errors.push(`stakeholder ${stakeholder.displayAlias}: unknown organization ${stakeholder.organizationKey}`);
    errors.push(...duplicateErrors(stakeholder.projectKeys, `stakeholder ${stakeholder.displayAlias} projectKeys`));
    errors.push(...duplicateErrors(stakeholder.permittedChannels, `stakeholder ${stakeholder.displayAlias} permittedChannels`));
    for (const key of stakeholder.projectKeys) {
      const project = policy.projects.find((candidate) => candidate.key === key);
      if (!project) errors.push(`stakeholder ${stakeholder.displayAlias}: unknown project ${key}`);
      else if (!project.stakeholderAliases.some((alias) => normalize(alias) === normalize(stakeholder.displayAlias))) {
        errors.push(`stakeholder ${stakeholder.displayAlias}: project ${key} does not link back`);
      } else if (project.organizationKey !== stakeholder.organizationKey) {
        errors.push(`stakeholder ${stakeholder.displayAlias}: organization does not match project ${key}`);
      }
    }
  }
  for (const group of policy.approvedGroups) {
    if (!organizationKeys.has(group.organizationKey)) errors.push(`approved group ${group.displayName}: unknown organization ${group.organizationKey}`);
    errors.push(...duplicateErrors(group.projectKeys, `approved group ${group.displayName} projectKeys`));
    for (const key of group.projectKeys) {
      const project = policy.projects.find((candidate) => candidate.key === key);
      if (!project) errors.push(`approved group ${group.displayName}: unknown project ${key}`);
      else if (!project.groupDisplayNames.some((name) => normalize(name) === normalize(group.displayName))) {
        errors.push(`approved group ${group.displayName}: project ${key} does not link back`);
      } else if (project.organizationKey !== group.organizationKey) {
        errors.push(`approved group ${group.displayName}: organization does not match project ${key}`);
      }
    }
  }

  for (const organization of policy.organizations) {
    const declared = policy.projects.filter((project) => project.organizationKey === organization.key).map((project) => project.key);
    if (!listEquals(declared, organization.projectKeys)) errors.push(`organization ${organization.key}: project membership is not bidirectional`);
  }

  const routeKeys = routes.map((route) => route.key);
  errors.push(...duplicateErrors(routeKeys, "project routes"));
  if (!listEquals(routeKeys, [...projectKeys])) errors.push("project routes: keys must exactly match admitted portfolio projects");
  const routeTokens: string[] = [];
  for (const route of routes) {
    if (!route.pathLeaves.includes(route.preferredPathLeaf)) errors.push(`project route ${route.key}: preferredPathLeaf must be an admitted path leaf`);
    errors.push(...duplicateErrors(route.nativeLabels, `project route ${route.key} nativeLabels`));
    errors.push(...duplicateErrors(route.pathLeaves, `project route ${route.key} pathLeaves`));
    errors.push(...duplicateErrors(route.aliases, `project route ${route.key} aliases`));
    routeTokens.push(...[route.key, ...route.aliases, ...route.pathLeaves, ...route.nativeLabels]
      .map((token) => `${normalize(token)}:${route.key}`));
  }
  const crossRouteDuplicates = (values: string[], label: string): void => {
    const owners = new Map<string, string>();
    for (const entry of values) {
      const separator = entry.lastIndexOf(":");
      const value = entry.slice(0, separator);
      const owner = entry.slice(separator + 1);
      const prior = owners.get(value);
      if (prior && prior !== owner) errors.push(`${label}: ${JSON.stringify(value)} belongs to both ${prior} and ${owner}`);
      owners.set(value, owner);
    }
  };
  crossRouteDuplicates(routeTokens, "project route identity tokens");

  for (const channel of policy.channels) {
    errors.push(...duplicateErrors(channel.availabilityChecks, `channel ${channel.channel} availabilityChecks`));
    if (channel.status === "deferred" && (channel.transport !== "none" || channel.scope !== "deferred" || channel.availabilityChecks.length > 0)) {
      errors.push(`channel ${channel.channel}: deferred channel must have no transport, scope, or availability assumption`);
    }
    if (channel.status === "enabled" && channel.availabilityChecks.length === 0) errors.push(`channel ${channel.channel}: enabled channel requires availability checks`);
  }

  if (errors.length) throw new PortfolioPolicyValidationError(errors);
  return policy;
}

export function assertAdmittedPortfolioProject(policy: PortfolioPolicyV1, projectKey: string): void {
  if (!policy.projects.some((project) => project.key === projectKey)) {
    throw new PortfolioPolicyValidationError([`project ${projectKey}: explicit owner admission required`]);
  }
}
