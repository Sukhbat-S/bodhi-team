import { NATIVE_CODEX_REASONING } from "./reasoning.js";

export const STATUS_CONTRACT_VERSION = 1 as const;

type SchedulerStatusLike = {
  state: "leader" | "standby" | "degraded" | "stopped";
};

type MaintenanceArmLike = {
  arm: string;
  status: string;
  stale: boolean;
};

export type MaintenanceStatus =
  | {
      status: "available";
      staleArms: string[];
      unknownArms: string[];
      armsConsidered: number;
    }
  | { status: "unavailable" };

export async function buildStatusSnapshot<T extends SchedulerStatusLike>(input: {
  schedulerDetail: T;
  ownerName: string;
  readMaintenanceLiveness: () => Promise<MaintenanceArmLike[]>;
  uptimeSeconds?: number;
}) {
  let maintenanceLiveness: MaintenanceStatus;
  try {
    const arms = await input.readMaintenanceLiveness();
    maintenanceLiveness = {
      status: "available",
      staleArms: arms.filter((arm) => arm.stale).map((arm) => arm.arm),
      unknownArms: arms.filter((arm) => arm.status === "unknown").map((arm) => arm.arm),
      armsConsidered: arms.length,
    };
  } catch {
    maintenanceLiveness = { status: "unavailable" };
  }

  return {
    contractVersion: STATUS_CONTRACT_VERSION,
    substrate: "online" as const,
    reasoning: NATIVE_CODEX_REASONING,
    memory: "active" as const,
    scheduler: input.schedulerDetail.state === "leader"
      ? "running" as const
      : input.schedulerDetail.state,
    schedulerDetail: input.schedulerDetail,
    "maintenance-liveness": maintenanceLiveness,
    uptime: input.uptimeSeconds ?? process.uptime(),
    ownerName: input.ownerName,
    capabilities: [
      "memory", "entities", "library", "policy", "parking", "checkpoints",
      "verification-receipts", "personal-goals", "personal-opportunities", "workflow-candidates",
    ],
  };
}
