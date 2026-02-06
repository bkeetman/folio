import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, Check, Image as ImageIcon, Loader2, Search, X } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useState } from "react";
import { Button, Input } from "../components/ui";
import { cleanupMetadataTitle } from "../lib/metadataCleanup";
import { LANGUAGE_OPTIONS } from "../lib/languageFlags";
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
    setView: Dispatch<SetStateAction<View>>;
    previousView: View;
    isDesktop: boolean;
    onItemUpdate: () => Promise<void>;
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
    getCandidateCoverUrl: (candidate: EnrichmentCandidate) => string | null;
};

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
    getCandidateCoverUrl,
}: BookEditViewProps) {
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isUploadingCover, setIsUploadingCover] = useState(false);
    const [isApplyingEmbeddedCover, setIsApplyingEmbeddedCover] = useState(false);
    const [isLoadingEmbeddedPreview, setIsLoadingEmbeddedPreview] = useState(false);
    const [embeddedPreviewUrl, setEmbeddedPreviewUrl] = useState<string | null>(null);
    const [embeddedCandidates, setEmbeddedCandidates] = useState<EmbeddedCoverCandidate[]>([]);
    const [selectedEmbeddedIndex, setSelectedEmbeddedIndex] = useState(0);
    const [formData, setFormData] = useState<ItemMetadata>({
        title: "",
        authors: [],
        publishedYear: null,
        language: null,
        isbn: null,
        series: null,
        seriesIndex: null,
        description: null,
    });

    const selectedItem = libraryItems.find((item) => item.id === selectedItemId);

    useEffect(() => {
        if (selectedItemId && isDesktop) {
            setIsLoading(true);
            setError(null);
            invoke<ItemMetadata>("get_item_details", { itemId: selectedItemId })
                .then((details) => {
                    setFormData(details);
                    setIsLoading(false);
                })
                .catch((err) => {
                    console.error("Failed to load details", err);
                    setError("Failed to load book details.");
                    setIsLoading(false);
                });

            // Ensure cover is loaded
            if (selectedItemId && !coverUrl) {
                void onFetchCover(selectedItemId);
            }
        }
    }, [selectedItemId, isDesktop, coverUrl, onFetchCover, detailsVersion]);

    useEffect(() => {
        return () => {
            if (embeddedPreviewUrl) {
                URL.revokeObjectURL(embeddedPreviewUrl);
            }
        };
    }, [embeddedPreviewUrl]);

    const handleSave = async () => {
        if (!selectedItemId) return;
        setIsSaving(true);
        setError(null);
        try {
            await invoke("save_item_metadata", { itemId: selectedItemId, metadata: formData });
            await onItemUpdate();
            // Fallback to library-books if previousView is somehow edit
            setView(previousView === "edit" ? "library-books" : previousView);
        } catch (err) {
            console.error("Failed to save", err);
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setIsSaving(false);
        }
    };

    const handleCancel = () => {
        setView(previousView === "edit" ? "library-books" : previousView);
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
                await invoke("upload_cover", { itemId: selectedItemId, path: selected });

                // Refresh cover
                onClearCover(selectedItemId);
                await onFetchCover(selectedItemId, true);

                await onItemUpdate();
                setIsUploadingCover(false);
            }
        } catch (err) {
            console.error("Failed to upload cover", err);
            setError("Failed to upload cover image.");
            setIsUploadingCover(false);
        }
    };

    const handleUseEmbeddedCover = async () => {
        if (!selectedItemId) return;
        setIsApplyingEmbeddedCover(true);
        setError(null);
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
            await onItemUpdate();
        } catch (err) {
            console.error("Failed to use embedded cover", err);
            setError(err instanceof Error ? err.message : "Failed to use embedded cover.");
        } finally {
            setIsApplyingEmbeddedCover(false);
        }
    };

    const handlePreviewEmbeddedCover = async () => {
        if (!selectedItemId) return;
        setIsLoadingEmbeddedPreview(true);
        setError(null);
        try {
            const result = await invoke<EmbeddedCoverCandidate[]>(
                "list_embedded_cover_candidates",
                { itemId: selectedItemId }
            );
            if (!result.length) {
                setError("No embedded cover found in EPUB.");
                return;
            }
            setEmbeddedCandidates(result);
            setSelectedEmbeddedIndex(0);
            const blob = new Blob([new Uint8Array(result[0].bytes)], { type: result[0].mime });
            const url = URL.createObjectURL(blob);
            setEmbeddedPreviewUrl((previous) => {
                if (previous) URL.revokeObjectURL(previous);
                return url;
            });
        } catch (err) {
            console.error("Failed to load embedded cover preview", err);
            setError(err instanceof Error ? err.message : "Failed to load embedded cover preview.");
        } finally {
            setIsLoadingEmbeddedPreview(false);
        }
    };

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
    };

    if (!selectedItemId || !selectedItem) {
        return (
            <div className="flex h-full items-center justify-center text-app-ink-muted">
                No book selected for editing.
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
        <div className="flex h-full flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-app-border bg-app-surface px-6 py-4">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="sm" onClick={handleCancel}>
                        <ArrowLeft size={16} />
                    </Button>
                    <div>
                        <h1 className="text-lg font-semibold">Edit Book</h1>
                        <p className="text-sm text-app-ink-muted">{selectedItem.title || "Untitled"}</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={handleCancel} disabled={isSaving || isUploadingCover}>
                        <X size={14} className="mr-1" />
                        Cancel
                    </Button>
                    <Button
                        size="sm"
                        className="bg-app-accent hover:bg-app-accent-hover text-white"
                        onClick={handleSave}
                        disabled={isSaving || isUploadingCover}
                    >
                        {isSaving ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Check size={14} className="mr-1" />}
                        Save Changes
                    </Button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
                <div className="mx-auto max-w-5xl">
                    {error && (
                        <div className="mb-6 rounded-md bg-red-50 p-4 text-sm text-red-700 border border-red-200">
                            {error}
                        </div>
                    )}

                    <div className="grid grid-cols-1 gap-8 md:grid-cols-[280px_1fr_320px]">
                        {/* Left Column: Cover */}
                        <div className="space-y-4">
                            <h2 className="text-sm font-semibold uppercase tracking-wider text-app-ink-muted">
                                Book Cover
                            </h2>
                            <div className="group relative aspect-[3/4] w-full overflow-hidden rounded-lg border border-app-border bg-app-surface shadow-sm">
                                {coverUrl ? (
                                    <img
                                        src={coverUrl}
                                        alt=""
                                        className="h-full w-full object-cover"
                                        onError={() => {
                                            if (selectedItemId) {
                                                onClearCover(selectedItemId);
                                                void onFetchCover(selectedItemId, true);
                                            }
                                        }}
                                    />
                                ) : (
                                    <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-app-ink-muted">
                                        <ImageIcon size={48} strokeWidth={1} />
                                        <span className="text-xs uppercase tracking-widest">{selectedItem.formats?.[0] || "Unknown"}</span>
                                    </div>
                                )}

                                {isUploadingCover && (
                                    <div className="absolute inset-0 flex items-center justify-center bg-white/60 backdrop-blur-[2px]">
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
                                {coverUrl ? "Change Cover" : "Add Cover"}
                            </Button>
                            <Button
                                variant="ghost"
                                className="w-full"
                                onClick={handleUseEmbeddedCover}
                                disabled={isUploadingCover || isApplyingEmbeddedCover || isSaving}
                            >
                                {isApplyingEmbeddedCover ? (
                                    <Loader2 size={14} className="mr-2 animate-spin" />
                                ) : (
                                    <ImageIcon size={14} className="mr-2" />
                                )}
                                Use Embedded Cover
                            </Button>
                            <div className="rounded-md border border-app-border bg-white p-3">
                                <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-app-ink-muted">
                                    Embedded Cover
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={handlePreviewEmbeddedCover}
                                        disabled={isLoadingEmbeddedPreview || isApplyingEmbeddedCover || isSaving}
                                    >
                                        {isLoadingEmbeddedPreview ? "Loading..." : "Preview"}
                                    </Button>
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
                                                className="h-8 w-full rounded-md border border-app-border bg-white px-2 text-[10px]"
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
                                    <div className="text-[10px] text-app-ink-muted">No preview loaded.</div>
                                )}
                            </div>
                            <p className="text-[10px] text-center text-app-ink-muted">
                                Recommended: 800x1200px (JPG, PNG, WebP)
                            </p>
                        </div>

                        {/* Right Column: Metadata */}
                        <div className="rounded-lg border border-app-border bg-white p-6 shadow-sm">
                            <h2 className="mb-6 text-sm font-semibold uppercase tracking-wider text-app-ink-muted">
                                Metadata details
                            </h2>

                            <div className="space-y-5">
                                {/* Title */}
                                <div>
                                    <div className="mb-1.5 flex items-center justify-between">
                                        <label className="block text-sm font-medium text-app-ink">Title</label>
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
                                            Auto-clean
                                        </Button>
                                    </div>
                                    <Input
                                        value={formData.title || ""}
                                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                        placeholder="Book title"
                                        className="w-full"
                                    />
                                </div>

                                {/* Authors */}
                                <div>
                                    <label className="mb-1.5 block text-sm font-medium text-app-ink">Authors</label>
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
                                        placeholder="Comma separated: Author One, Author Two"
                                        className="w-full"
                                    />
                                    <p className="mt-1 text-xs text-app-ink-muted">Separate multiple authors with commas</p>
                                </div>

                                {/* Year and Language */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="mb-1.5 block text-sm font-medium text-app-ink">Publication Year</label>
                                        <Input
                                            type="number"
                                            value={formData.publishedYear || ""}
                                            onChange={(e) =>
                                                setFormData({ ...formData, publishedYear: parseInt(e.target.value) || null })
                                            }
                                            placeholder="e.g. 2024"
                                            className="w-full"
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1.5 block text-sm font-medium text-app-ink">Language</label>
                                        <select
                                            value={formData.language ?? ""}
                                            onChange={(e) => setFormData({ ...formData, language: e.target.value || null })}
                                            className="h-10 w-full rounded-md border border-app-border bg-white px-3 text-sm text-app-ink"
                                        >
                                            <option value="">Select...</option>
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
                                    <label className="mb-1.5 block text-sm font-medium text-app-ink">ISBN</label>
                                    <Input
                                        value={formData.isbn || ""}
                                        onChange={(e) => setFormData({ ...formData, isbn: e.target.value || null })}
                                        placeholder="ISBN-10 or ISBN-13"
                                        className="w-full"
                                    />
                                </div>

                                {/* Series */}
                                <div className="grid grid-cols-[1fr_120px] gap-4">
                                    <div>
                                        <label className="mb-1.5 block text-sm font-medium text-app-ink">Series</label>
                                        <Input
                                            value={formData.series || ""}
                                            onChange={(e) => setFormData({ ...formData, series: e.target.value || null })}
                                            placeholder="Series name"
                                            className="w-full"
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1.5 block text-sm font-medium text-app-ink">Series #</label>
                                        <Input
                                            type="number"
                                            step="0.1"
                                            value={formData.seriesIndex || ""}
                                            onChange={(e) =>
                                                setFormData({ ...formData, seriesIndex: parseFloat(e.target.value) || null })
                                            }
                                            placeholder="1, 2, 3..."
                                            className="w-full"
                                        />
                                    </div>
                                </div>

                                {/* Description */}
                                <div>
                                    <label className="mb-1.5 block text-sm font-medium text-app-ink">Description</label>
                                    <textarea
                                        value={formData.description || ""}
                                        onChange={(e) => setFormData({ ...formData, description: e.target.value || null })}
                                        placeholder="Book description or summary..."
                                        className="flex min-h-[160px] w-full rounded-md border border-app-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Right Column: Match/Search */}
                        <div className="flex flex-col rounded-lg border border-app-border bg-white p-4 shadow-sm">
                            <div className="mb-3 flex items-center justify-between">
                                <h2 className="text-xs font-semibold uppercase tracking-wider text-app-ink-muted">
                                    Match metadata
                                </h2>
                            </div>
                            <div className="flex gap-2">
                                <Input
                                    value={matchQuery}
                                    onChange={(e) => onMatchQueryChange(e.target.value)}
                                    placeholder="Search title or author..."
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

                            <div className="mt-4 flex-1 overflow-y-auto">
                                {matchLoading ? (
                                    <div className="flex items-center justify-center gap-2 py-6 text-sm text-[var(--app-ink-muted)]">
                                        <Loader2 size={16} className="animate-spin" />
                                        Searching...
                                    </div>
                                ) : matchCandidates.length > 0 ? (
                                    <div className="space-y-3">
                                        {matchCandidates.map((candidate) => {
                                            const coverUrl = getCandidateCoverUrl(candidate);
                                            return (
                                                <div
                                                    key={candidate.id}
                                                    className="rounded-md border border-[var(--app-border)] bg-white p-2"
                                                >
                                                    <div className="flex gap-2">
                                                        <div className="h-16 w-11 flex-shrink-0 overflow-hidden rounded border border-[var(--app-border)] bg-[#fffaf4]">
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
                                                                    No cover
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
                                                                {candidate.published_year ?? "—"}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => onMatchApply(candidate)}
                                                        className="w-full mt-2 text-xs"
                                                        disabled={!isDesktop || matchApplyingId === candidate.id}
                                                    >
                                                        {matchApplyingId === candidate.id ? "Applying..." : "Apply This"}
                                                    </Button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="text-center py-6 text-sm text-[var(--app-ink-muted)]">
                                        <p>No results found.</p>
                                        <p className="mt-1 text-xs">Try a different query or edit metadata manually.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
