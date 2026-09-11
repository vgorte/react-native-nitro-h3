export interface TocHeading {
  slug: string
  text: string
  depth: number
  children: TocHeading[]
}

export interface TocEntry {
  slug: string
  text: string
  level: number
}

/**
 * Flattens the heading tree into the one list both tables of contents render.
 *
 * @param headings The tree from `Astro.locals.starlightRoute.toc`.
 * @param min The `minHeadingLevel` that tree was built with.
 * @returns One entry per heading in document order, the tree surviving as an indentation level.
 */
export function tocEntries(headings: TocHeading[], min: number, out: TocEntry[] = []): TocEntry[] {
  for (const heading of headings) {
    out.push({
      slug: heading.slug,
      text: heading.text,
      level: Math.max(0, heading.depth - min),
    })
    tocEntries(heading.children, min, out)
  }
  return out
}

export interface TocTrackerOptions {
  /** Takes `--nh3-progress`; a height of zero marks the table of contents this layout hides. */
  root: HTMLElement
  /** Holds the entry anchors in document order, one per list item. */
  list: ParentNode
  /** The article the progress fraction runs to the end of. */
  article: HTMLElement
  /** The box the list scrolls inside, for a list too long to fit it. Left out, it never scrolls. */
  scroller?: HTMLElement
  /** Runs on every draw with the entry being read, for chrome outside the list. */
  onDraw?: (current: HTMLAnchorElement | undefined) => void
}

export interface TocTracker {
  /** Draws the passed and current entries again, for a caller whose own chrome depends on them. */
  redraw: () => void
}

/** How long the reader's own scrolling of the list keeps the list from scrolling itself. */
const MANUAL_MS = 2000

/** `auto` where the reader asked for less motion, so a jump replaces the slide. */
const motion = (): ScrollBehavior =>
  matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'

// Scrolls the current entry into the scroller's visible box, an entry's height clear of the edge it
// came in from. `scrollIntoView` is no use here: it walks every scrollable ancestor and would take
// the document with it, which the tracker would then read back as the reader's own scrolling.
const reveal = (scroller: HTMLElement, item: HTMLElement) => {
  const room = scroller.scrollHeight - scroller.clientHeight
  if (room <= 0) return

  const view = scroller.scrollTop
  const top = item.getBoundingClientRect().top - scroller.getBoundingClientRect().top + view
  const bottom = top + item.offsetHeight
  if (top >= view && bottom <= view + scroller.clientHeight) return

  const margin = item.offsetHeight
  const wanted = top < view ? top - margin : bottom + margin - scroller.clientHeight
  scroller.scrollTo({ top: Math.min(room, Math.max(0, wanted)), behavior: motion() })
}

/**
 * Drives one table of contents: the entries already passed, the entry being read, and the share of
 * the article behind the reader as `--nh3-progress` on `root`.
 *
 * @param options The elements to drive and the callback for chrome outside the list.
 */
export function trackToc({ root, list, article, scroller, onDraw }: TocTrackerOptions): TocTracker {
  const targets: Array<{ link: HTMLAnchorElement; item: HTMLElement; heading: HTMLElement }> = []
  for (const link of list.querySelectorAll<HTMLAnchorElement>('a')) {
    const heading = document.getElementById(decodeURIComponent(link.hash.slice(1)))
    const item = link.parentElement
    if (heading && item) targets.push({ link, item, heading })
  }

  let current = 0
  let frame = 0
  let heldUntil = 0

  // Someone may be reading the list itself, so a wheel, a press or a key inside it hands the scroll
  // position back to them for a moment.
  if (scroller) {
    const hold = () => {
      heldUntil = Date.now() + MANUAL_MS
    }
    for (const type of ['wheel', 'pointerdown', 'keydown'] as const) {
      scroller.addEventListener(type, hold, { passive: true })
    }
  }

  const draw = () => {
    for (const [at, { item, link }] of targets.entries()) {
      item.classList.toggle('above', at <= current)
      item.classList.toggle('current', at === current)
      if (at === current) link.setAttribute('aria-current', 'true')
      else link.removeAttribute('aria-current')
    }
    const item = targets[current]?.item
    // Back at the first entry the list belongs at its own top, where the heading above it is
    // readable again. `reveal` alone would leave it parked, the entry being visible either way.
    if (scroller && item && Date.now() >= heldUntil) {
      if (current === 0) scroller.scrollTo({ top: 0, behavior: motion() })
      else reveal(scroller, item)
    }
    onDraw?.(targets[current]?.link)
  }

  const setCurrent = (index: number) => {
    if (index === current) return
    current = index
    draw()
  }

  // Where an anchor jump parks a heading: under the bar, plus Starlight's own scroll padding.
  // Reading it back keeps the ring, the active entry and a clicked link on one line.
  const readingLine = () => {
    const padding = Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop)
    return Number.isNaN(padding) ? root.getBoundingClientRect().bottom : padding
  }

  // `0` once the first heading reaches that line, `1` once the last line of the article is in
  // view.
  const setProgress = () => {
    const first = targets[0]
    if (!first) return
    const start = first.heading.getBoundingClientRect().top + scrollY - readingLine()
    const end = article.getBoundingClientRect().bottom + scrollY - innerHeight
    const span = end - start
    const value = span > 0 ? (scrollY - start) / span : Number(scrollY >= start)
    root.style.setProperty('--nh3-progress', String(Math.min(1, Math.max(0, value))))
  }

  // The heading above the reading line is the one being read. Every crossing of that line is an
  // intersection, so the rects are read on the observer's terms instead of on every scroll.
  const syncCurrent = () => {
    if (!root.offsetHeight) return
    const line = readingLine() + 1
    let index = 0
    for (const [at, { heading }] of targets.entries()) {
      if (heading.getBoundingClientRect().top > line) break
      index = at
    }
    setCurrent(index)
  }
  const observer = new IntersectionObserver(syncCurrent, {
    rootMargin: `-${Math.round(readingLine())}px 0px 0px 0px`,
  })
  for (const { heading } of targets) observer.observe(heading)

  // `offsetHeight` is zero for the table of contents the current layout hides.
  const onScroll = () => {
    if (frame || !root.offsetHeight) return
    frame = requestAnimationFrame(() => {
      frame = 0
      setProgress()
    })
  }
  addEventListener('scroll', onScroll, { passive: true })
  addEventListener('resize', () => {
    onScroll()
    syncCurrent()
  })

  draw()
  setProgress()

  return { redraw: draw }
}
