# Sonnevend Ákos — videós portfólió

Egyoldalas, statikus portfólió: **egy nyomtatott magazin, amiben mozognak a képek.**
Nincs build-lépés, framework, npm-függőség vagy CDN: `index.html` + `styles.css` + `main.js` (+ `js/` modulok),
`assets/`, `fonts/`. Minden útvonal relatív, így bármilyen statikus tárhelyre feltölthető (Vercel, Cloudflare Pages).

> **Állapot: DRAFT.** A galéria, a címlap-videó, a portré és a „About” fotó most **helykitöltő** anyag
> (a képkockákon ott a `PLACEHOLDER FOOTAGE` felirat, és az oldal bal alsó sarkában a `DRAFT · PLACEHOLDER CONTENT` jelzés).
> A 11. szakasz (videó-lista) üresen érkezett, és a forrásfájlok Ákos gépén vannak. Lásd lent: **Mielőtt élesedik**.

## Helyi előnézet

```bash
node dev-server.mjs          # http://localhost:4174  (Range-kéréseket is kiszolgál, a videókhoz kell)
```

## Mi hol van

| Fájl | Mire való |
|---|---|
| `index.html` | az oldal (fejléc, hero, galéria, rólam, kapcsolat, lábléc, projekt-világ) |
| `styles.css` | tokenek (színek, betűk, rács), minden szakasz, mozgás, `prefers-reduced-motion` |
| `main.js`, `js/*.js` | belépési pont + modulok: lejátszás-készlet (max. 6 videó), galéria, projekt-világ, UI |
| `content/projects.json` | **ezt szerkeszted**: projektek, forrásfájlok, klip-tartományok, szövegek — *nem kerül ki az oldalra* |
| `content/site.json` | a `tools/clips.mjs` generálja belőle: csak az engedélyezett projektek, forrásútvonalak nélkül — **ezt olvassa az oldal** |
| `assets/clips`, `assets/posters`, `assets/full` | a `tools/clips.mjs` kimenete — kézzel nem kell hozzányúlni |
| `assets/img`, `assets/og-image.jpg`, `assets/qr.svg` | portré, About-fotó, megosztási kép, QR |
| `assets/tex/` | papírszemcse, filmszemcse (a sötét vetítéshez), raszterpontos terrakotta kör — `python3 -m pip install pillow && python3 tools/make-textures.py` |
| `fonts/` | Anton, Archivo, Playfair Display, Caveat (woff2, helyből) + `glyphs.woff2` (→ ↗ ✓ ✕ ✳ saját rajzolású jelek, hogy iPhone-on se legyen belőlük emoji) |
| `tools/` | klip-, kép-, QR- és ellenőrző szkriptek (lent) |

## Ami az egérre reagál

- **Címlap:** a reel finoman elcsúszik a kereten belül az egér felé (csak `transform`, rAF-ben, és leáll, ha az egér nem mozog). Érintőképernyőn és csökkentett mozgásnál kikapcsol. Alatta futó SMPTE-időkód (25 fps), képkockánként frissül.
- **Kontaktlap:** a kiválasztott képkockát (hover vagy billentyűs fókusz) piros zsírkréta-karika keríti be — ahogy a fotós bekarikázza a kontaktlapon, amit nagyítani akar. Három kézzel rajzolt változat, képkockánként rögzített dőléssel.
- **Fejléc:** a ✳ egy nyolcadot fordul hoverre.

A szemcse csak a papíron és a sötét vetítésen van, a videók fölött nincs — azok élesek maradnak.

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
  "tools": "<szoftver, kamera>",
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
- `cleared: false` → a projekt **lekerül**: a `clips.mjs` törli a már legyártott klipjeit, posztereit, teljes videóját, és kihagyja a `site.json`-ból (jogi kapu: ügyfél-engedély, felismerhető arcok).
- A `media` blokkot a szkript írja — ne szerkeszd.
- A szkript előbb az egész fájlt ellenőrzi (slugok, tartományok, színek), és csak hibátlan fájlnál kezd kódolni. Ha kódolás közben egy projekt elhasal, a többi eredménye megmarad.

3. Klipek, poszterek, teljes videók legyártása:

```bash
node tools/clips.mjs              # csak ami hiányzik vagy változott
node tools/clips.mjs --force      # mindent újra
node tools/clips.mjs --dry-run    # csak kiírja az ffmpeg-parancsokat
```

Loop-klip: H.264, hang nélkül (audiosáv törölve), faststart, hosszabb oldal max. 1280 px + 720 px-es mobilváltozat,
poszter az első kockából (WebP). CRF 26; ha 1,5 MB fölé menne, magától CRF 28-cal újrakódol. Kisebb forrást nem nagyít fel.
Teljes videó: max. 1920 px, CRF 23, legfeljebb 3 Mbit/s — egy 60–90 mp-es film így 25 MiB körül marad (a Cloudflare Pages ennél nagyobb fájlt nem fogad; a szkript szól, ha túllépi).
A címlap-videót a `hero` blokk adja: **fekvő** (16:9), mozgalmas felvétel legyen (nem beszélő fej) — a `clips.mjs` az `index.html`-ben a kerete méretét is hozzáigazítja.

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

Playwright kell hozzá: `npm i -g playwright && npx playwright install chromium` (az oldalnak magának nincs npm-függősége). *Itt a konténerben a Chromium előre telepítve volt, a `playwright install` lépést nem futtattam.* Screenshotok és
`report.json` a `qa-report/` mappába. Ha a böngésző nem tud H.264-et (a Playwright saját Chromiuma ilyen),
a szkript a teszt idejére VP9-másolatokat szolgál ki az `.mp4` kérésekre — a szállított fájlokhoz nem nyúl.
Megjegyzés: `node --check main.js` Node 22-n **nem** jelez hibát ES-modul szintaxishibára; a szkript ezért
`node --input-type=module --check`-kel ellenőriz minden modult.

## Élesítés

```bash
npx vercel deploy --prod --yes     # a brief szerinti első kör — itt nem futtattam (nincs Vercel-hozzáférés a konténerben)
```

A `.vercelignore` kihagyja a szerkesztő-oldali fájlokat (`content/projects.json`, `tools/`, README, dev-server), így
a forrásfájl-nevek és a még nem engedélyezett projektek adatai nem kerülnek ki.
Cloudflare Pages: build parancs nélkül, de **csak ezeket** töltsd fel: `index.html`, `styles.css`, `main.js`, `js/`,
`fonts/`, `assets/`, `content/site.json`. Utána `node tools/set-url.mjs <új cím>`.

## Mielőtt élesedik

- [ ] `content/projects.json`: 8–12 valódi projekt, ebből 2–3 `featured` + `full` — a helykitöltők törlése (ekkor eltűnik a DRAFT jelzés)
- [ ] ügyfél-engedély minden ügyfélmunkára (OOM, Geri, VIA, …) és a DR1VN/futóklub arcaira → `cleared`
- [ ] `hero`: fekvő (16:9) klip a címlapra — a showreeled legerősebb 4–6 másodperce
- [ ] a kapcsolat előtti piros blokk klipje: alapból az első kiemelt projekt utolsó klipje; másikat a `projects.json` tetején adhatsz meg: `"bandClip": "<slug>:<klip sorszáma 0-tól>"`
- [ ] portré + About-fotó (`tools/images.mjs`), megosztási kép (`og`)
- [ ] kapcsolat: e-mail, Instagram, LinkedIn és a START A PROJECT gomb e-mailje az `index.html`-ben (most `hello@example.com` / `@handle` helykitöltő — a DRAFT jelzés addig kint marad, és a `verify.mjs` is kiírja)
- [ ] a bemutatkozó mondat („Every second has to earn the next.”), a hero-leírás és az About-szöveg vázlat: szándékosan nincs benne évszám, felszerelés, lakóhely vagy tagszám — írd át a saját hangodra, és csak igaz adat kerüljön bele
- [ ] végleges cím → `tools/set-url.mjs`
