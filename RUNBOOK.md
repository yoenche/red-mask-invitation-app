# Show-Day Runbook

Use this runbook for live operation of the Red Mask QR pre-show experience.

## Operator Flow

1. Open the admin console at `/admin`.
2. Enter the operator PIN.
3. Ask the audience to scan the QR code.
4. Ask the audience to tap "초대장 준비하기".
5. Check the ready count.
6. Press START.
7. Confirm the 3-second countdown and video playback.
8. Wait until "이제 고개를 들어주세요."
9. Start the live stage performance.
10. Guide users to save their reaction card.

## 공연 감독 핸드폰으로 운영하는 방법

1. 감독 핸드폰에서 `/admin` 접속
2. 운영자 PIN 입력
3. 접속자 수 확인
4. 준비 완료자 수 확인
5. START 누르기
6. "정말 시작합니다" 확인
7. 3초 카운트다운 확인
8. 관객 휴대폰 영상 재생 확인
9. "이제 고개를 들어주세요" 이후 실제 공연 시작
10. 필요 시 RESET 또는 EMERGENCY STOP 사용

## Before Audience Entry

- Confirm the production URL opens on both iPhone Safari and Android Chrome.
- Confirm `/admin` is open on the operator device and is not asleep or locked.
- Confirm Supabase environment variables are set in Vercel.
- Confirm `ADMIN_PIN` and `SUPABASE_SERVICE_ROLE_KEY` are set as Supabase Edge Function secrets.
- Confirm the final MP4 and image assets are deployed.
- Confirm the QR code points to the audience route `/`.

## During Audience Preparation

- Watch the connected audience count.
- Watch the ready count before pressing START.
- Verbally remind users to keep the page open.
- If camera permission is denied, users can still continue to video playback.

## During Playback

- Press START only after the floor manager or stage manager gives the cue.
- START requires a confirmation tap, then schedules a 3-second synchronized start.
- Confirm several nearby phones begin playback.
- Keep the admin console open in case RESET or EMERGENCY STOP is needed.
- At "이제 고개를 들어주세요.", hand the audience's attention to the live performers.

## After Playback

- Tell users they can save the generated reaction card.
- On Android, use "이미지 저장하기".
- On iPhone, long-press the image and save it to Photos.

## Emergency Actions

- Use RESET if the pre-show needs to return everyone to the waiting page.
- RESET requires the confirmation button "정말 초기화합니다".
- Use EMERGENCY STOP if the experience must stop immediately and users should follow on-site guidance.
- EMERGENCY STOP requires the confirmation button "정말 중지합니다".
