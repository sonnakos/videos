# Sonnevend Ákos — videós portfólió

Egyoldalas, statikus portfólió: **egy nyomtatott magazin, amiben mozognak a képek.**
Nincs build-lépés, framework, npm-függőség vagy CDN: `index.html` + `styles.css` + `main.js` (+ `js/` modulok),
`assets/`, `fonts/`. Minden útvonal relatív, így bármilyen statikus tárhelyre feltölthető (Vercel, Cloudflare Pages).

> **Állapot: DRAFT.** A galéria, a REEL-betűk, a portré és a „About” fotó most **helykitöltő** anyag
> (a képkockákon ott a `PLACEHOLDER FOOTAGE` felirat, és az oldal bal alsó sarkában a `DRAFT · PLACEHOLDER FOOTAGE` jelzés).
> A 11. szakasz (videó-lista) üresen érkezett, és a forrásfájlok Ákos gépén vannak. Lásd lent: **Mielőtt élesedik**.

## Helyi előnézet

```bash
node dev-server.mjs          # http://localhost:4174  (Range-kéréseket is kiszolgál, a videókhoz kell)
```

## Mi hol van

| Fájl | Mire való |
|---|---|
| `index.html` | az oldal (fejléc, hero, galéria, rólam, szolgáltatások, kapcsolat, lábléc, projekt-világ) |
| `styles.css` | tokenek (színek, betűk, rács), minden szakasz, mozgás, `prefers-reduced-motion` |
| `main.js`, `js/*.js` | belépési pont + modulok: lejátszás-készlet (max. 6 videó), galéria, projekt-világ, UI |
| `content/projects.json` | **az egyetlen tartalomfájl**: projektek, klip-tartományok, szövegek |
| `assets/clips`, `assets/posters`, `assets/full` | a `tools/clips.mjs` kimenete — kézzel nem kell hozzányúlni |
| `assets/img`, `assets/og-image.jpg`, `assets/qr.svg` | portré, About-fotó, megosztási kép, QR |
| `fonts/` | Anton, Archivo, Playfair Display, Caveat (woff2, helyből) + `glyphs.woff2` (→ ↗ ✓ ✕ ✳ saját rajzolású jelek, hogy iPhone-on se legyen belőlük emoji) |
| `tools/` | klip-, kép-, QR- és ellenőrző szkriptek (lent) |

## Új projekt felvétele (a 11. szakasz helyett)

1. ffmpeg kell: macOS-en `brew install ffmpeg` *(ezt a parancsot itt nem futtattam — a konténer Linux; itt `apt-get install ffmpeg` ment)*.
2. Írd át a `content/projects.json`-t. A helykitöltő projekteket töröld, és projektenként add meg:

```json
{
  "slug": "oom-brand-film",
  "name": "OOM",
  "category": "Brand Film",
  "client": "OOM",
  "featured": true,
  "tiles": 3,
  "cleared": true,
  "accent": "auto",
  "whatIDid": "Edit, colour grade, motion graphics",
  "tools": "DaVinci Resolve, Sony A7, DJI Mini",
  "turnaround": "4 days",
  "summary": "Egy mondat: mit oldott meg ez a videó a megrendelőnek.",
  "source": "OOM FINAL 1.mov",
  "clips": ["47-52", "1:03-1:08", "2:10-2:15"],
  "full": "0-"
}
```

- `sourceDir` (a fájl tetején) legyen `~/Desktop/vids/videos I created`; a `source` ehhez képest relatív.
- `clips`: 2–5 tartomány, egyenként **4–6 mp** (`"47-52"` vagy `"1:03-1:08"`). Az első a galéria-csempe.
- `featured: true` + `tiles: 2–3` → a projekt 2–3 csempét kap; a többi 1-et. 8–12 projektből így lesz 15–20 csempe.
- `full`: csak a kiemelt 2–3 projektnél — `"0-"` az egész fájl, vagy `"12-95"`. Ez hanggal, kezelőgombokkal játszható.
- `accent`: hex (`"#C4563A"`) vagy `"auto"` (a klip első kockájából számolja).
- `cleared: false` → a projekt **nem kerül fel** (jogi kapu: ügyfél-engedély, felismerhető arcok).
- A `media` blokkot a szkript írja — ne szerkeszd.

3. Klipek, poszterek, teljes videók legyártása:

```bash
node tools/clips.mjs              # csak ami hiányzik vagy változott
node tools/clips.mjs --force      # mindent újra
node tools/clips.mjs --dry-run    # csak kiírja az ffmpeg-parancsokat
```

Loop-klip: H.264, hang nélkül (audiosáv törölve), faststart, hosszabb oldal max. 1280 px + 720 px-es mobilváltozat,
poszter az első kockából (WebP). CRF 26; ha 1,5 MB fölé menne, magától CRF 28-cal újrakódol.
A REEL mögötti klipet a `hero` blokk adja: **fekvő**, mozgalmas, nagy kontrasztú felvétel legyen (nem beszélő fej).

A helykitöltőket így gyártottam (a `.placeholder-src/` nincs verziókezelve):

```bash
node tools/make-placeholders.mjs --seed && node tools/clips.mjs
```

## Portré, About-fotó, megosztási kép

```bash
node tools/images.mjs portrait "~/Desktop/FONTOS DOLGOK/Munkás dokumentumok/W Budapest/cv picture.jpg"
node tools/images.mjs about    "<másik fotó>"
node tools/images.mjs og       assets/clips/<erős-klip>.mp4 2      # 1200×630, a 2. másodpercből
```

Nem vág a képből: megtartja az arányt, és az `index.html`-ben a `width`/`height`/`srcset` értéket is átírja (nincs ugrálás betöltéskor).
A portréhoz a 2478×3304-es eredetit használd, ne a CV PDF-ből kivágottat.

## Végleges cím, QR

```bash
python3 -m pip install segno
node tools/set-url.mjs https://a-vegleges-cim.hu/
```

Átírja a `canonical`, `og:url`, `og:image`, `twitter:image` címeket és újragenerálja az `assets/qr.svg`-t.
Most egy szándékosan nem létező helykitöltő cím (`https://sonnevend-portfolio.example/`) van benne.
**QR-kódot ne nyomtass, amíg a cím nem végleges.** Domainváltás után (Vercel → Cloudflare) futtasd újra.

## Ellenőrzés (a 12. szakasz kapui)

```bash
node tools/verify.mjs                  # elindítja a szervert és végigmegy mind a 10 kapun + a projekt-világon
BASE=https://… node tools/verify.mjs   # élesített példányon
```

Playwright kell hozzá (`npm i -g playwright`; az oldalnak magának nincs npm-függősége). Screenshotok és
`report.json` a `qa-report/` mappába. Ha a böngésző nem tud H.264-et (a Playwright saját Chromiuma ilyen),
a szkript a teszt idejére VP9-másolatokat szolgál ki az `.mp4` kérésekre — a szállított fájlokhoz nem nyúl.
Megjegyzés: `node --check main.js` Node 22-n **nem** jelez hibát ES-modul szintaxishibára; a szkript ezért
`node --input-type=module --check`-kel ellenőriz minden modult.

## Élesítés

```bash
npx vercel deploy --prod --yes     # a brief szerinti első kör — itt nem futtattam (nincs Vercel-hozzáférés a konténerben)
```

Cloudflare Pages: ugyanez a mappa feltöltve, build parancs nélkül. Utána `node tools/set-url.mjs <új cím>`.

## Mielőtt élesedik

- [ ] `content/projects.json`: 8–12 valódi projekt, ebből 2–3 `featured` + `full` — a helykitöltők törlése (ekkor eltűnik a DRAFT jelzés)
- [ ] ügyfél-engedély minden ügyfélmunkára (OOM, Geri, VIA, …) és a DR1VN/futóklub arcaira → `cleared`
- [ ] `hero`: fekvő klip a REEL-betűk mögé
- [ ] portré + About-fotó (`tools/images.mjs`), megosztási kép (`og`)
- [ ] kapcsolat: e-mail, Instagram, LinkedIn az `index.html`-ben (most `hello@example.com` / `@handle` helykitöltő)
- [ ] szolgáltatások: a 4 blokk számai (3–5 vágás/hét, 48 óra, 7–10 nap, 5 nap) a briefből jönnek — erősítsd meg
- [ ] az About-szöveg és a hero-leírás az én megfogalmazásom a brief tényeiből — javítsd, ha nem a te hangod
- [ ] végleges cím → `tools/set-url.mjs`
