import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, Check, Image as ImageIcon, Loader2, X } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useState } from "react";
import { Button, Input } from "../components/ui";
import { LANGUAGE_OPTIONS } from "../lib/languageFlags";
import type { ItemMetadata, LibraryItem, View } from "../types/library";

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
}: BookEditViewProps) {
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isUploadingCover, setIsUploadingCover] = useState(false);
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
    }, [selectedItemId, isDesktop, coverUrl, onFetchCover]);

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

                    <div className="grid grid-cols-1 gap-8 md:grid-cols-[280px_1fr]">
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
                                disabled={isUploadingCover || isSaving}
                            >
                                <ImageIcon size={14} className="mr-2" />
                                {coverUrl ? "Change Cover" : "Add Cover"}
                            </Button>
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
                                    <label className="mb-1.5 block text-sm font-medium text-app-ink">Title</label>
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
                    </div>
                </div>
            </div>
        </div>
    );
}
