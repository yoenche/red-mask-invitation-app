# Red Mask Invitation App

Mobile-first QR pre-show horror experience for a live outdoor performance.

## Core Flow

1. Audience scans the venue QR code and lands on `/`.
2. The audience taps **Prepare Device**.
3. The app requests front camera permission with `getUserMedia`.
4. A low-size 9:16 MP4 is expected at `public/assets/video/prologue_red_mask_60s.mp4`.
5. The director opens **`/admin` on a phone** (mobile-first console): enter the operator PIN (stored in `sessionStorage` for the tab).
6. **START**, **RESET**, and **EMERGENCY STOP** call the Supabase Edge Function `show-control`, which validates `ADMIN_PIN` on the server and updates **`public.show_control`** (`id = main`). The admin UI also subscribes to that row over Realtime.
7. Audience devices load **`show_control`** on startup, subscribe to row changes, and use **`start_at`** when `state` is `PLAYING` to sync video start (with broadcast as an optional fast path).
8. At the configured timecode, the app captures the front-camera reaction.
9. Canvas generates a 9:16 result card.
10. The audience can save the image locally.

This project includes routing, Supabase Realtime Presence for readiness counts, Edge Function–backed show control, mobile-first styling, and a Canvas result-card utility.

## Tech Stack

- React 18
- Vite
- TypeScript
- React Router
- Supabase Realtime
- HTML5 video
- `getUserMedia`
- Canvas
- Vercel

## Routes

- `/` - audience waiting and device preparation page (reads `public.show_control`, Realtime subscription).
- `/admin` - **mobile director console**: PIN gate, live audience counts, `show_control` state, **START** / **RESET** / **EMERGENCY STOP** via Edge Function `show-control`.

## Getting Started

```bash
npm install
npm run dev
```

Open:

- Audience: `http://localhost:5173/`
- Admin: `http://localhost:5173/admin`

## Environment

Copy the example file and fill in Supabase values:

```bash
cp .env.example .env
```

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

The app also includes `.env.example` with beginner-safe placeholder values:

```bash
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

If these values are missing or still set to the placeholder text, the app does not crash. It shows a development warning in the audience and admin pages, and the browser console logs the same warning during local development.

The admin console at `/admin` asks for an operator PIN, but the PIN is not stored in frontend environment variables. Every control action is validated by the Supabase Edge Function before `show_control` is updated.

Important security warning:

- Do not put `ADMIN_PIN` in Vercel frontend environment variables.
- Do not put `SUPABASE_SERVICE_ROLE_KEY` in Vercel frontend environment variables.
- Store both values only as Supabase Edge Function secrets.

Camera access requires HTTPS in production. Localhost is treated as a secure context by modern mobile browsers when testing through a development tunnel.

## Final Assets

Put the final files in these exact folders and use these exact filenames. Vite serves everything inside `public` from the site root, so `public/assets/video/prologue_red_mask_60s.mp4` becomes `/assets/video/prologue_red_mask_60s.mp4` in the app.

Create or confirm these folders exist:

```text
public/assets/video
public/assets/images
```

Place each final file here:

```text
public/assets/video/prologue_red_mask_60s.mp4
public/assets/images/waiting_bg.png
public/assets/images/result_card_frame.png
public/assets/images/look_up_bg.png
```

Beginner checklist:

1. Open the project folder named `red-mask-invitation-app`.
2. Open the `public` folder.
3. Open `assets`, then `video`, and place the final prologue video there.
4. Rename the video file exactly to `prologue_red_mask_60s.mp4`.
5. Open `assets`, then `images`, and place the three final PNG files there.
6. Rename the image files exactly to `waiting_bg.png`, `result_card_frame.png`, and `look_up_bg.png`.
7. Do not place these files inside `src`; assets in `public` are referenced by URL at runtime.

The app exports these URLs from `src/lib/assets.ts`:

```ts
PROLOGUE_VIDEO_URL = '/assets/video/prologue_red_mask_60s.mp4';
WAITING_BG_URL = '/assets/images/waiting_bg.png';
RESULT_CARD_FRAME_URL = '/assets/images/result_card_frame.png';
LOOK_UP_BG_URL = '/assets/images/look_up_bg.png';
```

Recommended video constraints:

- 9:16 aspect ratio
- H.264 MP4
- Muted-safe playback path
- Small enough to preload on unstable outdoor mobile networks
- Tested on iOS Safari and Android Chrome

## Supabase Realtime Plan

Realtime setup lives in `src/lib/supabase.ts`.

The app uses one channel:

```text
red-mask-show-control
```

Admin broadcast events:

```text
START
RESET
EMERGENCY_STOP
```

Audience clients subscribe to the same events:

```text
START
RESET
EMERGENCY_STOP
```

Audience Presence status values:

```text
WAITING
CAMERA_GRANTED
VIDEO_READY
READY
PLAYING
RESULT
CAMERA_DENIED
```

The admin page calls the `show-control` Edge Function for `START`, `RESET`, and `EMERGENCY_STOP`, then broadcasts the same event as a fast path. It also displays live Presence counts by audience status.

## Persistent Show Control Table

Broadcast events are used for fast delivery, but the current show state is also stored in Supabase so phones can recover if they briefly disconnect and reconnect.

Create this table with the migration in `supabase/migrations/20260514000000_create_show_control.sql`, or run equivalent SQL in Supabase:

```text
Table name: public.show_control

Columns:
id text primary key
state text not null
start_at timestamptz nullable
updated_at timestamptz not null default now()
```

The app uses one row:

```text
id = "main"
```

Suggested SQL setup:

```sql
create table if not exists public.show_control (
  id text primary key,
  state text not null check (state in ('WAITING', 'PLAYING', 'STOPPED')),
  start_at timestamptz null,
  updated_at timestamptz not null default now()
);

insert into public.show_control (id, state, start_at, updated_at)
values ('main', 'WAITING', null, now())
on conflict (id) do nothing;

alter table public.show_control enable row level security;

drop policy if exists "show_control_read_for_clients" on public.show_control;

create policy "show_control_read_for_clients"
on public.show_control
for select
to anon, authenticated
using (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'show_control'
  ) then
    alter publication supabase_realtime add table public.show_control;
  end if;
end $$;
```

Audience clients can read `public.show_control`. They should not have insert, update, or delete policies. The Edge Function uses the Supabase service role key, which bypasses RLS, to update the row.

Show-state behavior:

- START updates `show_control` to `state = "PLAYING"`, `start_at = now + 3 seconds`, and then broadcasts `START`.
- RESET updates `show_control` to `state = "WAITING"`, clears `start_at`, and then broadcasts `RESET`.
- EMERGENCY STOP updates `show_control` to `state = "STOPPED"`, clears `start_at`, and then broadcasts `EMERGENCY_STOP`.
- Audience clients fetch `show_control` on page load, subscribe to table changes, and also listen for broadcasts.
- If `state = "PLAYING"` and `start_at` is in the future, the audience page waits until `start_at`.
- If `state = "PLAYING"` and `start_at` has already passed, the audience page plays immediately.
- If `state = "WAITING"`, the audience page stays on the waiting screen.
- If `state = "STOPPED"`, the audience page shows the emergency stop message.

## Supabase Edge Function (`show-control`)

서버에서만 PIN을 검증하고 `public.show_control`을 갱신합니다. 소스 위치:

```text
supabase/functions/show-control/index.ts
```

프런트엔드는 **`pin`과 `action`만** JSON으로 보냅니다. `ADMIN_PIN`과 `SUPABASE_SERVICE_ROLE_KEY`는 절대 브라우저/Vercel 프런트 환경 변수에 넣지 마세요.

### 요청 형식 (POST)

```json
{
  "pin": "1234",
  "action": "START"
}
```

허용되는 `action` 값:

```text
START
RESET
EMERGENCY_STOP
```

`/admin`에서 PIN만 검증할 때(상태 변경 없음) 추가로 `VERIFY`를 보낼 수 있습니다. 공연 제어 API 문서에는 보통 위 세 가지만 적습니다.

### 응답

- 성공(200): 업데이트되거나 조회된 **한 행**을 JSON 객체로 반환합니다 (`id`, `state`, `start_at`, `updated_at`).
- PIN 오류: **401**, `{ "error": "Invalid PIN." }`
- 잘못된 action 등: **400**, `{ "error": "...설명..." }`
- 기타 실패: **4xx/5xx**, `{ "error": "readable message" }`

### Supabase Dashboard에서 함수 만들기 · Secret 등록하기 (초보자용)

1. [Supabase Dashboard](https://supabase.com/dashboard)에 로그인하고, 해당 **프로젝트**를 선택합니다.
2. 왼쪽 메뉴에서 **Edge Functions**를 엽니다.
3. **Deploy a new function** 또는 **Create function**으로 새 함수를 만들거나, 로컬에서 만든 `show-control` 폴더를 CLI로 배포합니다.
   - 로컬에 이미 `supabase/functions/show-control/index.ts`가 있다면, 프로젝트 루트 터미널에서 Supabase CLI를 설치한 뒤 연결·배포합니다:

```bash
supabase login
supabase link --project-ref <YOUR_PROJECT_REF>
supabase functions deploy show-control
```

4. **Secrets**(환경 변수) 등록: Dashboard에서 **Project Settings**(톱니바퀴) → **Edge Functions** 섹션으로 이동하거나, 메뉴의 **Edge Functions** 안에 **Secrets** / **Manage secrets**가 있으면 그곳에서 추가합니다.
   - 다음 이름으로 저장합니다(이름은 정확히 일치해야 합니다):

| Secret 이름 | 설명 |
|-------------|------|
| `ADMIN_PIN` | 공연 당일 운영자 PIN. 코드나 Vercel 프런트에 넣지 않습니다. |
| `SUPABASE_SERVICE_ROLE_KEY` | Dashboard → **Project Settings** → **API** → **service_role** 키(service_role은 서버 전용). 프런트에는 넣지 않습니다. |
| `SUPABASE_URL` | 보통 Edge Runtime에 자동 주입됩니다. 함수 로그에 URL 관련 오류가 나면 Dashboard API 페이지의 Project URL을 동일 이름으로 Secret에 추가합니다. |

5. 배포 후 **Edge Functions** 목록에서 `show-control`을 선택하고 **Invoke** 또는 로그로 테스트합니다. 예시 본문:

```json
{
  "pin": "당신이_설정한_ADMIN_PIN",
  "action": "RESET"
}
```

요청 헤더에 **anon key**가 필요합니다(프런트와 동일하게 `Authorization: Bearer <anon>` 및 `apikey: <anon>`). Dashboard의 Invoke UI가 이를 채워 주는 경우가 많습니다.

### CLI로 Secret 설정 (대안)

```bash
supabase secrets set ADMIN_PIN=your-show-day-pin
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

필요 시:

```bash
supabase secrets set SUPABASE_URL=https://YOUR_PROJECT.supabase.co
```

배포:

```bash
supabase functions deploy show-control
```

함수는 `Deno.env.get("ADMIN_PIN")`으로 PIN을 검증하고, 틀리면 **401**을 반환합니다. DB 갱신에는 `SUPABASE_URL`과 `SUPABASE_SERVICE_ROLE_KEY`로 생성한 **service role** 클라이언트만 사용합니다.

## Canvas Result Card

`src/lib/reactionCard.ts` exports `generateReactionCard`, which creates a 1080 x 1920 Canvas image. It accepts an optional captured camera frame and returns a canvas that can be converted to a downloadable image with:

```ts
const url = canvas.toDataURL('image/png');
```

## Deploying to Vercel

```bash
npm run build
```

Vercel settings:

- Framework preset: Vite
- Build command: `npm run build`
- Output directory: `dist`
- Environment variables: add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`

Do not add `ADMIN_PIN` or `SUPABASE_SERVICE_ROLE_KEY` to Vercel frontend environment variables.

The included `vercel.json` rewrites all routes to `index.html` so `/admin` works on refresh.

## Project Structure

```text
red-mask-invitation-app/
  public/
    assets/
      images/
        .gitkeep
      video/
        .gitkeep
  supabase/
    functions/
      show-control/
        index.ts
    migrations/
      20260514000000_create_show_control.sql
  src/
    components/
      StatusPill.tsx
    lib/
      assets.ts
      reactionCard.ts
      showConfig.ts
      showControl.ts
      supabase.ts
    pages/
      AdminPage.tsx
      AudiencePage.tsx
    styles/
      global.css
    App.tsx
    main.tsx
    vite-env.d.ts
  .env.example
  eslint.config.js
  index.html
  package.json
  tsconfig.app.json
  tsconfig.json
  tsconfig.node.json
  vercel.json
```
