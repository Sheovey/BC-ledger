/**
 * 零依赖 xlsx 写入器：手写 STORE（不压缩）版 ZIP + 最小 OOXML 部件。
 *
 * 为什么不用 SheetJS：浏览器构建约 900KB，主包只有 2MB，为了一份存档文件
 * 引进来不划算。这里只用 Uint8Array / DataView，代码十几 KB 的产物。
 *
 * 代价是不压缩：xlsx 体积约等于同名 CSV 的 1.1 倍。记账量级（几千条）可以
 * 接受，换来的是「微信 openDocument 能直接预览」——CSV 微信打不开。
 *
 * 改动前务必对照三处最容易写错的地方：
 * 1. ZIP 各头偏移与字节序。EOCD 的 cdOffset、中央目录的 localHeaderOffset
 *    都是**绝对偏移**；STORE 下 csize 必须等于 usize；CRC 算的是未压缩字节；
 *    DOS 年份必须 ≥1980（否则 Excel 直接判损坏）。
 * 2. XML 子元素顺序。styles.xml 必须是 numFmts → fonts → fills → borders →
 *    cellStyleXfs → cellXfs → cellStyles；worksheet 里 cols 必须在 sheetData
 *    之前。顺序错 Excel 弹「需要修复」，而 WPS 可能照开，很容易漏。
 * 3. 文本转义与编码。控制字符、孤立代理项、`&` 二次转义，任一出错的表现
 *    不是某个格子不对，而是整个文件打不开。
 */

export type XlsxCell = string | number | null | undefined;

export interface XlsxSheet {
  /** 表名。调用方可用 sheetName() 先做合法化。 */
  name: string;
  rows: XlsxCell[][];
  /** 可选列宽（字符数），下标与列对齐 */
  colWidths?: number[];
  /** 首行是否加粗（当作表头） */
  headerRow?: boolean;
  /** 需要套 #,##0.00 格式的列下标（0 基）。数值单元格本身按 typeof 判断 */
  moneyCols?: number[];
}

/* ------------------------------------------------------------------ CRC32 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/* -------------------------------------------------------------- UTF-8 编码 */

/**
 * 自己写而不用 TextEncoder：小程序逻辑层不保证有 TextEncoder / Blob / btoa。
 * 同时负责把孤立代理项（emoji 被截断产生的半个字符）替换为 U+FFFD，否则会
 * 编码出非法 UTF-8 让整份文件打不开。
 */
function utf8Encode(input: string): Uint8Array {
  let buf = new Uint8Array(Math.max(64, input.length * 2));
  let p = 0;
  const grow = (need: number) => {
    if (p + need <= buf.length) return;
    let size = buf.length * 2;
    while (size < p + need) size *= 2;
    const next = new Uint8Array(size);
    next.set(buf.subarray(0, p));
    buf = next;
  };
  const push = (byte: number) => {
    grow(1);
    buf[p] = byte;
    p += 1;
  };

  for (let i = 0; i < input.length; i += 1) {
    let code = input.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = input.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      } else {
        code = 0xfffd;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      code = 0xfffd;
    }

    if (code < 0x80) {
      push(code);
    } else if (code < 0x800) {
      push(0xc0 | (code >> 6));
      push(0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      push(0xe0 | (code >> 12));
      push(0x80 | ((code >> 6) & 0x3f));
      push(0x80 | (code & 0x3f));
    } else {
      push(0xf0 | (code >> 18));
      push(0x80 | ((code >> 12) & 0x3f));
      push(0x80 | ((code >> 6) & 0x3f));
      push(0x80 | (code & 0x3f));
    }
  }
  return buf.subarray(0, p);
}

/* ---------------------------------------------------------------- XML 转义 */

/** XML 1.0 不允许的控制字符（保留 \t \n \r） */
const XML_ILLEGAL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;
const MAX_CELL_CHARS = 32767;

export function xmlEscape(raw: string): string {
  let text = raw.length > MAX_CELL_CHARS ? raw.slice(0, MAX_CELL_CHARS) : raw;
  text = text.replace(XML_ILLEGAL, '');
  // OOXML 用 _xHHHH_ 表示任意字符。备注里若真出现形如 _x0041_ 的字面量，
  // Excel 会解码成 A。先把这个下划线转义掉，成本极低。
  text = text.replace(/_x/g, '_x005F_x');
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/* ------------------------------------------------------------ 名称与列号 */

/** 0 → A, 25 → Z, 26 → AA */
export function colName(indexZeroBased: number): string {
  let n = indexZeroBased;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

const SHEET_BAD = /[:\\/?*[\]]/g;

/** 表名合法化：去非法字符、截断 31 字符、去首尾单引号、重名追加序号 */
export function sheetName(raw: string, used?: Set<string>): string {
  let name = (raw || '工作表').replace(SHEET_BAD, ' ').trim();
  name = name.replace(/^'+|'+$/g, '').trim();
  if (!name) name = '工作表';
  if (name.length > 31) name = name.slice(0, 31);
  if (name.toLowerCase() === 'history') name = 'History_';
  if (!used) return name;

  let candidate = name;
  let seq = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = `(${seq})`;
    candidate = `${name.slice(0, 31 - suffix.length)}${suffix}`;
    seq += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/* ---------------------------------------------------------------- 单元格 */

function numText(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Number.isInteger(value)) return String(value);
  // 避免 toExponential：金额本身是分/100，最多两位，六位足够兜底
  return String(Number(value.toFixed(6)));
}

function cellXml(ref: string, value: XlsxCell, style: number): string {
  const s = style ? ` s="${style}"` : '';
  if (value === null || value === undefined || value === '') {
    return s ? `<c r="${ref}"${s}/>` : `<c r="${ref}"/>`;
  }
  if (typeof value === 'number') {
    return `<c r="${ref}"${s}><v>${numText(value)}</v></c>`;
  }
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

/** 样式下标，与 styles.xml 的 cellXfs 顺序一一对应 */
const STYLE_PLAIN = 0;
const STYLE_MONEY = 1;
const STYLE_BOLD = 2;
const STYLE_BOLD_MONEY = 3;

function sheetXml(sheet: XlsxSheet): string {
  const parts: string[] = [];
  parts.push(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
  );

  // cols 必须排在 sheetData 之前
  if (sheet.colWidths && sheet.colWidths.length) {
    parts.push('<cols>');
    sheet.colWidths.forEach((width, index) => {
      parts.push(`<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`);
    });
    parts.push('</cols>');
  }

  parts.push('<sheetData>');
  const money = new Set(sheet.moneyCols ?? []);
  sheet.rows.forEach((row, rowIndex) => {
    const isHeader = sheet.headerRow && rowIndex === 0;
    parts.push(`<row r="${rowIndex + 1}">`);
    row.forEach((value, colIndex) => {
      const style = isHeader
        ? money.has(colIndex)
          ? STYLE_BOLD_MONEY
          : STYLE_BOLD
        : money.has(colIndex) && typeof value === 'number'
          ? STYLE_MONEY
          : STYLE_PLAIN;
      parts.push(cellXml(`${colName(colIndex)}${rowIndex + 1}`, value, style));
    });
    parts.push('</row>');
  });
  parts.push('</sheetData></worksheet>');
  return parts.join('');
}

/* ------------------------------------------------------------- OOXML 部件 */

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NS_DOC_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT_REL = 'application/vnd.openxmlformats-package.relationships+xml';
const CT_SHEET = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';
const CT_STYLES = 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml';
const CT_WORKBOOK = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';

function contentTypesXml(sheetCount: number): string {
  const overrides = [
    `<Override PartName="/xl/workbook.xml" ContentType="${CT_WORKBOOK}"/>`,
    ...Array.from(
      { length: sheetCount },
      (_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${CT_SHEET}"/>`,
    ),
    `<Override PartName="/xl/styles.xml" ContentType="${CT_STYLES}"/>`,
  ];
  return (
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="${CT_REL}"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    overrides.join('') +
    '</Types>'
  );
}

function rootRelsXml(): string {
  return (
    `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">` +
    `<Relationship Id="rId1" Type="${NS_DOC_REL}/officeDocument" Target="xl/workbook.xml"/>` +
    '</Relationships>'
  );
}

function workbookXml(names: string[]): string {
  const sheets = names
    .map((name, i) => `<sheet name="${xmlEscape(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('');
  return `${XML_HEAD}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_DOC_REL}"><sheets>${sheets}</sheets></workbook>`;
}

function workbookRelsXml(sheetCount: number): string {
  const rels = [
    ...Array.from(
      { length: sheetCount },
      (_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_DOC_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    ),
    `<Relationship Id="rId${sheetCount + 1}" Type="${NS_DOC_REL}/styles" Target="styles.xml"/>`,
  ];
  return `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">${rels.join('')}</Relationships>`;
}

/**
 * 最小 styles.xml。两个硬性约束：
 * - fills 必须是 2 项（none + gray125），这是 Excel 的既定期望；
 * - cellXfs 的 count 必须与实际 <xf> 个数一致，写错是「WPS 能开、Excel 说损坏」的头号来源。
 */
function stylesXml(): string {
  return (
    `${XML_HEAD}<styleSheet xmlns="${NS_MAIN}">` +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>' +
    '<fonts count="2">' +
    '<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>' +
    '</fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="4">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>'
  );
}

/* -------------------------------------------------------------- ZIP 打包 */

interface ZipEntry {
  name: string;
  data: Uint8Array;
  crc: number;
  offset: number;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function concat(parts: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function buildZip(files: Array<{ name: string; text: string }>, now: Date): ArrayBuffer {
  const { time, date } = dosDateTime(now);
  const entries: ZipEntry[] = [];
  const localParts: Uint8Array[] = [];
  let localSize = 0;

  for (const file of files) {
    const nameBytes = utf8Encode(file.name);
    const data = utf8Encode(file.text);
    const crc = crc32(data);
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); // 本地文件头签名
    view.setUint16(4, 20, true); // version needed
    view.setUint16(6, 0, true); // 通用标志：文件名全 ASCII，不置 UTF-8 位
    view.setUint16(8, 0, true); // 压缩方法 0 = STORE
    view.setUint16(10, time, true);
    view.setUint16(12, date, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true); // STORE 下 csize === usize
    view.setUint32(22, data.length, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true); // extra 长度
    header.set(nameBytes, 30);

    entries.push({ name: file.name, data, crc, offset: localSize });
    localParts.push(header, data);
    localSize += header.length + data.length;
  }

  const centralParts: Uint8Array[] = [];
  let centralSize = 0;
  for (const entry of entries) {
    const nameBytes = utf8Encode(entry.name);
    const record = new Uint8Array(46 + nameBytes.length);
    const view = new DataView(record.buffer);
    view.setUint32(0, 0x02014b50, true); // 中央目录签名
    view.setUint16(4, 20, true); // version made by
    view.setUint16(6, 20, true); // version needed
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, time, true);
    view.setUint16(14, date, true);
    view.setUint32(16, entry.crc, true);
    view.setUint32(20, entry.data.length, true);
    view.setUint32(24, entry.data.length, true);
    view.setUint16(28, nameBytes.length, true);
    view.setUint16(30, 0, true); // extra
    view.setUint16(32, 0, true); // comment
    view.setUint16(34, 0, true); // 起始磁盘号
    view.setUint16(36, 0, true); // 内部属性
    view.setUint32(38, 0, true); // 外部属性
    view.setUint32(42, entry.offset, true); // 本地头绝对偏移
    record.set(nameBytes, 46);
    centralParts.push(record);
    centralSize += record.length;
  }

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(4, 0, true);
  eocdView.setUint16(6, 0, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, localSize, true); // 中央目录起始 = 本地区总长
  eocdView.setUint16(20, 0, true);

  const bytes = concat([...localParts, ...centralParts, eocd], localSize + centralSize + eocd.length);
  // 必须是恰好尺寸的 buffer，否则写入端会多写尾部的空字节
  return bytes.buffer as ArrayBuffer;
}

/* ---------------------------------------------------------------- 入口 */

export function buildXlsx(sheets: XlsxSheet[], now: Date = new Date()): ArrayBuffer {
  const used = new Set<string>();
  const safeSheets = sheets.length ? sheets : [{ name: '空', rows: [['暂无数据']] }];
  const names = safeSheets.map((sheet) => sheetName(sheet.name, used));

  // [Content_Types].xml 必须排在第一条，部分解析器依赖这个顺序
  const files: Array<{ name: string; text: string }> = [
    { name: '[Content_Types].xml', text: contentTypesXml(safeSheets.length) },
    { name: '_rels/.rels', text: rootRelsXml() },
    { name: 'xl/workbook.xml', text: workbookXml(names) },
    { name: 'xl/_rels/workbook.xml.rels', text: workbookRelsXml(safeSheets.length) },
    { name: 'xl/styles.xml', text: stylesXml() },
    ...safeSheets.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      text: sheetXml(sheet),
    })),
  ];

  return buildZip(files, now);
}
