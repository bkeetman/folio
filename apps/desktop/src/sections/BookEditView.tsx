import { ArrowLeft, Check, ChevronRight, FileCheck2, Image as ImageIcon, Loader2, Search, Sparkles, Trash2, X } from "lucide-react";
import type { Dispatch, KeyboardEvent as ReactKeyboardEvent, ReactNode, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { confirm, convertFileSrc, invoke, open } from "../platform/native";
import { Button, Input } from "../components/ui";
import { useAuthorSuggestions } from "../hooks/useAuthorSuggestions";
import { LANGUAGE_OPTIONS } from "../lib/languageFlags";
import { cleanupMetadataTitle } from "../lib/metadataCleanup";
import { PREDEFINED_BOOK_CATEGORIES } from "../lib/categories";
import type { AuthorSuggestion, EnrichmentCandidate, ItemMetadata, LibraryItem, View } from "../types/library";

type EmbeddedCoverCandidate = {
    path: string;
    mime: string;
    bytes: number[];
    score: number;
};

type PendingCoverChange =
    | { type: "upload"; path: string; previewUrl: string }
    | { type: "remove" }
    | { type: "embedded" }
    | { type: "candidate"; candidate: EnrichmentCandidate };

type MetadataDraftField = keyof ItemMetadata;

const METADATA_DRAFT_FIELDS: MetadataDraftField[] = [
    "title",
    "authors",
    "publishedYear",
    "language",
    "isbn",
    "series",
    "seriesIndex",
    "genres",
    "description",
];

function normalizedMetadataValue(metadata: ItemMetadata, field: MetadataDraftField): string {
    const value = metadata[field];
    if (Array.isArray(value)) {
        return value.map((entry) => entry.trim()).filter(Boolean).join("\u0000");
    }
    return value === null || value === undefined ? "" : String(value).trim();
}

function getDirtyMetadataFields(baseline: ItemMetadata, draft: ItemMetadata): MetadataDraftField[] {
    return METADATA_DRAFT_FIELDS.filter(
        (field) => normalizedMetadataValue(baseline, field) !== normalizedMetadataValue(draft, field),
    );
}

function applyCandidateToDraft(current: ItemMetadata, candidate: EnrichmentCandidate): ItemMetadata {
    const isbn = candidate.identifiers.find(isLikelyIsbn);
    return {
        ...current,
        title: candidate.title?.trim() || current.title,
        authors: candidate.authors.length ? candidate.authors : current.authors,
        publishedYear: candidate.published_year ?? current.publishedYear,
        language: candidate.language?.trim() || current.language,
        isbn: isbn || current.isbn,
        genres: candidate.genres?.length ? candidate.genres : current.genres,
    };
}

function formatMetadataValue(metadata: ItemMetadata, field: MetadataDraftField): string {
    const value = metadata[field];
    if (Array.isArray(value)) return value.join(", ");
    return value === null || value === undefined || value === "" ? "Empty" : String(value);
}

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

function parseAuthorsInput(value: string): string[] {
    return value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
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

function CompactMetadataRow({
    label,
    current,
    changed,
    review,
    children,
}: {
    label: string;
    current: string;
    changed: boolean;
    review: boolean;
    children: ReactNode;
}) {
    return (
        <div className={`grid grid-cols-[108px_minmax(0,1fr)_28px_minmax(0,1fr)] items-center gap-3 border-b border-[var(--app-border-soft)] px-4 py-2 ${changed ? "bg-[rgba(249,115,22,0.06)]" : "bg-app-panel"}`}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.11em] text-app-ink-muted">{label}</div>
            <div className="truncate text-xs text-app-ink-muted" title={current}>{current}</div>
            <div className={`flex h-5 w-5 items-center justify-center rounded-full ${changed ? "bg-app-accent text-white" : "bg-app-surface-hover text-app-ink-muted"}`}>
                {changed ? <ChevronRight size={12} /> : <Check size={11} />}
            </div>
            <div className={review ? "truncate text-xs font-medium text-app-ink" : "min-w-0"}>{children}</div>
        </div>
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
    const [isRemovingCover, setIsRemovingCover] = useState(false);
    const [isApplyingEmbeddedCover, setIsApplyingEmbeddedCover] = useState(false);
    const [isQueueingRemove, setIsQueueingRemove] = useState(false);
    const [isLoadingEmbeddedPreview, setIsLoadingEmbeddedPreview] = useState(false);
    const [embeddedPreviewUrl, setEmbeddedPreviewUrl] = useState<string | null>(null);
    const [localCoverUrl, setLocalCoverUrl] = useState<string | null>(null);
    const [infoMessage, setInfoMessage] = useState<string | null>(null);
    const [editPhase, setEditPhase] = useState<"edit" | "review">("edit");
    const [pendingCoverChange, setPendingCoverChange] = useState<PendingCoverChange | null>(null);
    const [pendingMatchCandidate, setPendingMatchCandidate] = useState<EnrichmentCandidate | null>(null);
    const [embeddedCandidates, setEmbeddedCandidates] = useState<EmbeddedCoverCandidate[]>([]);
    const [selectedEmbeddedIndex, setSelectedEmbeddedIndex] = useState(0);
    const [embeddedSelectionDirty, setEmbeddedSelectionDirty] = useState(false);
    const [selectedCategoryToAdd, setSelectedCategoryToAdd] = useState("");
    const [isMatchQueryDirty, setIsMatchQueryDirty] = useState(false);
    const [authorsInput, setAuthorsInput] = useState("");
    const [authorsFocused, setAuthorsFocused] = useState(false);
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
    const [baselineMetadata, setBaselineMetadata] = useState<ItemMetadata>({
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
    const authorLookupQuery = useMemo(() => {
        const parts = authorsInput.split(",");
        return parts.at(-1)?.trim() ?? "";
    }, [authorsInput]);
    const {
        suggestions: authorSuggestions,
        loading: authorSuggestionsLoading,
        activeIndex: activeAuthorSuggestionIndex,
        setActiveIndex: setActiveAuthorSuggestionIndex,
        listRef: authorSuggestionsListRef,
        showSuggestions: showAuthorSuggestions,
        clearSuggestions: clearAuthorSuggestions,
        handleKeyDown: handleAuthorSuggestionsKeyDown,
    } = useAuthorSuggestions({
        isDesktop,
        enabled: authorsFocused,
        query: authorLookupQuery,
    });

    const selectedItem = libraryItems.find((item) => item.id === selectedItemId);
    const previewMetadata = useMemo<ItemMetadata | null>(() => {
        if (isDesktop || !selectedItemId || !selectedItem) return null;
        return {
            title: selectedItem.title,
            authors: selectedItem.authors,
            publishedYear: selectedItem.published_year,
            language: selectedItem.language ?? null,
            isbn: selectedItem.isbn ?? null,
            series: selectedItem.series ?? null,
            seriesIndex: selectedItem.series_index ?? null,
            description: null,
            genres: selectedItem.genres ?? [],
        };
    }, [
        selectedItemId,
        isDesktop,
        selectedItem,
    ]);
    const displayCoverUrl = localCoverUrl ?? coverUrl;
    const hasCover = Boolean(displayCoverUrl || selectedItem?.cover_path);
    const dirtyMetadataFields = getDirtyMetadataFields(baselineMetadata, formData);
    const coverDraftDirty = pendingCoverChange !== null || embeddedSelectionDirty;
    const draftChangeCount = dirtyMetadataFields.length + (coverDraftDirty ? 1 : 0);
    const draftCoverUrl = pendingCoverChange?.type === "remove"
        ? null
        : pendingCoverChange?.type === "upload"
            ? pendingCoverChange.previewUrl
            : pendingCoverChange?.type === "candidate"
                ? getCandidateCoverUrl(pendingCoverChange.candidate)
                : embeddedSelectionDirty && embeddedPreviewUrl
                    ? embeddedPreviewUrl
                    : displayCoverUrl;
    const activeItemIdRef = useRef<string | null>(selectedItemId);
    const embeddedPreviewUrlRef = useRef<string | null>(null);
    const localCoverUrlRef = useRef<string | null>(null);

    useEffect(() => {
        activeItemIdRef.current = selectedItemId;
        setError(null);
        setInfoMessage(null);
        setEditPhase("edit");
        setPendingCoverChange(null);
        setPendingMatchCandidate(null);
        setIsMatchQueryDirty(false);
        setAuthorsInput("");
        clearAuthorSuggestions();
        setAuthorsFocused(false);
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
    }, [clearAuthorSuggestions, selectedItemId]);

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
                    const normalized = { ...details, genres: details.genres ?? [] };
                    setFormData(normalized);
                    setBaselineMetadata(normalized);
                    setAuthorsInput((details.authors ?? []).join(", "));
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
        if (!previewMetadata) return;
        setFormData(previewMetadata);
        setBaselineMetadata(previewMetadata);
        setAuthorsInput(previewMetadata.authors.join(", "));
        setIsLoading(false);
    }, [previewMetadata]);

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
        if (isMatchQueryDirty || !selectedItemId || isLoading) return;
        if (metadataSearchQuery !== matchQuery) {
            onMatchQueryChange(metadataSearchQuery);
        }
    }, [
        isMatchQueryDirty,
        selectedItemId,
        isLoading,
        metadataSearchQuery,
        matchQuery,
        onMatchQueryChange,
    ]);

    const handleUseCurrentMetadataQuery = useCallback(() => {
        if (metadataSearchQuery !== matchQuery) {
            onMatchQueryChange(metadataSearchQuery);
        }
        setIsMatchQueryDirty(false);
    }, [metadataSearchQuery, matchQuery, onMatchQueryChange]);

    const handleUseMatchCandidateInDraft = useCallback((candidate: EnrichmentCandidate) => {
        const nextDraft = applyCandidateToDraft(formData, candidate);
        const candidateCoverUrl = getCandidateCoverUrl(candidate);
        const hasEffectiveChanges = getDirtyMetadataFields(baselineMetadata, nextDraft).length > 0 || Boolean(candidateCoverUrl);
        setFormData(nextDraft);
        if (candidate.authors.length) {
            setAuthorsInput(candidate.authors.join(", "));
        }
        setPendingMatchCandidate(candidate);
        if (candidateCoverUrl) {
            setPendingCoverChange({ type: "candidate", candidate });
            setEmbeddedSelectionDirty(false);
        }
        setEditPhase("edit");
        setError(null);
        setInfoMessage(hasEffectiveChanges
            ? t("bookEdit.matchAddedToDraft", {
                defaultValue: "Match values copied into the draft. The Library is unchanged.",
            })
            : t("bookEdit.matchAlreadySatisfied", {
                defaultValue: "This match already agrees with the Library. Nothing needs saving.",
            }));
    }, [baselineMetadata, formData, getCandidateCoverUrl, t]);

    const handleAuthorsInputChange = useCallback((value: string) => {
        const parsed = parseAuthorsInput(value);
        setAuthorsInput(value);
        setFormData((current) => ({ ...current, authors: parsed }));
        setActiveAuthorSuggestionIndex(-1);
    }, [setActiveAuthorSuggestionIndex]);

    const handleApplyAuthorSuggestion = useCallback((suggestion: AuthorSuggestion) => {
        const parts = authorsInput.split(",");
        if (parts.length === 0) {
            parts.push(suggestion.name);
        } else {
            parts[parts.length - 1] = suggestion.name;
        }
        const parsed = parseAuthorsInput(parts.join(","));
        setAuthorsInput(parsed.length ? `${parsed.join(", ")}, ` : "");
        setFormData((current) => ({ ...current, authors: parsed }));
        clearAuthorSuggestions();
    }, [authorsInput, clearAuthorSuggestions]);

    const handleAuthorsInputKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
        handleAuthorSuggestionsKeyDown(event, handleApplyAuthorSuggestion);
    }, [handleApplyAuthorSuggestion, handleAuthorSuggestionsKeyDown]);

    const handleSave = async () => {
        if (!selectedItemId) return;
        setIsSaving(true);
        setError(null);
        setInfoMessage(null);
        try {
            if (pendingMatchCandidate && pendingCoverChange?.type === "candidate") {
                await invoke("apply_fix_candidate", {
                    itemId: selectedItemId,
                    candidate: pendingMatchCandidate,
                });
            }
            if (pendingCoverChange?.type === "upload") {
                setIsUploadingCover(true);
                await invoke("upload_cover", {
                    itemId: selectedItemId,
                    path: pendingCoverChange.path,
                });
            } else if (pendingCoverChange?.type === "remove") {
                setIsRemovingCover(true);
                await invoke("remove_cover", { itemId: selectedItemId });
            } else if (pendingCoverChange?.type === "embedded" || embeddedSelectionDirty) {
                setIsApplyingEmbeddedCover(true);
                const selected = embeddedCandidates[selectedEmbeddedIndex];
                if (selected) {
                    await invoke("use_embedded_cover_from_bytes", {
                        itemId: selectedItemId,
                        bytes: selected.bytes,
                        mime: selected.mime,
                    });
                } else {
                    await invoke("use_embedded_cover", { itemId: selectedItemId });
                }
            }
            if (onSaveMetadata) {
                await onSaveMetadata(selectedItemId, formData);
            } else {
                await invoke("save_item_metadata", { itemId: selectedItemId, metadata: formData });
            }
            if (coverDraftDirty) {
                onClearCover(selectedItemId);
                await onFetchCover(selectedItemId, true);
                await loadLocalCoverBlob(selectedItemId);
            }
            if (onItemUpdate) {
                await onItemUpdate();
            }
            setBaselineMetadata(formData);
            setPendingCoverChange(null);
            setPendingMatchCandidate(null);
            setEmbeddedSelectionDirty(false);
            setInfoMessage(t("bookEdit.saved", { defaultValue: "Saved to Library." }));
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
            setIsUploadingCover(false);
            setIsRemovingCover(false);
            setIsApplyingEmbeddedCover(false);
        }
    };

    const handleCancel = () => {
        if (embedded || !setView) return;
        const fallbackView: View = previousView ?? "library-books";
        setView(fallbackView === "edit" ? "library-books" : fallbackView);
    };

    const handleDiscardDraft = () => {
        setFormData(baselineMetadata);
        setAuthorsInput(baselineMetadata.authors.join(", "));
        setPendingCoverChange(null);
        setPendingMatchCandidate(null);
        setEmbeddedSelectionDirty(false);
        setEditPhase("edit");
        setError(null);
        setInfoMessage(t("bookEdit.draftDiscarded", {
            defaultValue: "Draft discarded. The Library and files are unchanged.",
        }));
    };

    const handleQueueRemove = async () => {
        if (!selectedItemId || !isDesktop) return;
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
                setPendingCoverChange({
                    type: "upload",
                    path: selected,
                    previewUrl: convertFileSrc(selected),
                });
                setEmbeddedSelectionDirty(false);
                setInfoMessage(t("bookEdit.coverAddedToDraft", {
                    defaultValue: "Cover selected in the draft. Save or Cancel decides the outcome.",
                }));
            }
        } catch (err) {
            console.error("Failed to select cover", err);
            setError(t("bookEdit.failedSelectCover", { defaultValue: "Could not select the cover." }));
        }
    };

    const handleUseEmbeddedCover = async () => {
        if (!selectedItemId) return;
        setError(null);
        if (!embeddedPreviewUrl && embeddedCandidates.length === 0) {
            setError(t("bookEdit.noEmbeddedCover", { defaultValue: "No embedded cover is available." }));
            return;
        }
        setPendingCoverChange({ type: "embedded" });
        setEmbeddedSelectionDirty(true);
        setInfoMessage(t("bookEdit.embeddedCoverAddedToDraft", {
            defaultValue: "Embedded cover selected in the draft. Save or Cancel decides the outcome.",
        }));
    };

    const handleRemoveCover = async () => {
        if (!selectedItemId) return;
        setError(null);
        setPendingCoverChange({ type: "remove" });
        setEmbeddedSelectionDirty(false);
        setInfoMessage(t("bookEdit.coverRemovedFromDraft", {
            defaultValue: "Cover removed from the draft. Save or Cancel decides the outcome.",
        }));
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
        setPendingCoverChange({ type: "embedded" });
        setInfoMessage(t("bookEdit.embeddedCoverAddedToDraft", {
            defaultValue: "Embedded cover selected in the draft. Save or Cancel decides the outcome.",
        }));
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

    if (!embedded) {
        const busy = isSaving || isUploadingCover || isRemovingCover || isApplyingEmbeddedCover || isQueueingRemove;
        const isReview = editPhase === "review";
        const fieldChanged = (field: MetadataDraftField) => dirtyMetadataFields.includes(field);
        const showField = (field: MetadataDraftField) => !isReview || fieldChanged(field);
        const draftCoverLabel = pendingCoverChange?.type === "remove"
            ? t("bookEdit.noCover", { defaultValue: "No cover" })
            : pendingCoverChange?.type === "upload"
                ? t("bookEdit.selectedCover", { defaultValue: "Selected cover" })
                : pendingCoverChange?.type === "embedded"
                    ? t("bookEdit.embeddedCover", { defaultValue: "Embedded cover" })
                    : pendingCoverChange?.type === "candidate"
                        ? t("bookEdit.suggestedCover", { defaultValue: "Suggested cover" })
                        : t("bookEdit.libraryCover", { defaultValue: "Library cover" });

        return (
            <div className="mx-auto flex w-full max-w-[1380px] flex-col gap-3 pb-8">
                <header className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleCancel}
                            disabled={busy}
                            className="h-9 w-9 shrink-0 rounded-full border border-[var(--app-border-soft)] bg-app-surface/70"
                            aria-label={t("bookEdit.backToLibrary", { defaultValue: "Back to Library" })}
                        >
                            <ArrowLeft size={16} />
                        </Button>
                        <div className="min-w-0">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-app-ink-muted">
                                {t("bookEdit.editBook", { defaultValue: "Edit book" })}
                            </p>
                            <h1 className="truncate font-serif text-2xl leading-tight text-app-ink">
                                {formData.title || selectedItem.title || t("bookEdit.untitled")}
                            </h1>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="rounded-full border border-[var(--app-border-soft)] bg-app-surface px-2.5 py-1 text-[11px] font-medium text-app-ink-muted">
                            {draftChangeCount
                                ? t("bookEdit.draftChangeCount", { count: draftChangeCount, defaultValue: `${draftChangeCount} draft change${draftChangeCount === 1 ? "" : "s"}` })
                                : t("bookEdit.libraryUnchanged", { defaultValue: "Library unchanged" })}
                        </span>
                        {draftChangeCount > 0 ? (
                            <Button variant="outline" size="sm" onClick={handleDiscardDraft} disabled={busy} className="h-8 px-3">
                                <X size={13} />{t("bookEdit.cancel", { defaultValue: "Cancel" })}
                            </Button>
                        ) : null}
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleQueueRemove}
                            disabled={busy || !isDesktop}
                            className="h-9 w-9 text-red-500/75 hover:bg-red-500/10 hover:text-red-500"
                            title={t("bookEdit.removeFromLibrary")}
                        >
                            {isQueueingRemove ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                        </Button>
                    </div>
                </header>

                <nav aria-label={t("bookEdit.editProgress", { defaultValue: "Edit progress" })} className="grid overflow-hidden rounded-lg border border-[var(--app-border-soft)] bg-app-panel sm:grid-cols-3">
                    {[
                        {
                            label: t("bookEdit.editStep", { defaultValue: "Edit" }),
                            detail: t("bookEdit.editStepDetail", { defaultValue: "Compare and adjust" }),
                            active: !isReview,
                            complete: isReview,
                        },
                        {
                            label: t("bookEdit.reviewStep", { defaultValue: "Review" }),
                            detail: t("bookEdit.reviewStepDetail", { count: draftChangeCount, defaultValue: `${draftChangeCount} change${draftChangeCount === 1 ? "" : "s"}` }),
                            active: isReview,
                            complete: false,
                        },
                        {
                            label: t("bookEdit.saveStep", { defaultValue: "Save" }),
                            detail: t("bookEdit.saveStepDetail", { defaultValue: "Library first, files follow" }),
                            active: false,
                            complete: false,
                        },
                    ].map((step, index) => (
                        <button
                            key={step.label}
                            type="button"
                            disabled={busy || index === 2 || (index === 1 && draftChangeCount === 0)}
                            onClick={() => setEditPhase(index === 0 ? "edit" : "review")}
                            className={`flex items-center gap-3 border-[var(--app-border-soft)] px-4 py-2.5 text-left sm:border-r sm:last:border-r-0 ${step.active ? "bg-[var(--app-ink)] text-app-surface" : "bg-app-panel text-app-ink-muted"}`}
                        >
                            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${step.complete ? "border-emerald-500 bg-emerald-500 text-white" : step.active ? "border-white/30" : "border-[var(--app-border)]"}`}>
                                {step.complete ? <Check size={12} /> : index + 1}
                            </span>
                            <span>
                                <span className="block text-xs font-semibold">{step.label}</span>
                                <span className={`block text-[10px] ${step.active ? "opacity-65" : "text-app-ink-muted"}`}>{step.detail}</span>
                            </span>
                        </button>
                    ))}
                </nav>

                {error ? (
                    <div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-500">{error}</div>
                ) : infoMessage ? (
                    <div className="rounded-md border border-[var(--app-border-soft)] bg-app-surface px-3 py-2 text-xs text-app-ink-muted">{infoMessage}</div>
                ) : null}

                <div className="grid gap-3 min-[1120px]:grid-cols-[minmax(0,1fr)_300px]">
                    <main className="overflow-hidden rounded-xl border border-[var(--app-border-soft)] bg-app-panel shadow-soft">
                        <div className="flex items-center justify-between border-b border-[var(--app-border-soft)] bg-[var(--app-ink)] px-4 py-2.5 text-app-surface">
                            <div>
                                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] opacity-60">
                                    {isReview ? t("bookEdit.finalCheck", { defaultValue: "Final check" }) : t("bookEdit.libraryAndDraft", { defaultValue: "Library and draft" })}
                                </p>
                                <p className="mt-0.5 text-xs font-semibold">
                                    {isReview ? t("bookEdit.onlyChangesShown", { defaultValue: "Only effective changes are shown" }) : t("bookEdit.originalPreserved", { defaultValue: "Edit without losing the original" })}
                                </p>
                            </div>
                            {isReview ? (
                                <button type="button" onClick={() => setEditPhase("edit")} disabled={busy} className="text-[11px] font-semibold opacity-75 hover:opacity-100">
                                    {t("bookEdit.backToEditing", { defaultValue: "Back to editing" })}
                                </button>
                            ) : null}
                        </div>
                        <div className="grid grid-cols-[108px_minmax(0,1fr)_28px_minmax(0,1fr)] gap-3 border-b border-[var(--app-border-soft)] bg-app-surface px-4 py-2 text-[9px] font-semibold uppercase tracking-[0.13em] text-app-ink-muted">
                            <span>{t("bookEdit.field", { defaultValue: "Field" })}</span>
                            <span>{t("bookEdit.inLibrary", { defaultValue: "In Library" })}</span>
                            <span />
                            <span>{isReview ? t("bookEdit.afterSave", { defaultValue: "After Save" }) : t("bookEdit.draft", { defaultValue: "Draft" })}</span>
                        </div>

                        {showField("title") ? (
                            <CompactMetadataRow label={t("bookEdit.title")} current={formatMetadataValue(baselineMetadata, "title")} changed={fieldChanged("title")} review={isReview}>
                                {isReview ? formatMetadataValue(formData, "title") : (
                                    <div className="flex gap-1.5">
                                        <Input value={formData.title || ""} onChange={(event) => setFormData({ ...formData, title: event.target.value })} className="h-8 min-w-0 text-xs" />
                                        <Button variant="ghost" size="sm" onClick={() => setFormData((current) => {
                                            const cleaned = cleanupMetadataTitle(current);
                                            return cleaned.changed ? { ...current, title: cleaned.title, publishedYear: cleaned.publishedYear } : current;
                                        })} disabled={!titleCleanupPreview.changed} className="h-8 shrink-0 px-2 text-[10px]">{t("bookEdit.autoClean")}</Button>
                                    </div>
                                )}
                            </CompactMetadataRow>
                        ) : null}

                        {showField("authors") ? (
                            <CompactMetadataRow label={t("bookEdit.authors")} current={formatMetadataValue(baselineMetadata, "authors")} changed={fieldChanged("authors")} review={isReview}>
                                {isReview ? formatMetadataValue(formData, "authors") : (
                                    <div className="relative">
                                        <Input
                                            value={authorsInput || formData.authors.join(", ")}
                                            onFocus={() => setAuthorsFocused(true)}
                                            onBlur={() => window.setTimeout(() => setAuthorsFocused(false), 120)}
                                            onChange={(event) => handleAuthorsInputChange(event.target.value)}
                                            onKeyDown={handleAuthorsInputKeyDown}
                                            className="h-8 w-full text-xs"
                                        />
                                        {showAuthorSuggestions ? (
                                            <div ref={authorSuggestionsListRef} className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-[var(--app-border-soft)] bg-app-surface shadow-lg">
                                                {authorSuggestionsLoading ? <div className="px-3 py-2 text-xs text-app-ink-muted">{t("common.loading")}</div> : authorSuggestions.map((suggestion, index) => (
                                                    <button
                                                        key={suggestion.id}
                                                        type="button"
                                                        data-suggestion-index={index}
                                                        aria-selected={index === activeAuthorSuggestionIndex}
                                                        onMouseDown={(event) => { event.preventDefault(); handleApplyAuthorSuggestion(suggestion); }}
                                                        onMouseEnter={() => setActiveAuthorSuggestionIndex(index)}
                                                        className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs ${index === activeAuthorSuggestionIndex ? "bg-app-surface-hover" : "hover:bg-app-surface-hover"}`}
                                                    >
                                                        <span className="truncate">{suggestion.name}</span><span className="ml-3 text-app-ink-muted">{suggestion.bookCount}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        ) : null}
                                    </div>
                                )}
                            </CompactMetadataRow>
                        ) : null}

                        {showField("publishedYear") ? (
                            <CompactMetadataRow label={t("bookEdit.publicationYear")} current={formatMetadataValue(baselineMetadata, "publishedYear")} changed={fieldChanged("publishedYear")} review={isReview}>
                                {isReview ? formatMetadataValue(formData, "publishedYear") : <Input type="number" value={formData.publishedYear ?? ""} onChange={(event) => setFormData({ ...formData, publishedYear: parseInt(event.target.value, 10) || null })} className="h-8 text-xs" />}
                            </CompactMetadataRow>
                        ) : null}

                        {showField("language") ? (
                            <CompactMetadataRow label={t("bookEdit.language")} current={formatMetadataValue(baselineMetadata, "language")} changed={fieldChanged("language")} review={isReview}>
                                {isReview ? formatMetadataValue(formData, "language") : (
                                    <select value={formData.language ?? ""} onChange={(event) => setFormData({ ...formData, language: event.target.value || null })} className="h-8 w-full rounded-md border border-[var(--app-border-soft)] bg-app-surface px-2 text-xs text-app-ink">
                                        <option value="">{t("bookEdit.select")}</option>
                                        {LANGUAGE_OPTIONS.map((language) => <option key={language.code} value={language.code}>{language.flag ? `${language.flag} ${language.name}` : language.name}</option>)}
                                    </select>
                                )}
                            </CompactMetadataRow>
                        ) : null}

                        {showField("isbn") ? (
                            <CompactMetadataRow label={t("bookEdit.isbn")} current={formatMetadataValue(baselineMetadata, "isbn")} changed={fieldChanged("isbn")} review={isReview}>
                                {isReview ? formatMetadataValue(formData, "isbn") : <Input value={formData.isbn ?? ""} onChange={(event) => setFormData({ ...formData, isbn: event.target.value || null })} className="h-8 text-xs" />}
                            </CompactMetadataRow>
                        ) : null}

                        {showField("series") ? (
                            <CompactMetadataRow label={t("bookEdit.series")} current={formatMetadataValue(baselineMetadata, "series")} changed={fieldChanged("series")} review={isReview}>
                                {isReview ? formatMetadataValue(formData, "series") : <Input value={formData.series ?? ""} onChange={(event) => setFormData({ ...formData, series: event.target.value || null })} className="h-8 text-xs" />}
                            </CompactMetadataRow>
                        ) : null}

                        {showField("seriesIndex") ? (
                            <CompactMetadataRow label={t("bookEdit.seriesNumber")} current={formatMetadataValue(baselineMetadata, "seriesIndex")} changed={fieldChanged("seriesIndex")} review={isReview}>
                                {isReview ? formatMetadataValue(formData, "seriesIndex") : <Input type="number" step="0.1" value={formData.seriesIndex ?? ""} onChange={(event) => setFormData({ ...formData, seriesIndex: parseFloat(event.target.value) || null })} className="h-8 text-xs" />}
                            </CompactMetadataRow>
                        ) : null}

                        {showField("genres") ? (
                            <CompactMetadataRow label={t("bookEdit.categories")} current={formatMetadataValue(baselineMetadata, "genres")} changed={fieldChanged("genres")} review={isReview}>
                                {isReview ? formatMetadataValue(formData, "genres") : <Input value={(formData.genres ?? []).join(", ")} onChange={(event) => setFormData({ ...formData, genres: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} className="h-8 text-xs" />}
                            </CompactMetadataRow>
                        ) : null}

                        {showField("description") ? (
                            <CompactMetadataRow label={t("bookEdit.description")} current={formatMetadataValue(baselineMetadata, "description")} changed={fieldChanged("description")} review={isReview}>
                                {isReview ? formatMetadataValue(formData, "description") : <textarea value={formData.description ?? ""} onChange={(event) => setFormData({ ...formData, description: event.target.value || null })} className="h-14 w-full resize-none rounded-md border border-[var(--app-border-soft)] bg-app-surface px-2 py-1.5 text-xs text-app-ink outline-none focus:ring-1 focus:ring-[var(--app-accent)]" />}
                            </CompactMetadataRow>
                        ) : null}

                        {isReview && coverDraftDirty ? (
                            <div className="grid grid-cols-[108px_minmax(0,1fr)_28px_minmax(0,1fr)] items-center gap-3 bg-[rgba(249,115,22,0.06)] px-4 py-3">
                                <div className="text-[10px] font-semibold uppercase tracking-[0.11em] text-app-ink-muted">{t("bookEdit.bookCover")}</div>
                                <div className="flex items-center gap-2 text-xs text-app-ink-muted"><span className="h-9 w-7 overflow-hidden rounded-sm border border-[var(--app-border-soft)] bg-app-surface">{displayCoverUrl ? <img src={displayCoverUrl} alt="" className="h-full w-full object-cover" /> : null}</span>{t("bookEdit.libraryCover", { defaultValue: "Library cover" })}</div>
                                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-app-accent text-white"><ChevronRight size={12} /></div>
                                <div className="flex items-center gap-2 text-xs font-medium"><span className="h-9 w-7 overflow-hidden rounded-sm border border-[var(--app-border-soft)] bg-app-surface">{draftCoverUrl ? <img src={draftCoverUrl} alt="" className="h-full w-full object-cover" /> : null}</span>{draftCoverLabel}</div>
                            </div>
                        ) : null}
                    </main>

                    <aside className="space-y-3">
                        {!isReview ? (
                            <section className="rounded-xl border border-[var(--app-border-soft)] bg-app-panel p-3.5">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 text-xs font-semibold text-app-ink"><Sparkles size={14} className="text-app-accent" />{t("bookEdit.matchMetadata")}</div>
                                    {pendingMatchCandidate ? <span className="rounded-full bg-app-surface-hover px-2 py-0.5 text-[9px] font-semibold text-app-ink-muted">{pendingMatchCandidate.source}</span> : null}
                                </div>
                                <div className="mt-3 flex gap-2">
                                    <Input value={matchQuery} onChange={(event) => { const value = event.target.value; onMatchQueryChange(value); setIsMatchQueryDirty(value !== metadataSearchQuery); }} onKeyDown={(event) => { if (event.key === "Enter") onMatchSearch(matchQuery); }} className="h-8 flex-1 text-xs" />
                                    <Button variant="primary" size="sm" onClick={() => onMatchSearch(matchQuery)} disabled={matchLoading || !matchQuery.trim() || !isDesktop} className="h-8 px-2.5">{matchLoading ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}</Button>
                                </div>
                                <button type="button" onClick={handleUseCurrentMetadataQuery} disabled={!metadataSearchQuery} className="mt-1.5 block w-full text-right text-[10px] text-app-ink-muted hover:text-app-accent disabled:opacity-50">{t("bookEdit.useCurrentMetadata")}</button>
                                {matchCandidates.length ? (
                                    <div className="mt-3 max-h-52 space-y-2 overflow-y-auto pr-1">
                                        {matchCandidates.slice(0, 4).map((candidate) => (
                                            <button key={candidate.id} type="button" onClick={() => handleUseMatchCandidateInDraft(candidate)} disabled={busy} className="flex w-full items-center gap-2 rounded-md border border-[var(--app-border-soft)] bg-app-surface p-2 text-left hover:border-[var(--app-accent)]">
                                                <span className="h-12 w-8 shrink-0 overflow-hidden rounded-sm border border-[var(--app-border-soft)] bg-app-panel">{getCandidateCoverUrl(candidate) ? <img src={getCandidateCoverUrl(candidate) ?? ""} alt="" className="h-full w-full object-cover" /> : null}</span>
                                                <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-app-ink">{candidate.title || t("bookEdit.untitled")}</span><span className="block truncate text-[10px] text-app-ink-muted">{candidate.authors.join(", ")} · {candidate.source}</span></span>
                                                <span className="text-[10px] font-semibold text-app-accent">{Math.round(candidate.confidence * 100)}%</span>
                                            </button>
                                        ))}
                                    </div>
                                ) : matchLoading ? <div className="mt-3 flex items-center gap-2 text-[11px] text-app-ink-muted"><Loader2 size={13} className="animate-spin" />{t("bookEdit.searchingSources")}</div> : null}
                            </section>
                        ) : pendingMatchCandidate ? (
                            <section className="rounded-xl border border-[var(--app-border-soft)] bg-app-panel p-3.5">
                                <div className="flex items-center gap-2 text-xs font-semibold"><Sparkles size={14} className="text-app-accent" />{t("bookEdit.matchInDraft", { defaultValue: "Match in draft" })}</div>
                                <p className="mt-2 text-[11px] text-app-ink-muted">{pendingMatchCandidate.source} · {Math.round(pendingMatchCandidate.confidence * 100)}%</p>
                            </section>
                        ) : null}

                        <section className="rounded-xl border border-[var(--app-border-soft)] bg-app-panel p-3.5">
                            <div className="flex items-start gap-3">
                                <div className="h-36 w-24 shrink-0 overflow-hidden rounded-md border border-[var(--app-border-soft)] bg-app-surface shadow-sm">
                                    {draftCoverUrl ? <img src={draftCoverUrl} alt="" className="h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : <div className="flex h-full items-center justify-center"><ImageIcon size={24} className="text-app-ink-muted" /></div>}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-app-ink-muted">{t("bookEdit.coverInDraft", { defaultValue: "Cover in draft" })}</p>
                                    <p className="mt-1 text-[11px] font-medium text-app-ink">{draftCoverLabel}</p>
                                    {!isReview ? (
                                        <div className="mt-3 space-y-1.5">
                                            <button type="button" onClick={handleChangeCover} disabled={busy || !isDesktop} className="block text-left text-[11px] font-semibold text-app-ink-muted hover:text-app-accent disabled:opacity-50">{hasCover ? t("bookEdit.changeCover") : t("bookEdit.addCover")}</button>
                                            <button type="button" onClick={handleUseEmbeddedCover} disabled={busy || isLoadingEmbeddedPreview || !isDesktop} className="block text-left text-[11px] font-semibold text-app-ink-muted hover:text-app-accent disabled:opacity-50">{t("bookEdit.useEmbeddedCover")}</button>
                                            <button type="button" onClick={handleRemoveCover} disabled={busy || (!hasCover && !coverDraftDirty)} className="block text-left text-[11px] font-semibold text-red-500 disabled:opacity-50">{t("bookEdit.removeCover")}</button>
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                            {!isReview && embeddedPreviewUrl ? (
                                <div className="mt-3 flex items-center gap-2 border-t border-[var(--app-border-soft)] pt-3">
                                    <img src={embeddedPreviewUrl} alt="" className="h-12 w-8 rounded-sm object-cover" />
                                    <select value={String(selectedEmbeddedIndex)} onChange={(event) => handleSelectEmbeddedCandidate(parseInt(event.target.value, 10))} className="h-8 min-w-0 flex-1 rounded-md border border-[var(--app-border-soft)] bg-app-surface px-2 text-[10px] text-app-ink">
                                        {embeddedCandidates.map((candidate, index) => <option key={`${candidate.path}-${index}`} value={index}>{candidate.path}</option>)}
                                    </select>
                                </div>
                            ) : null}
                        </section>

                        <section className="rounded-xl border border-[var(--app-border-soft)] bg-app-panel p-3.5">
                            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-app-ink-muted"><FileCheck2 size={13} />{t("bookEdit.saveBoundary", { defaultValue: "Save boundary" })}</div>
                            <p className="mt-2 text-[11px] leading-relaxed text-app-ink-muted">{t("bookEdit.saveBoundaryDetailV2", { defaultValue: "Save updates the Library. File copies continue separately afterward." })}</p>
                            {!isReview ? (
                                <Button variant="primary" size="sm" className="mt-3 w-full" onClick={() => setEditPhase("review")} disabled={busy || draftChangeCount === 0}>
                                    {t("bookEdit.reviewChanges", { count: draftChangeCount, defaultValue: `Review ${draftChangeCount} change${draftChangeCount === 1 ? "" : "s"}` })}<ChevronRight size={13} />
                                </Button>
                            ) : (
                                <div className="mt-3 grid grid-cols-2 gap-2">
                                    <Button variant="outline" size="sm" onClick={handleDiscardDraft} disabled={busy}>{t("bookEdit.cancel", { defaultValue: "Cancel" })}</Button>
                                    <Button variant="primary" size="sm" onClick={handleSave} disabled={busy || draftChangeCount === 0 || !isDesktop}>
                                        {isSaving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}{t("bookEdit.saveDraft", { defaultValue: "Save changes" })}
                                    </Button>
                                </div>
                            )}
                            {!isDesktop ? <p className="mt-2 text-center text-[10px] text-app-ink-muted">{t("bookEdit.previewOnly", { defaultValue: "Preview only in the web build" })}</p> : null}
                        </section>
                    </aside>
                </div>
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
                            disabled={isUploadingCover || isRemovingCover || isApplyingEmbeddedCover || isSaving}
                        >
                            <ImageIcon size={14} className="mr-2" />
                            {hasCover ? t("bookEdit.changeCover") : t("bookEdit.addCover")}
                        </Button>
                        <Button
                            variant="ghost"
                            className="w-full text-red-400 hover:text-red-300 disabled:text-app-ink-muted"
                            onClick={handleRemoveCover}
                            disabled={!hasCover || isUploadingCover || isRemovingCover || isApplyingEmbeddedCover || isSaving}
                        >
                            {isRemovingCover ? (
                                <Loader2 size={14} className="mr-2 animate-spin" />
                            ) : (
                                <Trash2 size={14} className="mr-2" />
                            )}
                            {t("bookEdit.removeCover")}
                        </Button>
                        <Button
                            variant="ghost"
                            className="w-full"
                            onClick={handleUseEmbeddedCover}
                            disabled={isUploadingCover || isRemovingCover || isApplyingEmbeddedCover || isSaving || isLoadingEmbeddedPreview}
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
                                <div className="relative">
                                    <Input
                                        value={authorsInput}
                                        onFocus={() => setAuthorsFocused(true)}
                                        onBlur={() => {
                                            window.setTimeout(() => {
                                                setAuthorsFocused(false);
                                            }, 120);
                                        }}
                                        onChange={(e) => handleAuthorsInputChange(e.target.value)}
                                        onKeyDown={handleAuthorsInputKeyDown}
                                        placeholder={t("bookEdit.authorsPlaceholder")}
                                        className="w-full"
                                    />
                                    {showAuthorSuggestions && (
                                        <div
                                            ref={authorSuggestionsListRef}
                                            className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-md border border-[var(--app-border-soft)] bg-app-surface shadow-lg"
                                        >
                                            {authorSuggestionsLoading ? (
                                                <div className="px-3 py-2 text-xs text-app-ink-muted">{t("common.loading")}</div>
                                            ) : (
                                                authorSuggestions.map((suggestion, suggestionIndex) => (
                                                    <button
                                                        key={suggestion.id}
                                                        type="button"
                                                        data-suggestion-index={suggestionIndex}
                                                        className={`flex w-full items-center justify-between border-l-2 px-3 py-2 text-left text-sm text-app-ink transition-colors ${
                                                            suggestionIndex === activeAuthorSuggestionIndex
                                                                ? "border-[var(--app-accent)] bg-[rgba(249,115,22,0.12)]"
                                                                : "border-transparent hover:bg-app-surface-hover"
                                                        }`}
                                                        aria-selected={suggestionIndex === activeAuthorSuggestionIndex}
                                                        onMouseDown={(event) => {
                                                            event.preventDefault();
                                                            handleApplyAuthorSuggestion(suggestion);
                                                        }}
                                                        onMouseEnter={() => setActiveAuthorSuggestionIndex(suggestionIndex)}
                                                    >
                                                        <span className="truncate">{suggestion.name}</span>
                                                        <span className="ml-3 shrink-0 text-xs text-app-ink-muted">
                                                            {suggestion.bookCount}
                                                        </span>
                                                    </button>
                                                ))
                                            )}
                                        </div>
                                    )}
                                </div>
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
                        <div className="mb-3 flex items-center">
                            <h2 className="text-xs font-semibold uppercase tracking-wider text-app-ink-muted">
                                {t("bookEdit.matchMetadata")}
                            </h2>
                        </div>
                        <div className="flex gap-2">
                            <Input
                                value={matchQuery}
                                onChange={(e) => {
                                    const value = e.target.value;
                                    onMatchQueryChange(value);
                                    setIsMatchQueryDirty(value !== metadataSearchQuery);
                                }}
                                placeholder={t("bookEdit.searchTitleOrAuthor")}
                                className="flex-1 text-sm"
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

                        <div className="mt-4 flex-1 overflow-y-auto scrollbar-hide">
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
