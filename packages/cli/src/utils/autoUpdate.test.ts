import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * These tests exercise the policy — when a background install should or
 * shouldn't be scheduled — without ever spawning a real child process. The
 * `launchDetachedInstall` path is mocked out via vi.mock on node:child_process.
 */

type ConfigShape = {
  pendingUpdate?: { version: string; command: string; startedAt: string };
  completedUpdate?: { version: string; ok: boolean; finishedAt: string };
  latestVersion?: string;
};

function setupMocks(opts: {
  installer: {
    kind: "npm" | "bun" | "pnpm" | "brew" | "skip";
    command: string | null;
  };
  devMode?: boolean;
  config?: ConfigShape;
  env?: Record<string, string | undefined>;
}): {
  writeSpy: ReturnType<typeof vi.fn>;
  spawnSpy: ReturnType<typeof vi.fn>;
  config: ConfigShape;
} {
  vi.resetModules();

  const config = { ...(opts.config ?? {}) };
  const writeSpy = vi.fn((next: ConfigShape) => {
    Object.assign(config, next);
    // writeConfig is given a full replacement — mirror that by pruning keys
    // that disappeared.
    for (const k of Object.keys(config)) {
      if (!(k in next)) delete (config as Record<string, unknown>)[k];
    }
  });

  vi.doMock("../telemetry/config.js", () => ({
    readConfig: () => ({ ...config }),
    writeConfig: writeSpy,
  }));
  vi.doMock("./env.js", () => ({ isDevMode: () => !!opts.devMode }));
  vi.doMock("./installerDetection.js", () => ({
    detectInstaller: () => ({
      kind: opts.installer.kind,
      installCommand: () => opts.installer.command,
      reason: "test",
    }),
  }));

  const spawnSpy = vi.fn(() => ({
    pid: 42,
    unref: () => {},
  }));
  vi.doMock("node:child_process", () => ({ spawn: spawnSpy }));
  vi.doMock("node:fs", async () => {
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    return {
      ...actual,
      mkdirSync: () => {},
      openSync: () => 99,
      appendFileSync: () => {},
    };
  });

  // Apply env overrides, remembering originals for afterEach cleanup.
  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  return { writeSpy, spawnSpy, config };
}

const ORIGINAL_ENV = { ...process.env };

describe("scheduleBackgroundInstall", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.doUnmock("../telemetry/config.js");
    vi.doUnmock("./env.js");
    vi.doUnmock("./installerDetection.js");
    vi.doUnmock("node:child_process");
    vi.doUnmock("node:fs");
    vi.resetModules();
  });

  it("schedules an install when a newer minor/patch is available", async () => {
    const { spawnSpy, writeSpy, config } = setupMocks({
      installer: { kind: "npm", command: "npm install -g hyperframes@0.4.4" },
    });
    const { scheduleBackgroundInstall } = await import("./autoUpdate.js");

    const scheduled = scheduleBackgroundInstall("0.4.4", "0.4.3");

    expect(scheduled).toBe(true);
    expect(spawnSpy).toHaveBeenCalledOnce();
    expect(writeSpy).toHaveBeenCalled();
    expect(config.pendingUpdate?.version).toBe("0.4.4");
    expect(config.pendingUpdate?.command).toBe("npm install -g hyperframes@0.4.4");
  });

  it("does NOT schedule across a major-version jump", async () => {
    const { spawnSpy } = setupMocks({
      installer: { kind: "npm", command: "npm install -g hyperframes@1.0.0" },
    });
    const { scheduleBackgroundInstall } = await import("./autoUpdate.js");

    expect(scheduleBackgroundInstall("1.0.0", "0.4.3")).toBe(false);
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it("skips in dev mode", async () => {
    const { spawnSpy } = setupMocks({
      installer: { kind: "npm", command: "npm install -g hyperframes@0.4.4" },
      devMode: true,
    });
    const { scheduleBackgroundInstall } = await import("./autoUpdate.js");

    expect(scheduleBackgroundInstall("0.4.4", "0.4.3")).toBe(false);
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it("skips when CI=1", async () => {
    const { spawnSpy } = setupMocks({
      installer: { kind: "npm", command: "npm install -g hyperframes@0.4.4" },
      env: { CI: "1" },
    });
    const { scheduleBackgroundInstall } = await import("./autoUpdate.js");

    expect(scheduleBackgroundInstall("0.4.4", "0.4.3")).toBe(false);
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it("skips when HYPERFRAMES_NO_AUTO_INSTALL=1", async () => {
    const { spawnSpy } = setupMocks({
      installer: { kind: "npm", command: "npm install -g hyperframes@0.4.4" },
      env: { HYPERFRAMES_NO_AUTO_INSTALL: "1" },
    });
    const { scheduleBackgroundInstall } = await import("./autoUpdate.js");

    expect(scheduleBackgroundInstall("0.4.4", "0.4.3")).toBe(false);
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it("skips when the installer kind is unknown", async () => {
    const { spawnSpy } = setupMocks({
      installer: { kind: "skip", command: null },
    });
    const { scheduleBackgroundInstall } = await import("./autoUpdate.js");

    expect(scheduleBackgroundInstall("0.4.4", "0.4.3")).toBe(false);
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it("skips when already up to date", async () => {
    const { spawnSpy } = setupMocks({
      installer: { kind: "npm", command: "npm install -g hyperframes@0.4.3" },
    });
    const { scheduleBackgroundInstall } = await import("./autoUpdate.js");

    expect(scheduleBackgroundInstall("0.4.3", "0.4.3")).toBe(false);
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it("does not re-launch while a fresh pending install exists for the same version", async () => {
    const { spawnSpy } = setupMocks({
      installer: { kind: "npm", command: "npm install -g hyperframes@0.4.4" },
      config: {
        pendingUpdate: {
          version: "0.4.4",
          command: "npm install -g hyperframes@0.4.4",
          startedAt: new Date().toISOString(),
        },
      },
    });
    const { scheduleBackgroundInstall } = await import("./autoUpdate.js");

    expect(scheduleBackgroundInstall("0.4.4", "0.4.3")).toBe(false);
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it("re-launches when a stale pending install is older than the timeout", async () => {
    const longAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
    const { spawnSpy } = setupMocks({
      installer: { kind: "npm", command: "npm install -g hyperframes@0.4.4" },
      config: {
        pendingUpdate: {
          version: "0.4.4",
          command: "npm install -g hyperframes@0.4.4",
          startedAt: longAgo,
        },
      },
    });
    const { scheduleBackgroundInstall } = await import("./autoUpdate.js");

    expect(scheduleBackgroundInstall("0.4.4", "0.4.3")).toBe(true);
    expect(spawnSpy).toHaveBeenCalledOnce();
  });

  it("skips when the previous run already completed this version successfully", async () => {
    const { spawnSpy } = setupMocks({
      installer: { kind: "npm", command: "npm install -g hyperframes@0.4.4" },
      config: {
        completedUpdate: {
          version: "0.4.4",
          ok: true,
          finishedAt: new Date().toISOString(),
        },
      },
    });
    const { scheduleBackgroundInstall } = await import("./autoUpdate.js");

    expect(scheduleBackgroundInstall("0.4.4", "0.4.3")).toBe(false);
    expect(spawnSpy).not.toHaveBeenCalled();
  });
});
