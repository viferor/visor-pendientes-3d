// Parser XML mínimo (solo lectura) para poder ejecutar el código de index.html en Node
// sin modificar el repositorio. No pretende ser un parser XML completo: cubre
// declaración, comentarios, CDATA, elementos, atributos, texto y cierre automático.

class XNode {
  constructor(localName, prefix) {
    this.localName = localName;          // 'trkpt'
    this.tagName = prefix ? prefix + ':' + localName : localName;
    this.children = [];
    this.attributes = new Map();
    this.text = '';
  }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  get textContent() { return this.text + this.children.map(c => c.textContent).join(''); }
  get elements() { return this.children; }
  getElementsByTagName(name) {
    const out = [];
    const want = String(name);
    const walk = n => {
      for (const c of n.children) {
        if (want === '*' || c.tagName === want || c.localName === want) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  matchesAny(sel) {
    if (sel === '*') return true;
    return String(sel).split(',').map(s => s.trim()).filter(Boolean).some(s => s === this.tagName || s === this.localName);
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    const out = [];
    const walk = n => { for (const c of n.children) { if (c.matchesAny(sel)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
}

export function parseXML(text) {
  const root = new XNode('#document', '');
  const stack = [root];
  let i = 0;
  if (text.charCodeAt(0) === 0xFEFF) i = 1;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt < 0) { stack[stack.length - 1].text += text.slice(i); break; }
    if (lt > i) stack[stack.length - 1].text += text.slice(i, lt);
    if (text.startsWith('<!--', lt)) { const e = text.indexOf('-->', lt); i = e < 0 ? text.length : e + 3; continue; }
    if (text.startsWith('<![CDATA[', lt)) {
      const e = text.indexOf(']]>', lt);
      stack[stack.length - 1].text += text.slice(lt + 9, e < 0 ? text.length : e);
      i = e < 0 ? text.length : e + 3; continue;
    }
    if (text.startsWith('<?', lt)) { const e = text.indexOf('?>', lt); i = e < 0 ? text.length : e + 2; continue; }
    if (text.startsWith('<!', lt)) { const e = text.indexOf('>', lt); i = e < 0 ? text.length : e + 1; continue; }
    const gt = text.indexOf('>', lt);
    if (gt < 0) { // '<' suelto: texto literal
      stack[stack.length - 1].text += text.slice(lt);
      break;
    }
    let inner = text.slice(lt + 1, gt);
    const selfClose = /\/\s*$/.test(inner);
    if (selfClose) inner = inner.replace(/\/\s*$/, '');
    const closing = inner.startsWith('/');
    if (closing) {
      const name = inner.slice(1).trim();
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].tagName === name || stack[k].localName === name) { stack.length = k; break; }
      }
      i = gt + 1; continue;
    }
    const m = /^([^\s/>]+)\s*([\s\S]*)$/.exec(inner);
    if (!m) { i = gt + 1; continue; }
    const rawName = m[1];
    const colon = rawName.indexOf(':');
    const node = new XNode(colon < 0 ? rawName : rawName.slice(colon + 1), colon < 0 ? '' : rawName.slice(0, colon));
    const attrs = m[2];
    const attrRe = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let a;
    while ((a = attrRe.exec(attrs))) node.attributes.set(a[1], a[3] !== undefined ? a[3] : a[4]);
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
    i = gt + 1;
  }
  return root;
}

export class DOMParserStub {
  parseFromString(text, type) {
    const doc = parseXML(String(text));
    if (/xml/i.test(String(type))) {
      // DOMParser real mete <parsererror> en el documento cuando el XML está mal formado.
      if (isMalformed(String(text))) {
        const err = new XNode('parsererror', '');
        doc.children.push(err);
      }
    }
    return doc;
  }
}

// Detección conservadora de XML mal formado: etiquetas de cierre sin apertura, etiquetas sin cerrar
// o caracteres que no pueden formar parte de un nombre de elemento (< suelto al final, por ejemplo).
export function isMalformed(text) {
  const stack = [];
  const src = String(text).replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '').replace(/<\?[\s\S]*?\?>/g, '');
  const re = /<(\/?)([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  const rest = src.replace(re, '');
  // Un '<' fuera de una etiqueta válida es un error del parser real (parcialmente escrito, etc.)
  if (/</.test(rest)) return true;
  let m;
  while ((m = re.exec(src))) {
    const closing = m[1] === '/', name = m[2], self = m[4] === '/';
    if (self) continue;
    if (closing) {
      if (!stack.length || stack[stack.length - 1] !== name) return true;
      stack.pop();
    } else stack.push(name);
  }
  return stack.length > 0;
}
