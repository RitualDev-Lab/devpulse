/**
 * Zero-dependency Edge-Compatible Source Map v3 (VLQ) & Rust DWARF Symbolicator
 * Decodes minified JS/Next.js/Vite/Electron stack traces and Rust symbol maps
 * back to original source files, line numbers, columns, symbols, and code frames.
 */

export interface SourceMapV3 {
  version: number;
  file?: string;
  debugId?: string;
  debug_id?: string;
  sourceRoot?: string;
  sources: string[];
  sourcesContent?: Array<string | null>;
  names?: string[];
  mappings: string;
}

export interface RustDwarfSymbol {
  address?: string | number;
  addr?: string | number;
  function?: string;
  fn?: string;
  symbol?: string;
  file: string;
  line: number;
  column?: number;
  context?: string[];
}

export interface RustDwarfMap {
  format?: string;
  symbols: RustDwarfSymbol[];
}

export interface SourceContextLine {
  lineNumber: number;
  code: string;
  isTarget: boolean;
}

export interface SymbolicatedFrame {
  raw: string;
  symbolicated: boolean;
  kind: "sourcemap" | "rust-dwarf" | "raw";
  generatedFile?: string;
  generatedLine?: number;
  generatedColumn?: number;
  originalFile?: string;
  originalLine?: number;
  originalColumn?: number;
  functionName?: string;
  mapFileUsed?: string;
  codeContext?: SourceContextLine[];
}

export interface SymbolicationResult {
  frames: SymbolicatedFrame[];
  decodedTrace: string;
  totalFrames: number;
  symbolicatedCount: number;
  matchedMaps: string[];
}

interface DecodedSegment {
  generatedColumn: number;
  sourceIndex?: number;
  originalLine?: number;
  originalColumn?: number;
  nameIndex?: number;
}

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const CHAR_TO_INT = new Map<string, number>(
  Array.from(BASE64_CHARS).map((ch, idx) => [ch, idx])
);

function decodeVlqSegment(segment: string): number[] {
  const values: number[] = [];
  let i = 0;

  while (i < segment.length) {
    let result = 0;
    let shift = 0;
    let continuation = true;

    while (continuation && i < segment.length) {
      const digit = CHAR_TO_INT.get(segment[i++]);
      if (digit === undefined) {
        throw new Error(`Invalid Base64 VLQ character in source map`);
      }
      continuation = (digit & 32) !== 0;
      result += (digit & 31) << shift;
      shift += 5;
    }

    const isNegative = (result & 1) === 1;
    const shifted = result >> 1;
    values.push(isNegative ? -shifted : shifted);
  }

  return values;
}

/**
 * Look up a 1-based generated line & column inside a Source Map v3 JSON object.
 */
export function decodeSourceMapPosition(
  map: SourceMapV3,
  generatedLine: number,
  generatedColumn: number
): {
  source: string;
  line: number;
  column: number;
  name?: string;
  codeContext?: SourceContextLine[];
} | null {
  if (!map || map.version !== 3 || typeof map.mappings !== "string") {
    return null;
  }

  const targetLineZero = generatedLine - 1;
  const targetColZero = Math.max(0, generatedColumn - 1);
  if (targetLineZero < 0) return null;

  const lines = map.mappings.split(";");
  if (targetLineZero >= lines.length) return null;

  // Source Map v3 maintains cumulative state across lines for sourceIndex, originalLine, originalColumn, nameIndex
  let sourceIndex = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let nameIndex = 0;

  let lineSegments: DecodedSegment[] = [];

  for (let l = 0; l <= targetLineZero; l++) {
    let generatedColumnState = 0;
    const rawLine = lines[l];
    if (!rawLine) {
      if (l === targetLineZero) lineSegments = [];
      continue;
    }

    const parts = rawLine.split(",");
    const currentSegments: DecodedSegment[] = [];

    for (const part of parts) {
      if (!part) continue;
      const fields = decodeVlqSegment(part);
      if (fields.length === 0) continue;

      generatedColumnState += fields[0];
      const seg: DecodedSegment = { generatedColumn: generatedColumnState };

      if (fields.length >= 4) {
        sourceIndex += fields[1];
        originalLine += fields[2];
        originalColumn += fields[3];
        seg.sourceIndex = sourceIndex;
        seg.originalLine = originalLine;
        seg.originalColumn = originalColumn;

        if (fields.length >= 5) {
          nameIndex += fields[4];
          seg.nameIndex = nameIndex;
        }
      }

      currentSegments.push(seg);
    }

    if (l === targetLineZero) {
      lineSegments = currentSegments;
    }
  }

  if (lineSegments.length === 0) return null;

  // Find segment with largest generatedColumn <= targetColZero
  let best: DecodedSegment | null = null;
  for (const seg of lineSegments) {
    if (seg.generatedColumn <= targetColZero) {
      best = seg;
    } else {
      break;
    }
  }

  if (!best || best.sourceIndex === undefined || best.originalLine === undefined) {
    return null;
  }

  const rawSource = map.sources?.[best.sourceIndex] || "unknown";
  const prefix = map.sourceRoot ? `${map.sourceRoot.replace(/\/$/, "")}/` : "";
  const fullSource = `${prefix}${rawSource}`.replace(/^webpack:\/\/[^/]*\//, "");
  const origLineOne = best.originalLine + 1;
  const origColOne = (best.originalColumn ?? 0) + 1;
  const name =
    best.nameIndex !== undefined ? map.names?.[best.nameIndex] : undefined;

  let codeContext: SourceContextLine[] | undefined;
  const sourceText = map.sourcesContent?.[best.sourceIndex];
  if (typeof sourceText === "string") {
    const srcLines = sourceText.split(/\r?\n/);
    const startIdx = Math.max(0, origLineOne - 3);
    const endIdx = Math.min(srcLines.length - 1, origLineOne + 1);
    codeContext = [];
    for (let idx = startIdx; idx <= endIdx; idx++) {
      codeContext.push({
        lineNumber: idx + 1,
        code: srcLines[idx] ?? "",
        isTarget: idx + 1 === origLineOne,
      });
    }
  }

  return {
    source: fullSource,
    line: origLineOne,
    column: origColOne,
    name,
    codeContext,
  };
}

function normalizePath(p: string): string {
  return p
    .split("?")[0]
    .split("#")[0]
    .replace(/^file:\/\//i, "")
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/^webpack-internal:\/\/\/(\([^)]+\)\/)?/, "")
    .replace(/^\/+/, "")
    .replace(/\\/g, "/");
}

function findMatchingMap<T extends { filePath: string; parsed?: SourceMapV3 }>(
  generatedFile: string,
  entries: T[],
  stackDebugIds?: Set<string>
): T | null {
  // 0. TC39 ECMA-426 Debug ID exact match (beats filename/CDN hash variations)
  if (stackDebugIds && stackDebugIds.size > 0) {
    for (const entry of entries) {
      const mapDebugId = (entry.parsed?.debugId || entry.parsed?.debug_id || "").toLowerCase();
      if (mapDebugId && stackDebugIds.has(mapDebugId)) {
        return entry;
      }
    }
  }

  const normGen = normalizePath(generatedFile);
  const genBase = normGen.split("/").pop() || normGen;
  const expectedMapName = normGen.endsWith(".map") ? normGen : `${normGen}.map`;
  const expectedBaseMap = genBase.endsWith(".map") ? genBase : `${genBase}.map`;

  // 1. Exact suffix match on path + .map
  for (const entry of entries) {
    const mapNorm = normalizePath(entry.filePath);
    if (mapNorm === expectedMapName || mapNorm.endsWith(`/${expectedMapName}`)) {
      return entry;
    }
  }

  // 2. Basename match
  for (const entry of entries) {
    const mapBase = normalizePath(entry.filePath).split("/").pop() || "";
    if (mapBase === expectedBaseMap) {
      return entry;
    }
  }

  return null;
}

function parseAddress(addr?: string | number): number | null {
  if (typeof addr === "number" && Number.isFinite(addr)) return addr;
  if (typeof addr !== "string") return null;
  const cleaned = addr.trim();
  if (!cleaned) return null;
  const parsed = cleaned.startsWith("0x") || cleaned.startsWith("0X")
    ? Number.parseInt(cleaned.slice(2), 16)
    : Number.parseInt(cleaned, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveRustDwarfFrame(
  rawLine: string,
  dwarfMaps: Array<{ filePath: string; parsed: RustDwarfMap }>
): SymbolicatedFrame | null {
  const addrMatch = rawLine.match(/\b(0x[0-9a-fA-F]+)\b/);
  const targetAddr = addrMatch ? parseAddress(addrMatch[1]) : null;
  const fnMatch = rawLine.match(/-\s*([A-Za-z0-9_:$<>]+)\s*(?:\+|$)/);
  const targetFn = fnMatch?.[1];

  if (targetAddr === null && !targetFn) return null;

  for (const dMap of dwarfMaps) {
    const syms = dMap.parsed.symbols || [];
    if (targetAddr !== null) {
      let exactOrNearest: { sym: RustDwarfSymbol; dist: number } | null = null;
      for (const sym of syms) {
        const symAddr = parseAddress(sym.address ?? sym.addr);
        if (symAddr === null) continue;
        if (symAddr <= targetAddr) {
          const dist = targetAddr - symAddr;
          if (dist <= 0x1000 && (!exactOrNearest || dist < exactOrNearest.dist)) {
            exactOrNearest = { sym, dist };
          }
        }
      }
      if (exactOrNearest) {
        const s = exactOrNearest.sym;
        return {
          raw: rawLine,
          symbolicated: true,
          kind: "rust-dwarf",
          originalFile: s.file,
          originalLine: s.line,
          originalColumn: s.column ?? 1,
          functionName: s.function || s.fn || s.symbol || targetFn,
          mapFileUsed: dMap.filePath,
          codeContext: s.context?.map((code, idx) => ({
            lineNumber: Math.max(1, s.line - Math.floor((s.context?.length || 1) / 2) + idx),
            code,
            isTarget: idx === Math.floor((s.context?.length || 1) / 2),
          })),
        };
      }
    }

    if (targetFn) {
      const matched = syms.find(
        (s) => (s.function || s.fn || s.symbol) === targetFn
      );
      if (matched) {
        return {
          raw: rawLine,
          symbolicated: true,
          kind: "rust-dwarf",
          originalFile: matched.file,
          originalLine: matched.line,
          originalColumn: matched.column ?? 1,
          functionName: targetFn,
          mapFileUsed: dMap.filePath,
        };
      }
    }
  }

  return null;
}

/**
 * Symbolicate a multi-line stack trace against uploaded Source Map v3 and Rust DWARF symbol artifacts.
 */
export function symbolicateStackTrace(
  stackTrace: string,
  artifacts: Array<{ filePath: string; content: string }>
): SymbolicationResult {
  const jsMaps: Array<{ filePath: string; parsed: SourceMapV3 }> = [];
  const dwarfMaps: Array<{ filePath: string; parsed: RustDwarfMap }> = [];

  for (const art of artifacts) {
    try {
      const json = JSON.parse(art.content);
      if (json && json.version === 3 && typeof json.mappings === "string") {
        jsMaps.push({ filePath: art.filePath, parsed: json as SourceMapV3 });
      } else if (json && Array.isArray(json.symbols)) {
        dwarfMaps.push({ filePath: art.filePath, parsed: json as RustDwarfMap });
      }
    } catch {
      // Ignore malformed artifact JSON
    }
  }

  const lines = (stackTrace || "").split(/\r?\n/);
  const stackDebugIds = new Set<string>();
  for (const m of (stackTrace || "").matchAll(/debugId[=:]\s*([0-9a-f-]{8,36})/gi)) {
    stackDebugIds.add(m[1].toLowerCase());
  }
  const frames: SymbolicatedFrame[] = [];
  const matchedSet = new Set<string>();
  let symbolicatedCount = 0;

  // Matches JS/TS frames:
  //   at fnName (file.js:12:34)
  //   at file.js:12:34
  //   fnName@https://host/file.js:12:34
  const jsParenRe = /^\s*at\s+([^\s(]+)\s+\((.+):(\d+):(\d+)\)\s*$/;
  const jsBareRe = /^\s*at\s+(.+):(\d+):(\d+)\s*$/;
  const ffSafariRe = /^\s*([^@]*)@(.+):(\d+):(\d+)\s*$/;

  for (const raw of lines) {
    const trimmed = raw.trimEnd();
    if (!trimmed) continue;

    let fnName: string | undefined;
    let genFile: string | undefined;
    let genLine: number | undefined;
    let genCol: number | undefined;

    const m1 = trimmed.match(jsParenRe);
    if (m1) {
      fnName = m1[1];
      genFile = m1[2];
      genLine = Number(m1[3]);
      genCol = Number(m1[4]);
    } else {
      const m2 = trimmed.match(jsBareRe);
      if (m2) {
        genFile = m2[1];
        genLine = Number(m2[2]);
        genCol = Number(m2[3]);
      } else {
        const m3 = trimmed.match(ffSafariRe);
        if (m3) {
          fnName = m3[1] || undefined;
          genFile = m3[2];
          genLine = Number(m3[3]);
          genCol = Number(m3[4]);
        }
      }
    }

    if (genFile && genLine && genCol) {
      const candidate = findMatchingMap(genFile, jsMaps, stackDebugIds);
      if (candidate) {
        const decoded = decodeSourceMapPosition(candidate.parsed, genLine, genCol);
        if (decoded) {
          matchedSet.add(candidate.filePath);
          symbolicatedCount++;
          frames.push({
            raw: trimmed,
            symbolicated: true,
            kind: "sourcemap",
            generatedFile: genFile,
            generatedLine: genLine,
            generatedColumn: genCol,
            originalFile: decoded.source,
            originalLine: decoded.line,
            originalColumn: decoded.column,
            functionName: decoded.name || fnName,
            mapFileUsed: candidate.filePath,
            codeContext: decoded.codeContext,
          });
          continue;
        }
      }
    }

    // Try Rust DWARF symbol resolution
    if (dwarfMaps.length > 0) {
      const rustFrame = resolveRustDwarfFrame(trimmed, dwarfMaps);
      if (rustFrame) {
        if (rustFrame.mapFileUsed) matchedSet.add(rustFrame.mapFileUsed);
        symbolicatedCount++;
        frames.push(rustFrame);
        continue;
      }
    }

    frames.push({
      raw: trimmed,
      symbolicated: false,
      kind: "raw",
      generatedFile: genFile,
      generatedLine: genLine,
      generatedColumn: genCol,
      functionName: fnName,
    });
  }

  const decodedTrace = frames
    .map((f) => {
      if (!f.symbolicated) return f.raw;
      const fnPart = f.functionName ? `${f.functionName} ` : "";
      return `    at ${fnPart}(${f.originalFile}:${f.originalLine}:${f.originalColumn || 1}) [decoded via ${f.mapFileUsed}]`;
    })
    .join("\n");

  return {
    frames,
    decodedTrace,
    totalFrames: frames.length,
    symbolicatedCount,
    matchedMaps: Array.from(matchedSet),
  };
}
