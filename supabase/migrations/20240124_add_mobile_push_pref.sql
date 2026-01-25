-- Migration: Add mobile push notification preference to user_profiles

ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS pref_mobile_push_notif BOOLEAN DEFAULT TRUE;

COMMENT ON COLUMN user_profiles.pref_mobile_push_notif IS 'User preference for native mobile push notifications';
