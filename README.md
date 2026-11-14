# Neurology Ramathibodi · คู่มือแพทย์ประจำบ้าน

เว็บไซต์คู่มือแพทย์ประจำบ้านและแพทย์ประจำบ้านต่อยอด สาขาประสาทวิทยา รามาธิบดี
เนื้อหาแก้ไขใน Notion (หน้า **Neurology Med Rama**) แล้วเว็บอัปเดตอัตโนมัติทุกชั่วโมง (นาทีที่ 13) ระหว่าง 06.13–18.13 น.

## ส่วนประกอบ

| ไฟล์ | หน้าที่ | แก้ที่ไหน |
| --- | --- | --- |
| `notion/*.md`, `notion/manifest.json` | เนื้อหาคู่มือ | **Notion** (ไฟล์นี้ถูกเขียนทับทุกครั้งที่ซิงก์) |
| `site.json`, `img/n/` | คณาจารย์ เจ้าหน้าที่ ระบบสารสนเทศ แกลเลอรี ทำเนียบหัวหน้าหน่วย ข้อมูลหน่วย | **Notion** หน้า "ข้อมูลหน้าเว็บ" (เขียนทับทุกครั้งที่ซิงก์) |
| `img/` (นอก `img/n/`) | รูปตกแต่งเว็บ เช่น hero, โลโก้ | ผู้ดูแลเว็บ |
| `index.html` | หน้าตาและการทำงานของเว็บ | ผู้ดูแลเว็บ |
| `scripts/sync-notion.mjs` | ตัวดึงข้อมูลจาก Notion | ผู้ดูแลเว็บ |

## ซิงก์ทันที

แท็บ **Actions** → **Sync from Notion and publish** → **Run workflow**

## ตั้งค่าครั้งแรก

1. สร้าง Notion integration (Internal) ที่ notion.so/profile/integrations ให้สิทธิ์ Read content แล้วคัดลอก token
2. ใน Notion เปิดหน้า **Neurology Med Rama** → ••• → Connections → เพิ่ม integration ที่สร้าง
3. ใน GitHub: Settings → Secrets and variables → Actions → New repository secret ชื่อ `NOTION_TOKEN` ใส่ token
4. Settings → Pages → Source: **GitHub Actions**
