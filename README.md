# OTIS — AI Agent bio landing

Trang bio tĩnh (HTML/CSS/JS thuần, không cần build).

## Chạy thử
Mở bằng một web server (không mở trực tiếp file `index.html`, vì YouTube chặn nhúng khi chạy từ `file://`):

```
python -m http.server 8000
```
rồi vào http://localhost:8000

## Triển khai
Upload nguyên thư mục lên GitHub Pages / Netlify / Vercel / hosting bất kỳ.

## Nhạc nền
Thứ tự ưu tiên:
1. `assets/audio/theme.mp3` — nếu có file này, trang sẽ dùng nó (ổn định nhất, chạy tốt trên điện thoại). File được nén dải động (compressor) nên âm lượng đều suốt bài, và quả cầu/miệng nhân vật nhún theo nhịp nhạc thật.
2. Video YouTube `8SicfKsKh3o` (đổi ở `YT_ID` trong `assets/js/main.js`). Tự phát lại khi hết bài.
3. Nếu YouTube không cho nhúng video, nút nhạc sẽ mở video trên YouTube.

Cân bằng âm lượng cho video YouTube: `MUSIC_LEVELS` trong `assets/js/main.js`.
Mỗi dòng là `[giây, mức 0..1]`. Mặc định đoạn đầu (0–22s) phát 100%, từ giây 26 trở đi giảm còn 60% để nghe đều với đoạn đầu.
Nếu đoạn nhỏ kéo dài hơn/ngắn hơn, sửa số 22 và 26; nếu vẫn chênh, giảm 0.6 xuống (ví dụ 0.5).

## Avatar
Avatar là một cảnh nhiều lớp trong `assets/avatar/` (thân, đầu từ ảnh tham chiếu của Otis; hai tay `claw-l/claw-r` là găng da đen + cổ tay áo + ống tay áo của Otis, tạo dáng móng vuốt theo ảnh tay minh hoạ) + hố đen 3D vẽ bằng Three.js (`initBlackHole` trong `assets/js/main.js`).
Di chuột để kéo hố đen; hai tay, đầu và mắt nhân vật bám theo.
`assets/avatar.jpg` là ảnh tĩnh của cảnh đó, dùng cho favicon, ảnh chia sẻ và đĩa nhạc.

## Sửa nội dung
- Văn bản, liên kết: `index.html`
- Câu chạy chữ ở hero và dòng khởi động: `typerLines`, `bootLines` trong `assets/js/main.js`
- Màu sắc: biến CSS ở đầu `assets/css/style.css`
