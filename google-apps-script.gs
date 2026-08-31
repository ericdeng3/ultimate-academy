/**
 * Eric Deng Ultimate — form intake (Premium Application + Qualification flow)
 * ============================================================================
 *
 * Handles form submissions from BOTH:
 *   - index.html          (Premium Application modal — types: 'lead', 'application')
 *   - apply/index.html    (qualification flow — types: 'qualification_lead', 'qualification_application')
 *
 * This is a fresh, standalone script — not tied to whatever project used to
 * back the old APPS_SCRIPT_URL. It doesn't read anything from that old
 * project; it's self-contained.
 *
 * ── Setup ────────────────────────────────────────────────────────────────
 * 1. Create a new Google Sheet (any name, e.g. "Eric Deng Ultimate — Forms").
 * 2. In that Sheet: Extensions > Apps Script. Delete the default code and
 *    paste this whole file in.
 * 3. Project Settings (gear icon, left sidebar) > Script Properties > Add:
 *
 *      NOTIFY_EMAIL                        required — where alert emails go
 *      MAILERLITE_API_KEY                  optional — from MailerLite > Integrations > Developer API
 *      MAILERLITE_GROUP_QUALIFIED_ID       optional — group for qualified apply-page applicants
 *      MAILERLITE_GROUP_NOT_QUALIFIED_ID   optional — group for not-qualified apply-page applicants
 *      MAILERLITE_GROUP_PREMIUM_ID         optional — group for homepage Premium Application submissions
 *
 *    Anything left blank is simply skipped (e.g. no MAILERLITE_API_KEY means
 *    no MailerLite calls at all, but Sheets + email still work).
 *
 * 4. Deploy > New deployment > type "Web app":
 *      Execute as:      Me
 *      Who has access:  Anyone
 *    Click Deploy, authorize the requested permissions, and copy the
 *    resulting /exec URL.
 * 5. Paste that URL into APPS_SCRIPT_URL in BOTH index.html and
 *    apply/index.html, replacing the old one.
 *
 * Every submission lands in one of four sheet tabs (auto-created on first
 * write, no need to create them manually):
 *   "Premium Application Leads"   — homepage modal, step 1
 *   "Premium Applications"        — homepage modal, step 2 (full submission)
 *   "Qualification Leads"        — apply page, step 1
 *   "Qualification Applications" — apply page, step 2 (full submission)
 */

// ── Entry point ─────────────────────────────────────────────────────────

function doGet(e) {
  try {
    const p = e.parameter;
    switch (p.type) {
      case 'lead':
        return handlePremiumLead_(p);
      case 'application':
        return handlePremiumApplication_(p);
      case 'qualification_lead':
        return handleQualificationLead_(p);
      case 'qualification_application':
        return handleQualificationApplication_(p);
      default:
        return jsonResponse_({ ok: false, error: 'Unknown or missing type: ' + p.type });
    }
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err) });
  }
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ── Premium Application (index.html) ───────────────────────────────────

function handlePremiumLead_(p) {
  appendRow_('Premium Application Leads',
    ['Timestamp', 'Name', 'Email', 'Instagram', 'Source'],
    [p.timestamp, p.name, p.email, p.instagram, p.source]
  );
  return jsonResponse_({ ok: true });
}

function handlePremiumApplication_(p) {
  appendRow_('Premium Applications',
    ['Timestamp', 'Name', 'Email', 'Instagram', 'Experience', 'Level',
     'Biggest Challenge', 'Why Now', 'Teammate Qualities',
     'Investment OK?', 'Ready To Start?', 'Not-Ready Reason', 'Source'],
    [p.timestamp, p.name, p.email, p.instagram, p.experience, p.level,
     p.focus_areas, p.why_now, p.teammate_qualities,
     p.investment_ok, p.ready_to_start, p.not_ready_reason, p.source]
  );

  sendNotifyEmail_(
    `New Premium Application: ${p.name || ''}`,
    [
      `Name: ${p.name || ''}`,
      `Email: ${p.email || ''}`,
      `Instagram: ${p.instagram || ''}`,
      '',
      `Experience: ${p.experience || ''}`,
      `Level: ${p.level || ''}`,
      `Biggest challenge: ${p.focus_areas || ''}`,
      `Why now: ${p.why_now || ''}`,
      `Teammate qualities: ${p.teammate_qualities || ''}`,
      `Investment OK? ${p.investment_ok || ''}`,
      `Ready to start? ${p.ready_to_start || ''}`,
      p.not_ready_reason ? `Not-ready reason: ${p.not_ready_reason}` : null,
      '',
      `Submitted: ${p.timestamp || ''}`
    ].filter(Boolean).join('\n')
  );

  syncToMailerLite_(p.email, p.name, '', mlGroupId_('MAILERLITE_GROUP_PREMIUM_ID'));

  return jsonResponse_({ ok: true });
}

// ── Qualification flow (apply/index.html) ──────────────────────────────

function handleQualificationLead_(p) {
  appendRow_('Qualification Leads',
    ['Timestamp', 'First Name', 'Last Name', 'Email', 'Source'],
    [p.timestamp, p.firstName, p.lastName, p.email, p.source]
  );
  return jsonResponse_({ ok: true });
}

function handleQualificationApplication_(p) {
  const qualified = p.qualified === 'true';

  appendRow_('Qualification Applications',
    ['Timestamp', 'Status', 'Exit Reason', 'First Name', 'Last Name', 'Email', 'Instagram',
     'Q1: Where they mostly play', 'Q1 Other (if specified)',
     'Q2: Can commit to structured training', 'Q3: Can commit to $200/mo', 'Source'],
    [p.timestamp, qualified ? 'Qualified' : 'Not qualified', p.exitReason || '',
     p.firstName, p.lastName, p.email, p.instagram || '',
     p.q1, p.q1Other || '', p.q2, p.q3, p.source]
  );

  sendNotifyEmail_(
    `New application (${qualified ? 'QUALIFIED ✅' : 'not qualified'}): ${p.firstName || ''} ${p.lastName || ''}`.trim(),
    [
      `Status: ${qualified ? 'Qualified' : 'Not qualified'}`,
      p.exitReason ? `Exit reason: ${p.exitReason}` : null,
      '',
      `Name: ${p.firstName || ''} ${p.lastName || ''}`,
      `Email: ${p.email || ''}`,
      p.instagram ? `Instagram: ${p.instagram}` : null,
      '',
      `Q1 (where they mostly play): ${p.q1 || ''}`,
      p.q1Other ? `Q1 other: ${p.q1Other}` : null,
      `Q2 (structured training commitment): ${p.q2 || ''}`,
      `Q3 (can commit to $200/mo): ${p.q3 || ''}`,
      '',
      `Submitted: ${p.timestamp || ''}`
    ].filter(Boolean).join('\n')
  );

  const groupId = qualified
    ? mlGroupId_('MAILERLITE_GROUP_QUALIFIED_ID')
    : mlGroupId_('MAILERLITE_GROUP_NOT_QUALIFIED_ID');
  syncToMailerLite_(p.email, p.firstName, p.lastName, groupId);

  return jsonResponse_({ ok: true });
}

// ── Shared helpers ──────────────────────────────────────────────────────

function appendRow_(sheetName, header, row) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(header);
  }
  sheet.appendRow(row.map(v => v == null ? '' : v));
}

function sendNotifyEmail_(subject, body) {
  const notifyEmail = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL');
  if (!notifyEmail) return;
  MailApp.sendEmail(notifyEmail, subject, body);
}

function mlGroupId_(propertyName) {
  return PropertiesService.getScriptProperties().getProperty(propertyName) || '';
}

function syncToMailerLite_(email, firstName, lastName, groupId) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('MAILERLITE_API_KEY');
  if (!apiKey || !email) return;

  // MailerLite "Connect" API (current, as of 2024+). If your account is
  // still on the legacy MailerLite Classic API, this endpoint/auth header
  // is different — let me know and I'll adjust.
  const payload = {
    email: email,
    fields: {
      name: firstName || '',
      last_name: lastName || ''
    },
    groups: groupId ? [groupId] : []
  };

  UrlFetchApp.fetch('https://connect.mailerlite.com/api/subscribers', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}
