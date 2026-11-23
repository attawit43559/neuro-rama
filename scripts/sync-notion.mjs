// Pulls the "Neurology Med Rama" handbook from Notion:
//   notion/*.md + notion/manifest.json  ← topic pages (database "หัวข้อในคู่มือ") and the hub page
//   site.json + img/n/*                 ← the "ข้อมูลหน้าเว็บ" tables (faculty, staff, systems, gallery, heads, unit info)
// Runs in GitHub Actions (see .github/workflows/deploy.yml). Needs env NOTION_TOKEN
// (a Notion internal integration connected to the hub page). Node 18+, no dependencies.
//
// Built to survive editors: columns are found by name first and by type second (so renaming a
// column does not break anything), and if a table or the hub cannot be read the previous
// published values are kept instead of blanking the site.

import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'notion');
const IMG = join(ROOT, 'img', 'n');
const TOKEN = process.env.NOTION_TOKEN;
const VERSION = '2026-03-11';

const DS = {
  topics:  'fd50611c-8459-4f2c-b48c-9d5daeeca0c1', // หัวข้อในคู่มือ
  faculty: '4182d8a4-e682-816d-8edf-000bc3030413', // คณาจารย์
  staff:   '4182d8a4-e682-81aa-9fc5-000b56e9b7ee', // เจ้าหน้าที่
  systems: '4182d8a4-e682-816b-b63b-000bd29fc0a1', // ระบบสารสนเทศ
  gallery: '4182d8a4-e682-81d4-92ea-000bb31efcc5', // แกลเลอรีภาพกิจกรรม
  heads:   '4182d8a4-e682-81b2-b817-000bcd3eafa3', // ทำเนียบหัวหน้าหน่วย
  unit:    '4182d8a4-e682-8195-86da-000b4b55bd71', // ข้อมูลหน่วย
};
const HUB = '4142d8a4e6828121922fc3cab1942719';

if (!TOKEN) { console.error('NOTION_TOKEN is not set'); process.exit(1); }

// ---------- Notion API ----------
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
    throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  }
}
async function queryAll(ds) {
  const rows = []; let cursor;
  do {
    const r = await api(`/data_sources/${ds}/query`, { method: 'POST', body: { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) } });
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

// ---------- property helpers: by name, else the only column of that type ----------
const plain = arr => (arr || []).map(t => t.plain_text || '').join('').trim();
function prop(row, names, type) {
  const pr = row.properties || {};
  for (const n of names) if (pr[n] && (!type || pr[n].type === type)) return pr[n];
  if (!type) return undefined;
  const same = Object.values(pr).filter(p => p.type === type);
  return same.length === 1 ? same[0] : undefined;
}
const text = (row, names) => { const p = prop(row, names, 'rich_text'); return p ? plain(p.rich_text) : ''; };
const title = row => { const p = prop(row, [], 'title'); return p ? plain(p.title) : ''; };
const num = (row, names) => { const p = prop(row, names, 'number'); return typeof p?.number === 'number' ? p.number : 99; };
const check = (row, names) => prop(row, names, 'checkbox')?.checkbox === true;
const select = (row, names) => prop(row, names, 'select')?.select?.name || '';
const anyText = (row, names) => { // phone / email / url / text — whichever the column is
  for (const n of names) { const p = row.properties?.[n]; if (!p) continue;
    if (p.type === 'rich_text') return plain(p.rich_text);
    if (['phone_number', 'email', 'url'].includes(p.type)) return p[p.type] || ''; }
  return '';
};
const byOrder = (a, b) => a._o - b._o;
const bare = id => id.replace(/-/g, '');

// ---------- images ----------
const usedImages = new Set();
async function saveImage(row, names, tag) {
  const p = prop(row, names, 'files');
  const f = p?.files?.[0]; if (!f) return '';
  const url = f.type === 'external' ? f.external?.url : f.file?.url;
  if (!url) return '';
  let ext = extname(new URL(url).pathname).toLowerCase();
  if (!/^\.(jpe?g|png|webp|gif|avif)$/.test(ext)) ext = '.jpg';
  const name = `${tag}-${bare(row.id)}${ext}`;
  try {
    const res = await fetch(url); if (!res.ok) throw new Error(res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) throw new Error('image larger than 8 MB');
    await writeFile(join(IMG, name), buf);
  } catch (e) {
    console.warn(`image for "${title(row)}" not downloaded (${e.message}); keeping previous copy if any`);
  }
  usedImages.add(name);
  return 'img/n/' + name;
}

// ---------- unit info table (code -> text) ----------
let unitCache;
async function unitValues() {
  if (unitCache) return unitCache;
  const out = {};
  for (const r of await queryAll(DS.unit)) {
    const key = select(r, ['รหัส']); const val = text(r, ['ค่า', 'ข้อความ']);
    if (key) out[key] = val;
  }
  return (unitCache = out);
}
// "Stroke Unit 2700, 2715 · EMO 1669" (also one per line) -> "Stroke Unit <b>2700, 2715</b> · EMO <b>1669</b>"
function boldNumbers(v) {
  if (/<b>/.test(v)) return v;
  return v.split(/\s*[·•|\n]\s*/).map(x => x.trim()).filter(Boolean).map(part => {
    const m = part.match(/^(.*?\D)\s+(\d[\d,\s\-]*)$/);
    return m ? `${m[1].trim()} <b>${m[2].trim()}</b>` : part;
  }).join(' · ');
}

// ---------- topics + hub ----------
async function syncTopics(prevManifest) {
  const rows = await queryAll(DS.topics);
  if (!rows.length) throw new Error('topics database returned no pages — not touching the site');
  const pages = []; const failed = [];
  for (const row of rows) {
    const id = bare(row.id);
    const page = {
      id, title: title(row),
      icon: row.icon?.type === 'emoji' ? row.icon.emoji : '📄',
      group: select(row, ['หมวด']),
      desc: text(row, ['คำอธิบาย']),
      order: num(row, ['ลำดับ']),
      show: check(row, ['แสดงบนเว็บ']),
    };
    pages.push(page);
    if (!page.title) continue;
    try { await writeFile(join(OUT, id + '.md'), await markdown(row.id)); }
    catch (e) { failed.push(page.title); console.error(`failed: ${page.title}: ${e.message}`); }
  }
  pages.sort((a, b) => a.order - b.order);

  // Hub texts: the "ข้อมูลหน่วย" table is the source (rows coded subtitle / urgent / status).
  // Older layout kept them as lines on the hub page — still read as a fallback.
  const prevHub = prevManifest?.hub || {};
  let hub = { title: 'Neurology Med Rama', subtitle: prevHub.subtitle || '', status: prevHub.status || '', urgent: prevHub.urgent || '' };
  let unit = null;
  try { unit = await unitValues(); } catch (e) { console.warn('ข้อมูลหน่วย not read: ' + e.message); }
  if (unit?.subtitle) hub.subtitle = unit.subtitle;
  if (unit?.urgent) hub.urgent = boldNumbers(unit.urgent);
  if (unit) hub.status = unit.status || '';
  if (!unit?.subtitle || !unit?.urgent) {
    try {
      const lines = (await markdown(HUB)).split('\n');
      const subtitle = (lines[0].match(/<span color="gray">([\s\S]*?)<\/span>/) || [])[1];
      const urgentLine = lines.find(l => /^\s*<b>\s*เบอร์(ด่วน|โทร)/.test(l));
      if (!unit?.subtitle && subtitle) hub.subtitle = subtitle;
      if (!unit?.urgent && urgentLine) hub.urgent = urgentLine.trim().replace(/^<b>[^<]*<\/b>/, '').trim();
    } catch (e) { console.warn('hub not read, keeping previous values: ' + e.message); }
  }

  await writeFile(join(OUT, 'manifest.json'), JSON.stringify({ synced: bangkokNow(), hub, pages }, null, 1) + '\n');
  const keep = new Set(pages.map(p => p.id + '.md'));
  for (const f of await readdir(OUT)) if (/^[0-9a-f]{32}\.md$/.test(f) && !keep.has(f)) { await unlink(join(OUT, f)); console.log('removed', f); }
  const shown = pages.filter(p => p.show && p.title).length;
  return `${pages.length} topic pages (${shown} on the website)` + (failed.length ? `; failed: ${failed.join(', ')}` : '');
}

// ---------- site settings ----------
async function section(name, fn, prev) {
  try { return await fn(); }
  catch (e) { console.warn(`${name}: ${e.message} — keeping previous values`); return prev; }
}
async function syncSite() {
  let prev = {};
  try { prev = JSON.parse(await readFile(join(ROOT, 'site.json'), 'utf8')); } catch {}
  const site = { ...prev };

  const unit = await section('ข้อมูลหน่วย', unitValues, {});
  for (const k of ['unit', 'faculty_name', 'address', 'drive']) if (unit[k]) site[k] = unit[k];

  site.heads = await section('ทำเนียบหัวหน้าหน่วย', async () =>
    (await queryAll(DS.heads)).map(r => ({ _o: num(r, ['ลำดับ']), years: text(r, ['ช่วงปี']), name: title(r) }))
      .filter(h => h.name).sort(byOrder).map(({ _o, ...h }) => h), prev.heads);

  site.faculty = await section('คณาจารย์', async () => {
    const rows = (await queryAll(DS.faculty)).filter(r => check(r, ['แสดงบนเว็บ']) && title(r));
    const people = [];
    for (const r of rows) {
      const group = select(r, ['กลุ่ม']) || 'คณาจารย์';
      people.push({ _o: num(r, ['ลำดับ']), group, name: title(r), area: text(r, ['ความเชี่ยวชาญ']) || group,
        role: text(r, ['ตำแหน่ง']), img: (await saveImage(r, ['รูป'], 'f')) || 'img/logo.jpg' });
    }
    people.sort(byOrder);
    const groups = [];
    for (const p of people) {
      let g = groups.find(x => x.group === p.group); if (!g) groups.push(g = { group: p.group, people: [] });
      const { _o, group, role, ...rest } = p; g.people.push(role ? { ...rest, role } : rest);
    }
    return groups;
  }, prev.faculty);

  site.staff = await section('เจ้าหน้าที่', async () =>
    (await queryAll(DS.staff)).filter(r => check(r, ['แสดงบนเว็บ']) && title(r))
      .map(r => ({ _o: num(r, ['ลำดับ']), name: title(r), role: text(r, ['ตำแหน่ง']), phone: anyText(r, ['โทรศัพท์']),
        email: anyText(r, ['อีเมล']), note: text(r, ['ประสานงานเรื่อง']) }))
      .sort(byOrder).map(({ _o, ...s }) => s), prev.staff);

  site.systems = await section('ระบบสารสนเทศ', async () =>
    (await queryAll(DS.systems)).filter(r => check(r, ['แสดงบนเว็บ']) && title(r))
      .map(r => ({ _o: num(r, ['ลำดับ']), title: title(r), desc: text(r, ['คำอธิบาย']), url: anyText(r, ['ลิงก์']),
        // the row's page icon, when it is an image link, becomes the system's logo on the website
        icon: r.icon?.type === 'external' && /^https:\/\//.test(r.icon.external?.url || '') ? r.icon.external.url : '' }))
      .sort(byOrder).map(({ _o, icon, ...s }) => icon ? { ...s, icon } : s), prev.systems);

  site.gallery = await section('แกลเลอรีภาพกิจกรรม', async () => {
    const rows = (await queryAll(DS.gallery)).filter(r => check(r, ['แสดงบนเว็บ']));
    const items = [];
    for (const r of rows) { const img = await saveImage(r, ['รูป'], 'g'); if (img) items.push({ _o: num(r, ['ลำดับ']), img }); }
    return items.sort(byOrder).map(x => x.img);
  }, prev.gallery);

  // a failed section keeps its old image paths — keep those files too
  for (const p of (site.faculty || []).flatMap(g => g.people)) if (p.img?.startsWith('img/n/')) usedImages.add(p.img.slice(6));
  for (const g of site.gallery || []) if (g.startsWith('img/n/')) usedImages.add(g.slice(6));
  for (const f of await readdir(IMG)) if (!usedImages.has(f)) { await unlink(join(IMG, f)); console.log('removed image', f); }

  await writeFile(join(ROOT, 'site.json'), JSON.stringify(site, null, 1) + '\n');
  return `site: ${(site.faculty || []).reduce((n, g) => n + g.people.length, 0)} faculty, ${(site.staff || []).length} staff, ${(site.systems || []).length} systems, ${(site.gallery || []).length} photos`;
}

function bangkokNow() { return new Date(Date.now() + 7 * 3600e3).toISOString().replace(/\.\d+Z$/, '+07:00'); }

await mkdir(OUT, { recursive: true });
await mkdir(IMG, { recursive: true });
try {
  let prevManifest = null;
  try { prevManifest = JSON.parse(await readFile(join(OUT, 'manifest.json'), 'utf8')); } catch {}
  console.log('synced ' + await syncTopics(prevManifest));
  console.log(await syncSite());
} catch (e) { console.error(e.message); process.exit(1); }
