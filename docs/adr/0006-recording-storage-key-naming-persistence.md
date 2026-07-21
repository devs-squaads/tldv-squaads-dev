# Recording Storage Key Naming and Persistence

The S3/MinIO object key for a recording is currently computed on every access —
`buildRecordingStorageKey()` returns `` `${provider}/${meetingId}.mp4` `` and upload, delete, sign, and
the detail page each recompute it from scratch; it is never stored. The new naming format is
`` `${provider}/${sanitizedMeetingName}_${YYYY-MM-DD}_${meetingId}.mp4` ``, adding the meeting name and
recording date per product request. Because the key is recomputed rather than stored, changing the
formula outright would desync already-uploaded recordings from the key their file actually lives under.
This is resolved by adding a `meetings.recordingStorageKey` column, populated once at upload time: rows
with a value use it directly for delete/sign/download; rows without one (pre-existing recordings) keep
falling back to the current formula, unchanged.

## Status

accepted

## Considered Options

- **Change `buildRecordingStorageKey()` in place, keep recomputing everywhere**: rejected — the new
  format is not reproducible from `(meetingId, meetingUrl, providerHint)` alone (it needs the meeting's
  name and date), and recomputing under a changed formula would silently produce a different key than
  the one the file was actually uploaded under, breaking delete/sign/download for every existing
  recording.
- **Backfill `recordingStorageKey` for all existing rows under the new format**: rejected — would
  require locating and possibly renaming every already-uploaded S3 object; the fallback-to-legacy-formula
  approach achieves the same outcome (old recordings keep working) without touching stored files.

## Consequences

- `meetingId` stays as a suffix in the new format specifically to avoid collisions between meetings with
  the same name on the same day (e.g. a recurring "Daily Standup").
- The 14 existing callers of `buildRecordingStorageKey()` (upload, delete, sign, detail page) need to
  first check `meetings.recordingStorageKey`, only falling back to the computed formula when it is null.
