import type { DuplicateGroup, EnrichmentCandidate, InboxItem, Tag } from "../types/library";

export const sampleBooks = [
  {
    id: "1",
    title: "The Shallows",
    author: "Nicholas Carr",
    format: "EPUB",
    year: 2010,
    status: "Complete",
    cover: null,
    tags: [{ id: "t1", name: "Favorites", color: "amber" }],
  },
  {
    id: "2",
    title: "Silent Spring",
    author: "Rachel Carson",
    format: "PDF",
    year: 1962,
    status: "Complete",
    cover: null,
    tags: [],
  },
  {
    id: "3",
    title: "The Left Hand of Darkness",
    author: "Ursula K. Le Guin",
    format: "EPUB",
    year: 1969,
    status: "Needs ISBN",
    cover: null,
    tags: [{ id: "t2", name: "To Review", color: "sky" }],
  },
  {
    id: "4",
    title: "Braiding Sweetgrass",
    author: "Robin Wall Kimmerer",
    format: "PDF",
    year: 2013,
    status: "Needs Cover",
    cover: null,
    tags: [],
  },
  {
    id: "5",
    title: "The Book of Tea",
    author: "Kakuzo Okakura",
    format: "EPUB",
    year: 1906,
    status: "Complete",
    cover: null,
    tags: [{ id: "t3", name: "Classic", color: "emerald" }],
  },
];

export const sampleTags: Tag[] = [
  { id: "t1", name: "Favorites", color: "amber" },
  { id: "t2", name: "To Review", color: "sky" },
  { id: "t3", name: "Classic", color: "emerald" },
];

export const sampleInboxItems: InboxItem[] = [
  { id: "i1", title: "Notes on the Synthesis", reason: "Missing author" },
  { id: "i2", title: "Design of Everyday Things", reason: "Missing ISBN" },
  { id: "i3", title: "A New Ecology", reason: "Missing cover" },
];

export const sampleDuplicateGroups: DuplicateGroup[] = [
  {
    id: "d1",
    kind: "hash",
    title: "The Shallows",
    files: ["The Shallows.epub", "The Shallows (1).epub"],
    file_ids: ["d1-file-1", "d1-file-2"],
    file_paths: ["/samples/The Shallows.epub", "/samples/The Shallows (1).epub"],
    file_titles: ["The Shallows", "The Shallows"],
    file_authors: ["Nicholas Carr", "Nicholas Carr"],
    file_sizes: [1_048_576, 1_048_576],
  },
  {
    id: "d2",
    kind: "hash",
    title: "Silent Spring",
    files: ["Silent Spring.pdf", "Silent Spring - copy.pdf"],
    file_ids: ["d2-file-1", "d2-file-2"],
    file_paths: ["/samples/Silent Spring.pdf", "/samples/Silent Spring - copy.pdf"],
    file_titles: ["Silent Spring", "Silent Spring"],
    file_authors: ["Rachel Carson", "Rachel Carson"],
    file_sizes: [2_097_152, 2_097_152],
  },
];

export const sampleFixCandidates: EnrichmentCandidate[] = [
  {
    id: "c1",
    title: "The Left Hand of Darkness",
    authors: ["Ursula K. Le Guin"],
    published_year: 1969,
    identifiers: [],
    confidence: 0.92,
    source: "Open Library",
  },
  {
    id: "c2",
    title: "Left Hand of Darkness",
    authors: ["U. K. Le Guin"],
    published_year: 1969,
    identifiers: [],
    confidence: 0.86,
    source: "Google Books",
  },
  {
    id: "c3",
    title: "The Left Hand of Darkness (Anniversary)",
    authors: ["Ursula Le Guin"],
    published_year: 2004,
    identifiers: [],
    confidence: 0.74,
    source: "Open Library",
  },
  {
    id: "c4",
    title: "The Left Hand of Darkness",
    authors: ["Ursula K. Le Guin"],
    published_year: 1976,
    identifiers: [],
    confidence: 0.71,
    source: "Google Books",
  },
  {
    id: "c5",
    title: "The Left Hand of Darkness",
    authors: ["Ursula K. LeGuin"],
    published_year: 1969,
    identifiers: [],
    confidence: 0.67,
    source: "Open Library",
  },
];
