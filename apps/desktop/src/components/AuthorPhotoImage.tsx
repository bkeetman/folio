import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

type CoverBlob = {
  mime: string;
  bytes: number[];
};

type AuthorPhotoImageProps = {
  photoUrl: string | null | undefined;
  retryKey?: string | number | null;
  allowNetwork?: boolean;
  alt: string;
  className?: string;
  fallback: ReactNode;
  loadingFallback?: ReactNode;
};

const authorPhotoBlobUrlCache = new Map<string, string>();
const authorPhotoInFlightCache = new Map<string, Promise<string | null>>();
let unloadCleanupRegistered = false;

function ensureUnloadCleanup() {
  if (unloadCleanupRegistered || typeof window === "undefined") return;
  unloadCleanupRegistered = true;
  window.addEventListener("beforeunload", () => {
    for (const value of authorPhotoBlobUrlCache.values()) {
      if (typeof value === "string" && value.startsWith("blob:")) {
        URL.revokeObjectURL(value);
      }
    }
    authorPhotoBlobUrlCache.clear();
    authorPhotoInFlightCache.clear();
  });
}

function isRemotePhotoUrl(value: string): boolean {
  return value.startsWith("https://") || value.startsWith("http://");
}

async function resolveAuthorPhotoBlobUrl(
  photoUrl: string,
  allowNetwork: boolean
): Promise<string | null> {
  if (authorPhotoBlobUrlCache.has(photoUrl)) {
    return authorPhotoBlobUrlCache.get(photoUrl) ?? null;
  }

  const requestCacheKey = `${photoUrl}::${allowNetwork ? "network" : "cache-only"}`;
  const existingRequest = authorPhotoInFlightCache.get(requestCacheKey);
  if (existingRequest) {
    return existingRequest;
  }

  const request = invoke<CoverBlob | null>("get_author_photo_blob", { photoUrl, allowNetwork })
    .then((blob) => {
      if (!blob || !Array.isArray(blob.bytes) || blob.bytes.length === 0) {
        return null;
      }
      const mime = blob.mime && blob.mime.startsWith("image/") ? blob.mime : "image/jpeg";
      return URL.createObjectURL(new Blob([new Uint8Array(blob.bytes)], { type: mime }));
    })
    .catch(() => null)
    .then((result) => {
      if (result) {
        authorPhotoBlobUrlCache.set(photoUrl, result);
      }
      authorPhotoInFlightCache.delete(requestCacheKey);
      return result;
    });

  authorPhotoInFlightCache.set(requestCacheKey, request);
  return request;
}

export function AuthorPhotoImage({
  photoUrl,
  retryKey,
  allowNetwork = true,
  alt,
  className,
  fallback,
  loadingFallback,
}: AuthorPhotoImageProps) {
  const trimmedUrl = photoUrl?.trim() ?? "";
  const retryToken = retryKey == null ? "default" : String(retryKey);
  const requestKey = `${trimmedUrl}::${retryToken}::${allowNetwork ? "network" : "cache-only"}`;
  const isRemoteUrl = isRemotePhotoUrl(trimmedUrl);
  const isTauriRuntime = isTauri();
  const [resolvedByRequestKey, setResolvedByRequestKey] = useState<Record<string, string | null>>({});
  const hasLocalResolved = Object.prototype.hasOwnProperty.call(resolvedByRequestKey, requestKey);
  const cachedResolved = authorPhotoBlobUrlCache.get(trimmedUrl);
  const src =
    !trimmedUrl
      ? null
      : !isRemoteUrl || !isTauriRuntime
        ? trimmedUrl
        : authorPhotoBlobUrlCache.has(trimmedUrl)
          ? cachedResolved
          : hasLocalResolved
            ? resolvedByRequestKey[requestKey] ?? null
            : null;
  const loading =
    Boolean(trimmedUrl) &&
    isRemoteUrl &&
    isTauriRuntime &&
    !authorPhotoBlobUrlCache.has(trimmedUrl) &&
    !hasLocalResolved;

  useEffect(() => {
    if (!trimmedUrl || !isRemoteUrl || !isTauriRuntime) {
      return;
    }

    if (authorPhotoBlobUrlCache.has(trimmedUrl)) {
      return;
    }

    if (Object.prototype.hasOwnProperty.call(resolvedByRequestKey, requestKey)) {
      return;
    }

    ensureUnloadCleanup();
    let cancelled = false;
    void resolveAuthorPhotoBlobUrl(trimmedUrl, allowNetwork)
      .then((resolved) => {
        if (cancelled) return;
        setResolvedByRequestKey((prev) => {
          if (Object.prototype.hasOwnProperty.call(prev, requestKey)) {
            return prev;
          }
          return {
            ...prev,
            [requestKey]: resolved,
          };
        });
      });
    return () => {
      cancelled = true;
    };
  }, [allowNetwork, isRemoteUrl, isTauriRuntime, requestKey, resolvedByRequestKey, trimmedUrl]);

  if (src) {
    return <img className={className} src={src} alt={alt} />;
  }

  if (loading && loadingFallback) {
    return <>{loadingFallback}</>;
  }

  return <>{fallback}</>;
}
