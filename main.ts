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
import { renderMermaidSVG } from 'beautiful-mermaid'
import { EditorState, RangeSetBuilder, StateField } from '@codemirror/state'
import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view'

const DEFAULT_LANGUAGES = ['mermaid', 'mermaid-beautiful', 'beautiful-mermaid', 'bmmd']
const CODE_BLOCK_PROCESSOR_SORT_ORDER = -100

interface BeautifulMermaidSettings {
  languages: string[]
  minReadableHeight: number
  fitToWidth: boolean
}

const DEFAULT_SETTINGS: BeautifulMermaidSettings = {
  languages: DEFAULT_LANGUAGES,
  minReadableHeight: 260,
  fitToWidth: true,
}

function normalizeLanguages(value: string): string[] {
  const languages = value
    .split(',')
    .map((language) => language.trim().toLowerCase())
    .filter(Boolean)

  return Array.from(new Set(languages.length > 0 ? languages : DEFAULT_LANGUAGES))
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

function renderBeautifulMermaid(source: string): string {
  return renderMermaidSVG(stripMermaidFence(source), {
    bg: 'var(--background-primary, #f7f7f8)',
    fg: 'var(--text-normal, #16171d)',
    accent: 'var(--beautiful-mermaid-accent, #8b7bd8)',
    line: 'var(--beautiful-mermaid-line, #a4a4ad)',
    muted: 'var(--text-muted, #7c7d85)',
    surface: 'var(--beautiful-mermaid-surface, #ece9f8)',
    border: 'var(--beautiful-mermaid-border, #d8d8df)',
    transparent: true,
    interactive: true,
  })
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

  const update = () => {
    const containerWidth = container.clientWidth
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

    content.style.width = `${scaledWidth}px`
    content.style.height = `${scaledHeight}px`
    content.style.margin = scaledWidth <= containerWidth ? '0 auto' : '0'
    svgHost.style.transform = scale === 1 ? '' : `scale(${scale})`
    onResize?.()
  }

  update()
  const observer = new ResizeObserver(update)
  observer.observe(container)
  return observer
}

function fillBeautifulMermaidBlock(
  container: HTMLElement,
  source: string,
  minReadableHeight: number,
  fitToWidth: boolean,
  onOpen: (svg: string) => void,
  onEdit?: () => void,
  onResize?: () => void,
): ResizeObserver | null {
  container.empty()
  container.addClass('beautiful-mermaid-block')

  const svg = renderBeautifulMermaid(source)
  const scroller = container.createDiv({ cls: 'beautiful-mermaid-scroll' })
  const content = scroller.createDiv({ cls: 'beautiful-mermaid-content' })
  const svgHost = content.createDiv({ cls: 'beautiful-mermaid-svg' })
  svgHost.innerHTML = svg
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
    private readonly from: number,
    private readonly to: number,
  ) {
    super()
  }

  eq(other: MermaidEditorWidget): boolean {
    return this.source === other.source &&
      this.minReadableHeight === other.minReadableHeight &&
      this.fitToWidth === other.fitToWidth &&
      this.from === other.from &&
      this.to === other.to
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div')
    try {
      fillBeautifulMermaidBlock(container, this.source, this.minReadableHeight, this.fitToWidth, (svg) => {
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
              widget: new MermaidEditorWidget(app, fence.source, settings.minReadableHeight, settings.fitToWidth, fence.from, fence.to),
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
    svgHost.innerHTML = this.svg
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
      if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return

      event.preventDefault()
      this.activePointerId = event.pointerId
      this.dragging = true
      this.lastPoint = { x: event.clientX, y: event.clientY }
      viewport.setPointerCapture(event.pointerId)
      viewport.addClass('is-dragging')
    })
    viewport.addEventListener('pointermove', (event) => {
      if (!this.dragging || event.pointerId !== this.activePointerId) return

      event.preventDefault()
      this.translate.x += event.clientX - this.lastPoint.x
      this.translate.y += event.clientY - this.lastPoint.y
      this.lastPoint = { x: event.clientX, y: event.clientY }
      this.applyTransform()
    })
    viewport.addEventListener('pointerup', (event) => this.endDrag(viewport, event.pointerId))
    viewport.addEventListener('pointercancel', (event) => this.endDrag(viewport, event.pointerId))
    viewport.addEventListener('lostpointercapture', (event) => this.endDrag(viewport, event.pointerId))
  }

  onClose() {
    this.contentEl.empty()
    this.contentElRef = null
  }

  private zoomBy(multiplier: number) {
    this.scale = Math.max(0.25, Math.min(4, this.scale * multiplier))
    this.applyTransform()
  }

  private reset() {
    this.scale = 1
    this.translate = { x: 0, y: 0 }
    this.applyTransform()
  }

  private endDrag(viewport: HTMLElement, pointerId?: number) {
    if (pointerId !== undefined && pointerId !== this.activePointerId) return

    if (this.activePointerId !== null && viewport.hasPointerCapture(this.activePointerId)) {
      viewport.releasePointerCapture(this.activePointerId)
    }
    this.activePointerId = null
    this.dragging = false
    viewport.removeClass('is-dragging')
  }

  private applyTransform() {
    this.contentElRef?.style.setProperty(
      'transform',
      `translate(${this.translate.x}px, ${this.translate.y}px) scale(${this.scale})`,
    )
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
      const resizeObserver = fillBeautifulMermaidBlock(el, source, this.settings.minReadableHeight, this.settings.fitToWidth, (svg) => {
        new MermaidPreviewModal(this.app, svg, source).open()
      })
      if (resizeObserver) ctx.addChild(new ResizeObserverRenderChild(el, resizeObserver))
    } catch (error) {
      renderFallback(el, source, error)
    }
  }

  async loadSettings() {
    const loaded = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
    this.settings = {
      ...loaded,
      languages: Array.from(new Set(['mermaid', ...loaded.languages])),
    }
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

    containerEl.createEl('h2', { text: 'Beautiful Mermaid' })

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
