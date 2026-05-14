import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderMermaidSVG } from 'beautiful-mermaid'

const root = process.cwd()
const assetsDir = join(root, 'assets')

mkdirSync(assetsDir, { recursive: true })

const theme = {
  bg: '#f7f7f8',
  fg: '#16171d',
  accent: '#8b7bd8',
  line: '#a4a4ad',
  muted: '#7c7d85',
  surface: '#ece9f8',
  border: '#d8d8df',
  transparent: true,
  interactive: true,
}

const diagrams = [
  {
    fileName: 'gallery-flow.svg',
    source: `graph LR
  source[Mermaid code block] --> render[Beautiful Mermaid renderer]
  render --> theme[Theme-aware SVG]
  theme --> reading[Reading view]
  theme --> live[Live Preview]
  live --> zoom[Zoom and pan]
  live --> mobile[Mobile gestures]`,
  },
  {
    fileName: 'gallery-xy-bar.svg',
    source: `xychart-beta
  title "Monthly Notes Created"
  x-axis [Jan, Feb, Mar, Apr, May, Jun]
  y-axis "Notes" 0 --> 500
  bar [180, 250, 310, 280, 350, 420]`,
  },
  {
    fileName: 'gallery-xy-combo.svg',
    source: `xychart-beta
  title "Research Output with Trend"
  x-axis [Q1, Q2, Q3, Q4]
  y-axis "Items" 0 --> 220
  bar [52, 88, 128, 168]
  line [48, 96, 118, 196]`,
  },
  {
    fileName: 'gallery-xy-horizontal.svg',
    source: `xychart-beta horizontal
  title "Diagram Types Used"
  x-axis [Flowchart, Sequence, ER, Class, XY]
  y-axis "Uses" 0 --> 40
  bar [36, 28, 22, 18, 14]`,
  },
  {
    fileName: 'preview-flow.svg',
    source: `graph LR
  A[Obsidian Mermaid fence] --> B[Beautiful Mermaid renderer]
  B --> C[Theme-aware SVG]
  C --> D[Reading view]
  C --> E[Live Preview]
  E --> F[Fit to width]`,
  },
  {
    fileName: 'preview-redis.svg',
    source: `graph LR
  API[API emitEvent] --> RC[Redis Pub/Sub<br/>channel<br/>userId/channelId/guildId]

  subgraph GW1[Gateway session A]
    RS1[Redis subscriber client<br/>subscription scope] --> H1A[Handler for channel A]
    RS1 --> H1B[Handler for channel B]
  end

  subgraph GW2[Gateway session B]
    RS2[Redis subscriber client<br/>subscription scope] --> H2A[Handler for channel A]
    RS2 --> H2C[Handler for channel C]
  end

  RC -->|PUBLISH fanout| RS1
  RC -->|PUBLISH fanout| RS2`,
  },
]

for (const diagram of diagrams) {
  const svg = renderMermaidSVG(diagram.source, theme)
  writeFileSync(join(assetsDir, diagram.fileName), svg)
  console.log(`wrote assets/${diagram.fileName}`)
}
