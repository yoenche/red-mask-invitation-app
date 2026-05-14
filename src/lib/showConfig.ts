import { PROLOGUE_VIDEO_URL } from './assets';
import { SHOW_CONTROL_CHANNEL } from './supabase';

export const showConfig = {
  realtimeChannel: SHOW_CONTROL_CHANNEL,
  reactionCaptureTimecode: Number(import.meta.env.VITE_REACTION_CAPTURE_TIMECODE ?? 7.5),
  videoPath: PROLOGUE_VIDEO_URL
};
