/**
 * Eric Deng Ultimate — form intake (Premium Application + Qualification flow)
 * ============================================================================
 *
 * Handles form submissions from:
 *   - index.html               (Premium Application modal — types: 'lead', 'application')
 *   - apply/index.html         (qualification flow — types: 'qualification_lead', 'qualification_application')
 *   - qualification/index.html (quick fit-check flow — types: 'coaching_fit_lead', 'coaching_fit_application')
 *   - lock-in-for-2027-challenge/index.html ("Join $9" — type: 'lockin_lite_lead')
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
 *      MAILERLITE_GROUP_LEAD_ID            optional — group for apply-page leads (step 1, before finishing the application)
 *      MAILERLITE_GROUP_QUALIFIED_ID       optional — group for qualified apply-page applicants
 *      MAILERLITE_GROUP_NOT_QUALIFIED_ID   optional — group for not-qualified apply-page applicants
 *      MAILERLITE_GROUP_PREMIUM_ID         optional — group for homepage Premium Application submissions
 *      MAILERLITE_GROUP_LOCKIN_LITE_ID     optional — group for Lock In For 2027 "Join $9" sign-ups
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
 * Every submission lands in one of six sheet tabs (auto-created on first
 * write, no need to create them manually):
 *   "Premium Application Leads"   — homepage modal, step 1
 *   "Premium Applications"        — homepage modal, step 2 (full submission)
 *   "Qualification Leads"         — apply page, step 1
 *   "Qualification Applications"  — apply page, step 2 (full submission)
 *   "Coaching Fit Leads"          — qualification page, contact step
 *   "Coaching Fit Applications"   — qualification page, full submission
 *   "Lock In Lite Leads"          — Lock In page, "Join $9" (before Stripe checkout)
 *
 * ── Updating an existing deployment (keeps the same /exec URL) ─────────────
 * Paste the new code over the old, save, then Deploy > Manage deployments >
 * pencil icon on the live deployment > Version: "New version" > Deploy.
 * (Creating a NEW deployment would give a different URL.)
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
      case 'coaching_fit_lead':
        return handleCoachingFitLead_(p);
      case 'coaching_fit_application':
        return handleCoachingFitApplication_(p);
      case 'lockin_lite_lead':
        return handleLockInLiteLead_(p);
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

  // Sync to MailerLite immediately — this is step 1 (contact info only), so
  // they land here even if they never finish the qualifying questions.
  syncToMailerLite_(p.email, p.firstName, p.lastName, mlGroupId_('MAILERLITE_GROUP_LEAD_ID'));

  return jsonResponse_({ ok: true });
}

function handleQualificationApplication_(p) {
  const qualified = p.qualified === 'true';

  appendRow_('Qualification Applications',
    ['Timestamp', 'Status', 'Exit Reason', 'First Name', 'Last Name', 'Email', 'Instagram',
     'Q1: Where they mostly play', 'Q1 Other (if specified)',
     'Q2: Can commit to structured training', 'Q3: Prepared to invest financially',
     'Q4: How soon looking to start', 'Source'],
    [p.timestamp, qualified ? 'Qualified' : 'Not qualified', p.exitReason || '',
     p.firstName, p.lastName, p.email, p.instagram || '',
     p.q1, p.q1Other || '', p.q2, p.q3, p.q4, p.source]
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
      `Q3 (prepared to invest financially): ${p.q3 || ''}`,
      `Q4 (how soon looking to start): ${p.q4 || ''}`,
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

// ── Quick fit-check flow (qualification/index.html) ─────────────────────

// No MailerLite sync on this flow — it only collects a first name, and
// MailerLite requires an email to create/update a subscriber.

function handleCoachingFitLead_(p) {
  appendRow_('Coaching Fit Leads',
    ['Timestamp', 'First Name', 'Instagram', 'Source'],
    [p.timestamp, p.firstName, p.instagram || '', p.source]
  );

  return jsonResponse_({ ok: true });
}

function handleCoachingFitApplication_(p) {
  const qualified = p.qualified === 'true';

  appendRow_('Coaching Fit Applications',
    ['Timestamp', 'Status', 'Exit Reason', 'First Name', 'Instagram',
     'Where They Mostly Play', 'Struggling With', 'Training Gaps', 'Primary Skill', 'Scenario',
     'Ready To Invest?', 'Timeline', 'Need', 'Source'],
    [p.timestamp, qualified ? 'Qualified' : 'Not qualified', p.exitReason || '',
     p.firstName, p.instagram || '',
     p.playLocation, p.struggles, p.gaps, p.primarySkill, p.scenario,
     p.budget, p.timeline, p.need, p.source]
  );

  sendNotifyEmail_(
    `New fit check (${qualified ? 'QUALIFIED ✅' : 'not qualified'}): ${p.firstName || ''}`.trim(),
    [
      `Status: ${qualified ? 'Qualified' : 'Not qualified'}`,
      p.exitReason ? `Exit reason: ${p.exitReason}` : null,
      '',
      `Name: ${p.firstName || ''}`,
      p.instagram ? `Instagram: ${p.instagram}` : null,
      '',
      `Where they mostly play: ${p.playLocation || ''}`,
      `Struggling with: ${p.struggles || ''}`,
      `Training gaps: ${p.gaps || ''}`,
      `Primary skill: ${p.primarySkill || ''}`,
      `Scenario: ${p.scenario || ''}`,
      `Ready to invest? ${p.budget || ''}`,
      `Timeline: ${p.timeline || ''}`,
      `Need: ${p.need || ''}`,
      '',
      `Submitted: ${p.timestamp || ''}`
    ].filter(Boolean).join('\n')
  );

  return jsonResponse_({ ok: true });
}

// ── Lock In For 2027 Challenge (lock-in-for-2027-challenge/index.html) ──

// "Join $9" collects first name + email, then sends the person to Stripe.
// Saved here before payment, so this is everyone who STARTED checkout -
// Stripe's dashboard shows who actually paid.
function handleLockInLiteLead_(p) {
  appendRow_('Lock In Lite Leads',
    ['Timestamp', 'First Name', 'Email', 'Source'],
    [p.timestamp, p.firstName, p.email, p.source]
  );

  sendNotifyEmail_(
    `Lock In Lite checkout started: ${p.firstName || ''}`.trim(),
    [
      `Name: ${p.firstName || ''}`,
      `Email: ${p.email || ''}`,
      '',
      'They were sent to the $9 Stripe checkout - check Stripe to confirm payment.',
      `Submitted: ${p.timestamp || ''}`
    ].join('\n')
  );

  syncToMailerLite_(p.email, p.firstName, '', mlGroupId_('MAILERLITE_GROUP_LOCKIN_LITE_ID'));

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
  if (!email) return;
  if (!apiKey) {
    logMailerLiteError_(email, groupId, 'skipped', 'MAILERLITE_API_KEY script property is not set');
    return;
  }

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

  try {
    const res = UrlFetchApp.fetch('https://connect.mailerlite.com/api/subscribers', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + apiKey },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    // 200 = existing subscriber updated, 201 = new subscriber created
    if (code !== 200 && code !== 201) {
      logMailerLiteError_(email, groupId, code, res.getContentText());
    }
  } catch (err) {
    logMailerLiteError_(email, groupId, 'exception', String(err));
  }
}

// Failed MailerLite syncs land in a "MailerLite Errors" tab so they're visible
// (e.g. a mistyped group ID or an expired API key) instead of failing silently.
function logMailerLiteError_(email, groupId, code, detail) {
  appendRow_('MailerLite Errors',
    ['Timestamp', 'Email', 'Group ID', 'Response code', 'Detail'],
    [new Date().toISOString(), email, groupId || '(none)', String(code), String(detail).slice(0, 500)]
  );
}
