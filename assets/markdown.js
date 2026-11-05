// Renderer for the rating guide's markdown, which uses only paragraphs, **bold** and "- " lists.
// Text is HTML-escaped before the bold markers are turned into <strong>.

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inline = (s) => escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

export function renderMarkdown(md) {
  const out = [];
  let para = [];
  let list = null;
  const flushPara = () => { if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`); para = []; };
  const flushList = () => { if (list) out.push(`<ul>${list.map((li) => `<li>${inline(li)}</li>`).join('')}</ul>`); list = null; };
  for (const raw of String(md || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { flushPara(); flushList(); continue; }
    if (line.startsWith('- ')) { flushPara(); (list ||= []).push(line.slice(2).trim()); continue; }
    if (list && /^\s+/.test(raw)) { list[list.length - 1] += ` ${line}`; continue; }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return out.join('\n');
}
