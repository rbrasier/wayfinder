import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import {
  domainError,
  err,
  type BuiltInEngineStatus,
  type EngineChoice,
  type IPdfConverter,
  type Result,
} from "@wayfinder/domain";
import { EngineSupervisor, type EngineProcess } from "./engine-supervisor";
import { GotenbergPdfConverter } from "./gotenberg-pdf-converter";
import { LocalPdfConverter, type ConverterRun } from "./local-pdf-converter";

type Env = Record<string, string | undefined>;

// Reads the converter choice per call, so an admin switching between Built-in
// and External takes effect without a restart (ADR-069 §2).
export class RoutingPdfConverter implements IPdfConverter {
  constructor(
    private readonly loadChoice: () => Promise<EngineChoice>,
    private readonly builtIn: IPdfConverter | null,
    private readonly external: (url: string) => IPdfConverter = (url) => new GotenbergPdfConverter(async () => url),
  ) {}

  async convertDocxToPdfA(docxBytes: Buffer): Promise<Result<Buffer>> {
    const choice = await this.loadChoice();
    if (choice.source === "external") return this.external(choice.url).convertDocxToPdfA(docxBytes);
    if (!this.builtIn) return err(domainError("INFRA_FAILURE", "There is no built-in PDF converter here."));
    return this.builtIn.convertDocxToPdfA(docxBytes);
  }
}

// The child processes get only what they need. The web server's own secrets
// (database, encryption and model keys) are never handed to LibreOffice or the
// JVM, both of which parse documents.
export const childEnvironment = (env: Env, keys: readonly string[]): Env => {
  const passed: Env = {};
  for (const key of keys) {
    if (env[key] !== undefined) passed[key] = env[key];
  }
  return passed;
};

// The group may already be gone when a timeout fires in the same instant the
// process exits; an uncaught ESRCH from a timer would take the web server down.
export const killProcessGroup = (
  pid: number,
  kill: (pid: number, signal: "SIGKILL") => void = (target, signal) => process.kill(target, signal),
): void => {
  try {
    kill(-pid, "SIGKILL");
  } catch {
    // Nothing left to kill.
  }
};

const CONVERTER_ENV_KEYS = ["PATH", "HOME", "TZ", "LANG", "LC_ALL", "TMPDIR"] as const;

// Runs LibreOffice in its own process group, so a timeout kills every helper
// process it forked rather than leaving them behind.
const runProcess =
  (env: Env): ConverterRun =>
  (command, args, timeoutMs) =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      env: childEnvironment(env, CONVERTER_ENV_KEYS) as NodeJS.ProcessEnv,
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) killProcessGroup(child.pid);
    }, timeoutMs);
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ exitCode: null, timedOut });
    });
    child.on("exit", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, timedOut });
    });
  });

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });

const isHealthy = async (baseUrl: string): Promise<boolean> => {
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
};

const ENGINE_ENV_KEYS = [
  "PATH",
  "HOME",
  "TZ",
  "LANG",
  "JAVA_TOOL_OPTIONS",
  "DSS_ENVIRONMENT",
  "SIGNING_TRUST_MOCK_CA",
] as const;

const engineEnv = (env: Env, port: number): Env => ({
  ...childEnvironment(env, ENGINE_ENV_KEYS),
  PORT: String(port),
  BIND_ADDRESS: "127.0.0.1",
  TRUST_ANCHORS_DIR: env.TRUST_ANCHORS_DIR ?? "/app/trust",
});

const spawnEngine = (javaPath: string, jarPath: string, heap: string, env: Env, port: number): EngineProcess => {
  const child = spawn(javaPath, [`-Xmx${heap}`, "-jar", jarPath], {
    // Apps may widen NodeJS.ProcessEnv (e.g. a required NODE_ENV); the JVM
    // needs none of that, so the allowlisted environment is passed as is.
    env: engineEnv(env, port) as NodeJS.ProcessEnv,
    stdio: ["ignore", "inherit", "inherit"],
  });
  return {
    kill: () => {
      child.kill("SIGTERM");
    },
    onExit: (listener) => {
      child.once("exit", listener);
      child.once("error", () => listener(null));
    },
  };
};

const positiveNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export interface BuiltInEngines {
  pdfConverter: LocalPdfConverter;
  signatureEngine: EngineSupervisor;
  status(): { pdfConverter: BuiltInEngineStatus; signatureEngine: BuiltInEngineStatus };
}

// The engines the default image carries (ADR-069 §3). Paths default to where
// the Dockerfile puts them and can be pointed elsewhere for local development;
// on a -slim image the files are absent and both engines report unavailable.
export const createBuiltInEngines = (env: Env = process.env): BuiltInEngines => {
  const sofficePath = env.PDF_CONVERTER_SOFFICE ?? "/usr/bin/soffice";
  const javaPath = env.SIGNING_ENGINE_JAVA ?? "/opt/wayfinder/jre/bin/java";
  const jarPath = env.SIGNING_ENGINE_JAR ?? "/opt/wayfinder/dss/wayfinder-dss.jar";
  const heap = env.SIGNING_ENGINE_HEAP ?? "384m";

  const pdfConverter = new LocalPdfConverter({
    sofficePath,
    isInstalled: () => existsSync(sofficePath),
    run: runProcess(env),
    concurrency: positiveNumber(env.PDF_CONVERTER_CONCURRENCY, 2),
    timeoutMs: 60_000,
  });

  const signatureEngine = new EngineSupervisor({
    isInstalled: () => existsSync(javaPath) && existsSync(jarPath),
    spawn: (port) => spawnEngine(javaPath, jarPath, heap, env, port),
    freePort,
    isHealthy,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    // Unref'd so an idle timer never keeps a shutting-down server alive.
    setTimer: (callback, ms) => setTimeout(callback, ms).unref(),
    clearTimer: (timer) => clearTimeout(timer as NodeJS.Timeout),
    startTimeoutMs: 30_000,
    pollIntervalMs: 250,
    idleStopMs: positiveNumber(env.SIGNING_ENGINE_IDLE_MINUTES, 30) * 60_000,
    maxFailures: 3,
    failureWindowMs: 5 * 60_000,
  });

  return {
    pdfConverter,
    signatureEngine,
    status: () => ({ pdfConverter: pdfConverter.status(), signatureEngine: signatureEngine.status() }),
  };
};
