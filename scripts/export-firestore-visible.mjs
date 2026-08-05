#!/usr/bin/env node

import { once } from 'node:events';
import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
  main as exportAllFirestore,
  parseArguments,
} from './export-firestore-all.mjs';

const HIDDEN_STATUSES = new Set([
  'deleted',
  'inactive',
  'da xoa',
  'ngung hoat dong',
]);

const GENERATED_MANIFESTS = new Set([
  'firestore-export-manifest.json',
  'visible-export-manifest.json',
]);

function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

function firestoreBoolean(fields, names) {
  for (const name of names) {
    const field = fields?.[name];

    if (field && Object.prototype.hasOwnProperty.call(field, 'booleanValue')) {
      return field.booleanValue === true;
    }
  }

  return undefined;
}

function firestoreString(fields, names) {
  for (const name of names) {
    const field = fields?.[name];

    if (field && Object.prototype.hasOwnProperty.call(field, 'stringValue')) {
      return String(field.stringValue ?? '');
    }
  }

  return '';
}

export function isVisibleFirestoreDocument(document) {
  const fields = document?.fields ?? {};
  const deleted = firestoreBoolean(fields, ['deleted', 'isDeleted', 'is_deleted']);
  const active = firestoreBoolean(fields, ['active', 'isActive', 'is_active']);
  const status = normalizeText(firestoreString(fields, [
    'status',
    'lifecycleStatus',
    'lifecycle_status',
  ]));

  if (deleted === true) {
    return false;
  }

  if (active === false) {
    return false;
  }

  if (HIDDEN_STATUSES.has(status)) {
    return false;
  }

  return true;
}

export function clearGeneratedExportFiles(outputDirectory) {
  mkdirSync(outputDirectory, { recursive: true });
  const removed = [];

  for (const file of readdirSync(outputDirectory)) {
    const lower = file.toLowerCase();
    const generated = lower.endsWith('.ndjson')
      || lower.endsWith('.ndjson.visible.tmp')
      || GENERATED_MANIFESTS.has(lower);

    if (!generated) {
      continue;
    }

    rmSync(resolve(outputDirectory, file), { force: true, recursive: true });
    removed.push(file);
  }

  return removed.sort((left, right) => left.localeCompare(right));
}

async function filterNdjsonFile(path) {
  const temporaryPath = `${path}.visible.tmp`;
  const input = createReadStream(path, { encoding: 'utf8' });
  const output = createWriteStream(temporaryPath, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let scanned = 0;
  let kept = 0;
  let skipped = 0;

  try {
    for await (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      scanned++;
      const row = JSON.parse(line);

      if (!isVisibleFirestoreDocument(row)) {
        skipped++;
        continue;
      }

      if (!output.write(`${JSON.stringify(row)}\n`)) {
        await once(output, 'drain');
      }

      kept++;
    }

    output.end();
    await once(output, 'finish');
    renameSync(temporaryPath, path);
  } catch (error) {
    lines.close();
    input.destroy();
    output.destroy();
    rmSync(temporaryPath, { force: true });
    throw error;
  }

  return { scanned, kept, skipped };
}

function updateManifest(outputDirectory, statistics, removedFiles) {
  const manifestPath = resolve(outputDirectory, 'firestore-export-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const byFile = new Map(statistics.map(item => [item.file, item]));

  manifest.filter = {
    mode: 'visible_records_only',
    cleared_previous_export_files: removedFiles,
    rules: [
      'deleted/isDeleted/is_deleted phải khác true',
      'active/isActive/is_active phải khác false',
      'status/lifecycle_status không thuộc deleted, inactive, đã xóa, ngừng hoạt động',
      'document thiếu các field trên vẫn được giữ để tương thích dữ liệu legacy',
      'collection không còn bản ghi hiển thị sẽ không tạo file NDJSON',
      'file NDJSON và manifest của lần xuất trước được xóa trước khi bắt đầu',
    ],
  };
  manifest.total_scanned_records = statistics.reduce((total, item) => total + item.scanned, 0);
  manifest.total_skipped_records = statistics.reduce((total, item) => total + item.skipped, 0);
  manifest.total_records = statistics.reduce((total, item) => total + item.kept, 0);
  manifest.collections = (manifest.collections || []).map(item => {
    const stat = byFile.get(item.file);

    if (!stat) {
      return item;
    }

    return {
      ...item,
      scanned_records: stat.scanned,
      skipped_records: stat.skipped,
      records: stat.kept,
      file_present: stat.filePresent,
    };
  });

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return manifest;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);

  if (options.help) {
    await exportAllFirestore(argv);
    console.log('');
    console.log('Lệnh này xóa file export cũ, xuất lại và chỉ giữ document đang hiển thị.');
    return;
  }

  const removedFiles = clearGeneratedExportFiles(options.output);

  if (removedFiles.length > 0) {
    console.log(`Đã xóa ${removedFiles.length} file export cũ trong ${options.output}.`);
  }

  await exportAllFirestore(argv);

  console.log('');
  console.log('Đang lọc các document đã xóa hoặc ngừng hoạt động...');

  const files = readdirSync(options.output)
    .filter(file => file.toLowerCase().endsWith('.ndjson'))
    .sort((left, right) => left.localeCompare(right));
  const statistics = [];

  for (const file of files) {
    const path = resolve(options.output, file);
    const stat = await filterNdjsonFile(path);
    const filePresent = stat.kept > 0;

    if (!filePresent) {
      rmSync(path, { force: true });
    }

    statistics.push({ file, ...stat, filePresent });

    if (filePresent) {
      console.log(`${file}: giữ ${stat.kept}/${stat.scanned}, loại ${stat.skipped}`);
    } else {
      console.log(`${file}: không còn bản ghi hiển thị, đã bỏ file (${stat.scanned} bản ghi bị loại)`);
    }
  }

  const manifest = updateManifest(options.output, statistics, removedFiles);

  console.log('');
  console.log(
    `Hoàn tất lọc: giữ ${manifest.total_records}/${manifest.total_scanned_records} bản ghi, `
    + `loại ${manifest.total_skipped_records} bản ghi không còn hiển thị.`,
  );
}

const isDirectExecution = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  main().catch(error => {
    console.error(`Xuất dữ liệu đang hiển thị thất bại: ${error.message}`);
    process.exitCode = 1;
  });
}
