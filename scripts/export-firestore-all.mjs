#!/usr/bin/env node

import { createSign } from 'node:crypto';
import { once } from 'node:events';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FIRESTORE_API_BASE = 'https://firestore.googleapis.com/v1';
const DEFAULT_PAGE_SIZE = 1000;
const MAX_RETRIES = 4;

export function parseArguments(argv) {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = resolve(scriptDirectory, '..');
  const defaultOutput = resolve(
    repositoryRoot,
    '..',
    'cms_manager_order',
    'storage',
    'app',
    'legacy',
  );

  const options = {
    credentials: process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
    project: '',
    database: '(default)',
    output: defaultOutput,
    include: [],
    exclude: [],
    pageSize: DEFAULT_PAGE_SIZE,
    help: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];

    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }

    const [name, inlineValue] = argument.split('=', 2);
    const value = inlineValue ?? argv[index + 1];

    if (['--credentials', '--project', '--database', '--output', '--include', '--exclude', '--page-size'].includes(name)) {
      if (inlineValue === undefined) {
        index++;
      }

      if (!value) {
        throw new Error(`Thiếu giá trị cho ${name}.`);
      }

      switch (name) {
        case '--credentials':
          options.credentials = value;
          break;
        case '--project':
          options.project = value;
          break;
        case '--database':
          options.database = value;
          break;
        case '--output':
          options.output = value;
          break;
        case '--include':
          options.include.push(...splitCollectionList(value));
          break;
        case '--exclude':
          options.exclude.push(...splitCollectionList(value));
          break;
        case '--page-size':
          options.pageSize = Number.parseInt(value, 10);
          break;
      }

      continue;
    }

    throw new Error(`Tùy chọn không được hỗ trợ: ${argument}`);
  }

  options.credentials = options.credentials ? resolve(options.credentials) : '';
  options.output = resolve(options.output);
  options.include = [...new Set(options.include)];
  options.exclude = [...new Set(options.exclude)];

  if (!Number.isInteger(options.pageSize) || options.pageSize < 1 || options.pageSize > 1000) {
    throw new Error('--page-size phải là số nguyên từ 1 đến 1000.');
  }

  return options;
}

function splitCollectionList(value) {
  return String(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

export function safeCollectionFileName(collectionId) {
  const safe = String(collectionId).replace(/[<>:"/\\|?*\u0000-\u001F]/g, character => {
    return `%${character.codePointAt(0).toString(16).toUpperCase().padStart(2, '0')}`;
  });

  return safe.replace(/[. ]+$/g, suffix => {
    return [...suffix]
      .map(character => `%${character.codePointAt(0).toString(16).toUpperCase().padStart(2, '0')}`)
      .join('');
  });
}

function base64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function createSignedJwt(credentials) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({
    iss: credentials.client_email,
    scope: FIRESTORE_SCOPE,
    aud: TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3600,
  }));
  const unsignedToken = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsignedToken);
  signer.end();

  return `${unsignedToken}.${base64Url(signer.sign(credentials.private_key))}`;
}

function loadCredentials(path) {
  if (!path) {
    throw new Error(
      'Thiếu Service Account. Truyền --credentials hoặc đặt GOOGLE_APPLICATION_CREDENTIALS.',
    );
  }

  if (!existsSync(path)) {
    throw new Error(`Không tìm thấy file Service Account: ${path}`);
  }

  let credentials;

  try {
    credentials = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Không đọc được Service Account JSON: ${error.message}`);
  }

  for (const field of ['client_email', 'private_key', 'project_id']) {
    if (!credentials[field]) {
      throw new Error(`Service Account thiếu trường ${field}.`);
    }
  }

  return credentials;
}

function createTokenProvider(credentials) {
  let cached = null;

  return async function getAccessToken() {
    const now = Math.floor(Date.now() / 1000);

    if (cached && cached.expiresAt - 300 > now) {
      return cached.token;
    }

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: createSignedJwt(credentials),
      }),
    });

    const payload = await readJsonResponse(response);

    if (!response.ok || !payload.access_token) {
      throw new Error(
        `Không lấy được Google access token (${response.status}): ${formatApiError(payload)}`,
      );
    }

    cached = {
      token: payload.access_token,
      expiresAt: now + Number(payload.expires_in || 3600),
    };

    return cached.token;
  };
}

async function readJsonResponse(response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function formatApiError(payload) {
  return payload?.error?.message
    || payload?.error_description
    || payload?.raw
    || JSON.stringify(payload);
}

function sleep(milliseconds) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));
}

async function firestoreRequest(url, options, getAccessToken) {
  let lastError;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const token = await getAccessToken();
      const response = await fetch(url, {
        ...options,
        headers: {
          authorization: `Bearer ${token}`,
          ...(options.headers || {}),
        },
      });
      const payload = await readJsonResponse(response);

      if (response.ok) {
        return payload;
      }

      const retryable = response.status === 429 || response.status >= 500;
      const message = `Firestore API ${response.status}: ${formatApiError(payload)}`;

      if (!retryable || attempt === MAX_RETRIES - 1) {
        throw new Error(message);
      }

      lastError = new Error(message);
    } catch (error) {
      lastError = error;

      if (attempt === MAX_RETRIES - 1) {
        throw error;
      }
    }

    await sleep(500 * 2 ** attempt);
  }

  throw lastError;
}

async function listTopLevelCollections({ projectId, database, pageSize, getAccessToken }) {
  const collectionIds = [];
  let pageToken = '';
  const encodedProject = encodeURIComponent(projectId);
  const encodedDatabase = encodeURIComponent(database);
  const url = `${FIRESTORE_API_BASE}/projects/${encodedProject}/databases/${encodedDatabase}/documents:listCollectionIds`;

  do {
    const payload = await firestoreRequest(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          pageSize,
          ...(pageToken ? { pageToken } : {}),
        }),
      },
      getAccessToken,
    );

    collectionIds.push(...(payload.collectionIds || []));
    pageToken = payload.nextPageToken || '';
  } while (pageToken);

  return [...new Set(collectionIds)].sort((left, right) => left.localeCompare(right));
}

async function exportCollection({
  collectionId,
  projectId,
  database,
  outputDirectory,
  pageSize,
  getAccessToken,
}) {
  const fileName = `${safeCollectionFileName(collectionId)}.ndjson`;
  const outputPath = resolve(outputDirectory, fileName);
  const temporaryPath = `${outputPath}.tmp`;
  const stream = createWriteStream(temporaryPath, { encoding: 'utf8' });
  const encodedProject = encodeURIComponent(projectId);
  const encodedDatabase = encodeURIComponent(database);
  const encodedCollection = encodeURIComponent(collectionId);
  const baseUrl = `${FIRESTORE_API_BASE}/projects/${encodedProject}/databases/${encodedDatabase}/documents/${encodedCollection}`;
  let pageToken = '';
  let count = 0;

  try {
    do {
      const query = new URLSearchParams({ pageSize: String(pageSize) });

      if (pageToken) {
        query.set('pageToken', pageToken);
      }

      const payload = await firestoreRequest(
        `${baseUrl}?${query.toString()}`,
        { method: 'GET' },
        getAccessToken,
      );

      for (const document of payload.documents || []) {
        const documentId = String(document.name || '').split('/').at(-1) || '';
        const row = {
          _collection: collectionId,
          document_id: documentId,
          ...document,
        };

        if (!stream.write(`${JSON.stringify(row)}\n`)) {
          await once(stream, 'drain');
        }

        count++;
      }

      pageToken = payload.nextPageToken || '';
    } while (pageToken);

    stream.end();
    await once(stream, 'finish');
    renameSync(temporaryPath, outputPath);
  } catch (error) {
    stream.destroy();
    rmSync(temporaryPath, { force: true });
    throw error;
  }

  return {
    collection: collectionId,
    file: fileName,
    path: outputPath,
    records: count,
  };
}

function printHelp() {
  console.log(`Xuất toàn bộ collection Firestore thành các file NDJSON.\n\nCách dùng:\n  node scripts/export-firestore-all.mjs --credentials <service-account.json> [options]\n\nTùy chọn:\n  --credentials <path>   File Service Account JSON. Có thể dùng GOOGLE_APPLICATION_CREDENTIALS.\n  --project <id>         Firebase project ID. Mặc định lấy từ Service Account.\n  --database <id>        Firestore database ID. Mặc định: (default).\n  --output <path>        Thư mục xuất file. Mặc định: ../cms_manager_order/storage/app/legacy.\n  --include <a,b,c>      Chỉ xuất các collection được liệt kê.\n  --exclude <a,b,c>      Bỏ qua các collection được liệt kê.\n  --page-size <1-1000>   Số document mỗi trang. Mặc định: 1000.\n  --help                 Hiển thị hướng dẫn.\n\nVí dụ PowerShell:\n  $env:GOOGLE_APPLICATION_CREDENTIALS="C:\\keys\\service-account.json"\n  node scripts/export-firestore-all.mjs\n`);
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);

  if (options.help) {
    printHelp();
    return;
  }

  const credentials = loadCredentials(options.credentials);
  const projectId = options.project || credentials.project_id;
  const getAccessToken = createTokenProvider(credentials);
  mkdirSync(options.output, { recursive: true });

  console.log(`Firebase project: ${projectId}`);
  console.log(`Firestore database: ${options.database}`);
  console.log(`Thư mục đầu ra: ${options.output}`);
  console.log('Đang đọc danh sách collection...');

  const discovered = await listTopLevelCollections({
    projectId,
    database: options.database,
    pageSize: options.pageSize,
    getAccessToken,
  });
  const include = new Set(options.include);
  const exclude = new Set(options.exclude);
  const collections = discovered.filter(collectionId => {
    if (include.size > 0 && !include.has(collectionId)) {
      return false;
    }

    return !exclude.has(collectionId);
  });

  if (collections.length === 0) {
    throw new Error('Không tìm thấy collection phù hợp để xuất.');
  }

  console.log(`Tìm thấy ${collections.length} collection cần xuất.`);
  const results = [];

  for (let index = 0; index < collections.length; index++) {
    const collectionId = collections[index];
    process.stdout.write(`[${index + 1}/${collections.length}] ${collectionId}: `);

    const result = await exportCollection({
      collectionId,
      projectId,
      database: options.database,
      outputDirectory: options.output,
      pageSize: options.pageSize,
      getAccessToken,
    });

    results.push(result);
    console.log(`${result.records} bản ghi → ${result.file}`);
  }

  const manifest = {
    project_id: projectId,
    database: options.database,
    exported_at: new Date().toISOString(),
    output_directory: options.output,
    total_collections: results.length,
    total_records: results.reduce((total, item) => total + item.records, 0),
    collections: results.map(({ collection, file, records }) => ({
      collection,
      file,
      records,
    })),
  };
  const manifestPath = resolve(options.output, 'firestore-export-manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log('');
  console.log(`Hoàn tất: ${manifest.total_collections} collection, ${manifest.total_records} bản ghi.`);
  console.log(`Manifest: ${manifestPath}`);
}

const isDirectExecution = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  main().catch(error => {
    console.error(`Xuất Firestore thất bại: ${error.message}`);
    process.exitCode = 1;
  });
}
