import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, Check, Image as ImageIcon, Loader2, Search, Trash2, X } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Input } from "../components/ui";
import { LANGUAGE_OPTIONS } from "../lib/languageFlags";
import { cleanupMetadataTitle } from "../lib/metadataCleanup";
import { PREDEFINED_BOOK_CATEGORIES } from "../lib/categories";
import type { EnrichmentCandidate, ItemMetadata, LibraryItem, View } from "../types/library";

type EmbeddedCoverCandidate = {
    path: string;
    mime: string;
    bytes: number[];
    score: number;
};

type BookEditViewProps = {
    selectedItemId: string | null;
    libraryItems: LibraryItem[];
    setView?: Dispatch<SetStateAction<View>>;
    previousView?: View;
    isDesktop: boolean;
    onItemUpdate?: () => Promise<void>;
    coverUrl: string | null;
    onFetchCover: (itemId: string, force?: boolean) => Promise<void>;
    onClearCover: (itemId: string) => void;
    detailsVersion: number;
    matchQuery: string;
    onMatchQueryChange: (query: string) => void;
    matchLoading: boolean;
    matchCandidates: EnrichmentCandidate[];
    onMatchSearch: (query: string) => void;
    onMatchApply: (candidate: EnrichmentCandidate) => void;
    matchApplyingId: string | null;
    onQueueRemoveItem: (itemId: string) => Promise<void>;
    getCandidateCoverUrl: (candidate: EnrichmentCandidate) => string | null;
    onSaveMetadata?: (itemId: string, metadata: ItemMetadata) => Promise<void>;
    embedded?: boolean;
};

function isLikelyIsbn(value: string): boolean {
    const normalized = value.replace(/[^0-9Xx]/g, "");
    return normalized.length === 10 || normalized.length === 13;
}

function buildMetadataSearchQuery(metadata: ItemMetadata): string {
    const rawIdentifier = metadata.isbn?.trim() ?? "";
    const title = metadata.title?.trim() ?? "";
    const primaryAuthor = metadata.authors.find((author) => author.trim().length > 0)?.trim() ?? "";
    if (rawIdentifier && isLikelyIsbn(rawIdentifier)) return rawIdentifier;
    if (title && primaryAuthor) {
        return `${title} by ${primaryAuthor}`;
    }
    return title || primaryAuthor || rawIdentifier;
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return "";
}

function isExpectedEmbeddedCoverMiss(error: unknown): boolean {
    const message = getErrorMessage(error).toLowerCase();
    if (!message) return false;
    return (
        message.includes("no epub file found") ||
        message.includes("no embedded cover found") ||
        message.includes("unsupported") ||
        message.includes("not supported")
    );
}

export function BookEditView({
    selectedItemId,
    libraryItems,
    setView,
    previousView,
    isDesktop,
    onItemUpdate,
    coverUrl,
    onFetchCover,
    onClearCover,
    detailsVersion,
    matchQuery,
    onMatchQueryChange,
    matchLoading,
    matchCandidates,
    onMatchSearch,
    onMatchApply,
    matchApplyingId,
    onQueueRemoveItem,
    getCandidateCoverUrl,
    onSaveMetadata,
    embedded = false,
}: BookEditViewProps) {
    const { t } = useTranslation();
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isUploadingCover, setIsUploadingCover] = useState(false);
    const [isApplyingEmbeddedCover, setIsApplyingEmbeddedCover] = useState(false);
    const [isQueueingRemove, setIsQueueingRemove] = useState(false);
    const [isLoadingEmbeddedPreview, setIsLoadingEmbeddedPreview] = useState(false);
    const [embeddedPreviewUrl, setEmbeddedPreviewUrl] = useState<string | null>(null);
    const [localCoverUrl, setLocalCoverUrl] = useState<string | null>(null);
    const [infoMessage, setInfoMessage] = useState<string | null>(null);
    const [embeddedCandidates, setEmbeddedCandidates] = useState<EmbeddedCoverCandidate[]>([]);
    const [selectedEmbeddedIndex, setSelectedEmbeddedIndex] = useState(0);
    const [embeddedSelectionDirty, setEmbeddedSelectionDirty] = useState(false);
    const [selectedCategoryToAdd, setSelectedCategoryToAdd] = useState("");
    const [openSearchMode, setOpenSearchMode] = useState(false);
    const [formData, setFormData] = useState<ItemMetadata>({
        title: "",
        authors: [],
        publishedYear: null,
        language: null,
        isbn: null,
        series: null,
        seriesIndex: null,
        description: null,
        genres: [],
    });
    const visibleGenres = (formData.genres ?? []).filter((value, index, array) => {
        const trimmed = value.trim();
        return trimmed.length > 0 && array.findIndex((entry) => entry.trim() === trimmed) === index;
    });
    const availableCategoryOptions = PREDEFINED_BOOK_CATEGORIES.filter(
        (category) => !visibleGenres.some((genre) => genre.localeCompare(category, undefined, { sensitivity: "base" }) === 0),
    );
    const metadataSearchQuery = buildMetadataSearchQuery(formData);

    const selectedItem = libraryItems.find((item) => item.id === selectedItemId);
    const displayCoverUrl = localCoverUrl ?? coverUrl;
    const activeItemIdRef = useRef<string | null>(selectedItemId);
    const embeddedPreviewUrlRef = useRef<string | null>(null);
    const localCoverUrlRef = useRef<string | null>(null);

    useEffect(() => {
        activeItemIdRef.current = selectedItemId;
        setError(null);
        setInfoMessage(null);
        setOpenSearchMode(false);
        setEmbeddedCandidates([]);
        setSelectedEmbeddedIndex(0);
        setEmbeddedSelectionDirty(false);
        setEmbeddedPreviewUrl((previous) => {
            if (previous) URL.revokeObjectURL(previous);
            return null;
        });
        setLocalCoverUrl((previous) => {
            if (previous) URL.revokeObjectURL(previous);
            return null;
        });
    }, [selectedItemId]);

    const loadLocalCoverBlob = useCallback(async (itemId: string) => {
        try {
            if (activeItemIdRef.current !== itemId) return false;
            const result = await invoke<{ mime: string; bytes: number[] } | null>("get_cover_blob", { itemId });
            if (activeItemIdRef.current !== itemId) return false;
            if (!result) {
                setLocalCoverUrl((previous) => {
                    if (previous) URL.revokeObjectURL(previous);
                    return null;
                });
                return false;
            }
            const blob = new Blob([new Uint8Array(result.bytes)], { type: result.mime });
            const url = URL.createObjectURL(blob);
            setLocalCoverUrl((previous) => {
                if (previous) URL.revokeObjectURL(previous);
                return url;
            });
            return true;
        } catch {
            return false;
        }
    }, []);

    useEffect(() => {
        if (selectedItemId && isDesktop) {
            setIsLoading(true);
            setError(null);
            setInfoMessage(null);
            invoke<ItemMetadata>("get_item_details", { itemId: selectedItemId })
                .then((details) => {
                    setFormData({ ...details, genres: details.genres ?? [] });
                    setIsLoading(false);
                })
                .catch((err) => {
                    console.error("Failed to load details", err);
                    setError(t("bookEdit.failedLoadDetails"));
                    setIsLoading(false);
                });

            // Ensure the latest saved cover is loaded after metadata/candidate updates.
            if (selectedItemId) {
                if (!coverUrl) {
                    void onFetchCover(selectedItemId);
                }
                void loadLocalCoverBlob(selectedItemId);
            }
        }
    }, [
        selectedItemId,
        isDesktop,
        coverUrl,
        onFetchCover,
        detailsVersion,
        loadLocalCoverBlob,
        t,
    ]);

    useEffect(() => {
        embeddedPreviewUrlRef.current = embeddedPreviewUrl;
    }, [embeddedPreviewUrl]);

    useEffect(() => {
        localCoverUrlRef.current = localCoverUrl;
    }, [localCoverUrl]);

    useEffect(() => {
        return () => {
            if (embeddedPreviewUrlRef.current) {
                URL.revokeObjectURL(embeddedPreviewUrlRef.current);
            }
            if (localCoverUrlRef.current) {
                URL.revokeObjectURL(localCoverUrlRef.current);
            }
        };
    }, [t]);

    useEffect(() => {
        if (openSearchMode || !selectedItemId || isLoading) return;
        if (metadataSearchQuery !== matchQuery) {
            onMatchQueryChange(metadataSearchQuery);
        }
    }, [
        openSearchMode,
        selectedItemId,
        isLoading,
        metadataSearchQuery,
        matchQuery,
        onMatchQueryChange,
    ]);

    const handleToggleOpenSearch = useCallback(() => {
        setOpenSearchMode((current) => {
            const next = !current;
            if (!next && metadataSearchQuery !== matchQuery) {
                onMatchQueryChange(metadataSearchQuery);
            }
            return next;
        });
    }, [metadataSearchQuery, matchQuery, onMatchQueryChange]);

    const handleUseCurrentMetadataQuery = useCallback(() => {
        if (metadataSearchQuery !== matchQuery) {
            onMatchQueryChange(metadataSearchQuery);
        }
    }, [metadataSearchQuery, matchQuery, onMatchQueryChange]);

    const handleSave = async () => {
        if (!selectedItemId) return;
        setIsSaving(true);
        setError(null);
        setInfoMessage(null);
        try {
            if (embeddedSelectionDirty) {
                const selected = embeddedCandidates[selectedEmbeddedIndex];
                if (selected) {
                    await invoke("use_embedded_cover_from_bytes", {
                        itemId: selectedItemId,
                        bytes: selected.bytes,
                        mime: selected.mime,
                    });
                    onClearCover(selectedItemId);
                    await onFetchCover(selectedItemId, true);
                    await loadLocalCoverBlob(selectedItemId);
                }
                setEmbeddedSelectionDirty(false);
            }
            if (onSaveMetadata) {
                await onSaveMetadata(selectedItemId, formData);
            } else {
                await invoke("save_item_metadata", { itemId: selectedItemId, metadata: formData });
            }
            if (onItemUpdate) {
                await onItemUpdate();
            }
            if (!embedded && setView) {
                const fallbackView: View = previousView ?? "library-books";
                // Fallback to library-books if previousView is somehow edit
                setView(fallbackView === "edit" ? "library-books" : fallbackView);
            }
        } catch (err) {
            console.error("Failed to save", err);
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setIsSaving(false);
        }
    };

    const handleCancel = () => {
        if (embedded || !setView) return;
        const fallbackView: View = previousView ?? "library-books";
        setView(fallbackView === "edit" ? "library-books" : fallbackView);
    };

    const handleQueueRemove = async () => {
        if (!selectedItemId || !isDesktop) return;
        const { confirm } = await import("@tauri-apps/plugin-dialog");
        const ok = await confirm(
            t("bookEdit.removeFromLibraryConfirm"),
            {
                title: t("bookEdit.removeFromLibraryTitle"),
                kind: "warning",
            }
        );
        if (!ok) return;

        setIsQueueingRemove(true);
        setError(null);
        setInfoMessage(null);
        try {
            await onQueueRemoveItem(selectedItemId);
        } catch (err) {
            console.error("Failed to queue remove", err);
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setIsQueueingRemove(false);
        }
    };

    const titleCleanupPreview = cleanupMetadataTitle(formData);

    const handleChangeCover = async () => {
        if (!selectedItemId) return;

        try {
            const { open } = await import("@tauri-apps/plugin-dialog");
            const selected = await open({
                multiple: false,
                filters: [
                    {
                        name: "Image",
                        extensions: ["png", "jpg", "jpeg", "webp"],
                    },
                ],
            });

            if (selected && typeof selected === "string") {
                setIsUploadingCover(true);
                setInfoMessage(t("bookEdit.applyingCover"));
                await invoke("upload_cover", { itemId: selectedItemId, path: selected });

                // Refresh cover
                onClearCover(selectedItemId);
                await onFetchCover(selectedItemId, true);
                await loadLocalCoverBlob(selectedItemId);
                if (onItemUpdate) {
                    await onItemUpdate();
                }
                setInfoMessage(t("bookEdit.coverUpdated"));
                setIsUploadingCover(false);
            }
        } catch (err) {
            console.error("Failed to upload cover", err);
            setError(t("bookEdit.failedUploadCover"));
            setIsUploadingCover(false);
        }
    };

    const handleUseEmbeddedCover = async () => {
        if (!selectedItemId) return;
        setIsApplyingEmbeddedCover(true);
        setError(null);
        setInfoMessage(t("bookEdit.applyingEmbeddedCover"));
        try {
            const selected = embeddedCandidates[selectedEmbeddedIndex];
            if (!selected) {
                await invoke("use_embedded_cover", { itemId: selectedItemId });
            } else {
                await invoke("use_embedded_cover_from_bytes", {
                    itemId: selectedItemId,
                    bytes: selected.bytes,
                    mime: selected.mime,
                });
            }
            onClearCover(selectedItemId);
            await onFetchCover(selectedItemId, true);
            const hasLocalCover = await loadLocalCoverBlob(selectedItemId);
            if (!hasLocalCover) {
                setError(t("bookEdit.embeddedCoverReadbackFailed"));
                setInfoMessage(null);
                return;
            }
            if (onItemUpdate) {
                await onItemUpdate();
            }
            setEmbeddedSelectionDirty(false);
            setInfoMessage(t("bookEdit.embeddedCoverApplied"));
        } catch (err) {
            console.error("Failed to use embedded cover", err);
            setError(err instanceof Error ? err.message : t("bookEdit.failedUseEmbeddedCover"));
            setInfoMessage(null);
        } finally {
            setIsApplyingEmbeddedCover(false);
        }
    };

    const loadEmbeddedCoverCandidates = useCallback(async (itemId: string) => {
        setIsLoadingEmbeddedPreview(true);
        setError(null);
        try {
            const result = await invoke<EmbeddedCoverCandidate[]>(
                "list_embedded_cover_candidates",
                { itemId }
            );
            if (activeItemIdRef.current !== itemId) return;
            if (!result.length) {
                setEmbeddedCandidates([]);
                setSelectedEmbeddedIndex(0);
                setEmbeddedSelectionDirty(false);
                setEmbeddedPreviewUrl((previous) => {
                    if (previous) URL.revokeObjectURL(previous);
                    return null;
                });
                return;
            }
            setEmbeddedCandidates(result);
            setSelectedEmbeddedIndex(0);
            setEmbeddedSelectionDirty(false);
            const blob = new Blob([new Uint8Array(result[0].bytes)], { type: result[0].mime });
            const url = URL.createObjectURL(blob);
            setEmbeddedPreviewUrl((previous) => {
                if (previous) URL.revokeObjectURL(previous);
                return url;
            });
        } catch (err) {
            if (activeItemIdRef.current === itemId) {
                setEmbeddedCandidates([]);
                setSelectedEmbeddedIndex(0);
                setEmbeddedPreviewUrl((previous) => {
                    if (previous) URL.revokeObjectURL(previous);
                    return null;
                });
                if (isExpectedEmbeddedCoverMiss(err)) {
                    setError(null);
                } else {
                    console.error("Failed to load embedded cover preview", err);
                    setError(err instanceof Error ? err.message : t("bookEdit.failedLoadEmbeddedPreview"));
                }
            }
        } finally {
            if (activeItemIdRef.current === itemId) {
                setIsLoadingEmbeddedPreview(false);
            }
        }
    }, [t]);

    const handleSelectEmbeddedCandidate = (index: number) => {
        const candidate = embeddedCandidates[index];
        if (!candidate) return;
        const blob = new Blob([new Uint8Array(candidate.bytes)], { type: candidate.mime });
        const url = URL.createObjectURL(blob);
        setEmbeddedPreviewUrl((previous) => {
            if (previous) URL.revokeObjectURL(previous);
            return url;
        });
        setSelectedEmbeddedIndex(index);
        setEmbeddedSelectionDirty(true);
    };

    useEffect(() => {
        if (!selectedItemId || !isDesktop) return;
        void loadEmbeddedCoverCandidates(selectedItemId);
    }, [selectedItemId, isDesktop, loadEmbeddedCoverCandidates]);

    if (!selectedItemId || !selectedItem) {
        return (
            <div className="flex h-full items-center justify-center text-app-ink-muted">
                {t("bookEdit.noBookSelected")}
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="flex h-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-app-accent" />
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6">
            {/* Header */}
            {!embedded ? (
                <header className="flex items-center justify-between border-b border-app-border pb-3">
                    <div className="flex items-center gap-4">
                        <Button variant="ghost" size="sm" onClick={handleCancel} className="h-10 w-10 rounded-full border border-[var(--app-border-soft)] bg-app-surface/60 hover:bg-app-surface-hover transition-colors">
                            <ArrowLeft size={18} />
                        </Button>
                        <div className="space-y-0.5">
                            <h1 className="text-lg font-semibold leading-tight">{t("bookEdit.editBook")}</h1>
                            <p className="text-[11px] text-app-ink-muted">{selectedItem.title || t("bookEdit.untitled")}</p>
                        </div>
                    </div>
                    <div className="flex gap-2 items-center">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleQueueRemove}
                            disabled={isSaving || isUploadingCover || isQueueingRemove}
                            className="h-9 w-9 text-red-500/70 hover:text-red-500 hover:bg-red-500/10"
                            title={t("bookEdit.removeFromLibrary")}
                        >
                            {isQueueingRemove ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                        </Button>
                        <Button variant="outline" size="sm" onClick={handleCancel} disabled={isSaving || isUploadingCover || isQueueingRemove} className="h-9 px-4 border-[var(--app-border-soft)]">
                            <X size={14} className="mr-2" />
                            {t("bookEdit.cancel")}
                        </Button>
                        <Button
                            size="sm"
                            className="h-9 px-4 bg-app-accent hover:bg-app-accent-hover text-white shadow-soft"
                            onClick={handleSave}
                            disabled={isSaving || isUploadingCover || isQueueingRemove}
                        >
                            {isSaving ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Check size={14} className="mr-2" />}
                            {t("bookEdit.saveChanges")}
                        </Button>
                    </div>
                </header>
            ) : null}

            {/* Content */}
            <div className={embedded ? "w-full" : "mx-auto w-full max-w-5xl"}>
                {error && (
                    <div className="mb-6 rounded-md bg-red-500/10 p-4 text-sm text-red-500 border border-red-500/20">
                        {error}
                    </div>
                )}
                {infoMessage && !error ? (
                    <div className="mb-6 rounded-md border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-500 transition-all">
                        {infoMessage}
                    </div>
                ) : null}

                <div
                    className={
                        embedded
                            ? "grid grid-cols-1 gap-6 xl:grid-cols-[220px_minmax(0,1fr)] 2xl:grid-cols-[220px_minmax(420px,1fr)_340px]"
                            : "grid grid-cols-1 gap-8 md:grid-cols-[280px_1fr_320px]"
                    }
                >
                    {/* Left Column: Cover */}
                    <div className={embedded ? "order-2 space-y-4 xl:order-1" : "space-y-4"}>
                        <h2 className="text-sm font-semibold uppercase tracking-wider text-app-ink-muted">
                            {t("bookEdit.bookCover")}
                        </h2>
                        <div
                            className={
                                embedded
                                    ? "group relative mx-auto aspect-[3/4] w-full max-w-[220px] overflow-hidden rounded-lg border border-app-border bg-app-surface shadow-sm"
                                    : "group relative aspect-[3/4] w-full overflow-hidden rounded-lg border border-app-border bg-app-surface shadow-sm"
                            }
                        >
                            {displayCoverUrl ? (
                                <img
                                    src={displayCoverUrl}
                                    alt=""
                                    className="h-full w-full object-cover"
                                    onError={() => {
                                        if (selectedItemId) {
                                            onClearCover(selectedItemId);
                                            void onFetchCover(selectedItemId, true);
                                            void loadLocalCoverBlob(selectedItemId);
                                        }
                                    }}
                                />
                            ) : (
                                <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-app-ink-muted">
                                    <ImageIcon size={48} strokeWidth={1} />
                                    <span className="text-xs uppercase tracking-widest">{selectedItem.formats?.[0] || t("bookEdit.unknown")}</span>
                                </div>
                            )}

                            {isUploadingCover && (
                                <div className="absolute inset-0 flex items-center justify-center bg-app-surface/60 backdrop-blur-[2px]">
                                    <Loader2 className="h-8 w-8 animate-spin text-app-accent" />
                                </div>
                            )}
                        </div>
                        <Button
                            variant="outline"
                            className="w-full"
                            onClick={handleChangeCover}
                            disabled={isUploadingCover || isApplyingEmbeddedCover || isSaving}
                        >
                            <ImageIcon size={14} className="mr-2" />
                            {coverUrl ? t("bookEdit.changeCover") : t("bookEdit.addCover")}
                        </Button>
                        <Button
                            variant="ghost"
                            className="w-full"
                            onClick={handleUseEmbeddedCover}
                            disabled={isUploadingCover || isApplyingEmbeddedCover || isSaving || isLoadingEmbeddedPreview}
                        >
                            {isApplyingEmbeddedCover ? (
                                <Loader2 size={14} className="mr-2 animate-spin" />
                            ) : (
                                <ImageIcon size={14} className="mr-2" />
                            )}
                            {t("bookEdit.useEmbeddedCover")}
                        </Button>
                        <div className="rounded-md border border-[var(--app-border-soft)] bg-app-panel p-3">
                            <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-app-ink-muted">
                                {t("bookEdit.embeddedCover")}
                                {isLoadingEmbeddedPreview ? (
                                    <span className="text-[10px] text-app-ink-muted">{t("bookEdit.loading")}</span>
                                ) : null}
                            </div>
                            {embeddedPreviewUrl ? (
                                <div className="space-y-2">
                                    <img
                                        src={embeddedPreviewUrl}
                                        alt=""
                                        className="h-28 w-20 rounded border border-app-border object-cover"
                                    />
                                    {embeddedCandidates.length > 1 ? (
                                        <select
                                            className="h-8 w-full rounded-md border border-[var(--app-border-soft)] bg-app-surface px-2 text-[10px]"
                                            value={String(selectedEmbeddedIndex)}
                                            onChange={(event) =>
                                                handleSelectEmbeddedCandidate(parseInt(event.target.value, 10))
                                            }
                                        >
                                            {embeddedCandidates.map((candidate, index) => (
                                                <option key={`${candidate.path}-${index}`} value={index}>
                                                    {candidate.path}
                                                </option>
                                            ))}
                                        </select>
                                    ) : null}
                                </div>
                            ) : (
                                <div className="text-[10px] text-app-ink-muted">{t("bookEdit.noPreviewLoaded")}</div>
                            )}
                        </div>
                        <p className="text-[10px] text-center text-app-ink-muted">
                            {t("bookEdit.recommendedCover")}
                        </p>
                    </div>

                    {/* Right Column: Metadata */}
                    <div
                        className={
                            embedded
                                ? "order-1 rounded-lg border border-[var(--app-border-soft)] bg-app-panel p-6 shadow-none xl:order-2 xl:col-start-2 2xl:col-start-2"
                                : "rounded-lg border border-[var(--app-border-soft)] bg-app-panel p-6 shadow-none"
                        }
                    >
                        <h2 className="mb-6 text-sm font-semibold uppercase tracking-wider text-app-ink-muted">
                            {t("bookEdit.metadataDetails")}
                        </h2>

                        <div className="space-y-5">
                            {/* Title */}
                            <div>
                                <div className="mb-1.5 flex items-center justify-between">
                                    <label className="block text-sm font-medium text-app-ink">{t("bookEdit.title")}</label>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() =>
                                            setFormData((current) => {
                                                const cleaned = cleanupMetadataTitle(current);
                                                return cleaned.changed
                                                    ? { ...current, title: cleaned.title, publishedYear: cleaned.publishedYear }
                                                    : current;
                                            })
                                        }
                                        disabled={!titleCleanupPreview.changed}
                                    >
                                        {t("bookEdit.autoClean")}
                                    </Button>
                                </div>
                                <Input
                                    value={formData.title || ""}
                                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                    placeholder={t("bookEdit.bookTitlePlaceholder")}
                                    className="w-full"
                                />
                            </div>

                            {/* Authors */}
                            <div>
                                <label className="mb-1.5 block text-sm font-medium text-app-ink">{t("bookEdit.authors")}</label>
                                <Input
                                    value={formData.authors.join(", ")}
                                    onChange={(e) =>
                                        setFormData({
                                            ...formData,
                                            authors: e.target.value
                                                .split(",")
                                                .map((s) => s.trim())
                                                .filter(Boolean),
                                        })
                                    }
                                    placeholder={t("bookEdit.authorsPlaceholder")}
                                    className="w-full"
                                />
                                <p className="mt-1 text-xs text-app-ink-muted">{t("bookEdit.authorsHint")}</p>
                            </div>

                            {/* Year and Language */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="mb-1.5 block text-sm font-medium text-app-ink">{t("bookEdit.publicationYear")}</label>
                                    <Input
                                        type="number"
                                        value={formData.publishedYear || ""}
                                        onChange={(e) =>
                                            setFormData({ ...formData, publishedYear: parseInt(e.target.value) || null })
                                        }
                                        placeholder={t("bookEdit.yearPlaceholder")}
                                        className="w-full"
                                    />
                                </div>
                                <div>
                                    <label className="mb-1.5 block text-sm font-medium text-app-ink">{t("bookEdit.language")}</label>
                                    <select
                                        value={formData.language ?? ""}
                                        onChange={(e) => setFormData({ ...formData, language: e.target.value || null })}
                                        className="h-10 w-full rounded-md border border-[var(--app-border-soft)] bg-app-surface px-3 text-sm text-app-ink"
                                    >
                                        <option value="">{t("bookEdit.select")}</option>
                                        {LANGUAGE_OPTIONS.map((lang) => (
                                            <option key={lang.code} value={lang.code}>
                                                {lang.flag ? `${lang.flag} ${lang.name}` : lang.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* ISBN */}
                            <div>
                                <label className="mb-1.5 block text-sm font-medium text-app-ink">{t("bookEdit.isbn")}</label>
                                <Input
                                    value={formData.isbn || ""}
                                    onChange={(e) => setFormData({ ...formData, isbn: e.target.value || null })}
                                    placeholder={t("bookEdit.isbnPlaceholder")}
                                    className="w-full"
                                />
                            </div>

                            {/* Series */}
                            <div className="grid grid-cols-[1fr_120px] gap-4">
                                <div>
                                    <label className="mb-1.5 block text-sm font-medium text-app-ink">{t("bookEdit.series")}</label>
                                    <Input
                                        value={formData.series || ""}
                                        onChange={(e) => setFormData({ ...formData, series: e.target.value || null })}
                                        placeholder={t("bookEdit.seriesPlaceholder")}
                                        className="w-full"
                                    />
                                </div>
                                <div>
                                    <label className="mb-1.5 block text-sm font-medium text-app-ink">{t("bookEdit.seriesNumber")}</label>
                                    <Input
                                        type="number"
                                        step="0.1"
                                        value={formData.seriesIndex || ""}
                                        onChange={(e) =>
                                            setFormData({ ...formData, seriesIndex: parseFloat(e.target.value) || null })
                                        }
                                        placeholder={t("bookEdit.seriesNumberPlaceholder")}
                                        className="w-full"
                                    />
                                </div>
                            </div>

                            {/* Description */}
                            <div>
                                <label className="mb-1.5 block text-sm font-medium text-app-ink">{t("bookEdit.categories")}</label>
                                <div className="mb-2 flex gap-2">
                                    <select
                                        value={selectedCategoryToAdd}
                                        onChange={(event) => setSelectedCategoryToAdd(event.target.value)}
                                        className="h-9 w-full rounded-md border border-[var(--app-border-soft)] bg-app-surface px-3 text-sm text-app-ink"
                                    >
                                        <option value="">{t("bookEdit.selectCategory")}</option>
                                        {availableCategoryOptions.map((category) => (
                                            <option key={category} value={category}>
                                                {category}
                                            </option>
                                        ))}
                                    </select>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={!selectedCategoryToAdd}
                                        onClick={() => {
                                            if (!selectedCategoryToAdd) return;
                                            setFormData((current) => ({
                                                ...current,
                                                genres: [...(current.genres ?? []), selectedCategoryToAdd],
                                            }));
                                            setSelectedCategoryToAdd("");
                                        }}
                                    >
                                        {t("bookEdit.addCategory")}
                                    </Button>
                                </div>
                                {visibleGenres.length > 0 ? (
                                    <div className="flex flex-wrap gap-1.5">
                                        {visibleGenres.map((genre) => (
                                            <button
                                                key={genre}
                                                type="button"
                                                onClick={() =>
                                                    setFormData((current) => ({
                                                        ...current,
                                                        genres: (current.genres ?? []).filter(
                                                            (value) => value.localeCompare(genre, undefined, { sensitivity: "base" }) !== 0,
                                                        ),
                                                    }))
                                                }
                                                className="inline-flex items-center rounded-full border border-[var(--app-border-soft)] bg-[var(--app-bg-secondary)] px-2 py-0.5 text-[11px] text-app-ink-muted hover:border-[var(--app-accent)] hover:text-[var(--app-accent-strong)]"
                                            >
                                                {genre}
                                                <span className="ml-1 text-[10px]">×</span>
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-xs text-app-ink-muted">{t("bookEdit.noCategoriesYet")}</p>
                                )}
                                <p className="mt-1 text-xs text-app-ink-muted">{t("bookEdit.categoriesHint")}</p>
                            </div>

                            {/* Description */}
                            <div>
                                <label className="mb-1.5 block text-sm font-medium text-app-ink">{t("bookEdit.description")}</label>
                                <textarea
                                    value={formData.description || ""}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value || null })}
                                    placeholder={t("bookEdit.descriptionPlaceholder")}
                                    className="flex min-h-[160px] w-full rounded-md border border-[var(--app-border-soft)] bg-app-surface px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                />
                            </div>

                            {embedded ? (
                                <div className="flex gap-2 pt-2">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={handleQueueRemove}
                                        disabled={isSaving || isUploadingCover || isQueueingRemove}
                                        className="h-9 w-9 text-red-500/70 hover:text-red-500 hover:bg-red-500/10"
                                        title={t("bookEdit.removeFromLibrary")}
                                    >
                                        {isQueueingRemove ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                                    </Button>
                                    <Button
                                        variant="primary"
                                        size="sm"
                                        onClick={handleSave}
                                        disabled={isSaving || isUploadingCover || isQueueingRemove}
                                        className="ml-auto"
                                    >
                                        {isSaving ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Check size={14} className="mr-2" />}
                                        {t("bookEdit.saveChanges")}
                                    </Button>
                                </div>
                            ) : null}
                        </div>
                    </div>

                    {/* Right Column: Match/Search */}
                    <div
                        className={
                            embedded
                                ? "order-3 flex flex-col rounded-lg border border-[var(--app-border-soft)] bg-app-panel p-4 shadow-none xl:col-span-2 2xl:col-span-1 2xl:col-start-3"
                                : "flex flex-col rounded-lg border border-[var(--app-border-soft)] bg-app-panel p-4 shadow-none"
                        }
                    >
                        <div className="mb-3 flex items-center justify-between gap-2">
                            <h2 className="text-xs font-semibold uppercase tracking-wider text-app-ink-muted">
                                {t("bookEdit.matchMetadata")}
                            </h2>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleToggleOpenSearch}
                                className={
                                    openSearchMode
                                        ? "h-7 border-[var(--app-accent)] bg-[rgba(201,122,58,0.12)] px-2 text-[11px] text-[var(--app-accent-strong)] hover:bg-[rgba(201,122,58,0.2)]"
                                        : "h-7 border-[var(--app-border-soft)] bg-[var(--app-bg-secondary)] px-2 text-[11px] text-app-ink-muted hover:text-app-ink"
                                }
                            >
                                {t("bookEdit.openSearch")}
                            </Button>
                        </div>
                        <div className="flex gap-2">
                            <Input
                                value={matchQuery}
                                onChange={(e) => {
                                    if (!openSearchMode) return;
                                    onMatchQueryChange(e.target.value);
                                }}
                                placeholder={t("bookEdit.searchTitleOrAuthor")}
                                className="flex-1 text-sm"
                                readOnly={!openSearchMode}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        onMatchSearch(matchQuery);
                                    }
                                }}
                            />
                            <Button
                                variant="primary"
                                size="sm"
                                onClick={() => onMatchSearch(matchQuery)}
                                disabled={matchLoading || !matchQuery.trim() || !isDesktop}
                            >
                                {matchLoading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                            </Button>
                        </div>
                        <div className="mt-1 flex items-center justify-end">
                            <button
                                type="button"
                                onClick={handleUseCurrentMetadataQuery}
                                disabled={!metadataSearchQuery}
                                className="text-[11px] text-app-ink-muted transition hover:text-[var(--app-accent-strong)] disabled:opacity-50"
                            >
                                {t("bookEdit.useCurrentMetadata")}
                            </button>
                        </div>

                        <div className="mt-4 flex-1 overflow-y-auto">
                            {matchLoading ? (
                                <div className="mb-3 flex items-center gap-2 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2.5 py-2 text-xs text-[var(--app-ink-muted)]">
                                    <Loader2 size={14} className="animate-spin" />
                                    <span>{t("bookEdit.searchingSources")}</span>
                                </div>
                            ) : null}
                            {matchLoading ? (
                                <div className="flex items-center justify-center gap-2 py-6 text-sm text-[var(--app-ink-muted)]">
                                    <Loader2 size={16} className="animate-spin" />
                                    {t("bookEdit.searching")}
                                </div>
                            ) : matchCandidates.length > 0 ? (
                                <div className="space-y-3">
                                    {matchCandidates.map((candidate) => {
                                        const coverUrl = getCandidateCoverUrl(candidate);
                                        return (
                                            <div
                                                key={candidate.id}
                                                className="rounded-md border border-[var(--app-border-soft)] bg-app-surface p-2"
                                            >
                                                <div className="flex gap-2">
                                                    <div className="h-16 w-11 flex-shrink-0 overflow-hidden rounded border border-[var(--app-border-soft)] bg-app-bg/50">
                                                        {coverUrl ? (
                                                            <img
                                                                src={coverUrl}
                                                                alt=""
                                                                className="h-full w-full object-cover"
                                                                onError={(e) => {
                                                                    e.currentTarget.style.display = "none";
                                                                }}
                                                            />
                                                        ) : (
                                                            <div className="h-full w-full flex items-center justify-center text-[8px] text-[var(--app-ink-muted)]">
                                                                {t("bookEdit.noCover")}
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center justify-between gap-1 mb-0.5">
                                                            <span className="text-[9px] rounded-full bg-[rgba(201,122,58,0.12)] px-1.5 py-0.5 text-[var(--app-accent)]">
                                                                {candidate.source}
                                                            </span>
                                                            <span className="text-[9px] text-[var(--app-ink-muted)]">
                                                                {Math.round(candidate.confidence * 100)}%
                                                            </span>
                                                        </div>
                                                        <div className="text-xs font-medium truncate">{candidate.title}</div>
                                                        <div className="text-[10px] text-[var(--app-ink-muted)] truncate">
                                                            {candidate.authors.join(", ")}
                                                        </div>
                                                        <div className="text-[10px] text-[var(--app-ink-muted)]">
                                                            {candidate.published_year ?? t("bookEdit.unknownYear")}
                                                        </div>
                                                        {(candidate.genres ?? []).length > 0 ? (
                                                            <div className="mt-1 flex flex-wrap gap-1">
                                                                {(candidate.genres ?? []).slice(0, 3).map((genre) => (
                                                                    <span
                                                                        key={`${candidate.id}-${genre}`}
                                                                        className="inline-flex items-center rounded-full border border-[var(--app-border-soft)] bg-[var(--app-bg)] px-1.5 py-0.5 text-[9px] text-[var(--app-ink-muted)]"
                                                                    >
                                                                        {genre}
                                                                    </span>
                                                                ))}
                                                                {(candidate.genres ?? []).length > 3 ? (
                                                                    <span className="text-[9px] text-[var(--app-ink-muted)]">
                                                                        +{(candidate.genres ?? []).length - 3}
                                                                    </span>
                                                                ) : null}
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                </div>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => onMatchApply(candidate)}
                                                    className="w-full mt-2 text-xs"
                                                    disabled={!isDesktop || matchLoading || matchApplyingId === candidate.id}
                                                >
                                                    {matchApplyingId === candidate.id ? (
                                                        <span className="flex items-center gap-2">
                                                            <Loader2 size={12} className="animate-spin" />
                                                            {t("bookEdit.applying")}
                                                        </span>
                                                    ) : (
                                                        t("bookEdit.applyThis")
                                                    )}
                                                </Button>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="text-center py-6 text-sm text-[var(--app-ink-muted)]">
                                    <p>{t("bookEdit.noResultsFound")}</p>
                                    <p className="mt-1 text-xs">{t("bookEdit.tryDifferentQuery")}</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
