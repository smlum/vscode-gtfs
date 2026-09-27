// @ts-check
const path = require('path');
const vscode = require('vscode');
const SCHEMA = require('./schema/gtfs-schema.json');

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

/** One line describing an enum cell, e.g. `3` → **Bus**. */
function describeCode(code, field) {
  if (code === '' && field.whenEmpty) return `(blank) → **${field.whenEmpty.label}** (default)`;
  if (code === '') return '(blank)';
  const label = field.values[code];
  return label ? `\`${code}\` → **${label}**` : `\`${code}\` is not a standard value`;
}

/** Hover text for the cell under the cursor, from the file name (table) and header row (column). */
function hoverText(fileName, headerLine, line, lineNumber, character) {
  const fields = SCHEMA.tables[path.basename(fileName, '.txt')]?.fields;
  if (!fields) return;
  const header = splitFields(headerLine.replace(/^﻿/, ''));
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

function activate(context) {
  context.subscriptions.push(
    vscode.languages.registerHoverProvider('gtfs', {
      provideHover(document, position) {
        const hover = hoverText(document.fileName, document.lineAt(0).text, document.lineAt(position.line).text, position.line, position.character);
        if (!hover) return;
        const range = new vscode.Range(position.line, hover.cell.start, position.line, hover.cell.end);
        return new vscode.Hover(new vscode.MarkdownString(hover.text), range);
      },
    })
  );
}

module.exports = { activate, splitFields, hoverText };
