# Folio voorstel: performance/stabiliteit voor bibliotheken met duizenden boeken

## Doel
Het boekenoverzicht vlot houden bij 2k-20k boeken, zonder UI-jank, piekgeheugen of instabiele gedragspieken.

## Samenvatting
De grootste bottlenecks zitten nu niet in 1 plek, maar in een combinatie van:
- te veel DOM-nodes tegelijk renderen (alle kaarten tegelijk),
- zware cover-loading via IPC per item,
- meerdere client-side filter/sort passes over complete arrays,
- een paar database-querypatronen zonder ondersteunende indexen,
- brede App-state die veel rerenders veroorzaakt.

## Belangrijkste bevindingen (code)
1. Geen virtualisatie in bibliotheekgrid/list.
- `apps/desktop/src/components/LibraryGrid.tsx` rendert altijd `books.map(...)` voor alle resultaten.

2. Elke kaart bevat relatief dure render en image-elementen; kaarten zijn niet gememoized.
- `apps/desktop/src/components/BookCard.tsx`.
- `key` op `<img>` bevat `coverRefreshToken`, waardoor images bij refresh remounten.

3. Cover pipeline laadt in 1 keer blobs voor alle items met cover.
- `apps/desktop/src/App.tsx`: effect laadt `itemsToLoad` en doet `Promise.all(fetchCoverOverride(...))`.
- `fetchCoverOverride` haalt bytes op via `invoke("get_cover_blob")`; dit is zwaar bij duizenden items.

4. Filter/sort/search gebeurt volledig client-side op complete collectie.
- `apps/desktop/src/hooks/useLibrarySelectors.ts`: opbouw `allBooks`, meerdere filter-passes, daarna sort.
- Zoekinput schrijft direct op elke toetsaanslag naar query state.

5. Library refresh doet meerdere grote calls sequentieel.
- `apps/desktop/src/hooks/useLibraryData.ts`: `get_library_items`, `get_inbox_items`, duplicates, missing files, health.

6. `get_library_items` query is zwaar en joins veel tabellen.
- `apps/desktop/src-tauri/src/lib.rs`.
- Huidige schema heeft weinig extra indexen op veelgebruikte join/filter-kolommen.
- Basis schema: `packages/core/drizzle/0000_nebulous_mysterio.sql`.

## Voorstel (gefaseerd)

## Fase 1 (quick wins, laag risico, hoge impact)
1. UI virtualisatie invoeren voor `LibraryGrid`.
- Gebruik `@tanstack/react-virtual` voor zowel list als grid.
- Render alleen zichtbare kaarten + overscan.
- Verwachte winst: grootste frame-time daling, minder geheugendruk.

2. Zoekinput debouncen + deferred rendering.
- Debounce 150-250ms op query updates.
- `useDeferredValue`/`startTransition` voor filter/sort pad.
- Verwachte winst: minder input-lag bij typen.

3. `BookCard` memoizen en props stabiliseren.
- `React.memo(BookCard)`.
- Vermijd inline closures in `LibraryGrid` (of comparator die alleen relevante props vergelijkt).
- Verwachte winst: minder onnodige rerenders bij statuswijzigingen buiten de lijst.

4. Cover-loading limiteren naar viewport.
- Nu: eager load van vrijwel alle covers.
- Nieuw: laad cover blob pas als item zichtbaar wordt (virtualizer range / intersection observer).
- Voeg concurrency limiet toe (bijv. 4-8 tegelijk).

## Fase 2 (backend/data, middel risico, grote schaalwinst)
1. Nieuwe query-index migratie toevoegen.
- Aanbevolen indexen:
  - `files(item_id, status)`
  - `covers(item_id, created_at)`
  - `identifiers(item_id, type)`
  - `item_tags(item_id, tag_id)` en `item_tags(tag_id, item_id)`
  - `items(created_at)` en optioneel `items(published_year)`
  - `tags(normalized)` (unique als functioneel gewenst)
- Doel: joins/subqueries in library/inbox queries versnellen.

2. `get_library_items` opdelen in lichte lijst + detail-on-demand.
- Lijst endpoint: alleen velden nodig voor overzicht (id, title, author summary, year, format, hasCover, createdAt).
- Detail endpoint: tags, isbn, extra metadata pas bij selectie/inspector.
- Vermindert payload en parse/render werk.

3. Server-side filter/sort/paginering introduceren.
- Commandvoorbeeld: `get_library_items_page({offset, limit, query, filters, sort})` + `get_library_items_count`.
- Hierdoor vervalt volledige client-side sort/filter op complete dataset.

## Fase 3 (cover-architectuur, hoogste impact op geheugen/stabiliteit)
1. Thumbnails introduceren.
- Tijdens import/enrichment een kleine thumbnail genereren en opslaan.
- Grid gebruikt thumbnail; detailpaneel gebruikt volledige cover.

2. IPC bytes vermijden voor standaard gridweergave.
- Vermijd `bytes: number[]` voor grote aantallen (hoge serialisatie- en geheugenkost).
- Gebruik bestands-URL/protocol of dedicated asset route voor covers.

3. Cover cache beleid.
- LRU in-memory cache met maximum entries/MB.
- Oude object URLs actief revoken bij scrollen of viewwissel.

## Stabiliteitsmaatregelen
1. Backpressure/cancellation.
- Bij snelle scroll/filter wijziging lopende cover-requests cancelen/ignore.

2. Fail-soft rendering.
- Bij coverfout 1 retry max; daarna placeholder zonder eindeloze refetch.

3. Grote acties ontkoppelen van lijst-render.
- Statusupdates (scan/enrich/activity) los trekken van lijstcomponent zodat ze niet de hele grid laten rerenderen.

## Meetplan (voor en na)
1. Frontend metrics.
- Time-to-interactive boekenview.
- Gemiddelde en p95 input latency in zoekveld.
- Gemiddelde en p95 frame time tijdens scroll.
- Aantal gerenderde `BookCard`s per interaction.

2. Backend metrics.
- Querytijd `get_library_items` (p50/p95).
- Tijd tot eerste pagina zichtbaar.
- Cover fetch throughput + foutpercentage.

3. Doelwaarden (praktisch)
- Zoekinput voelt direct: p95 < 80ms bij 5k boeken.
- Scrollen blijft vloeiend: geen langdurige drops < 45fps.
- Initiale boekenview merkbaar sneller dan huidige situatie.

## Concrete implementatievolgorde
1. Virtualisatie + debounce + memoization + viewport-cover-loading.
2. Query-index migratie + query-timing logging.
3. Lichte lijst-DTO + detail lazy-load.
4. Server-side paginering/filter/sort.
5. Thumbnail pipeline en cover-cache policy.

## Verwachte impact
- Fase 1: direct merkbare UI-verbetering met beperkte codewijzigingen.
- Fase 2: schaalbaarheid bij 10k+ items en stabielere responstijden.
- Fase 3: grootste winst in geheugen- en IO-stabiliteit op lange sessies.

## Opmerking over scope
Dit voorstel is bewust incrementeel: eerst merkbare winst met laag risico, daarna structurele schaalverbetering zonder dat je meteen grote delen hoeft te herschrijven.
