# Deep Tourism – Dubai Desert Safari Landing Page (practice)

- `index.html` – standalone page (browser me seedha khulta hai)
- `elementor-embed.html` – Elementor/WordPress ke **HTML widget** me paste karne ke liye (head/body tags nahi)

CSS `#dt` ke andar scoped hai, isliye Elementor/theme ki styling se nahi bigadti.

## Elementor me lagane ka tarika
1. Section/Container ko **Full Width** karo, padding 0.
2. HTML widget me `elementor-embed.html` ka poora code paste karo.
3. Video/photos ke liye script ke upar wale `DT` config me URL daalo (neeche dekho).

## Video / photos kaise lagayein
Pinterest/Instagram links embed nahi hote. Sahi tareeka:
- **MP4:** WordPress → Media → Add New → upload → "File URL" copy → `DT.hero.mp4` ya `DT.slides[n].mp4` me paste.
- **YouTube:** video ID ko `yt` me daalo (autoplay muted loop).
- **Photo:** Media Library URL ko `img` me daalo.

## Practice-only data
Prices, reviews, ratings/numbers, licence no., WhatsApp number (`DT.WA`), offer counter (`left`) sab sample hain.
