# Neurology Ramathibodi · คู่มือแพทย์ประจำบ้าน

เว็บไซต์คู่มือแพทย์ประจำบ้านและแพทย์ประจำบ้านต่อยอด สาขาประสาทวิทยา รามาธิบดี
เนื้อหาแก้ไขใน Notion (หน้า **Neurology Med Rama**) แล้วเว็บอัปเดตอัตโนมัติทุกวันก่อน 06.00 น.

## ส่วนประกอบ

| ไฟล์ | หน้าที่ | แก้ที่ไหน |
| --- | --- | --- |
| `notion/*.md`, `notion/manifest.json` | เนื้อหาคู่มือ | **Notion** (ไฟล์นี้ถูกเขียนทับทุกครั้งที่ซิงก์) |
| `site.json` | คณาจารย์ เจ้าหน้าที่ แกลเลอรี ลิงก์ระบบต่าง ๆ | แก้ในไฟล์นี้ |
| `img/` | รูปภาพ | อัปโหลดไฟล์ใหม่ทับชื่อเดิม |
| `index.html` | หน้าตาและการทำงานของเว็บ | ผู้ดูแลเว็บ |
| `scripts/sync-notion.mjs` | ตัวดึงข้อมูลจาก Notion | ผู้ดูแลเว็บ |

## ซิงก์ทันที

แท็บ **Actions** → **Sync from Notion and publish** → **Run workflow**

## ตั้งค่าครั้งแรก

1. สร้าง Notion integration (Internal) ที่ notion.so/profile/integrations ให้สิทธิ์ Read content แล้วคัดลอก token
2. ใน Notion เปิดหน้า **Neurology Med Rama** → ••• → Connections → เพิ่ม integration ที่สร้าง
3. ใน GitHub: Settings → Secrets and variables → Actions → New repository secret ชื่อ `NOTION_TOKEN` ใส่ token
4. Settings → Pages → Source: **GitHub Actions**
