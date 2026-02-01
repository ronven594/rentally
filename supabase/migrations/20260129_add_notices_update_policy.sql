-- Allow UPDATE on notices for email status tracking and manual delivery status
-- The original migration deliberately omitted UPDATE policy, but the app needs to
-- update status (draft -> sent) and email delivery fields after initial insert.

CREATE POLICY "Users can update notice status"
ON notices FOR UPDATE
USING (true)
WITH CHECK (true);
