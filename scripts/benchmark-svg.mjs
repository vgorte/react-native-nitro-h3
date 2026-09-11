/**
 * Renders `apps/example/benchmark.json` as two charts of paired horizontal bars, scaled per pair so
 * that the slower median spans the full width and the shorter bar reads as the share of the time it
 * takes. `img/benchmark.svg` puts a `react-native-nitro-h3` bar above an `h3-js` bar for each
 * headline workload; `img/benchmark-batch.svg` puts the batch call against both the `h3-js` loop and
 * this package's own per-call loop.
 *
 * The JSON is the `BENCHMARK_JSON` line the example app's benchmark screen logs on a Release build,
 * reassembled from its chunks by `benchmark-device.ts`. Rows without an `h3-js` reference carry
 * no factor and are left out. A run whose payload could not be recovered is transcribed by hand, and
 * then carries a `source` field naming that and a per-row `factor` the screen displayed,
 * because a factor recomputed from rounded medians drifts from the one that was measured.
 *
 * Usage:
 *   bun run benchmark:svg
 *   bun scripts/benchmark-svg.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { failPayload, validatePayload } from './benchmark-payload.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const INPUT = join(ROOT, 'apps', 'example', 'benchmark.json')
const OUTPUT = join(ROOT, 'img', 'benchmark.svg')
const OUTPUT_BATCH = join(ROOT, 'img', 'benchmark-batch.svg')

const TITLE = 'react-native-nitro-h3 against h3-js, median milliseconds per workload'
const BATCH_TITLE = 'One batch call against the loop it replaces, 100,000 elements'
// no external resources: a system stack, resolved by the viewer
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

// the headline workloads the README chart carries, in the order it shows them
const CHART_IDS = ['W1', 'W3', 'W4', 'W7']

// The batch chart, as two panels of two pairs. The first panel measures the batch against `h3-js`,
// the second against the per-call loop of this package that the batch call replaces.
const BATCH_PANELS = [
  {
    heading: 'Against h3-js, one call per element',
    pairs: [
      { id: 'W11', subject: 'latLngsToCells, 100,000 coordinate pairs', slowLabel: 'h3-js' },
      { id: 'W12', subject: 'cellsToLatLngs, 100,000 cells', slowLabel: 'h3-js' },
    ],
  },
  {
    heading: "Against this package's own per-call loop",
    pairs: [
      {
        id: 'W11',
        against: 'W1',
        subject: 'latLngsToCells against a latLngToCell loop',
        slowLabel: 'per-call loop',
        note: ' *',
      },
      {
        id: 'W12',
        against: 'W6',
        subject: 'cellsToLatLngs against a cellToLatLng loop',
        slowLabel: 'per-call loop',
      },
    ],
  },
]

const BATCH_FOOTNOTE =
  '* The loop repeats one coordinate where the batch call indexes 100,000 distinct ones, so this ' +
  'figure is a floor rather than the win.'

// No single colour clears 4.5:1 on white and on GitHub's `#0d1117` at once; 4.35:1 is the
// arithmetic ceiling. The base values sit on it, and the media queries lift each theme past 4.5:1
// wherever the renderer honours them.
const TEXT_BASE = '#727a84'
const TEXT_LIGHT = '#57606a'
const TEXT_DARK = '#8b949e'
const STRONG_BASE = '#727a84'
const STRONG_LIGHT = '#1f2328'
const STRONG_DARK = '#e6edf3'
const ACCENT_BASE = '#2f78dc'
const ACCENT_LIGHT = '#1f6feb'
const ACCENT_DARK = '#58a6ff'
// a bar is not text, so 3:1 is the bar to clear: the accent holds 3.68:1 on white and 5.15:1 on
// `#0d1117`, the neutral 3.73:1 and 5.07:1
const BAR_ACCENT = '#3b82f6'
const BAR_NEUTRAL_BASE = '#7d8590'
const BAR_NEUTRAL_LIGHT = '#6e7781'
const BAR_NEUTRAL_DARK = '#8b949e'

const WIDTH = 800
const MARGIN = 24
const LABEL_WIDTH = 130
const VALUE_WIDTH = 110
const BAR_HEIGHT = 18
const BAR_GAP = 6
const LABEL_TO_BAR = 8
const GROUP_STEP = 80
const CHART_TOP = 62
const CAPTION_FIRST = 30
const CAPTION_LINE = 18
const CAPTION_TAIL = 14
const PANEL_HEAD_STEP = 26
const PANEL_GAP = 40
const FOOTNOTE_STEP = 22
const BATCH_CAPTION_FIRST = 46

const BAR_LEFT = MARGIN + LABEL_WIDTH
const BAR_MAX = WIDTH - MARGIN - VALUE_WIDTH - BAR_LEFT
const GROUP_HEIGHT = LABEL_TO_BAR + 2 * BAR_HEIGHT + BAR_GAP

function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// One decimal and grouped thousands, matching the results table, and no ICU dependency. A median
// under a millisecond gets three, where one decimal would round it into a different number.
function formatMillis(millis) {
  const [whole, fraction] = millis.toFixed(millis < 1 ? 3 : 1).split('.')
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`
}

// Three significant digits, with no trailing zero to suggest precision the run does not carry. A
// factor under ten separates two close medians, where the second decimal is the whole difference.
function formatFactor(factor) {
  const fixed = factor.toFixed(factor < 10 ? 2 : 1)
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed
}

function fail(field, expectation) {
  failPayload(INPUT, field, expectation)
}

function readPayload() {
  return validatePayload(JSON.parse(readFileSync(INPUT, 'utf8')), INPUT)
}

// the leading `W\d+` is an id, not part of the name a reader wants to see
function workloadId(workload) {
  return workload.split(' ')[0]
}

function workloadSubject(workload) {
  return workload.replace(/^W\d+ /, '')
}

function toBars(rows) {
  const bars = []
  for (const row of rows) {
    // a row with no `h3-js` counterpart has no factor; that is expected, not a defect
    if (row.referenceMillis === null) {
      continue
    }
    if (row.millis <= 0) {
      console.warn(`Skipped \`${row.workload}\`: \`millis\` is ${row.millis}, no factor to draw`)
      continue
    }
    bars.push({
      id: workloadId(row.workload),
      workload: row.workload,
      subject: workloadSubject(row.workload),
      runs: row.runs,
      millis: row.millis,
      referenceMillis: row.referenceMillis,
      // the measured factor wins over one recomputed from medians a transcription rounded
      factor: row.factor ?? row.referenceMillis / row.millis,
    })
  }
  if (bars.length === 0) {
    throw new Error(`${INPUT} holds no row with an \`h3-js\` reference time`)
  }
  return bars
}

// the chart carries the headline workloads and nothing else, so a missing id is a defect
function chartBars(bars) {
  return CHART_IDS.map((id) => {
    const matches = bars.filter((bar) => bar.id === id)
    if (matches.length !== 1) {
      fail(
        'rows',
        `must hold exactly one \`${id}\` row with an h3-js reference, found ${matches.length}`,
      )
    }
    return matches[0]
  })
}

// The widest measured factor, named with the workload it belongs to. The published figure is a
// measurement, not a rounded claim, so the number is passed on as the payload carries it.
function headline(bars) {
  const widest = bars.reduce((best, bar) => (bar.factor > best.factor ? bar : best))
  return { workload: widest.workload, factor: widest.factor }
}

// The caption annotates the bars, so the run count is read back off the charted rows and not off
// the payload, which carries rows at other sample counts that no bar shows.
function runCounts(bars) {
  const tally = new Map()
  for (const bar of bars) {
    tally.set(bar.runs, (tally.get(bar.runs) ?? 0) + 1)
  }
  const [common] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]
  const exceptions = bars
    .filter((bar) => bar.runs !== common)
    .map((bar) => `${bar.runs} for ${bar.subject.split(/[ ,]/)[0]}`)
  return exceptions.length === 0 ? `${common} runs` : `${common} runs (${exceptions.join(', ')})`
}

function warmUps(count) {
  return count === 1 ? 'one warm-up' : `${count} warm-ups`
}

// `Platform.OS` is lowercase; the caption is prose, so it names the platform the way readers do
const PLATFORM_NAMES = { ios: 'iOS', android: 'Android' }

function platformName(platform) {
  return PLATFORM_NAMES[platform] ?? platform
}

// `Platform.Version` is the API level on Android, not the version a reader knows the OS by
function platformVersion(platform, osVersion) {
  return platform === 'android' ? `API ${osVersion}` : osVersion
}

// one line per sentence: all of it on one would run past the canvas at this font size
function caption(payload, bars, scaledBy) {
  const { platform, osVersion, build, reactNative, h3js, date, warmupRuns, device } =
    payload.measuredOn
  const lines = [
    `Measured on ${device === undefined ? '' : `${device}, `}` +
      `${platformName(platform)} ${platformVersion(platform, osVersion)}, ` +
      `${build} build, ` +
      `React Native ${reactNative}, ` +
      `against h3-js ${h3js}, ${date}.`,
    `Median of ${runCounts(bars)} after ${warmUps(warmupRuns)}. ` +
      `Bars are scaled per ${scaledBy}. Lower is better.`,
  ]
  return lines
}

function styleBlock() {
  return [
    '<style>',
    `text { fill: ${TEXT_BASE} }`,
    `.strong { fill: ${STRONG_BASE} }`,
    `.factor { fill: ${ACCENT_BASE} }`,
    `.reference { fill: ${BAR_NEUTRAL_BASE} }`,
    '@media (prefers-color-scheme: light) {',
    `text { fill: ${TEXT_LIGHT} }`,
    `.strong { fill: ${STRONG_LIGHT} }`,
    `.factor { fill: ${ACCENT_LIGHT} }`,
    `.reference { fill: ${BAR_NEUTRAL_LIGHT} }`,
    '}',
    '@media (prefers-color-scheme: dark) {',
    `text { fill: ${TEXT_DARK} }`,
    `.strong { fill: ${STRONG_DARK} }`,
    `.factor { fill: ${ACCENT_DARK} }`,
    `.reference { fill: ${BAR_NEUTRAL_DARK} }`,
    '}',
    '</style>',
  ].join('\n')
}

// a bar never disappears: two pixels still read as a bar next to a full-width one
function barLength(millis, referenceMillis) {
  return Math.max(2, Math.round((millis / referenceMillis) * BAR_MAX))
}

// A pair is the fast bar over the slow one it is measured against, both named on the left. The slow
// bar always spans the full width, so the fast bar reads as the share of the time it takes.
function renderGroup(pair, top) {
  const subjectBaseline = top
  const fastTop = top + LABEL_TO_BAR
  const slowTop = fastTop + BAR_HEIGHT + BAR_GAP
  const fastLength = barLength(pair.fastMillis, pair.slowMillis)
  const textBaseline = (barTop) => barTop + 13
  return [
    `<text class="strong" x="${MARGIN}" y="${subjectBaseline}" font-size="14" font-weight="600">` +
      `${escapeXml(pair.subject)}</text>`,
    `<text x="${BAR_LEFT - 10}" y="${textBaseline(fastTop)}" font-size="12" text-anchor="end">` +
      `${escapeXml(pair.fastLabel)}</text>`,
    `<rect x="${BAR_LEFT}" y="${fastTop}" width="${fastLength}" height="${BAR_HEIGHT}" rx="3" ` +
      `fill="${BAR_ACCENT}"/>`,
    `<text x="${BAR_LEFT + fastLength + 8}" y="${textBaseline(fastTop)}" font-size="12" ` +
      `font-weight="600"><tspan class="strong">${escapeXml(`${formatMillis(pair.fastMillis)} ms`)}` +
      `</tspan><tspan class="factor" dx="10">${formatFactor(pair.factor)}× faster` +
      `${escapeXml(pair.note ?? '')}</tspan></text>`,
    `<text x="${BAR_LEFT - 10}" y="${textBaseline(slowTop)}" font-size="12" text-anchor="end">` +
      `${escapeXml(pair.slowLabel)}</text>`,
    `<rect class="reference" x="${BAR_LEFT}" y="${slowTop}" width="${BAR_MAX}" ` +
      `height="${BAR_HEIGHT}" rx="3" fill="${BAR_NEUTRAL_BASE}"/>`,
    `<text class="strong" x="${BAR_LEFT + BAR_MAX + 8}" y="${textBaseline(slowTop)}" ` +
      `font-size="12" font-weight="600">` +
      `${escapeXml(`${formatMillis(pair.slowMillis)} ms`)}</text>`,
  ]
}

function toPair(bar, extra) {
  return {
    subject: bar.subject,
    fastLabel: 'react-native-nitro-h3',
    fastMillis: bar.millis,
    slowLabel: 'h3-js',
    slowMillis: bar.referenceMillis,
    factor: bar.factor,
    ...extra,
  }
}

function captionLines(lines, top) {
  return lines.map(
    (line, index) =>
      `<text x="${MARGIN}" y="${top + index * CAPTION_LINE}" font-size="11">` +
      `${escapeXml(line)}</text>`,
  )
}

function openDocument(title, height) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" ` +
      `viewBox="0 0 ${WIDTH} ${height}" font-family="${FONT}" role="img" ` +
      `aria-label="${escapeXml(title)}">`,
    `<title>${escapeXml(title)}</title>`,
    styleBlock(),
    `<text class="strong" x="${MARGIN}" y="32" font-size="17" font-weight="600">` +
      `${escapeXml(title)}</text>`,
  ]
}

function render(payload) {
  const bars = toBars(payload.rows)
  const groups = chartBars(bars)
  const text = caption(payload, groups, 'workload')
  const chartBottom = CHART_TOP + (groups.length - 1) * GROUP_STEP + GROUP_HEIGHT
  const height = chartBottom + CAPTION_FIRST + (text.length - 1) * CAPTION_LINE + CAPTION_TAIL

  const lines = openDocument(TITLE, height)
  groups.forEach((bar, index) => {
    lines.push(...renderGroup(toPair(bar), CHART_TOP + index * GROUP_STEP))
  })
  lines.push(...captionLines(text, chartBottom + CAPTION_FIRST), '</svg>')
  return `${lines.join('\n')}\n`
}

// the batch panels name their own rows, so a missing one is a defect rather than a row to skip
function batchBar(bars, id) {
  const match = bars.find((bar) => bar.id === id)
  if (match === undefined) {
    fail('rows', `must hold a \`${id}\` row with an h3-js reference for the batch chart`)
  }
  return match
}

// A pair in the second panel measures the batch row against the per-call loop row named by
// `against`, so both bars are this package and the factor is the one the payload does not carry.
function batchPair(bars, spec) {
  const batch = batchBar(bars, spec.id)
  if (spec.against === undefined) {
    return toPair(batch, { subject: spec.subject, fastLabel: 'one batch call' })
  }
  const loop = batchBar(bars, spec.against)
  return {
    subject: spec.subject,
    fastLabel: 'one batch call',
    fastMillis: batch.millis,
    slowLabel: spec.slowLabel,
    slowMillis: loop.millis,
    factor: loop.millis / batch.millis,
    note: spec.note,
  }
}

function renderBatch(payload) {
  const bars = toBars(payload.rows)
  const panels = BATCH_PANELS.map((panel) => ({
    heading: panel.heading,
    pairs: panel.pairs.map((spec) => batchPair(bars, spec)),
  }))
  const charted = [...new Set(BATCH_PANELS.flatMap((panel) => panel.pairs.map((p) => p.id)))].map(
    (id) => batchBar(bars, id),
  )
  const text = caption(payload, charted, 'pair')

  const body = []
  let cursor = CHART_TOP
  for (const panel of panels) {
    body.push(
      `<text class="strong" x="${MARGIN}" y="${cursor}" font-size="15" font-weight="600">` +
        `${escapeXml(panel.heading)}</text>`,
    )
    cursor += PANEL_HEAD_STEP
    for (const pair of panel.pairs) {
      body.push(...renderGroup(pair, cursor))
      cursor += GROUP_STEP
    }
    cursor += GROUP_HEIGHT + PANEL_GAP - GROUP_STEP
  }
  const chartBottom = cursor - PANEL_GAP
  const captionTop = chartBottom + BATCH_CAPTION_FIRST
  const height = captionTop + (text.length - 1) * CAPTION_LINE + CAPTION_TAIL

  return `${[
    ...openDocument(BATCH_TITLE, height),
    ...body,
    `<text x="${MARGIN}" y="${chartBottom + FOOTNOTE_STEP}" font-size="11">` +
      `${escapeXml(BATCH_FOOTNOTE)}</text>`,
    ...captionLines(text, captionTop),
    '</svg>',
  ].join('\n')}\n`
}

const payload = readPayload()
writeFileSync(OUTPUT, render(payload), 'utf8')
console.log(`Wrote ${OUTPUT}`)
writeFileSync(OUTPUT_BATCH, renderBatch(payload), 'utf8')
console.log(`Wrote ${OUTPUT_BATCH}`)

// one line the README task can copy verbatim
const hero = headline(toBars(payload.rows))
console.log(`HEADLINE ${formatFactor(hero.factor)}× faster than h3-js (${hero.workload})`)
