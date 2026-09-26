// The Kibana dashboards, as code: data views over the analytics indices, Lens charts, and two
// dashboards (Listening, Search). `pnpm kibana:load` writes them to saved-objects.ndjson and
// imports them. Ids are fixed, so loading again updates them in place.

type SavedObject = {
  id: string
  type: string
  attributes: Record<string, unknown>
  references: Reference[]
  typeMigrationVersion?: string
  coreMigrationVersion?: string
}
type Reference = { id: string; type: string; name: string }
type Column = Record<string, unknown>

const PLAYS = 'rc-plays'
const SEARCHES = 'rc-search-queries'

function dataView(id: string, name: string): SavedObject {
  return { id, type: 'index-pattern', attributes: { title: id, name, timeFieldName: '@timestamp' }, references: [] }
}

// Lens columns.
const count = (label: string): Column => ({
  label,
  customLabel: true,
  dataType: 'number',
  operationType: 'count',
  sourceField: '___records___',
  isBucketed: false,
  scale: 'ratio',
  params: { emptyAsNull: false },
})
const sum = (field: string, label: string): Column => ({
  label,
  customLabel: true,
  dataType: 'number',
  operationType: 'sum',
  sourceField: field,
  isBucketed: false,
  scale: 'ratio',
  params: { emptyAsNull: true },
})
const formula = (formula: string, label: string, format: 'percent' | 'number' = 'number', decimals = 0): Column => ({
  label,
  customLabel: true,
  dataType: 'number',
  operationType: 'formula',
  isBucketed: false,
  scale: 'ratio',
  references: [],
  params: { formula, isFormulaBroken: false, format: { id: format, params: { decimals } } },
})
const overTime = (): Column => ({
  label: '@timestamp',
  dataType: 'date',
  operationType: 'date_histogram',
  sourceField: '@timestamp',
  isBucketed: true,
  scale: 'interval',
  params: { interval: 'auto', includeEmptyRows: true, dropPartials: false },
})
/** Top values of `field`, by the column `by` (most first), or in their own order (`byValue`). */
const terms = (field: string, label: string, size: number, by: string | 'byValue', dataType = 'string'): Column => ({
  label,
  customLabel: true,
  dataType,
  operationType: 'terms',
  sourceField: field,
  isBucketed: true,
  scale: 'ordinal',
  params: {
    size,
    orderBy: by === 'byValue' ? { type: 'alphabetical', fallback: false } : { type: 'column', columnId: by },
    orderDirection: by === 'byValue' ? 'asc' : 'desc',
    otherBucket: false,
    missingBucket: false,
    parentFormat: { id: 'terms' },
  },
})

/** A Lens chart over one data view, with one layer (`l`) of `columns`. */
function lens(
  id: string,
  title: string,
  dataViewId: string,
  visualizationType: string,
  columns: Record<string, Column>,
  visualization: Record<string, unknown>,
  kql = '',
): SavedObject {
  return {
    id,
    type: 'lens',
    attributes: {
      title,
      description: '',
      visualizationType,
      state: {
        datasourceStates: {
          formBased: { layers: { l: { columns, columnOrder: Object.keys(columns), incompleteColumns: {} } } },
        },
        visualization,
        query: { query: kql, language: 'kuery' },
        filters: [],
        adHocDataViews: {},
        internalReferences: [],
      },
    },
    references: [{ type: 'index-pattern', id: dataViewId, name: 'indexpattern-datasource-layer-l' }],
  }
}

const metric = (id: string, title: string, dataViewId: string, value: Column, kql = '') =>
  lens(id, title, dataViewId, 'lnsMetric', { m: value }, { layerId: 'l', layerType: 'data', metricAccessor: 'm' }, kql)

const xy = (
  id: string,
  title: string,
  dataViewId: string,
  seriesType: 'bar_stacked' | 'bar_horizontal' | 'area' | 'line',
  x: Column,
  y: Column,
  kql = '',
) =>
  lens(
    id,
    title,
    dataViewId,
    'lnsXY',
    { x, y },
    {
      legend: { isVisible: false, position: 'right' },
      valueLabels: 'hide',
      preferredSeriesType: seriesType,
      layers: [{ layerId: 'l', layerType: 'data', seriesType, xAccessor: 'x', accessors: ['y'] }],
      axisTitlesVisibilitySettings: { x: false, yLeft: false, yRight: false },
    },
    kql,
  )

const table = (id: string, title: string, dataViewId: string, columns: Record<string, Column>, kql = '') =>
  lens(
    id,
    title,
    dataViewId,
    'lnsDatatable',
    columns,
    { layerId: 'l', layerType: 'data', columns: Object.keys(columns).map((columnId) => ({ columnId })) },
    kql,
  )

const donut = (id: string, title: string, dataViewId: string, group: Column, value: Column) =>
  lens(
    id,
    title,
    dataViewId,
    'lnsPie',
    { g: group, m: value },
    {
      shape: 'donut',
      layers: [
        {
          layerId: 'l',
          layerType: 'data',
          primaryGroups: ['g'],
          metrics: ['m'],
          numberDisplay: 'percent',
          categoryDisplay: 'default',
          legendDisplay: 'default',
          nestedLegend: false,
        },
      ],
    },
  )

const heatmap = (id: string, title: string, dataViewId: string, x: Column, y: Column, value: Column) =>
  lens(
    id,
    title,
    dataViewId,
    'lnsHeatmap',
    { x, y, v: value },
    {
      layerId: 'l',
      layerType: 'data',
      shape: 'heatmap',
      xAccessor: 'x',
      yAccessor: 'y',
      valueAccessor: 'v',
      legend: { isVisible: true, position: 'right', type: 'heatmap_legend' },
      gridConfig: {
        type: 'heatmap_grid',
        isCellLabelVisible: false,
        isYAxisLabelVisible: true,
        isXAxisLabelVisible: true,
        isYAxisTitleVisible: false,
        isXAxisTitleVisible: false,
      },
    },
  )

/** A dashboard of `panels`, laid out on Kibana's 48-column grid. */
function dashboard(
  id: string,
  title: string,
  description: string,
  timeFrom: string,
  panels: { lens: SavedObject; x: number; y: number; w: number; h: number }[],
): SavedObject {
  return {
    id,
    type: 'dashboard',
    attributes: {
      title,
      description,
      timeRestore: true,
      timeFrom,
      timeTo: 'now',
      refreshInterval: { pause: true, value: 60_000 },
      panelsJSON: JSON.stringify(
        panels.map((panel, index) => ({
          type: 'lens',
          panelIndex: `p${index}`,
          gridData: { x: panel.x, y: panel.y, w: panel.w, h: panel.h, i: `p${index}` },
          embeddableConfig: { enhancements: {} },
          panelRefName: `panel_p${index}`,
        })),
      ),
      optionsJSON: JSON.stringify({ useMargins: true, syncColors: false, syncCursor: true, syncTooltips: false, hidePanelTitles: false }),
      kibanaSavedObjectMeta: { searchSourceJSON: JSON.stringify({ query: { query: '', language: 'kuery' }, filter: [] }) },
    },
    references: panels.map((panel, index) => ({ name: `panel_p${index}`, type: 'lens', id: panel.lens.id })),
  }
}

// Listening.
const plays = metric('rc-plays-count', 'Plays', PLAYS, count('Plays'))
const hours = metric('rc-plays-hours', 'Hours listened', PLAYS, formula('sum(minutes) / 60', 'Hours', 'number', 1))
const tracks = metric('rc-plays-tracks', 'Different tracks', PLAYS, formula('unique_count(trackId)', 'Tracks'))
const playsOverTime = xy('rc-plays-over-time', 'Plays over time', PLAYS, 'bar_stacked', overTime(), count('Plays'))
const whenYouListen = heatmap(
  'rc-plays-heatmap',
  'When you listen (hour × weekday)',
  PLAYS,
  terms('hour', 'Hour', 24, 'byValue', 'number'),
  terms('weekday', 'Day', 7, 'byValue'),
  count('Plays'),
)
const topArtists = xy('rc-plays-top-artists', 'Top artists', PLAYS, 'bar_horizontal', terms('artist', 'Artist', 10, 'y'), count('Plays'))
const topTracks = table('rc-plays-top-tracks', 'Top tracks', PLAYS, {
  t: terms('track', 'Track', 15, 'c'),
  a: terms('artist', 'Artist', 1, 'c'),
  c: count('Plays'),
})
const byContext = donut('rc-plays-by-context', 'Minutes by where you played from', PLAYS, terms('contextType', 'Played from', 6, 'm'), sum('minutes', 'Minutes'))

// Search.
const searches = metric('rc-searches-count', 'Searches', SEARCHES, count('Searches'))
const zeroRate = metric('rc-searches-zero-rate', 'Found nothing', SEARCHES, formula("count(kql='zeroResults : true') / count()", 'Share', 'percent'))
const pickRank = metric('rc-searches-pick-rank', 'Average rank picked', SEARCHES, formula('average(pickedRank)', 'Rank', 'number', 1))
const searchesOverTime = xy('rc-searches-over-time', 'Searches over time', SEARCHES, 'bar_stacked', overTime(), count('Searches'))
const topQueries = table('rc-searches-top', 'Top searches', SEARCHES, { q: terms('q', 'Search', 15, 'c'), c: count('Times') })
const zeroQueries = table(
  'rc-searches-zero',
  'Searches that found nothing',
  SEARCHES,
  { q: terms('q', 'Search', 15, 'c'), c: count('Times') },
  'zeroResults : true',
)
const pickedTypes = donut('rc-searches-picked', 'What gets picked', SEARCHES, terms('pickedType', 'Type', 6, 'm'), count('Picks'))
const filtersUsed = xy('rc-searches-filters', 'Filters used', SEARCHES, 'bar_horizontal', terms('filterFields', 'Filter', 8, 'y'), count('Searches'))

/**
 * The saved-object versions these are written in (Kibana 9.5). Without them Kibana treats an
 * import as ancient and runs every migration since 7.x over it.
 */
const VERSIONS: Record<string, string> = { 'index-pattern': '8.0.0', lens: '10.1.0', dashboard: '10.3.0' }
const versioned = (object: SavedObject): SavedObject => ({
  ...object,
  typeMigrationVersion: VERSIONS[object.type],
  coreMigrationVersion: '8.8.0',
})

const all: SavedObject[] = [
  dataView(PLAYS, 'Replay Crate plays'),
  dataView(SEARCHES, 'Replay Crate searches'),
  plays,
  hours,
  tracks,
  playsOverTime,
  whenYouListen,
  topArtists,
  topTracks,
  byContext,
  searches,
  zeroRate,
  pickRank,
  searchesOverTime,
  topQueries,
  zeroQueries,
  pickedTypes,
  filtersUsed,
  dashboard('rc-listening', 'Replay Crate: Listening', 'Every recorded play: how much, when, and what.', 'now-1y', [
    { lens: plays, x: 0, y: 0, w: 16, h: 6 },
    { lens: hours, x: 16, y: 0, w: 16, h: 6 },
    { lens: tracks, x: 32, y: 0, w: 16, h: 6 },
    { lens: playsOverTime, x: 0, y: 6, w: 48, h: 12 },
    { lens: whenYouListen, x: 0, y: 18, w: 28, h: 14 },
    { lens: byContext, x: 28, y: 18, w: 20, h: 14 },
    { lens: topArtists, x: 0, y: 32, w: 24, h: 16 },
    { lens: topTracks, x: 24, y: 32, w: 24, h: 16 },
  ]),
  dashboard('rc-search', 'Replay Crate: Search', 'What gets searched for, what comes back, and what gets picked.', 'now-30d', [
    { lens: searches, x: 0, y: 0, w: 16, h: 6 },
    { lens: zeroRate, x: 16, y: 0, w: 16, h: 6 },
    { lens: pickRank, x: 32, y: 0, w: 16, h: 6 },
    { lens: searchesOverTime, x: 0, y: 6, w: 48, h: 10 },
    { lens: topQueries, x: 0, y: 16, w: 24, h: 16 },
    { lens: zeroQueries, x: 24, y: 16, w: 24, h: 16 },
    { lens: pickedTypes, x: 0, y: 32, w: 24, h: 14 },
    { lens: filtersUsed, x: 24, y: 32, w: 24, h: 14 },
  ]),
]

export const objects = all.map(versioned)
