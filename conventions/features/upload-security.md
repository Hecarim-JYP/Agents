# 레시피: 업로드 파일 내용 검사 — 형식 판정·메타데이터 제거·안전한 서빙 `[대외]`

> 확정: 2026-10-16 | 원칙: express.md 6절(저장 경로·메타 쌍·크기 상한) | 테이블: `schemas/03_files.sql` | 짝: security-headers.md, public-id.md(파일 URL), excel-upload.md(엑셀 파싱)
> 확장자와 `Content-Type`은 **보낸 사람이 정한 값**이다. 형식은 **파일 내용(매직 바이트)** 으로 판정하고, 이미지는 **다시 인코딩해 메타데이터를 버리고**, 내려줄 때는 **브라우저가 문서로 실행하지 못하게** 한다.

## 1. 언제 쓰나

이용자가 올린 파일을 다시 내려받거나 화면에 표시하는 모든 경우. **3-3절(서빙)은 사내 시스템도 해당**한다 — 같은 출처에서 문서로 열린 파일은 우리 화면과 같은 권한(쿠키·API)으로 실행된다.

## 2. 결정 항목 (기본값)

| 결정 | 기본값 | 대안 / 비고 |
|---|---|---|
| 허용 형식 | **기능별 화이트리스트** (예: 프로필 = jpeg·png·webp, 첨부 = pdf·xlsx·docx + 이미지) | 블랙리스트 금지 |
| 이미지 처리 | **재인코딩** — 회전 반영 + 메타데이터 제거 | 원본이 증빙이면(사고 사진 등) 원본은 다운로드 전용으로 따로 두고 표시용 사본만 재인코딩 |
| 픽셀 상한 | **5천만 픽셀**(약 8000×6000 — 48MP 휴대폰 사진까지) | 서비스가 받는 최대 해상도로 명시. sharp 기본은 약 2.68억 |
| 화면 표시(inline) | **래스터 이미지(jpeg·png·gif·webp)만** | 그 외는 전부 다운로드(attachment) |
| SVG | **받지 않는다** | 꼭 받아야 하면 attachment + CSP sandbox로만 내려주고 화면에는 `<img>`로만 표시 |
| 악성코드 검사 | **다른 이용자에게 전달되는 파일이면** ClamAV(clamd) — 3-4절 | 서명 DB가 최신인지(freshclam)와 EICAR 검출을 도입 시 운영 환경에서 확인 |
| 저장 위치 | 웹 루트 밖 + 앱이 권한 확인 후 내려준다 (express.md 6절) | 대규모 대외 서비스는 이용자 파일 전용 도메인으로 분리하면 3-3절 위험이 출처째 격리된다 |

## 3. 표준 설계

### 3-1. 형식 판정 — 내용으로

```js
import { fileTypeFromBuffer } from 'file-type';                 // ESM 전용 (19.x 실측, 22.x에서 같은 API 재확인 2026-10-19)

/** 기능별 허용 형식 — 판정은 파일 내용(매직 바이트)으로, 확장자·Content-Type은 보지 않는다 */
const ALLOWED_MIME = {
  profile:    ['image/jpeg', 'image/png', 'image/webp'],
  attachment: ['application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
               'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png'],
};

const detected = await fileTypeFromBuffer(buffer);
if (!detected || !ALLOWED_MIME[purpose].includes(detected.mime)) {
  throw new BadRequestError('UNSUPPORTED_FILE_TYPE', '허용하지 않는 파일 형식입니다');
}
// files.mime_type·저장 확장자는 판정 결과(detected.mime / detected.ext)로 기록한다 — 보낸 값이 아니라
```

- 실측 2026-10-16 (file-type 19): 파일명 `evil.png` + `Content-Type: image/png`로 보낸 HTML → **판정 불가**(거부) / 진짜 PNG → `image/png` / ExcelJS가 만든 xlsx → xlsx / PDF → pdf.
- **CSV·TXT는 매직 바이트가 없어 판정되지 않는다**(실측: csv → 판정 불가) — 텍스트 형식은 파서가 실제로 읽어 보는 것이 검사다(excel-upload.md). 판정 불가를 일괄 거부하면 CSV 업로드가 막히므로 기능별로 분기한다.

### 3-2. 이미지 재인코딩

```js
import sharp from 'sharp';

const output = await sharp(buffer, { limitInputPixels: 50_000_000 })   // 압축 폭탄 — 상한 초과는 즉시 거부
  .rotate()                // EXIF 방향을 픽셀에 반영 — 메타데이터를 버려도 사진이 눕지 않는다
  .toFormat(detected.ext)  // 판정된 형식 그대로(jpg·png·webp) — 출력에 메타데이터를 싣지 않는다(sharp 기본)
  .toBuffer();
```

- **메타데이터 제거**: GPS가 든 JPEG(EXIF 322바이트) → 재인코딩 후 EXIF **없음** (실측 2026-10-16, sharp 0.33). 위 코드 그대로 jpg·png·webp 각각 EXIF 0바이트, png·webp 투명도 유지. 휴대폰 사진의 촬영 위치·기기 정보가 그대로 공개되는 것을 막는다.
- **`rotate()`를 빼면 사진이 눕는다** — 세로 사진은 "가로 픽셀 + 90도 돌려 보여라" 표시로 저장되는 경우가 많다. 메타데이터만 버리면 그 표시가 사라져 옆으로 누운 채 보인다 (실측: 픽셀 80×40 + Orientation 6 → 메타데이터만 제거 시 80×40 그대로 / `rotate()` 후 40×80).
- **압축 폭탄**: 파일은 작고 픽셀만 큰 이미지 — 16000×16000 단색 PNG는 **758KB**인데 처리에 **618ms**, 4건 동시면 최대 RSS **416MB** (실측). `limitInputPixels`로 상한을 서비스에 맞게 낮추면 2ms 만에 거부된다.

### 3-3. 서빙 — 문서로 실행되지 않게

| 파일 | 응답 헤더 |
|---|---|
| 래스터 이미지 (inline 허용) | `Content-Type: <저장된 mime_type>` · `X-Content-Type-Options: nosniff` · `Content-Security-Policy: default-src 'none'; sandbox` |
| 그 외 전부 | 위 3개 + `Content-Disposition: attachment; filename*=UTF-8''<원본 파일명>` |

- 실측 2026-10-16 (Chromium) — 스크립트가 든 SVG를 같은 출처에서 내려줄 때:
  - 우리 화면의 `<img>`로 표시 → 스크립트 **미실행**
  - **링크로 직접 열기(새 탭) → 스크립트 실행, 우리 출처 쿠키를 읽음** (`document.cookie` → `sid=SESSION-SECRET`)
  - `CSP: … sandbox` 추가 → 미실행 / `attachment` + `nosniff` → 문서로 열리지 않고 다운로드
- 같은 헤더(`default-src 'none'; sandbox` + `nosniff`)를 붙여도 정상 이미지는 `<img>`와 직접 열기 모두 정상 표시된다 (실측: 둘 다 naturalWidth 30).
- 다운로드는 권한 검사 후 DB에 기록된 경로로만 (express.md 6절). URL의 파일 ID는 공개 ID (public-id.md).

### 3-4. 악성코드 검사 — clamd (다른 이용자에게 전달되는 파일만)

```js
// external/clamd.js — 파일을 디스크에 쓰지 않고 clamd에 소켓으로 보내 검사한다 (INSTREAM)
import net from 'node:net';

/**
 * @param {Buffer} buf 업로드 파일 내용
 * @returns {Promise<{ clean: boolean, reply: string }>} clean은 응답이 정확히 "stream: OK"일 때만 true
 */
export function scanBuffer(buf, { host = process.env.CLAMD_HOST, port = 3310, timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, host);
    let reply = '';
    sock.setTimeout(timeoutMs, () => sock.destroy(new Error('clamd timeout')));
    sock.on('connect', () => {
      sock.write('zINSTREAM\0');
      for (let i = 0; i < buf.length; i += 64 * 1024) {           // 청크 = 4바이트 길이(빅엔디언) + 데이터
        const chunk = buf.subarray(i, i + 64 * 1024);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(chunk.length);
        sock.write(Buffer.concat([len, chunk]));
      }
      sock.write(Buffer.alloc(4));                                   // 길이 0 = 끝
    });
    sock.on('data', (d) => { reply += d.toString(); });
    sock.on('end', () => {
      const r = reply.replace(/\0$/, '').trim();
      resolve({ clean: r === 'stream: OK', reply: r });              // 검출·오류·한도 초과는 모두 clean이 아니다
    });
    sock.on('error', reject);                                        // clamd 중지 → 업로드도 실패(통과시키지 않는다)
  });
}
```

- 실측 2026-10-20 (ClamAV 1.5.4 `clamav/clamav` 이미지, clamd TCP 3310): EICAR → `stream: … FOUND` / **zip 안의 EICAR도 FOUND** / PNG·xlsx → `stream: OK` / 99MB(EICAR 포함) FOUND / **101MB → `INSTREAM size limit exceeded. ERROR`**(기본 `StreamMaxLength` 100MB — 검사하지 못했다는 뜻이라 거부) / clamd 중지 → `ECONNREFUSED`.
- ⚠ 이 실측은 **공식 서명 DB 없이** EICAR 해시를 넣은 사용자 서명으로 했다 — 이 환경의 네트워크 정책이 `database.clamav.net`을 막는다. 운영에서는 freshclam이 서명을 받아야 검출이 된다(이미지 기본 진입점이 시작할 때 freshclam으로 서명을 받는다 — 이 환경에서는 받지 못해 `Update failed`로 끝났다). 도입 시 운영 환경에서 공식 서명으로 EICAR 검출을 한 번 확인한다.
- 업로드 상한(express.md 6절)을 `StreamMaxLength`보다 작게 둔다 — 크면 큰 파일이 전부 "검사 불가"로 거부된다.
- clamd는 별도 컨테이너로 두고 compose에 추가한다(메모리는 공식 서명을 받은 뒤 운영 환경에서 확인). 검사가 필요 없는 기능(본인만 보는 파일)은 부르지 않는다(2절).

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| 확장자·`Content-Type`으로 판정 | `.png`로 위장한 HTML이 통과 (실측) | 매직 바이트 (3-1절) |
| 판정 불가를 일괄 거부 | CSV 업로드가 전부 막힌다 (실측) | 텍스트 형식은 파서 검사 |
| 이미지를 받은 그대로 저장 | 촬영 위치(GPS)·기기 정보 공개 (실측) | 재인코딩 |
| 메타데이터만 제거 | 세로 사진이 옆으로 눕는다 (실측) | `rotate()` 먼저 |
| 픽셀 상한 미지정 | 1MB 미만 파일 몇 개로 수백 MB 메모리·CPU 점유 (실측) | `limitInputPixels` |
| 업로드 파일을 inline으로 | SVG·HTML이 우리 출처에서 실행 — 쿠키·API 탈취 (실측) | inline은 래스터만 + `nosniff` + `sandbox` |
| 저장 MIME을 요청 값으로 | 내려줄 때 그 값이 `Content-Type`이 된다 | 판정 결과로 기록 |

## 5. 스택별 구현

| 구성 | Express | Spring |
|---|---|---|
| 형식 판정 | `file-type` (19.x, ESM 전용) | Apache Tika `tika-core` `new Tika().detect(bytes)` — **파일명을 함께 넘기지 않는다**. `file-type`과 달리 HTML·SVG·텍스트도 형식을 돌려주므로(판정 불가가 아니다) 허용 목록 비교가 거부의 전부다. **tika-core만으로는 xlsx·docx가 `application/x-tika-ooxml`**로 나온다 — 허용 목록에 그 값을 쓰거나 `tika-parser-microsoft-module`을 추가해 세부 형식을 받는다 (실측 2026-10-20, 4.1.0: PNG·JPEG·PDF 정상 / `.png`로 위장한 HTML → `text/html` / SVG → `image/svg+xml` / xlsx → `x-tika-ooxml`, 이름을 주면 xlsx MIME / CSV → `text/plain`, 이름을 주면 `text/csv`) |
| 이미지 재인코딩 | `sharp` (0.33 실측) | Thumbnailator `Thumbnails.of(in).width(…).outputFormat(판정 형식)` — 방향 반영 + 메타데이터 제거. **`ImageIO`로 읽어 그대로 다시 쓰면 메타데이터는 빠지지만 방향을 보지 않아 사진이 눕는다** (실측 2026-10-20, Thumbnailator 0.4.21 · Java 25: 800×400 + Orientation 6 + GPS → Thumbnailator 400×800·EXIF 0바이트 / ImageIO 축소 400×200·EXIF 0바이트) |
| 헤더 | `res.attachment(original_file_name)`(파일명 인코딩 처리) + `res.set(...)` | `ContentDisposition.attachment().filename(name, UTF_8)` + `HttpHeaders` |
| 악성코드 검사 | 3-4절 `scanBuffer` (INSTREAM, 실측) | 같은 프로토콜 — `Socket`에 `zINSTREAM\0` + (4바이트 길이 `ByteBuffer.putInt` + 청크)… + 4바이트 0, 응답이 정확히 `stream: OK`일 때만 통과 (실측 2026-10-20, Java 25: EICAR·zip 안 EICAR FOUND, PNG OK — Node와 같은 결과) |

## 6. 검증 포인트

- 자동화 테스트: HTML을 `evil.png`로 업로드 → 400 / GPS EXIF가 든 JPEG 업로드 → 저장 파일 EXIF 없음 / 세로 사진 → 저장 파일 가로·세로가 표시 의도대로 / 픽셀 상한 초과 → 400 / 다운로드 응답에 `nosniff`·`sandbox`·(비이미지는) `attachment`.
- 실동작 검증(/live-test): 스크립트가 든 SVG·HTML 업로드 시도 → 거부되는지, 업로드된 첨부의 다운로드 링크를 새 탭으로 열었을 때 문서로 열리지 않는지.
