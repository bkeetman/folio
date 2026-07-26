import { getVersion as tauriGetVersion } from "@tauri-apps/api/app";
import {
  convertFileSrc as tauriConvertFileSrc,
  invoke as tauriInvoke,
  isTauri as tauriIsTauri,
  type InvokeArgs,
} from "@tauri-apps/api/core";
import {
  listen as tauriListen,
  type EventCallback,
  type EventName,
  type UnlistenFn,
} from "@tauri-apps/api/event";
import {
  confirm as tauriConfirm,
  open as tauriOpen,
  type ConfirmDialogOptions,
  type OpenDialogOptions,
  type OpenDialogReturn,
} from "@tauri-apps/plugin-dialog";
import { relaunch as tauriRelaunch } from "@tauri-apps/plugin-process";
import { check as tauriCheck } from "@tauri-apps/plugin-updater";

export type PlatformError = {
  message: string;
};

export type CapabilityState<T> =
  | { status: "loading" }
  | { status: "success"; value: T }
  | { status: "unsupported"; capability: string }
  | { status: "error"; error: PlatformError };

type SettledCapabilityState<T> = Exclude<CapabilityState<T>, { status: "loading" }>;
type CapabilityStateListener<T> = (state: CapabilityState<T>) => void;

export type NativeCoreDependencies = {
  isAvailable: () => boolean;
  invoke: typeof tauriInvoke;
  listen: typeof tauriListen;
  convertFileSrc: typeof tauriConvertFileSrc;
};

export type NativeBridge = {
  isAvailable: () => boolean;
  invoke: <T>(command: string, args?: InvokeArgs) => Promise<T>;
  invokeCapability: <T>(
    command: string,
    args?: InvokeArgs,
    onStateChange?: CapabilityStateListener<T>,
  ) => Promise<SettledCapabilityState<T>>;
  listen: <T>(event: EventName, handler: EventCallback<T>) => Promise<UnlistenFn>;
  convertFileSrc: (path: string, protocol?: string) => string;
};

export class NativeCapabilityUnavailableError extends Error {
  constructor(capability: string) {
    super(`Native capability is unavailable in browser preview: ${capability}`);
    this.name = "NativeCapabilityUnavailableError";
  }
}

function toPlatformError(error: unknown): PlatformError {
  return {
    message: error instanceof Error ? error.message : String(error ?? "Unknown native error"),
  };
}

export function createLoadingCapabilityState<T>(): CapabilityState<T> {
  return { status: "loading" };
}

export function createNativeBridge(dependencies: NativeCoreDependencies): NativeBridge {
  const isAvailable = () => dependencies.isAvailable();

  const invoke = async <T>(command: string, args?: InvokeArgs): Promise<T> => {
    if (!isAvailable()) {
      throw new NativeCapabilityUnavailableError(command);
    }
    return dependencies.invoke<T>(command, args);
  };

  const invokeCapability = async <T>(
    command: string,
    args?: InvokeArgs,
    onStateChange?: CapabilityStateListener<T>,
  ): Promise<SettledCapabilityState<T>> => {
    onStateChange?.(createLoadingCapabilityState<T>());
    try {
      if (!isAvailable()) {
        const state = { status: "unsupported", capability: command } as const;
        onStateChange?.(state);
        return state;
      }
      const state = {
        status: "success",
        value: await dependencies.invoke<T>(command, args),
      } as const;
      onStateChange?.(state);
      return state;
    } catch (error) {
      const state = { status: "error", error: toPlatformError(error) } as const;
      onStateChange?.(state);
      return state;
    }
  };

  const listen = async <T>(
    event: EventName,
    handler: EventCallback<T>,
  ): Promise<UnlistenFn> => {
    if (!isAvailable()) {
      return () => undefined;
    }
    return dependencies.listen<T>(event, handler);
  };

  const convertFileSrc = (path: string, protocol?: string): string => {
    if (!isAvailable()) return path;
    return dependencies.convertFileSrc(path, protocol);
  };

  return { isAvailable, invoke, invokeCapability, listen, convertFileSrc };
}

const nativeBridge = createNativeBridge({
  isAvailable: tauriIsTauri,
  invoke: tauriInvoke,
  listen: tauriListen,
  convertFileSrc: tauriConvertFileSrc,
});

export const isTauri = nativeBridge.isAvailable;
export const invoke = nativeBridge.invoke;
export const invokeCapability = nativeBridge.invokeCapability;
export const listen = nativeBridge.listen;
export const convertFileSrc = nativeBridge.convertFileSrc;

export async function open<T extends OpenDialogOptions>(
  options?: T,
): Promise<OpenDialogReturn<T>> {
  if (!isTauri()) return null;
  return tauriOpen(options);
}

export async function confirm(
  message: string,
  options?: string | ConfirmDialogOptions,
): Promise<boolean> {
  if (!isTauri()) return false;
  return tauriConfirm(message, options);
}

export async function getVersion(): Promise<string> {
  if (!isTauri()) throw new NativeCapabilityUnavailableError("app-version");
  return tauriGetVersion();
}

export async function check() {
  if (!isTauri()) return null;
  return tauriCheck();
}

export async function relaunch(): Promise<void> {
  if (!isTauri()) throw new NativeCapabilityUnavailableError("app-relaunch");
  return tauriRelaunch();
}
