# Persiapan NSIS Installer untuk GrandMA2 Hub

Rencana ini merangkum semua modifikasi kode dan struktur yang diperlukan untuk mengubah aplikasi GrandMA2 Hub menjadi Installer profesional (`.exe` setup) yang siap didistribusikan, memaketkan *source code*, dan menyimpan konfigurasi dengan aman.

## Metadata Aplikasi (Final)
1. **Nama Author:** zokuse
2. **Deskripsi:** "A smart utility and bridge application for managing the MA Lighting GrandMA2 console."
3. **App ID:** `com.zokuse.grandma2hub` (Ini adalah ID unik Windows, bukan berarti Anda harus punya website/domain asli. Ini hanya format standar agar sistem Windows tidak tertukar dengan aplikasi lain).

---

## Perubahan yang Diajukan (Proposed Changes)

### 1. Migrasi Data ke AppData (Backend)

#### [MODIFY] [backend/MA2Client.js](file:///c:/Users/zokuse/Documents/GrandMA2%20Hubs%20Master/GrandMA2%20Hub%20(Electron)/backend/MA2Client.js)
- Mengimpor `app` dari modul `electron`.
- Memperbarui properti `this.configFile` dan `this.fixtureSpecsFile` agar menggunakan `app.getPath('userData')` yang mengarah ke `AppData/Roaming/grandma2-hub-electron`.
- Menambahkan skrip migrasi otomatis. Jika file konfigurasi lama ditemukan di `os.homedir()`, sistem akan memindahkannya ke `userData`.

#### [MODIFY] [backend/ipcHandlers.js](file:///c:/Users/zokuse/Documents/GrandMA2%20Hubs%20Master/GrandMA2%20Hub%20(Electron)/backend/ipcHandlers.js)
- Memperbarui `dmxDictPath` menggunakan `app.getPath('userData')`.
- Memastikan logika *fallback* migrasi otomatis dari `os.homedir()` juga diterapkan.

---

### 2. Fitur Profesional & Pembaruan Otomatis (Auto-Updater)

#### [MODIFY] [main.js](file:///c:/Users/zokuse/Documents/GrandMA2%20Hubs%20Master/GrandMA2%20Hub%20(Electron)/main.js)
- **Single Instance Lock:** Menambahkan kode `app.requestSingleInstanceLock()` agar aplikasi hanya bisa dibuka satu per satu. Jika *user* mencoba membuka aplikasi kedua kali, jendela yang sudah terbuka akan dimunculkan ke depan.
- **Auto-Updater:** Mengintegrasikan `electron-updater` (misalnya `autoUpdater.checkForUpdatesAndNotify()`) agar aplikasi bisa mengecek versi baru di latar belakang saat dijalankan.
- Memastikan struktur `asar` untuk pemanggilan HTML tetap aman.

---

### 3. Konfigurasi Installer & Metadata

#### [MODIFY] [package.json](file:///c:/Users/zokuse/Documents/GrandMA2%20Hubs%20Master/GrandMA2%20Hub%20(Electron)/package.json)
- Menghapus dependensi `electron-packager` dan menginstal `electron-builder` & `electron-updater`.
- Menambahkan blok metadata dasar: `author`, `description`, `build.appId`.
- Menambahkan konfigurasi khusus `electron-builder` (`"build"`):
  - Mengaktifkan pemaketan source code (`"asar": true`).
  - Menambahkan konfigurasi untuk Auto-Updater (opsi `"publish"` ke GitHub/lainnya).
  - Mengonfigurasi target Windows: `"win": { "target": "nsis", "icon": "assets/icon.ico" }`.
  - Mengonfigurasi NSIS: `"nsis": { "oneClick": false, "allowToChangeInstallationDirectory": true, "deleteAppDataOnUninstall": false }`. (Fitur `deleteAppDataOnUninstall: false` memastikan konfigurasi pengguna tetap utuh saat aplikasi di-uninstall).
  - Menyesuaikan blok `"scripts"` menjadi `"build-installer": "electron-builder --win"`.

---

## Verifikasi Akhir
Setelah semua di atas diubah, langkah akhirnya adalah:
1. Menjalankan `npm install`.
2. Menjalankan perintah `npm run build-installer`.
3. Menguji file installer `.exe` yang dihasilkan.
