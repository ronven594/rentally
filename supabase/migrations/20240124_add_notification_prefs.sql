-- Migration: Add notification preferences to user_profiles

ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS pref_sms_notif BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS pref_push_notif BOOLEAN DEFAULT TRUE;

COMMENT ON COLUMN user_profiles.pref_sms_notif IS 'User preference for SMS notifications';
COMMENT ON COLUMN user_profiles.pref_push_notif IS 'User preference for browser push notifications';
