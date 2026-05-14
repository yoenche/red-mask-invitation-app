# Test Checklist

Use this checklist during rehearsal and before show-day deployment. Test with the final MP4, final images, production Supabase values, and the same QR URL the audience will use.

## Device And Browser Coverage

- [ ] iPhone Safari test
- [ ] Android Chrome test
- [ ] Admin phone test
- [ ] 3-device test
- [ ] 10-device test
- [ ] 3-device mobile director test
- [ ] 10-device mobile director test

## Audience Preparation

- [ ] Camera permission allowed
- [ ] Camera permission denied
- [ ] Video preload test
- [ ] Weak network test

## Admin Control

- [ ] PIN wrong test
- [ ] PIN correct test
- [ ] Admin START test
- [ ] Admin RESET test
- [ ] Emergency stop test
- [ ] Emergency stop from phone test
- [ ] START countdown test
- [ ] show_control DB update test
- [ ] Audience reconnect during PLAYING test

## Playback And Capture

- [ ] Reaction capture timing test
- [ ] Result card generation test

## Saving Result Images

- [ ] Image saving on Android
- [ ] Image saving on iPhone

## Suggested Test Notes

- Confirm the audience page does not crash when Supabase env values are missing during local development.
- Confirm the admin console shows connected audience count and ready count before START.
- Confirm denied-camera users can still watch the video and reach the result screen.
- Confirm the result card image is generated only on the user's device and is not uploaded to a server.
- Confirm the final message, "이제 고개를 들어주세요.", appears at the handoff moment.
