// Pulls the "Neurology Med Rama" handbook from Notion into notion/*.md + notion/manifest.json.
// Runs in GitHub Actions (see .github/workflows/deploy.yml). Needs env NOTION_TOKEN
// (a Notion internal integration that has been connected to the hub page).
// Node 18+ (uses built-in fetch). No dependencies.

import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'notion');
const TOKEN = process.env.NOTION_TOKEN;
const DATA_SOURCE = process.env.NOTION_DATA_SOURCE || 'fd50611c-8459-4f2c-b48c-9d5daeeca0c1'; // "หัวข้อในคู่มือ"
const HUB = process.env.NOTION_HUB_PAGE || '4142d8a4e6828121922fc3cab1942719';            // "Neurology Med Rama"
const VERSION = '2026-03-11';

if (!TOKEN) { console.error('NOTION_TOKEN is not set'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(path, { method = 'GET', body } = {}) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch('https://api.notion.com/v1' + path, {
      method,
      headers: { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': VERSION, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return res.json();
    const text = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 1500 * attempt;
      console.warn(`${method} ${path} -> ${res.status}, retry in ${wait} ms`);
      await sleep(wait); continue;
    }
    throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  }
}

const plain = arr => (arr || []).map(t => t.plain_text || '').join('').trim();
const bare = id => id.replace(/-/g, '');

async function queryPages() {
  const rows = []; let cursor;
  do {
    const r = await api(`/data_sources/${DATA_SOURCE}/query`, { method: 'POST', body: { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) } });
    rows.push(...r.results); cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return rows.filter(p => p.object === 'page' && !p.in_trash && !p.archived);
}

async function markdown(pageId) {
  const r = await api(`/pages/${pageId}/markdown?markdown_version=v2`);
  if (r.truncated) console.warn(`page ${pageId}: content truncated by Notion`);
  if (r.unknown_block_ids?.length) console.warn(`page ${pageId}: ${r.unknown_block_ids.length} block(s) not exported`);
  return String(r.markdown || '').replace(/^\n/, '').replace(/\n$/, '');
}

function bangkokNow() {
  const d = new Date(Date.now() + 7 * 3600e3);
  return d.toISOString().replace(/\.\d+Z$/, '+07:00');
}

async function main() {
  const rows = await queryPages();
  if (!rows.length) throw new Error('database query returned no pages — not touching the site');

  const pages = []; const failed = [];
  for (const row of rows) {
    const id = bare(row.id); const pr = row.properties || {};
    const page = {
      id,
      title: plain(pr['ชื่อหัวข้อ']?.title),
      icon: row.icon?.type === 'emoji' ? row.icon.emoji : '📄',
      group: pr['หมวด']?.select?.name || '',
      desc: plain(pr['คำอธิบาย']?.rich_text),
      order: typeof pr['ลำดับ']?.number === 'number' ? pr['ลำดับ'].number : 99,
      show: pr['แสดงบนเว็บ']?.checkbox === true,
    };
    pages.push(page);
    if (!page.title) continue; // untitled drafts are never shown
    try { await writeFile(join(OUT, id + '.md'), await markdown(row.id)); }
    catch (e) { failed.push(page.title); console.error(`failed: ${page.title}: ${e.message}`); }
  }
  pages.sort((a, b) => a.order - b.order);

  const hubMd = await markdown(HUB);
  const lines = hubMd.split('\n');
  const head = lines.slice(0, 3).join('\n');
  const subtitle = (lines[0].match(/<span color="gray">([\s\S]*?)<\/span>/) || [])[1] || '';
  const status = ((head.match(/<span color="orange">([\s\S]*?)<\/span>/) || [])[1] || '').replace(/^●\s*/, '').trim();
  const urgentLine = lines.find(l => l.trim().startsWith('<b>เบอร์ด่วน</b>')) || '';
  const urgent = urgentLine.trim().replace(/^<b>เบอร์ด่วน<\/b>/, '').trim();

  const manifest = { synced: bangkokNow(), hub: { title: 'Neurology Med Rama', subtitle, status, urgent }, pages };
  await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');

  // remove files of pages deleted from Notion
  const keep = new Set(pages.map(p => p.id + '.md'));
  for (const f of await readdir(OUT)) if (/^[0-9a-f]{32}\.md$/.test(f) && !keep.has(f)) { await unlink(join(OUT, f)); console.log('removed', f); }

  const shown = pages.filter(p => p.show && p.title).length;
  console.log(`synced ${pages.length} pages (${shown} on the website, ${pages.length - shown} hidden)${failed.length ? '; failed: ' + failed.join(', ') : ''}`);
}

await mkdir(OUT, { recursive: true });
main().catch(e => { console.error(e.message); process.exit(1); });
