# Warm Intro — mobile web app

A private mobile app for Arun Seth to process warm introductions one person at a time. The desktop workspace includes a contact queue; the phone layout uses a compact horizontal queue.

## What it does

- Shows one contact card at a time, with progress and context.
- Records Arun's voice from the phone microphone.
- Converts English, Hindi and Hinglish audio directly to English in one request using the OpenAI audio translations endpoint, preserving meaning and names before showing **Your words**.
- Combines the personal note with the fixed Shodh email template.
- Creates a Gmail **draft** (never auto-sends). Contact email is optional. Blank or invalid addresses leave To empty so the recipient can be added directly in Gmail.
- Updates the Google Sheet tracker automatically.
- Installs to a phone home screen as a PWA.

## Phone flow

1. Arun opens the Warm Intro icon.
2. One contact is shown.
3. Tap **Tap to speak** and dictate 2–3 lines.
4. Watch the microphone-level indicator while speaking. Tap again to stop (or it stops at 90 seconds).
5. Review or edit the English transcript in **Your words**.
6. Tap **OK, create draft**. The exact approved text is combined with the Sheet’s email template and saved in Gmail.
7. Open Gmail to review the draft, or move to the next person. On phones, the button attempts to launch Gmail; select the connected account and open Drafts. A separate web link remains available if the browser blocks the app launch.

The app intentionally does **not** make swipe-right send an email. Draft creation requires approving the displayed text.

## One Google Sheet for the app

Set `GOOGLE_SHEET_ID` to the shared tracker spreadsheet. The app reuses that one file; edit its Contacts tab to update the list shown when the app opens or refreshes. It also stores the template and progress in the same spreadsheet. Grant Arun access to this file.

If no tracker is configured, **Create intro tracker sheet** can create one with these tabs:

- `Contacts` — source-of-truth database.
- `Arun - Action Needed` — automatically filtered list of contacts that still need Arun's note.
- `Dashboard` — counts for total, need note, draft ready, sent, replied, meetings, skipped and follow-ups due.
- `Settings` — fixed subject, Shodh template, signature and follow-up days.

### Contacts columns

`Name | Company | Email | Intro Reason | Context for Arun | Arun Note | Cleaned Note | Status | Draft ID | Draft Created | Date Sent | Follow-up Date | Reply | Notes`

## Deploy to Vercel

This project deliberately has no npm dependencies. It is a static mobile UI plus **10 Vercel `/api` serverless functions**, keeping it within the Hobby-plan function-count limit.

### 1. Create a Vercel project

Upload/import this folder into a new Vercel project. No build command is required.

### 2. Add environment variables

Copy the values from `.env.example` into Vercel Project → Settings → Environment Variables.

Required:

- `OPENAI_API_KEY`
- `APP_SECRET` (use a long random value)
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Recommended:

- `GOOGLE_SHEET_ID` — the existing tracker spreadsheet ID.
- `ALLOWED_GOOGLE_EMAIL` — set this to the permitted Google email addresses, separated by commas.
- `APP_BASE_URL` — your final URL, for example `https://intro.shodh.ai`.

The model environment variables are optional; current defaults are already in code.

### 3. Create Google OAuth credentials

In Google Cloud Console:

1. Create/select a project.
2. Enable **Gmail API** and **Google Sheets API**.
3. Configure OAuth consent screen. For an internal/single-user tool, keep access limited appropriately.
4. Create an OAuth Client ID of type **Web application**.
5. Add this redirect URI exactly:

`https://YOUR-DOMAIN/api/google/callback`

For a Vercel preview URL, add its exact callback URL too if you want to test OAuth there.

Scopes requested by the app:

- `openid`
- `email`
- `https://www.googleapis.com/auth/gmail.compose`
- `https://www.googleapis.com/auth/spreadsheets`

Google bundles draft management and sending into `gmail.compose`; the app only calls Gmail’s draft-creation API. It does not read the inbox or send emails.

### 4. Open the app

- Enter the configured app password, then connect Google.
- Settings → **Connect Google**.
- Sign in with Arun's Google account.
- The configured tracker loads automatically. Create a tracker only if none is configured.
- Add contacts and your email template to that Sheet.
- Test one complete draft before loading real contacts.

### 5. Put it on Arun's phone

Android Chrome:

- Open the production URL.
- Chrome menu → **Add to Home screen** / **Install app**.

On iPhone Safari:

- Open the production URL.
- Share → **Add to Home Screen**.

The microphone requires HTTPS; Vercel provides HTTPS automatically.

## Email template

Edit the `Settings` tab in the tracker Sheet. Changes are picked up by the app automatically.

Keys:

- `email_subject`
- `fixed_template`
- `signature`
- `founder_note` — Arastu’s reusable company note, below Arun’s signature
- `cc_email` — optional single CC address
- `deck_url` — optional HTTPS deck link
- `followup_days`

Supported subject variables:

- `{{FirstName}}`
- `{{Name}}`
- `{{Company}}`

## Security notes

- The OpenAI API key and Google client secret never go to the browser.
- Google refresh credentials are encrypted into an HttpOnly cookie using `APP_SECRET` rather than stored in frontend JavaScript.
- Set `ALLOWED_GOOGLE_EMAIL` for a single-advisor production deployment.
- Set `APP_ACCESS_CODE` privately for the deployment. Google sign-in is also required to read the tracker and create Gmail drafts.
- The app creates drafts only; Arun remains the person who sends the email.

## Demo mode

With Node.js 22 or newer, run `npm run dev` and open `http://localhost:4173`. The dependency-free local server runs the same API handlers as Vercel. Add `OPENAI_API_KEY` to a private, gitignored `.env.local` file and restart the server to enable real transcription. Without a Google connection, the server asks you to connect Google and shows no sample contacts. The local server listens only on loopback and serves an explicit public-file allowlist; environment files and backend source are never served. Demo drafts are explicitly labeled and stored only in the current browser.

On the hosted app, a missing Google connection or tracker shows a connection screen, never a sample contact list. Google must be connected in each browser. Authentication and data errors are shown explicitly rather than silently switching a connected workspace to demo data. The reset button after finishing the queue restarts the demo.

Notes are retained while switching contacts during the current page session. Settings supports Escape, keyboard focus containment, and focus restoration. The interface respects reduced motion and includes accessible form labels and progress.

## Current model defaults

- audio-to-English translation: `whisper-1` (the audio translations endpoint)

Audio translation uses the model supported by the translations endpoint. The optional cleanup API remains available, but the phone flow saves the exact approved transcript without an additional model call.

## Local checks

Run `npm test` to check local API routing, private-file isolation, request validation, and cross-origin rejection. Never commit `.env.local` or place API keys in browser code. Hosted deployments require their own environment variables; local secrets are not uploaded by Git.

## Recording troubleshooting

After recording, use the audio player to check what the microphone captured. An empty transcription shows a clear no-speech message instead of silently leaving an empty note. You can retry transcription without re-recording, record again, or type your note. Browser recording errors and timeouts release the controls so you can try again. Transcription logs include byte counts and status only, never the audio or transcript text.


### Multiple companies

After Google connection, the app shows a company picker. The existing configured
`GOOGLE_SHEET_ID` remains the shared registry and Shodh AI tracker. Its `Companies`
tab uses columns A:C: `Company name`, `Tracker Sheet link`, `Description`.
Add each other company's name and Google Sheets URL in a new row (rows 2–100).
Each tracker needs the same `Contacts` columns and `Settings` key/value layout as
the original tracker, and must be shared with every Google account using it.
Configure that company's own `email_subject`, `fixed_template`, `signature`, and
optional `founder_note`, `forwarded_from`, `forwarded_to`, `cc_email`, and `deck_url` in Settings.
Other companies never inherit Shodh's default wording.

Use **Change company** to return to the picker. Refresh companies reloads the
registry. Unsaved typed notes remain separate per company while the page is open;
recordings and unsaved notes are not retained after a page reload. Draft creation
and status writes validate the selected company against the registry each time.

When `founder_note` is present, new drafts use a `Fwd:` subject and place that
saved text below a forwarded-message separator. Optional `forwarded_from` and
`forwarded_to` settings supply known source details; no original date or subject
is invented. This recreates the saved message in a new draft, not a Gmail
message forward, and does not fetch the original email or its attachments.


Use **Add company** on the company picker to create a new blank tracker in the
connected Google account and register it in the existing Companies tab. Each
card offers **Open Sheet** and **Copy Sheet link**. Before forwarding a link,
open Google Sheets and use Share to grant the company access. Creation does not
make the Sheet public or send a message. Company-specific email text starts
blank, while the contact headers, formulas and Settings keys are prefilled.
If registration fails after creation, Retry linking reuses that Sheet.
