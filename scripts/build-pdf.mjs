// README.md → README.pdf
// 사용법: npm run pdf   (macOS Chrome 필요. 다른 경로면 CHROME=/path/to/chrome npm run pdf)
//
// 1) marked로 Markdown → HTML
// 2) 헤드리스 Chrome에서 mermaid.js로 다이어그램을 SVG로 그린 뒤 DOM을 뽑아냄
// 3) 그 정적 HTML을 다시 헤드리스 Chrome으로 PDF 인쇄
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { marked } from 'marked';

const SRC = resolve(process.argv[2] ?? 'README.md');
const OUT = resolve(process.argv[3] ?? 'README.pdf');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const md = readFileSync(SRC, 'utf8');
const renderer = new marked.Renderer();
const origCode = renderer.code.bind(renderer);
renderer.code = (tok) =>
  tok.lang === 'mermaid'
    ? `<pre class="mermaid">${tok.text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>\n`
    : origCode(tok);
marked.use({ renderer, gfm: true });
const body = marked.parse(md);

const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<title>${md.split('\n')[0].replace(/^#\s*/, '')}</title>
<style>
@page { size: A4; margin: 18mm 16mm; }
html { -webkit-print-color-adjust: exact; }
body { font-family: "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", -apple-system, sans-serif;
       font-size: 10.5pt; line-height: 1.65; color: #1a1a1a; margin: 0; word-break: keep-all; overflow-wrap: anywhere; }
h1 { font-size: 22pt; border-bottom: 2px solid #333; padding-bottom: 6px; margin-top: 0; }
h2 { font-size: 16pt; margin-top: 28px; border-bottom: 1px solid #bbb; padding-bottom: 4px; page-break-after: avoid; }
h3 { font-size: 13pt; margin-top: 20px; page-break-after: avoid; }
h4 { font-size: 11.5pt; page-break-after: avoid; }
p, li { orphans: 3; widows: 3; }
a { color: #0b57d0; text-decoration: none; }
code { font-family: "SF Mono", Menlo, "D2Coding", monospace; font-size: 9.2pt; background: #f2f2f2; padding: 1px 4px; border-radius: 3px; }
pre { background: #f6f8fa; border: 1px solid #ddd; border-radius: 4px; padding: 10px 12px; font-size: 8.8pt; line-height: 1.45;
      white-space: pre-wrap; overflow-wrap: anywhere; page-break-inside: avoid; }
pre code { background: none; padding: 0; font-size: inherit; }
pre.mermaid { background: #fff; text-align: center; border: 1px solid #ddd; }
pre.mermaid svg { max-width: 100%; height: auto; }
blockquote { border-left: 4px solid #ccc; margin: 12px 0; padding: 4px 14px; color: #444; background: #fafafa; }
table { border-collapse: collapse; width: 100%; font-size: 9.5pt; page-break-inside: avoid; margin: 10px 0; }
th, td { border: 1px solid #ccc; padding: 5px 8px; text-align: left; vertical-align: top; }
th { background: #eef1f5; }
hr { border: 0; border-top: 1px solid #ccc; margin: 24px 0; }
img { max-width: 100%; }
</style></head><body>
${body}
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
  mermaid.initialize({ startOnLoad: false, theme: 'neutral', htmlLabels: false, flowchart: { htmlLabels: false, useMaxWidth: true } });
  // --virtual-time-budget 아래에서는 Date.now()가 멈춰 mermaid.run()이 모든 다이어그램에 같은 id를 주므로
  // 직접 고유 id로 하나씩 render한다.
  const pres = [...document.querySelectorAll('pre.mermaid')];
  for (let i = 0; i < pres.length; i++) {
    try { pres[i].innerHTML = (await mermaid.render('mmd-' + i, pres[i].textContent)).svg; }
    catch (e) { console.error('mermaid', i, e); }
  }
  document.documentElement.dataset.ready = '1';
</script>
</body></html>`;

const work = mkdtempSync(join(tmpdir(), 'readme-pdf-'));
const srcHtml = join(work, 'src.html');
const staticHtml = join(work, 'static.html');
writeFileSync(srcHtml, html);

const chrome = (args) => execFileSync(CHROME, ['--headless=new', '--disable-gpu', ...args], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 });

// 2) mermaid 실행 후 DOM 덤프, module script 제거
let dom = chrome(['--window-size=1000,1400', '--virtual-time-budget=30000', '--dump-dom', `file://${srcHtml}`]).toString('utf8');
dom = dom.replace(/<script type="module">[\s\S]*?<\/script>/, '');
const svgCount = (dom.match(/<pre class="mermaid"[^>]*><svg/g) ?? []).length;
const mermaidCount = (body.match(/class="mermaid"/g) ?? []).length;
if (svgCount !== mermaidCount) throw new Error(`mermaid 렌더 실패: ${svgCount}/${mermaidCount}`);
writeFileSync(staticHtml, dom);

// 3) 정적 HTML → PDF
chrome(['--no-pdf-header-footer', `--print-to-pdf=${OUT}`, `file://${staticHtml}`]);
rmSync(work, { recursive: true, force: true });
console.log(`${OUT} (mermaid ${svgCount}개)`);
