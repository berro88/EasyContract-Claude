import JSZip from 'jszip';
import { type ReportDoc, TONE_COLOURS } from './model.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // Characters XML 1.0 doesn't allow.
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

const run = (text: string, props = '') =>
  text.split('\n').map((line, i) => `${i ? '<w:r><w:br/></w:r>' : ''}<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(line)}</w:t></w:r>`).join('');
const para = (inner: string, pPr = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${inner}</w:p>`;

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** An editable Word file. The disclaimer sits in the page footer, so it is on every page. */
export async function renderDocx(doc: ReportDoc): Promise<Buffer> {
  const body: string[] = [];
  body.push(para(run(doc.title), '<w:pStyle w:val="Title"/>'));
  for (const m of doc.meta) body.push(para(run(m, '<w:color w:val="555555"/><w:sz w:val="20"/>')));
  body.push(para(run(doc.disclaimer, '<w:b/><w:color w:val="4A3300"/>'), '<w:pBdr><w:top w:val="single" w:sz="4" w:space="4" w:color="E8C766"/><w:bottom w:val="single" w:sz="4" w:space="4" w:color="E8C766"/></w:pBdr><w:shd w:val="clear" w:fill="FFF4D6"/>'));

  for (const b of doc.blocks) {
    switch (b.type) {
      case 'heading': body.push(para(run(b.text), `<w:pStyle w:val="Heading${b.level}"/>`)); break;
      case 'paragraph': body.push(para(run(b.text, `${b.bold ? '<w:b/>' : ''}${b.muted ? '<w:color w:val="666666"/>' : ''}`))); break;
      case 'quote': body.push(para(`${b.label ? run(`${b.label}  `, '<w:b/><w:color w:val="2557D6"/>') : ''}${run(b.text, '<w:i/>')}`, '<w:pStyle w:val="Quote"/>')); break;
      case 'label': body.push(para(run(b.text.toUpperCase(), `<w:b/><w:color w:val="${TONE_COLOURS[b.tone]}"/><w:sz w:val="18"/>`), '<w:spacing w:before="240" w:after="0"/>')); break;
      case 'bullets': for (const item of b.items) body.push(para(run(`•  ${item}`), '<w:ind w:left="360" w:hanging="240"/>')); break;
      case 'warning': body.push(para(run(`Warning: ${b.text}`, '<w:b/><w:color w:val="6B1010"/>'), '<w:shd w:val="clear" w:fill="FDE8E8"/>')); break;
      case 'rule': body.push(para('', '<w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="CCCCCC"/></w:pBdr>')); break;
    }
  }

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}><w:body>${body.join('')}
<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:footerReference w:type="first" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;

  const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr ${W}>${para(run(doc.disclaimer, '<w:sz w:val="16"/><w:color w:val="444444"/>'), '<w:jc w:val="center"/>')}${para(`${run('Page ', '<w:sz w:val="16"/>')}<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>`, '<w:jc w:val="center"/>')}</w:ftr>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="360"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360"/><w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="2557D6"/></w:pBdr></w:pPr></w:style>
</w:styles>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`);
  zip.file('word/document.xml', document);
  zip.file('word/styles.xml', styles);
  zip.file('word/footer1.xml', footer);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
