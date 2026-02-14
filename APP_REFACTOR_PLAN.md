# App Architecture Refactor Plan

Dit document beschrijft hoe de huidige app-shell stapsgewijs verder wordt opgesplitst naar domeinproviders en pagina-containers.

## Context (huidige stand)

- `apps/desktop/src/App.tsx` bevat nog centrale orchestration en is nog relatief groot.
- Routeweergave is al opgesplitst:
  - `apps/desktop/src/sections/AppRoutes.tsx`
  - `apps/desktop/src/sections/app-routes/types.ts`
  - `apps/desktop/src/sections/app-routes/AppRouteViews.tsx`
- Zware routeviews worden lazy geladen via `React.lazy` + `Suspense`.

## Hoofddoel

`App.tsx` reduceren naar een dunne shell (layout + provider wiring + route entry), met domeinlogica buiten `App.tsx`.

## Gewenste doelarchitectuur

1. `App.tsx`:
   - Layout
   - top-level providers
   - route mount
2. Domeinproviders/hooks:
   - `library`
   - `changes`
   - `metadata/fix`
   - `ereader`
   - `organizer/import`
   - `settings`
3. Route-containers:
   - per pagina een container die data/handlers composeert uit providers
4. Centrale loading-UX:
   - consistente loadercomponenten en teksten

## Fasen

### Fase 1: Baseline en kaders

Doel: stabiele referentie voordat verdere splitsing start.

- [ ] Nulmeting vastleggen:
  - `App.tsx` regels
  - chunkgroottes build output
  - lint/build status
- [ ] Refactor-guardrails vastleggen:
  - geen functionele regressie in scan/enrich/changes/edit/ereader
  - lazy-loading en loading feedback blijft aanwezig
- [ ] Smoke-checklist opstellen voor handmatige QA.

Output:
- Korte baseline-notitie in dit bestand (met datum en metingen).

### Fase 2: Domeinproviders introduceren

Doel: state en acties uit `App.tsx` halen.

- [ ] Map toevoegen: `apps/desktop/src/state/`
- [ ] Providers aanmaken:
  - [ ] `LibraryProvider.tsx`
  - [ ] `ChangesProvider.tsx`
  - [ ] `MetadataProvider.tsx`
  - [ ] `EreaderProvider.tsx`
  - [ ] `OrganizerProvider.tsx`
- [ ] Per provider:
  - state
  - actions
  - selectors (memoized)

Output:
- `App.tsx` consumeert providers i.p.v. losse domeinstate.

### Fase 3: Route-containers per pagina

Doel: prop-oppervlak tussen `App` en views verder reduceren.

- [ ] Map toevoegen: `apps/desktop/src/sections/containers/`
- [ ] Containers aanmaken:
  - [ ] `LibraryPageContainer.tsx`
  - [ ] `FixPageContainer.tsx`
  - [ ] `ChangesPageContainer.tsx`
  - [ ] `EreaderPageContainer.tsx`
  - [ ] `SettingsPageContainer.tsx`
- [ ] `AppRouteViews` laten renderen op containerniveau.

Output:
- Minder handmatige prop-doorvoer vanuit `App.tsx`.

### Fase 4: Centrale loading-systematiek

Doel: consistente perceived performance en UX.

- [ ] Nieuwe componentset:
  - [ ] `components/loading/PageLoading.tsx`
  - [ ] `components/loading/SectionLoading.tsx`
  - [ ] `components/loading/InlineLoading.tsx`
  - [ ] `components/loading/ActionButtonLoading.tsx`
- [ ] Losse `Loader2`/`animate-spin` varianten gefaseerd vervangen.
- [ ] Loading labels standaardiseren via i18n keys.

Output:
- Uniforme loading states over alle pagina’s.

### Fase 5: Cleanup en contracten

Doel: structureel onderhoudbare codebasis.

- [ ] Oude glue-code verwijderen.
- [ ] Types consolideren per domein.
- [ ] Import boundaries nalopen.
- [ ] AGENTS/README bijwerken met nieuwe architectuur.

Output:
- Schone, consistente structuur zonder dubbele paden.

## Acceptatiecriteria

1. `apps/desktop/src/App.tsx` < 500 regels.
2. `pnpm -C apps/desktop lint` slaagt.
3. `pnpm -C apps/desktop build` slaagt.
4. Hoofdchunk blijft < 500kB (minified).
5. Geen regressie in:
   - scan
   - enrich
   - changes apply/remove
   - edit metadata
   - ereader sync
6. Loading feedback is consistent over alle views.

## Risico’s en mitigatie

1. Regressies door grote verplaatsingen:
   - Mitigatie: kleine PR’s per domein, met smoke-checklist.
2. Extra rerenders door context:
   - Mitigatie: selector hooks + memoized provider values.
3. Inconsistente loaders tijdens migratie:
   - Mitigatie: eerst centrale loadingcomponenten, daarna vervanging per view.

## Aanbevolen PR-volgorde

1. PR1: provider-skeleton + wiring in `App.tsx`
2. PR2: library + metadata/fix domeinmigratie
3. PR3: changes + ereader domeinmigratie
4. PR4: route-containers
5. PR5: loading-system consolidatie
6. PR6: cleanup + documentatie

## Handmatige smoke-checklist

- [ ] App start zonder errors.
- [ ] Library laden/filter/sort/select werkt.
- [ ] Fix search/apply/save werkt.
- [ ] Changes apply/remove/all/selected werkt.
- [ ] Enrich start/cancel/events werkt.
- [ ] Missing files acties werken.
- [ ] Duplicates resolve single/all werkt.
- [ ] Ereader queue/sync flow werkt.
- [ ] Loading states zichtbaar en consistent.

