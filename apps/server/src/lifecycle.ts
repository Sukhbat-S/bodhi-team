import { serve as honoServe } from "@hono/node-server";
import { closeDb } from "@seneca/db";
import type { Hono } from "hono";
import { evaluateBootGuard } from "./bootGuard.js";
import { isApiAuthEnabled } from "./middleware/apiAuth.js";
import type { Runtime } from "./runtime.js";

interface ServerHandle {
  close(callback: (error?: Error) => void): void;
  closeIdleConnections?(): void;
  closeAllConnections?(): void;
}

interface LifecycleDependencies {
  serve: (options: { fetch: Hono["fetch"]; port: number; hostname: string }, onListening: () => void) => ServerHandle;
  closeDb: () => Promise<void>;
  authEnabled: () => boolean;
  shutdownGraceMs?: number;
  exit?: (code: number) => void;
}

export interface RunningRuntime {
  stop: () => Promise<void>;
}

const defaultDependencies: LifecycleDependencies = {
  serve: honoServe,
  closeDb,
  authEnabled: isApiAuthEnabled,
  shutdownGraceMs: 5_000,
};

async function closeHttpServer(server: ServerHandle, graceMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(graceTimer);
      if (error) console.error("   HTTP server close FAILED:", error.message);
      resolve();
    };
    const graceTimer = setTimeout(() => {
      try {
        server.closeAllConnections?.();
      } catch (error) {
        console.error("   HTTP forced close FAILED:", error instanceof Error ? error.message : error);
      }
      finish();
    }, graceMs);
    try {
      server.close(finish);
      server.closeIdleConnections?.();
    } catch (error) {
      console.error("   HTTP server close FAILED:", error instanceof Error ? error.message : error);
      finish();
    }
  });
}

export async function startRuntime(
  runtime: Runtime,
  app: Hono,
  dependencies: LifecycleDependencies = defaultDependencies,
): Promise<RunningRuntime> {
  const { config, scheduler } = runtime;
  const bindHost = config.HOST?.trim() || "127.0.0.1";
  const guard = evaluateBootGuard(bindHost, dependencies.authEnabled());
  if (!guard.allowed) throw new Error(guard.reason);

  console.log("\n  Starting substrate services...");
  const server = dependencies.serve(
    { fetch: app.fetch, port: config.PORT, hostname: bindHost },
    () => {
      const reach = bindHost === "127.0.0.1" || bindHost === "localhost"
        ? "localhost-only"
        : `bound to ${bindHost} (auth enabled)`;
      console.log(`  API server: http://${bindHost}:${config.PORT} (${reach})`);
    },
  );
  scheduler.start();

  const keepAliveInterval = setInterval(runtime.keepAlive, 3 * 24 * 60 * 60 * 1000);
  keepAliveInterval.unref();

  console.log("\n🌳  BODHI substrate is online.\n");
  let stopPromise: Promise<void> | undefined;
  const stop = () => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      console.log("\n🌳  BODHI substrate shutting down...");
      clearInterval(keepAliveInterval);
      scheduler.stop();
      await closeHttpServer(server, dependencies.shutdownGraceMs ?? 5_000);
      try {
        await dependencies.closeDb();
        console.log("   DB pool drained");
      } catch (error) {
        console.error("   DB pool close FAILED:", error instanceof Error ? error.message : error);
      }
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      process.off("unhandledRejection", onUnhandledRejection);
      process.off("uncaughtException", onUncaughtException);
    })();
    return stopPromise;
  };
  const exit = dependencies.exit ?? ((code: number) => process.exit(code));
  const onSignal = () => { void stop().then(() => exit(0), () => exit(1)); };
  let fatalExitScheduled = false;
  const fatal = () => {
    if (fatalExitScheduled) return;
    fatalExitScheduled = true;
    void stop().then(() => exit(1), () => exit(1));
  };
  const onUnhandledRejection = (reason: unknown) => {
    console.error("[server] UNHANDLED REJECTION (shutting down):", reason instanceof Error ? reason.stack ?? reason.message : reason);
    fatal();
  };
  const onUncaughtException = (error: Error) => {
    console.error("[server] UNCAUGHT EXCEPTION (shutting down):", error.stack ?? error.message);
    fatal();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  process.on("unhandledRejection", onUnhandledRejection);
  process.on("uncaughtException", onUncaughtException);
  return { stop };
}
