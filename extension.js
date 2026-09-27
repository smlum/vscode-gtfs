// @ts-check
const path = require('path');
const vscode = require('vscode');
const SCHEMA = require('./schema/gtfs-schema.json');

const MAX_PROBLEMS = 100;
const PATTERNS = Object.fromEntries(
  Object.entries(SCHEMA.fieldTypes).filter(([, t]) => t.pattern).map(([name, t]) => [name, new RegExp(t.pattern)])
);

/** Split a CSV line into fields, keeping each field's start/end offset. Quote-aware. */
function splitFields(line) {
  const fields = [];
  let start = 0;
  let inQuotes = false;
  for (let i = 0; i <= line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (i === line.length || (ch === ',' && !inQuotes)) {
      fields.push({ start, end: i, text: unquote(line.slice(start, i).trim()) });
      start = i + 1;
    }
  }
  return fields;
}

/** "a ""b""" -> a "b" */
function unquote(s) {
  return s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1).replace(/""/g, '"') : s;
}

/** Schema fields for a file, e.g. stops.txt -> SCHEMA.tables.stops.fields (undefined if not a GTFS table). */
function tableFields(fileName) {
  return SCHEMA.tables[path.basename(fileName, '.txt')]?.fields;
}

/** Header cells, ignoring a UTF-8 byte order mark at the start of the file. */
function splitHeader(headerLine) {
  return splitFields(headerLine.replace(/^﻿/, ''));
}

/** One line describing an enum cell, e.g. `3` → **Bus**. */
function describeCode(code, field) {
  if (code === '' && field.whenEmpty) return `(blank) → **${field.whenEmpty.label}** (default)`;
  if (code === '') return '(blank)';
  const label = field.values[code];
  return label ? `\`${code}\` → **${label}**` : `\`${code}\` is not a standard value`;
}

/** Hover text for the cell under the cursor, from the file name (table) and header row (column). */
function hoverText(fileName, headerLine, line, lineNumber, character) {
  const fields = tableFields(fileName);
  if (!fields) return;
  const header = splitHeader(headerLine);
  const cells = splitFields(line);
  const i = cells.findIndex((c) => character >= c.start && character <= c.end);
  if (i < 0 || !header[i]) return;

  const column = header[i].text;
  const field = fields[column];
  if (!field) return { cell: cells[i], text: `**${column}** is not a standard column in this file` };

  const lines = [`**${column}** · ${field.type}` + (field.required ? ` · required: ${field.required}` : '')];
  if (field.values && lineNumber === 0) {
    lines.push(Object.entries(field.values).map(([code, label]) => `\`${code}\` ${label}`).join(' · '));
  } else if (field.values) {
    lines.push(describeCode(cells[i].text, field));
  }
  if (field.condition) lines.push(field.condition);
  return { cell: cells[i], text: lines.join('\n\n') };
}

/** What's wrong with one cell, as [severity, message], or undefined if it looks fine. */
function checkValue(value, field) {
  if (value === '') return field.required === 'always' && !field.whenEmpty ? ['error', 'required value is blank'] : undefined;
  if (field.values) return field.values[value] ? undefined : ['warning', `${value} is not a standard value`];
  const type = SCHEMA.fieldTypes[field.type] ?? {};
  if (PATTERNS[field.type] && !PATTERNS[field.type].test(value)) return ['warning', `${value} is not a valid ${field.type}`];
  if ('minimum' in type && isNaN(Number(value))) return ['warning', `${value} is not a valid ${field.type}`];
  if ('minimum' in type && !(Number(value) >= type.minimum && Number(value) <= type.maximum)) {
    return ['warning', `${value} is outside ${type.minimum} to ${type.maximum}`];
  }
}

/** Problems in a GTFS file, as { line, start, end, severity, message }. Stops after MAX_PROBLEMS. */
function findProblems(fileName, lines) {
  const fields = tableFields(fileName);
  if (!fields || lines.length === 0) return [];
  const header = splitHeader(lines[0]);
  const problems = [];
  const add = (line, range, severity, message) => problems.push({ line, start: range.start, end: range.end, severity, message });

  for (const [column, field] of Object.entries(fields)) {
    if (field.required === 'always' && !header.some((h) => h.text === column)) {
      add(0, { start: 0, end: lines[0].length }, 'error', `Missing required column ${column}`);
    }
  }
  for (const h of header) {
    if (!fields[h.text]) add(0, h, 'info', `${h.text} is not a standard column in this file`);
  }

  for (let n = 1; n < lines.length && problems.length < MAX_PROBLEMS; n++) {
    if (lines[n].trim() === '') continue;
    const cells = splitFields(lines[n]);
    if (cells.length !== header.length) {
      add(n, { start: 0, end: lines[n].length }, 'warning', `Row has ${cells.length} cells, header has ${header.length}`);
    }
    cells.forEach((cell, i) => {
      const field = fields[header[i]?.text];
      const problem = field && checkValue(cell.text, field);
      if (problem) add(n, cell, problem[0], `${header[i].text}: ${problem[1]}`);
    });
  }
  return problems.slice(0, MAX_PROBLEMS);
}

function activate(context) {
  const diagnostics = vscode.languages.createDiagnosticCollection('gtfs');
  const severity = {
    error: vscode.DiagnosticSeverity.Error,
    warning: vscode.DiagnosticSeverity.Warning,
    info: vscode.DiagnosticSeverity.Information,
  };

  function validate(document) {
    if (document.languageId !== 'gtfs') return;
    if (!vscode.workspace.getConfiguration('gtfs').get('validation.enabled')) return diagnostics.delete(document.uri);
    const problems = findProblems(document.fileName, document.getText().split(/\r?\n/));
    diagnostics.set(document.uri, problems.map((p) => {
      const d = new vscode.Diagnostic(new vscode.Range(p.line, p.start, p.line, p.end), p.message, severity[p.severity]);
      d.source = 'gtfs';
      return d;
    }));
  }

  let timer;
  context.subscriptions.push(
    diagnostics,
    vscode.languages.registerHoverProvider('gtfs', {
      provideHover(document, position) {
        const hover = hoverText(document.fileName, document.lineAt(0).text, document.lineAt(position.line).text, position.line, position.character);
        if (!hover) return;
        const range = new vscode.Range(position.line, hover.cell.start, position.line, hover.cell.end);
        return new vscode.Hover(new vscode.MarkdownString(hover.text), range);
      },
    }),
    vscode.workspace.onDidOpenTextDocument(validate),
    vscode.workspace.onDidChangeTextDocument((e) => {
      clearTimeout(timer);
      timer = setTimeout(() => validate(e.document), 300);
    }),
    vscode.workspace.onDidCloseTextDocument((document) => diagnostics.delete(document.uri)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('gtfs.validation')) vscode.workspace.textDocuments.forEach(validate);
    })
  );
  vscode.workspace.textDocuments.forEach(validate);
}

module.exports = { activate, splitFields, hoverText, findProblems };
