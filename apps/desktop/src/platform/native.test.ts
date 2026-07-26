import { deepEqual, doesNotThrow, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  createLoadingCapabilityState,
  createNativeBridge,
  type NativeCoreDependencies,
} from "./native";

function createDependencies(
  overrides: Partial<NativeCoreDependencies> = {},
): NativeCoreDependencies {
  return {
    isAvailable: () => true,
    invoke: async <T>() => undefined as T,
    listen: async () => () => undefined,
    convertFileSrc: (path) => `asset://${path}`,
    ...overrides,
  };
}

test("browser preview reports native capabilities as unsupported without calling Tauri", async () => {
  let invokeCalls = 0;
  let listenCalls = 0;
  const states: unknown[] = [];
  const bridge = createNativeBridge(
    createDependencies({
      isAvailable: () => false,
      invoke: async <T>() => {
        invokeCalls += 1;
        return undefined as T;
      },
      listen: async () => {
        listenCalls += 1;
        return () => undefined;
      },
    }),
  );

  const result = await bridge.invokeCapability<string>(
    "load-library",
    undefined,
    (state) => states.push(state),
  );
  const unlisten = await bridge.listen("library-changed", () => undefined);

  deepEqual(states, [
    { status: "loading" },
    { status: "unsupported", capability: "load-library" },
  ]);
  deepEqual(result, {
    status: "unsupported",
    capability: "load-library",
  });
  equal(bridge.convertFileSrc("/books/cover.jpg"), "/books/cover.jpg");
  equal(invokeCalls, 0);
  equal(listenCalls, 0);
  doesNotThrow(unlisten);
});

test("native capability calls expose typed success and error results", async () => {
  const successBridge = createNativeBridge(
    createDependencies({
      invoke: async <T>() => "ready" as T,
    }),
  );
  const errorBridge = createNativeBridge(
    createDependencies({
      invoke: async () => {
        throw new Error("backend unavailable");
      },
    }),
  );

  deepEqual(await successBridge.invokeCapability<string>("load-library"), {
    status: "success",
    value: "ready",
  });
  deepEqual(await errorBridge.invokeCapability<string>("load-library"), {
    status: "error",
    error: { message: "backend unavailable" },
  });
});

test("native availability failures become typed capability errors", async () => {
  const states: unknown[] = [];
  const bridge = createNativeBridge(
    createDependencies({
      isAvailable: () => {
        throw new Error("runtime detection failed");
      },
    }),
  );

  const result = await bridge.invokeCapability("load-library", undefined, (state) => {
    states.push(state);
  });

  deepEqual(states, [
    { status: "loading" },
    { status: "error", error: { message: "runtime detection failed" } },
  ]);
  deepEqual(result, {
    status: "error",
    error: { message: "runtime detection failed" },
  });
});

test("capabilities have an explicit loading state", () => {
  deepEqual(createLoadingCapabilityState<string>(), { status: "loading" });
});
