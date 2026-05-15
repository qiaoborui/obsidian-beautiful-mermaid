import {
  App,
  editorLivePreviewField,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
} from 'obsidian'
import { renderMermaidSVG, THEMES } from 'beautiful-mermaid'
import type { RenderOptions } from 'beautiful-mermaid'
import { EditorState, RangeSetBuilder, StateField } from '@codemirror/state'
import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view'

const DEFAULT_LANGUAGES = ['mermaid', 'mermaid-beautiful', 'beautiful-mermaid', 'bmmd']
const CODE_BLOCK_PROCESSOR_SORT_ORDER = -100
const OBSIDIAN_THEME_VALUE = 'obsidian'
const THEME_OPTIONS = [
  OBSIDIAN_THEME_VALUE,
  'zinc-light',
  'zinc-dark',
  'tokyo-night',
  'tokyo-night-storm',
  'tokyo-night-light',
  'catppuccin-mocha',
  'catppuccin-latte',
  'nord',
  'nord-light',
  'dracula',
  'github-light',
  'github-dark',
  'solarized-light',
  'solarized-dark',
  'one-dark',
] as const

type BeautifulMermaidTheme = typeof THEME_OPTIONS[number]

interface Point {
  x: number
  y: number
}

interface BeautifulMermaidSettings {
  languages: string[]
  minReadableHeight: number
  fitToWidth: boolean
  theme: BeautifulMermaidTheme
}

const DEFAULT_SETTINGS: BeautifulMermaidSettings = {
  languages: DEFAULT_LANGUAGES,
  minReadableHeight: 260,
  fitToWidth: true,
  theme: OBSIDIAN_THEME_VALUE,
}

function normalizeLanguages(value: string): string[] {
  const languages = value
    .split(',')
    .map((language) => language.trim().toLowerCase())
    .filter(Boolean)

  return Array.from(new Set(languages.length > 0 ? languages : DEFAULT_LANGUAGES))
}

function normalizeTheme(value: unknown): BeautifulMermaidTheme {
  if (typeof value === 'string' && THEME_OPTIONS.includes(value as BeautifulMermaidTheme)) {
    return value as BeautifulMermaidTheme
  }
  return OBSIDIAN_THEME_VALUE
}

function normalizeSettings(data: unknown): BeautifulMermaidSettings {
  if (!data || typeof data !== 'object') return DEFAULT_SETTINGS

  const saved = data as Partial<Record<keyof BeautifulMermaidSettings, unknown>>
  const languages = Array.isArray(saved.languages)
    ? saved.languages.filter((language): language is string => typeof language === 'string')
    : DEFAULT_SETTINGS.languages

  return {
    languages: Array.from(new Set(['mermaid', ...languages])),
    minReadableHeight: typeof saved.minReadableHeight === 'number'
      ? saved.minReadableHeight
      : DEFAULT_SETTINGS.minReadableHeight,
    fitToWidth: typeof saved.fitToWidth === 'boolean'
      ? saved.fitToWidth
      : DEFAULT_SETTINGS.fitToWidth,
    theme: normalizeTheme(saved.theme),
  }
}

function getThemeLabel(value: BeautifulMermaidTheme): string {
  if (value === OBSIDIAN_THEME_VALUE) return 'Obsidian colors'
  return value
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function parseSvgDimensions(svgString: string): { width: number; height: number } | null {
  const widthMatch = svgString.match(/width="(\d+(?:\.\d+)?)"/)
  const heightMatch = svgString.match(/height="(\d+(?:\.\d+)?)"/)
  if (!widthMatch?.[1] || !heightMatch?.[1]) return null
  return { width: parseFloat(widthMatch[1]), height: parseFloat(heightMatch[1]) }
}

function stripMermaidFence(source: string): string {
  const lines = source.replace(/\r\n/g, '\n').trim().split('\n')
  if (lines[0]?.trim().match(/^(`{3,}|~{3,})\s*[A-Za-z0-9_-]*.*$/)) {
    lines.shift()
  }
  if (lines[lines.length - 1]?.trim().match(/^(`{3,}|~{3,})\s*$/)) {
    lines.pop()
  }
  return lines.join('\n').trim()
}

function getRenderOptions(theme: BeautifulMermaidTheme): RenderOptions {
  const baseOptions = {
    transparent: true,
    interactive: true,
  } satisfies RenderOptions

  if (theme !== OBSIDIAN_THEME_VALUE) {
    return {
      ...THEMES[theme],
      ...baseOptions,
    }
  }

  return {
    bg: 'var(--background-primary, #f7f7f8)',
    fg: 'var(--text-normal, #16171d)',
    accent: 'var(--beautiful-mermaid-accent, #8b7bd8)',
    line: 'var(--beautiful-mermaid-line, #a4a4ad)',
    muted: 'var(--text-muted, #7c7d85)',
    surface: 'var(--beautiful-mermaid-surface, #ece9f8)',
    border: 'var(--beautiful-mermaid-border, #d8d8df)',
    ...baseOptions,
  }
}

function renderBeautifulMermaid(source: string, theme: BeautifulMermaidTheme): string {
  return renderMermaidSVG(stripMermaidFence(source), {
    ...getRenderOptions(theme),
  })
}

function appendSvg(host: HTMLElement, svg: string) {
  host.empty()

  const parser = new DOMParser()
  const parsed = parser.parseFromString(svg, 'image/svg+xml')
  const svgElement = parsed.documentElement
  if (svgElement.nodeName.toLowerCase() !== 'svg') {
    throw new Error('Mermaid renderer returned invalid SVG')
  }

  host.appendChild(host.doc.importNode(svgElement, true))
}

function renderFallback(el: HTMLElement, source: string, error: unknown) {
  el.empty()
  el.addClass('beautiful-mermaid-error')

  const title = el.createDiv({ cls: 'beautiful-mermaid-error-title', text: 'Mermaid render failed' })
  title.setAttr('aria-label', error instanceof Error ? error.message : String(error))
  el.createDiv({
    cls: 'beautiful-mermaid-error-message',
    text: error instanceof Error ? error.message : String(error),
  })
  el.createEl('pre', { text: stripMermaidFence(source) })
}

function fitRenderedDiagram(
  container: HTMLElement,
  content: HTMLElement,
  svgHost: HTMLElement,
  svg: string,
  minReadableHeight: number,
  fitToWidth: boolean,
  onResize?: () => void,
): ResizeObserver | null {
  const dims = parseSvgDimensions(svg)
  if (!dims) return null

  container.style.setProperty('--beautiful-mermaid-natural-width', `${dims.width}px`)
  container.style.setProperty('--beautiful-mermaid-natural-height', `${dims.height}px`)
  container.style.setProperty('--beautiful-mermaid-min-height', `${minReadableHeight}px`)
  const svgElement = svgHost.querySelector('svg')

  const getContainerWidth = () => {
    const width = container.clientWidth ||
      container.getBoundingClientRect().width ||
      container.parentElement?.clientWidth ||
      container.closest<HTMLElement>('.export-image-root')?.clientWidth ||
      container.closest<HTMLElement>('.markdown-preview-view')?.clientWidth ||
      content.parentElement?.clientWidth ||
      0

    return Math.floor(width)
  }

  const applySize = (width: number, height: number, containerWidth: number) => {
    const widthPx = `${width}px`
    const heightPx = `${height}px`

    content.style.width = widthPx
    content.style.height = heightPx
    content.style.margin = width <= containerWidth ? '0 auto' : '0'
    svgHost.style.width = widthPx
    svgHost.style.height = heightPx
    svgHost.style.transform = ''

    if (svgElement) {
      svgElement.setAttr('width', String(width))
      svgElement.setAttr('height', String(height))
      svgElement.style.setProperty('width', widthPx)
      svgElement.style.setProperty('height', heightPx)
    }
  }

  const update = () => {
    const containerWidth = getContainerWidth()
    if (!containerWidth) return

    const fitToContainerScale = containerWidth / dims.width
    const projectedHeight = dims.height * fitToContainerScale
    const overflow = dims.width - containerWidth

    let scale = 1

    if (fitToWidth && dims.width > containerWidth) {
      scale = fitToContainerScale
    } else if (projectedHeight < minReadableHeight) {
      scale = Math.min(minReadableHeight / dims.height, 1)
    } else if (overflow > 0 && overflow < 200) {
      scale = fitToContainerScale
    }

    const scaledWidth = dims.width * scale
    const scaledHeight = dims.height * scale

    applySize(scaledWidth, scaledHeight, containerWidth)
    onResize?.()
  }

  update()
  container.win.requestAnimationFrame(update)
  container.win.setTimeout(update, 50)
  container.win.setTimeout(update, 250)
  const observer = new ResizeObserver(update)
  observer.observe(container)
  if (container.parentElement) observer.observe(container.parentElement)
  return observer
}

function fillBeautifulMermaidBlock(
  container: HTMLElement,
  source: string,
  minReadableHeight: number,
  fitToWidth: boolean,
  theme: BeautifulMermaidTheme,
  onOpen: (svg: string) => void,
  onEdit?: () => void,
  onResize?: () => void,
): ResizeObserver | null {
  container.empty()
  container.addClass('beautiful-mermaid-block')
  container.toggleClass('is-fit-to-width', fitToWidth)
  container.toggleClass('is-readable-height', !fitToWidth)

  const svg = renderBeautifulMermaid(source, theme)
  const scroller = container.createDiv({ cls: 'beautiful-mermaid-scroll' })
  const content = scroller.createDiv({ cls: 'beautiful-mermaid-content' })
  const svgHost = content.createDiv({ cls: 'beautiful-mermaid-svg' })
  appendSvg(svgHost, svg)
  const resizeObserver = fitRenderedDiagram(container, content, svgHost, svg, minReadableHeight, fitToWidth, onResize)

  const actions = container.createDiv({ cls: 'beautiful-mermaid-actions' })
  if (onEdit) {
    actions.createEl('button', { text: 'Edit' }, (button) => {
      button.setAttr('aria-label', 'Edit Mermaid source')
      button.onClickEvent(onEdit)
    })
  }
  actions.createEl('button', { text: 'Open' }, (button) => {
    button.setAttr('aria-label', 'Open diagram preview')
    button.onClickEvent(() => onOpen(svg))
  })
  actions.createEl('button', { text: 'Copy' }, (button) => {
    button.setAttr('aria-label', 'Copy Mermaid source')
    button.onClickEvent(async () => {
      await navigator.clipboard.writeText(source)
      new Notice('Mermaid source copied')
    })
  })

  return resizeObserver
}

class ResizeObserverRenderChild extends MarkdownRenderChild {
  constructor(
    containerEl: HTMLElement,
    private readonly resizeObserver: ResizeObserver,
  ) {
    super(containerEl)
  }

  onunload() {
    this.resizeObserver.disconnect()
  }
}

interface MermaidFence {
  from: number
  to: number
  source: string
}

function findMermaidFences(docText: string, languages: Set<string>): MermaidFence[] {
  const fences: MermaidFence[] = []
  const fencePattern = /^(\s*)(`{3,}|~{3,})\s*([A-Za-z0-9_-]+)?[^\n\r]*$/gm
  let opening: { from: number; marker: string; language: string } | null = null
  let match: RegExpExecArray | null

  while ((match = fencePattern.exec(docText)) != null) {
    const marker = match[2] ?? ''
    const language = (match[3] ?? '').toLowerCase()
    const lineEnd = docText.indexOf('\n', match.index)
    const afterLine = lineEnd === -1 ? docText.length : lineEnd + 1

    if (!opening) {
      if (language && languages.has(language)) {
        opening = { from: match.index, marker: marker[0] ?? '`', language }
      }
      continue
    }

    if ((marker[0] ?? '`') !== opening.marker) continue

    const sourceStart = docText.indexOf('\n', opening.from)
    const source = sourceStart === -1
      ? ''
      : docText.slice(sourceStart + 1, match.index).replace(/\n$/, '')

    fences.push({
      from: opening.from,
      to: afterLine,
      source,
    })
    opening = null
  }

  return fences
}

function selectionIntersects(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => range.from <= to && range.to >= from)
}

class MermaidEditorWidget extends WidgetType {
  constructor(
    private readonly app: App,
    private readonly source: string,
    private readonly minReadableHeight: number,
    private readonly fitToWidth: boolean,
    private readonly theme: BeautifulMermaidTheme,
    private readonly from: number,
    private readonly to: number,
  ) {
    super()
  }

  eq(other: MermaidEditorWidget): boolean {
    return this.source === other.source &&
      this.minReadableHeight === other.minReadableHeight &&
      this.fitToWidth === other.fitToWidth &&
      this.theme === other.theme &&
      this.from === other.from &&
      this.to === other.to
  }

  toDOM(view: EditorView): HTMLElement {
    const container = view.dom.doc.createElement('div')
    try {
      fillBeautifulMermaidBlock(container, this.source, this.minReadableHeight, this.fitToWidth, this.theme, (svg) => {
        new MermaidPreviewModal(this.app, svg, this.source).open()
      }, () => {
        view.dispatch({
          selection: { anchor: this.from },
          scrollIntoView: true,
        })
        view.focus()
      }, () => {
        view.requestMeasure()
      })
    } catch (error) {
      renderFallback(container, this.source, error)
    }
    return container
  }

  ignoreEvent(event: Event): boolean {
    return event.type !== 'mousedown'
  }
}

function createMermaidEditorExtension(app: App, getSettings: () => BeautifulMermaidSettings) {
  const buildDecorations = (state: EditorState): DecorationSet => {
    if (!state.field(editorLivePreviewField, false)) return Decoration.none

    const settings = getSettings()
    const languages = new Set(settings.languages.map((language) => language.toLowerCase()))
    const builder = new RangeSetBuilder<Decoration>()
    const docText = state.doc.toString()

    for (const fence of findMermaidFences(docText, languages)) {
      if (selectionIntersects(state, fence.from, fence.to)) continue

      builder.add(
        fence.from,
        fence.from,
        Decoration.widget({
          block: true,
          side: -1,
          widget: new MermaidEditorWidget(app, fence.source, settings.minReadableHeight, settings.fitToWidth, settings.theme, fence.from, fence.to),
        }),
      )
      builder.add(fence.from, fence.to, Decoration.replace({ block: true }))
    }

    return builder.finish()
  }

  const field = StateField.define<DecorationSet>({
    create: buildDecorations,
    update: (_decorations, transaction) => buildDecorations(transaction.state),
    provide: (stateField) => EditorView.decorations.from(stateField),
  })

  return field
}

class MermaidPreviewModal extends Modal {
  private scale = 1
  private translate = { x: 0, y: 0 }
  private dragging = false
  private activePointerId: number | null = null
  private pointers = new Map<number, Point>()
  private pinchDistance: number | null = null
  private pinchCenter: Point | null = null
  private lastPoint = { x: 0, y: 0 }
  private contentElRef: HTMLElement | null = null

  constructor(
    app: App,
    private readonly svg: string,
    private readonly source: string,
  ) {
    super(app)
  }

  onOpen() {
    const { contentEl, modalEl } = this
    modalEl.addClass('beautiful-mermaid-modal')
    contentEl.empty()

    const toolbar = contentEl.createDiv({ cls: 'beautiful-mermaid-modal-toolbar' })
    toolbar.createEl('button', { text: '-' }, (button) => {
      button.setAttr('aria-label', 'Zoom out')
      button.onClickEvent(() => this.zoomBy(0.85))
    })
    toolbar.createEl('button', { text: '100%' }, (button) => {
      button.setAttr('aria-label', 'Reset zoom')
      button.onClickEvent(() => this.reset())
    })
    toolbar.createEl('button', { text: '+' }, (button) => {
      button.setAttr('aria-label', 'Zoom in')
      button.onClickEvent(() => this.zoomBy(1.18))
    })
    toolbar.createEl('button', { text: 'Copy' }, (button) => {
      button.setAttr('aria-label', 'Copy Mermaid source')
      button.onClickEvent(async () => {
        await navigator.clipboard.writeText(this.source)
        new Notice('Mermaid source copied')
      })
    })

    const viewport = contentEl.createDiv({ cls: 'beautiful-mermaid-modal-viewport' })
    const svgHost = viewport.createDiv({ cls: 'beautiful-mermaid-modal-svg' })
    appendSvg(svgHost, this.svg)
    this.contentElRef = svgHost
    this.applyTransform()

    viewport.onClickEvent((event) => {
      if (event.detail === 2) this.reset()
    })
    viewport.addEventListener('wheel', (event) => {
      event.preventDefault()
      this.zoomBy(event.deltaY < 0 ? 1.08 : 0.92)
    }, { passive: false })
    viewport.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return

      event.preventDefault()
      const point = this.eventPoint(event)
      this.pointers.set(event.pointerId, point)
      viewport.setPointerCapture(event.pointerId)
      this.updateGestureState(event.pointerId, point)
      viewport.addClass('is-dragging')
    })
    viewport.addEventListener('pointermove', (event) => {
      if (!this.pointers.has(event.pointerId)) return

      event.preventDefault()
      const point = this.eventPoint(event)
      this.pointers.set(event.pointerId, point)

      if (this.pointers.size >= 2) {
        this.updatePinch()
      } else if (this.dragging && event.pointerId === this.activePointerId) {
        this.translate.x += point.x - this.lastPoint.x
        this.translate.y += point.y - this.lastPoint.y
        this.lastPoint = point
      }

      this.applyTransform()
    })
    viewport.addEventListener('pointerup', (event) => this.endDrag(viewport, event.pointerId))
    viewport.addEventListener('pointercancel', (event) => this.endDrag(viewport, event.pointerId))
    viewport.addEventListener('lostpointercapture', (event) => this.endDrag(viewport, event.pointerId))
  }

  onClose() {
    this.contentEl.empty()
    this.contentElRef = null
    this.pointers.clear()
  }

  private zoomBy(multiplier: number) {
    this.scale = this.clampScale(this.scale * multiplier)
    this.applyTransform()
  }

  private reset() {
    this.scale = 1
    this.translate = { x: 0, y: 0 }
    this.applyTransform()
  }

  private endDrag(viewport: HTMLElement, pointerId?: number) {
    if (pointerId !== undefined) {
      this.pointers.delete(pointerId)
    }

    if (pointerId !== undefined && viewport.hasPointerCapture(pointerId)) {
      viewport.releasePointerCapture(pointerId)
    }

    this.pinchDistance = null
    this.pinchCenter = null

    if (this.pointers.size > 0) {
      const nextPointer = this.pointers.entries().next().value as [number, Point]
      this.activePointerId = nextPointer[0]
      this.dragging = true
      this.lastPoint = nextPointer[1]
      return
    }

    this.stopGesture(viewport)
  }

  private applyTransform() {
    this.contentElRef?.style.setProperty(
      'transform',
      `translate(${this.translate.x}px, ${this.translate.y}px) scale(${this.scale})`,
    )
  }

  private eventPoint(event: PointerEvent): Point {
    return { x: event.clientX, y: event.clientY }
  }

  private updateGestureState(pointerId: number, point: Point) {
    if (this.pointers.size >= 2) {
      this.activePointerId = null
      this.dragging = false
      const [first, second] = this.getFirstTwoPointers()
      this.pinchDistance = this.distance(first, second)
      this.pinchCenter = this.midpoint(first, second)
      return
    }

    this.activePointerId = pointerId
    this.dragging = true
    this.lastPoint = point
    this.pinchDistance = null
    this.pinchCenter = null
  }

  private updatePinch() {
    const [first, second] = this.getFirstTwoPointers()
    const nextDistance = this.distance(first, second)
    const nextCenter = this.midpoint(first, second)

    if (this.pinchDistance !== null && this.pinchDistance > 0 && this.pinchCenter !== null) {
      this.translate.x += nextCenter.x - this.pinchCenter.x
      this.translate.y += nextCenter.y - this.pinchCenter.y
      this.scale = this.clampScale(this.scale * (nextDistance / this.pinchDistance))
    }

    this.pinchDistance = nextDistance
    this.pinchCenter = nextCenter
  }

  private stopGesture(viewport: HTMLElement) {
    this.activePointerId = null
    this.dragging = false
    viewport.removeClass('is-dragging')
  }

  private getFirstTwoPointers(): [Point, Point] {
    const values = Array.from(this.pointers.values())
    return [values[0], values[1]]
  }

  private distance(first: Point, second: Point): number {
    return Math.hypot(second.x - first.x, second.y - first.y)
  }

  private midpoint(first: Point, second: Point): Point {
    return {
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
    }
  }

  private clampScale(scale: number): number {
    return Math.max(0.25, Math.min(4, scale))
  }
}

export default class BeautifulMermaidPlugin extends Plugin {
  settings: BeautifulMermaidSettings = DEFAULT_SETTINGS

  async onload() {
    await this.loadSettings()
    this.addSettingTab(new BeautifulMermaidSettingTab(this.app, this))
    this.registerProcessors()
    this.registerEditorExtension(createMermaidEditorExtension(this.app, () => this.settings))
  }

  private registerProcessors() {
    for (const language of this.settings.languages) {
      this.registerMarkdownCodeBlockProcessor(language, (source, el, ctx) => {
        this.renderBlock(source, el, ctx)
      }, CODE_BLOCK_PROCESSOR_SORT_ORDER)
    }
  }

  private renderBlock(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
    el.empty()
    el.addClass('beautiful-mermaid-block')

    try {
      const resizeObserver = fillBeautifulMermaidBlock(el, source, this.settings.minReadableHeight, this.settings.fitToWidth, this.settings.theme, (svg) => {
        new MermaidPreviewModal(this.app, svg, source).open()
      })
      if (resizeObserver) ctx.addChild(new ResizeObserverRenderChild(el, resizeObserver))
    } catch (error) {
      renderFallback(el, source, error)
    }
  }

  async loadSettings() {
    this.settings = normalizeSettings(await this.loadData())
  }

  async saveSettings() {
    await this.saveData(this.settings)
  }
}

class BeautifulMermaidSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: BeautifulMermaidPlugin,
  ) {
    super(app, plugin)
  }

  display() {
    const { containerEl } = this
    containerEl.empty()

    new Setting(containerEl)
      .setName('Beautiful Mermaid')
      .setHeading()

    new Setting(containerEl)
      .setName('Code block languages')
      .setDesc('Comma-separated fence languages handled by this plugin.')
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_LANGUAGES.join(', '))
          .setValue(this.plugin.settings.languages.join(', '))
          .onChange(async (value) => {
            this.plugin.settings.languages = normalizeLanguages(value)
            await this.plugin.saveSettings()
          })
      })

    new Setting(containerEl)
      .setName('Diagram theme')
      .setDesc('Use Obsidian CSS variables, or choose a built-in beautiful-mermaid theme.')
      .addDropdown((dropdown) => {
        for (const theme of THEME_OPTIONS) {
          dropdown.addOption(theme, getThemeLabel(theme))
        }
        dropdown
          .setValue(this.plugin.settings.theme)
          .onChange(async (value) => {
            this.plugin.settings.theme = normalizeTheme(value)
            await this.plugin.saveSettings()
          })
      })

    new Setting(containerEl)
      .setName('Fit diagrams to width')
      .setDesc('Scale wide inline diagrams down so the full diagram is visible without horizontal scrolling.')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.fitToWidth)
          .onChange(async (value) => {
            this.plugin.settings.fitToWidth = value
            await this.plugin.saveSettings()
          })
      })

    new Setting(containerEl)
      .setName('Minimum readable height')
      .setDesc('Used when Fit diagrams to width is disabled.')
      .addSlider((slider) => {
        slider
          .setLimits(160, 420, 20)
          .setDynamicTooltip()
          .setValue(this.plugin.settings.minReadableHeight)
          .onChange(async (value) => {
            this.plugin.settings.minReadableHeight = value
            await this.plugin.saveSettings()
          })
      })

    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Reload Obsidian after changing languages so code block processors are registered again.',
    })
  }
}
