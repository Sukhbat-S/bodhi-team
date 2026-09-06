import { z } from "zod";

const isoDateTime = z.string().datetime({ offset: true });

const trustTierSchema = z.object({
  actionClass: z.string().min(1),
  tier: z.enum(["auto-do", "notify", "await"]),
});

const reviewedContextSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  content: z.string(),
  tags: z.array(z.string()),
  createdAt: isoDateTime,
});

export const priorFindingSchema = z.object({
  finding: z.string().min(1),
  kind: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  file: z.string().nullable().optional(),
  rationale: z.string().optional(),
  half_life_days: z.number().nonnegative().nullable().optional(),
  via: z.string().optional(),
  sighting_count: z.number().int().positive().optional(),
  first_seen: isoDateTime.optional(),
  last_seen: isoDateTime.optional(),
});

export type PriorFinding = z.infer<typeof priorFindingSchema>;

export function filterValidPriorFindings(findings: readonly unknown[]): PriorFinding[] {
  const valid: PriorFinding[] = [];
  for (const finding of findings) {
    const parsed = priorFindingSchema.safeParse(finding);
    if (parsed.success) valid.push(parsed.data);
  }
  return valid;
}

/** Runtime contract returned by GET /api/policy-packet. */
export const policyPacketSchema = Object.assign(z.object({
  contractVersion: z.literal(3),
  trustTiers: z.array(trustTierSchema),
  reviewedContext: z.array(reviewedContextSchema),
  libraryDomains: z.array(z.string()),
  evidenceOrder: z.array(z.string()).min(1),
  project: z.string(),
  cwd: z.string(),
  generatedAt: isoDateTime,
}), { priorFindingSchema, filterValidPriorFindings });

export type PolicyPacket = z.infer<typeof policyPacketSchema>;
