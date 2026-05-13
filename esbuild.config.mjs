import esbuild from 'esbuild'
import process from 'node:process'

const prod = process.argv.includes('--production')

const context = await esbuild.context({
  banner: {
    js: '/* Obsidian Beautiful Mermaid */',
  },
  entryPoints: ['main.ts'],
  bundle: true,
  external: ['obsidian', '@codemirror/state', '@codemirror/view'],
  format: 'cjs',
  target: 'es2018',
  logLevel: 'info',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  outfile: 'main.js',
})

if (prod) {
  await context.rebuild()
  await context.dispose()
} else {
  await context.watch()
}
