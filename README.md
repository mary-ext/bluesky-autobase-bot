# Bluesky autobase bot example

## Indonesia

1. Install [Bun](https://bun.sh/)
2. Install dependencies (`bun install`)
3. Copy `.env` ke `.env.local`
4. Buat kata sandi aplikasi
   1. Lanjut ke Preferensi -> Kata sandi Aplikasi -> Tambahkan kata sandi aplikasi
   2. Centang akses ke DM
   3. Isi `ACCOUNT_IDENTIFIER` dan `ACCOUNT_PASSWORD` dengan kata sandi yang dibuat
5. Ambil DID akun pemilik (untuk nyala/matikan bot)\
   DID adalah identifikasi akun unik yang tidak berubah walaupun ganti username
   1. Buka [internect.info](https://internect.info/)
   2. Masukkan username/domain akun pemilik
   3. Isi `OWNER_DID` dengan hasil DID yang didapat
6. Jalani bot nya (`bun start`)

Bot mengirim postingan dengan awalan yang ditentukan `MENFESS_PREFIX`.

Bot akan langsung memonitorkan DM ketika dijalankan, yang bisa diatur dengan `MENFESS_WATCH_AT_LAUNCH`, ubah
ke `false` untuk tidak langsung monitor.

Monitoring bisa dimatikan dan dinyalakan saat beroperasi, dengan perintah yang ditentukan di
`MENFESS_TOGGLE_COMMAND`, perintah hanya akan diterima dari akun yang disebutkan `OWNER_DID`.

`MENFESS_REPORT_AT_LAUNCH` mengatur jika bot nya perlu melaporkan status monitoring ke pemilik akun
(`OWNER_DID`) saat dijalankan, bermanfaat sebagai pengingat. Ubah ke `false` jika tidak perlu.
