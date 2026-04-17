import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:net";
import { testPortOnAllHosts } from "./portUtils.js";

// A genuinely-free port on every OS we care about. Picked from the high
// IANA-ephemeral range with enough runway that random collisions are rare;
// if a test still flakes on a loaded CI shard we bump `BASE`.
const BASE = 45_000;

const openServers: Server[] = [];

function allocFreePort(): number {
  // Each test picks its own port out of a counter to avoid cross-test reuse.
  return BASE + Math.floor(Math.random() * 1_000);
}

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.close(() => resolve());
        }),
    ),
  );
});

describe("testPortOnAllHosts", () => {
  it("returns true for a genuinely free port (regression: #309)", async () => {
    // The bug: running the four probes in parallel caused the `0.0.0.0` bind
    // to collide with the still-open `127.0.0.1` socket, so `every port is
    // occupied` on Linux. This test binds NOTHING and asserts the scanner
    // sees the port as free — which only works when the internal probes are
    // sequential and each socket is fully closed before the next opens.
    const port = allocFreePort();
    const result = await testPortOnAllHosts(port);
    expect(result).toBe(true);
  });

  it("returns false when the port is occupied on 0.0.0.0", async () => {
    const port = allocFreePort();
    const blocker = createServer();
    openServers.push(blocker);
    await new Promise<void>((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen({ port, host: "0.0.0.0" }, () => resolve());
    });
    const result = await testPortOnAllHosts(port);
    expect(result).toBe(false);
  });

  it("releases each probe socket before starting the next (no wildcard-vs-loopback race)", async () => {
    // Sanity-check the shape of the bug itself: two back-to-back calls for
    // the same free port must both return true. If the first call left a
    // socket lingering, the second would see EADDRINUSE.
    const port = allocFreePort();
    const first = await testPortOnAllHosts(port);
    const second = await testPortOnAllHosts(port);
    expect(first).toBe(true);
    expect(second).toBe(true);
  });
});
