// Vercel serverless function — receives a due-date push from the work board
// (src/App.jsx calls fetch('/api/dashboard-task', ...) whenever a due date is
// set on a task/subtask/sub-subtask) and appends a row to the Google Sheet
// that daily-dashboard reads from.
//
// Confirmed columns (read directly from the live sheet):
//   [Done checkbox] | Task | Status | Due Date | Priority | Category | Sub Category | Repeat | Notes | Assignee
//
// NOT WIRED UP YET. This currently just accepts the request and does nothing,
// so the work board keeps functioning normally either way. To make it live:
//
//   1. Install the auth helper this file needs:
//        npm install google-auth-library
//
//   2. Create a Google Cloud service account (console.cloud.google.com →
//      IAM & Admin → Service Accounts → Create), enable the "Google Sheets
//      API" for that project, and generate a JSON key for the account.
//
//   3. Open the spreadsheet and share it (top-right "Share" button) with the
//      service account's email address (looks like
//      something@your-project.iam.gserviceaccount.com), giving it Editor
//      access — otherwise it can't write rows.
//
//   4. In Vercel → this project → Settings → Environment Variables, add:
//        GOOGLE_SERVICE_ACCOUNT_EMAIL = the service account's email
//        GOOGLE_PRIVATE_KEY           = the "private_key" field from the JSON
//                                       key (keep the \n line breaks as-is —
//                                       this file un-escapes them at runtime)
//        GOOGLE_SHEET_TAB             = the exact tab name at the bottom of
//                                       the spreadsheet that holds this list
//                                       (open the sheet and check — likely
//                                       something like "To Do" or "Master")
//
//   5. Redeploy.
//
// The spreadsheet ID is already filled in below since it's public info from
// your dashboard's "Sheet" link. Everything else needs the steps above.

import { JWT } from 'google-auth-library';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID || '115WA0pm7zFdQNWSSRwUEyS9LDokPsENJ-9pUUZL9MwI';
const SHEET_TAB = process.env.GOOGLE_SHEET_TAB || ''; // TODO: fill in via env var — see step 4 above

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { title, dueDate, category, subcategory, priority, project } = req.body || {};

  if (!title || !dueDate) {
    return res.status(400).json({ error: 'title and dueDate are required' });
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !key || !SHEET_TAB) {
    // Not configured yet — accept the call so the board doesn't error out,
    // but make it obvious in the logs that nothing was actually written.
    console.warn('[dashboard-task] Google Sheets not configured yet — skipping write for:', title);
    return res.status(200).json({ ok: true, synced: false, reason: 'Google Sheets not configured yet' });
  }

  try {
    const client = new JWT({
      email,
      key: key.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const { access_token: accessToken } = await client.authorize();

    // Row order matches the sheet's real header row:
    // [Done] | Task | Status | Due Date | Priority | Category | Sub Category | Repeat | Notes | Assignee
    const row = [
      'FALSE',
      project ? `${title} (${project})` : title,
      'Not started',
      dueDate,
      priority || 'Moderate',
      category || 'Work',
      subcategory || 'Work Projects',
      '',
      '',
      '',
    ];

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(SHEET_TAB)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [row] }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[dashboard-task] Sheets API error:', errText);
      return res.status(502).json({ ok: false, error: 'Sheets API rejected the request', detail: errText });
    }

    return res.status(200).json({ ok: true, synced: true });
  } catch (err) {
    console.error('[dashboard-task] Failed to reach Google Sheets:', err);
    return res.status(502).json({ ok: false, error: 'Failed to reach Google Sheets' });
  }
}
