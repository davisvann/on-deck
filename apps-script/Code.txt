/**
 * On Deck Google bridge (Apps Script).
 *
 * Deploy once from a computer, under your own Google account:
 *   1. Open https://script.new, delete the sample code, paste this whole file, and save.
 *   2. Run the function `setup` once (Run button). Approve the Gmail and Calendar access
 *      Google asks for. Then open View > Logs (or Execution log) and copy the secret.
 *   3. Deploy > New deployment > type "Web app". Execute as: Me. Who has access: Anyone.
 *      Copy the Web app URL.
 *   4. In On Deck's phone screen, paste the URL and the secret.
 *
 * What it can do, and nothing else:
 *   ping      return your email address
 *   snapshot  read unread inbox threads (last 3 days, no promotions/social) and your
 *             calendar for the next 36 hours plus open invites for 14 days
 *   reply     reply in an existing thread (it cannot email anyone new)
 *   rsvp      answer an invite you were invited to
 *   email     email the attendees of one of your events (only addresses on that event)
 *
 * Every request must carry the secret from step 2. To shut it off, run `revoke`
 * (or delete the deployment).
 */

function setup() {
  var secret = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('ONDECK_SECRET', secret);
  // Touch both services so Google asks for permission now.
  GmailApp.getInboxUnreadCount();
  CalendarApp.getDefaultCalendar().getName();
  Logger.log('Your On Deck secret: ' + secret);
}

function revoke() {
  PropertiesService.getScriptProperties().deleteProperty('ONDECK_SECRET');
  Logger.log('Secret removed. The bridge now refuses every request.');
}

function doGet() {
  return out_({ ok: false, error: 'Use POST' });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'Bad request' }); }
  var secret = PropertiesService.getScriptProperties().getProperty('ONDECK_SECRET');
  if (!secret || !req || req.secret !== secret) return out_({ ok: false, error: 'Unauthorized' });
  try {
    switch (req.op) {
      case 'ping': return out_({ ok: true, email: me_() });
      case 'snapshot': return out_(snapshot_());
      case 'reply': return out_(reply_(req));
      case 'rsvp': return out_(rsvp_(req));
      case 'email': return out_(email_(req));
      default: return out_({ ok: false, error: 'Unknown operation' });
    }
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function me_() { return Session.getEffectiveUser().getEmail(); }

function status_(ev) {
  if (ev.isOwnedByMe && ev.isOwnedByMe()) return 'owner';
  var s = String(ev.getMyStatus());
  return { YES: 'yes', NO: 'no', MAYBE: 'maybe', INVITED: 'invited', OWNER: 'owner' }[s] || 'invited';
}

function eventJson_(ev) {
  var creators = ev.getCreators() || [];
  return {
    eventId: ev.getId(), title: ev.getTitle(), start: ev.getStartTime().toISOString(), end: ev.getEndTime().toISOString(),
    allDay: ev.isAllDayEvent(), location: ev.getLocation() || '', myStatus: status_(ev), organizer: creators[0] || '',
    guests: ev.getGuestList().map(function (g) { return g.getEmail(); }),
    description: String(ev.getDescription() || '').slice(0, 400),
  };
}

function snapshot_() {
  var now = new Date();
  var threads = GmailApp.search('in:inbox is:unread newer_than:3d -category:promotions -category:social', 0, 25).map(function (t) {
    var msgs = t.getMessages();
    var last = msgs[msgs.length - 1];
    return {
      threadId: t.getId(), subject: t.getFirstMessageSubject(), from: last.getFrom(), date: last.getDate().toISOString(),
      snippet: String(last.getPlainBody() || '').replace(/\s+/g, ' ').slice(0, 1200), messages: msgs.length,
    };
  });
  var cal = CalendarApp.getDefaultCalendar();
  var soon = cal.getEvents(now, new Date(now.getTime() + 36 * 3600 * 1000));
  var later = cal.getEvents(new Date(now.getTime() + 36 * 3600 * 1000), new Date(now.getTime() + 14 * 24 * 3600 * 1000))
    .filter(function (ev) { return status_(ev) === 'invited'; });
  return { ok: true, now: now.toISOString(), me: me_(), threads: threads, events: soon.concat(later).slice(0, 40).map(eventJson_) };
}

function reply_(req) {
  var t = GmailApp.getThreadById(String(req.threadId || ''));
  if (!t) throw new Error('Thread not found');
  var body = String(req.body || '').trim();
  if (!body || body.length > 4000) throw new Error('Reply is empty or too long');
  t.reply(body);
  return { ok: true };
}

function rsvp_(req) {
  var ev = CalendarApp.getEventById(String(req.eventId || ''));
  if (!ev) throw new Error('Event not found');
  if (status_(ev) === 'owner') throw new Error('You own this event');
  var map = { yes: CalendarApp.GuestStatus.YES, no: CalendarApp.GuestStatus.NO, maybe: CalendarApp.GuestStatus.MAYBE };
  var st = map[req.response];
  if (!st) throw new Error('Bad response');
  ev.setMyStatus(st);
  var note = String(req.note || '').trim();
  var organizer = (ev.getCreators() || [])[0];
  if (note && organizer && organizer !== me_()) GmailApp.sendEmail(organizer, 'Re: ' + ev.getTitle(), note);
  return { ok: true };
}

function email_(req) {
  var ev = CalendarApp.getEventById(String(req.eventId || ''));
  if (!ev) throw new Error('Event not found');
  var allowed = {};
  ev.getGuestList().forEach(function (g) { allowed[g.getEmail().toLowerCase()] = true; });
  (ev.getCreators() || []).forEach(function (c) { allowed[String(c).toLowerCase()] = true; });
  allowed[me_().toLowerCase()] = true;
  var to = (req.to || []).map(String);
  if (!to.length || to.some(function (x) { return !allowed[x.toLowerCase()]; })) throw new Error('Recipients must be on the event');
  var body = String(req.body || '').trim();
  if (!body || body.length > 4000) throw new Error('Message is empty or too long');
  GmailApp.sendEmail(to.join(','), String(req.subject || ev.getTitle()).slice(0, 200), body);
  return { ok: true };
}
