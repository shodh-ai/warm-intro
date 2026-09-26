import { finishRecording, audioLevel } from './audio-recording.js';
const $ = (id) => document.getElementById(id);

const FALLBACK_SETTINGS = {
  email_subject: 'Introduction — Shodh AI × {{FirstName}}',
  fixed_template: 'I wanted to introduce you to the team at Shodh AI. They are building Physical Intelligence models for science and industry, with a focus on helping R&D teams reason across molecules, processes and manufacturing conditions.\n\nI thought it could be useful for you to connect with them and hear what they are building directly.',
  signature: 'Best,\nArun',
  followup_days: '5'
};
const FALLBACK_CONTACTS = [
  { rowNumber: 2, name: 'George Robson', company: 'Sequoia Capital', email: 'george@example.com', introReason: 'Fundraising / Physical Intelligence', context: 'Warm investor introduction. You know George personally and want him to meet the Shodh team.', status: 'Need Arun Note' },
  { rowNumber: 3, name: 'Priya Mehta', company: 'Industrial R&D Co.', email: 'priya@example.com', introReason: 'Potential design partner', context: 'She leads R&D partnerships and is relevant for a pilot conversation.', status: 'Need Arun Note' },
  { rowNumber: 4, name: 'David Chen', company: 'Deeptech Fund', email: 'david@example.com', introReason: 'Fundraising', context: 'You met David through a mutual friend last year.', status: 'Need Arun Note' }
];

const state = {
  mode: 'demo', contacts: [], settings: FALLBACK_SETTINGS, selectedId: null,
  recording: false, busy: false, stream: null, recorder: null, chunks: [], timerId: null, startedAt: 0,
  lastBlob: null, authenticated: false, google: null,
  localPreview: false, notes: new Map(), audioContext: null, levelTimer: null, recordingUrl: null, recordingFileName: 'intro.webm', heardAudio: false
};
const MIC_ICON = $('micIcon').innerHTML;
const DEMO_KEY = 'arun-intro-demo-contacts';
function show(el, yes = true) { el.classList.toggle('hidden', !yes); }
function banner(message, type = '') {
  $('statusBanner').textContent = message;
  $('statusBanner').className = `status-banner ${type}`.trim();
  show($('statusBanner'), Boolean(message));
}
function firstName(name) { return String(name || '').trim().split(/\s+/)[0] || 'there'; }
function initials(name) { return String(name || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase(); }
function completed(c) { return ['Draft Ready','Sent','Replied','Meeting Booked','Skipped','Closed'].includes(c.status); }
function pendingContacts() { return state.contacts.filter(c => !completed(c)); }
function currentContact() { return state.contacts.find(c => c.rowNumber === state.selectedId) || null; }
function scrollToElement(el) { el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' }); }
function setStep(step) {
  ['stepNote', 'stepReview', 'stepDraft'].forEach((id, i) => {
    $(id).classList.toggle('active', i === step);
    $(id).classList.toggle('done', i < step);
    if (i === step) $(id).setAttribute('aria-current', 'step'); else $(id).removeAttribute('aria-current');
  });
}
function setBusy(busy) {
  state.busy = busy;
  document.querySelectorAll('.queue-contact').forEach(button => { button.disabled = busy || button.dataset.completed === 'true'; });
  ['skipBtn', 'nextBtn', 'emptyResetBtn', 'typeNoteBtn', 'redoBtn', 'createSheetBtn', 'draftBtn', 'retryRecordingBtn'].forEach(id => { $(id).disabled = busy; });
  $('transcript').readOnly = busy;
  $('draftBtn').disabled = busy || !currentContact() || completed(currentContact()) || !$('transcript').value.trim();
  $('micBtn').disabled = busy && !state.recording;
  if (completed(currentContact() || {})) {
    ['skipBtn', 'micBtn', 'typeNoteBtn', 'draftBtn'].forEach(id => { $(id).disabled = true; });
  }
  $('createSheetBtn').disabled = busy || !state.google?.connected;
}
function renderProgress() {
  const total = state.contacts.length, done = state.contacts.filter(completed).length;
  const percent = total ? Math.round(done / total * 100) : 0;
  $('progressText').textContent = `${done} of ${total} completed`;
  $('remainingText').textContent = `${total - done} introduction${total - done === 1 ? '' : 's'} left`;
  $('progressPercent').textContent = `${percent}%`;
  $('queueCount').textContent = total - done;
  $('progressBar').style.width = `${percent}%`;
  $('progressTrack').setAttribute('aria-valuenow', percent);
  $('modeBadge').textContent = state.mode === 'demo' ? 'Demo workspace' : 'Google connected';
  $('settingsModeTitle').textContent = state.mode === 'demo' ? 'Try it with sample contacts' : 'Your connected workspace';
  $('settingsModeDescription').textContent = state.mode === 'demo' ? 'Demo drafts stay in this browser. Connect Google and a tracker to create real Gmail drafts.' : 'Introductions come from your tracker. Drafts are saved to your connected Gmail account for review.';
  show($('emptyResetBtn'), state.mode === 'demo');
}
function renderQueue() {
  $('contactQueue').replaceChildren();
  state.contacts.forEach(c => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'queue-contact';
    button.setAttribute('aria-current', String(c.rowNumber === state.selectedId));
    button.dataset.completed = String(completed(c)); button.disabled = state.busy || completed(c);
    const avatar = document.createElement('span'); avatar.className = 'queue-avatar'; avatar.textContent = initials(c.name); avatar.setAttribute('aria-hidden', 'true');
    const person = document.createElement('span'); person.className = 'queue-person';
    const name = document.createElement('strong'); name.textContent = c.name || 'Unnamed contact';
    const company = document.createElement('small'); company.textContent = completed(c) ? (c.status === 'Draft Ready' && state.mode === 'demo' ? 'Demo draft saved' : c.status) : c.company || 'No company';
    person.append(name, company);
    const arrow = document.createElement('span'); arrow.className = 'queue-arrow'; arrow.textContent = completed(c) ? '✓' : '↗'; arrow.setAttribute('aria-hidden', 'true');
    button.append(avatar, person, arrow); button.addEventListener('click', () => selectContact(c.rowNumber));
    $('contactQueue').append(button);
  });
}
function saveComposer() {
  const c = currentContact();
  if (c && !completed(c)) state.notes.set(c.rowNumber, { transcript: $('transcript').value });
}
function resetComposer() {
  clearRecordingPreview();
  recordingStatus(''); show($('recordingMeter'), false);
  $('transcript').value = ''; $('emailSubject').textContent = '—'; $('emailBody').textContent = '';
  ['transcriptSection','emailSection','draftSuccess'].forEach(id => show($(id), false));
  $('emailSection').open = false;
  show($('voiceZone'), true); show($('openGmailBtn'), state.mode === 'google');
  $('micBtn').classList.remove('recording'); $('micBtn').setAttribute('aria-label', 'Start recording'); $('micBtn').setAttribute('aria-pressed', 'false');
  $('micIcon').innerHTML = MIC_ICON; $('micLabel').textContent = 'Tap to speak'; show($('timer'), false);
  $('draftBtn').textContent = state.mode === 'demo' ? 'OK, save demo draft ↗' : 'OK, create draft ↗';
  $('draftHint').textContent = state.mode === 'demo' ? 'Saved in this browser only. No email will be created or sent.' : 'Your words come first, followed by Arun’s introduction and Arastu’s company note. Nothing is sent.';
  setStep(0); setBusy(false);
}
function renderContact() {
  renderProgress(); renderQueue();
  const c = currentContact();
  show($('emptyState'), !c); show($('contactCard'), Boolean(c));
  if (!c) return;
  resetComposer();
  $('avatar').textContent = initials(c.name); $('contactName').textContent = c.name || 'Unnamed contact'; $('contactCompany').textContent = c.company || '—';
  $('introReason').textContent = c.introReason || 'A thoughtful introduction'; $('arunContext').textContent = c.context || 'Add a personal note about why you’d like to connect.';
  $('contactStatus').textContent = 'Needs your note'; $('emailTo').textContent = c.email || 'Add recipient in Gmail';
  $('contactPosition').textContent = `${state.contacts.indexOf(c) + 1} / ${state.contacts.length}`;
  const saved = state.notes.get(c.rowNumber) || { transcript: c.cleanedNote || c.arunNote || '' };
  $('transcript').value = saved.transcript;
  show($('transcriptSection'), Boolean(saved.transcript));
  if (saved.transcript) setStep(1);
  setBusy(false);
}
function selectContact(id) {
  if (state.busy || state.recording) return;
  saveComposer(); state.selectedId = id; banner(''); renderContact();
}
function readDemo() {
  try {
    const saved = JSON.parse(localStorage.getItem(DEMO_KEY));
    return Array.isArray(saved) && saved.every(c => c && typeof c.rowNumber === 'number' && typeof c.name === 'string') ? saved : null;
  } catch { return null; }
}
function persistDemo() {
  if (state.mode === 'demo') {
    try { localStorage.setItem(DEMO_KEY, JSON.stringify(state.contacts)); }
    catch { banner('Browser storage is unavailable. Keep this page open to retain your demo progress.'); }
  }
}
async function api(path, options = {}) {
  const opts = { ...options, headers: { ...(options.headers || {}) }, signal: options.signal || AbortSignal.timeout(45000) };
  if (opts.body && typeof opts.body !== 'string') { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(opts.body); }
  const r = await fetch(path, opts);
  const data = (r.headers.get('content-type') || '').includes('application/json') ? await r.json() : await r.text();
  if (!r.ok) { const err = new Error(typeof data === 'string' ? data : data.error || `Request failed (${r.status})`); err.status = r.status; err.data = data; throw err; }
  return data;
}
async function checkAuth() {
  try {
    const a = await api('/api/auth-status'); state.authenticated = a.authenticated;
    show($('unlockCard'), !a.authenticated); show($('workspace'), false);
    $('modeBadge').textContent = a.authenticated ? 'Connecting…' : 'Private workspace';
    return a.authenticated;
  } catch (e) {
    if (e.status === 404 && ['localhost','127.0.0.1','[::1]'].includes(location.hostname)) {
      state.localPreview = true; state.authenticated = true; return true;
    }
    banner('Unable to open the workspace. Please refresh to try again.', 'error'); return false;
  } finally { show($('loadingState'), false); }
}
async function loadData() {
  try {
    const data = state.localPreview ? { mode: 'demo', contacts: FALLBACK_CONTACTS.map(c => ({...c})), settings: FALLBACK_SETTINGS } : await api('/api/app-data');
    state.mode = data.mode || 'demo'; state.contacts = data.contacts || []; state.settings = { ...FALLBACK_SETTINGS, ...data.settings }; state.google = data.google || null;
    const needsConnection = !state.localPreview && state.mode !== 'google';
    show($('connectionCard'), needsConnection);
    if (needsConnection) {
      state.contacts = []; state.selectedId = null;
      show($('workspace'), false);
      $('modeBadge').textContent = state.google?.connected ? 'Tracker not connected' : 'Connect Google';
      $('connectionTitle').textContent = state.google?.connected ? 'Connect your tracker' : 'Connect your Google account';
      $('connectionMessage').textContent = state.google?.connected ? 'Your Google account is connected. Open Settings to connect your introduction tracker.' : 'Connect Google in this browser to load your Sheet contacts and save drafts in Gmail.';
      show($('connectWorkspaceBtn'), !state.google?.connected);
      show($('trackerSettingsBtn'), Boolean(state.google?.connected));
      $('settingsModeTitle').textContent = 'Your Google workspace';
      $('settingsModeDescription').textContent = 'Connect Google to use the contacts in your tracker and create Gmail drafts.';
      return;
    }
    if (state.mode === 'demo') state.contacts = readDemo() || state.contacts;
    state.selectedId = pendingContacts()[0]?.rowNumber ?? null;
    show($('workspace'), true); renderContact();
  } catch (e) {
    show($('workspace'), false); show($('connectionCard'), false);
    if (e.status === 401) { state.authenticated = false; show($('unlockCard'), true); }
    banner('Your introductions could not load. Please refresh or check your Google connection in Settings.', 'error');
  }
}
async function loadGoogleStatus() {
  if (state.google?.connected) {
    $('googleStatus').textContent = `Connected as ${state.google.email || 'Google user'}`; $('googleConnectBtn').textContent = 'Reconnect';
    if (state.google.sheetUrl) { $('sheetLink').href = state.google.sheetUrl; show($('sheetLink'), true); $('createSheetBtn').textContent = 'Create a new tracker sheet'; }
  } else {
    $('googleStatus').textContent = state.localPreview ? 'Available on the hosted app' : state.authenticated ? 'Not connected' : 'Unlock the workspace first';
    $('googleConnectBtn').textContent = 'Connect Google'; show($('sheetLink'), false);
  }
  const unavailable = state.localPreview || !state.authenticated;
  $('googleConnectBtn').setAttribute('aria-disabled', unavailable);
  $('googleConnectBtn').tabIndex = unavailable ? -1 : 0;
  $('createSheetBtn').disabled = !state.google?.connected || state.busy;
}

function chooseMime() {
  const candidates = ['audio/webm;codecs=opus','audio/webm','audio/mp4'];
  return candidates.find(t => window.MediaRecorder?.isTypeSupported?.(t)) || '';
}

function updateTimer() {
  const s = Math.floor((Date.now() - state.startedAt) / 1000);
  $('timer').textContent = `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
  if (s >= 90) stopRecording();
}

async function startRecording() {
  if (state.recording) return stopRecording();
  if (state.busy || completed(currentContact() || {})) return;
  if (state.localPreview) { banner('Voice transcription is available on the hosted app. Type a note to try the demo.'); show($('transcriptSection'), true); $('transcript').focus(); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    banner('This browser does not support microphone recording. Use current Chrome or Safari.', 'error'); show($('transcriptSection'), true); $('transcript').focus(); return;
  }
  setBusy(true);
  try {
    banner('');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    state.stream = stream; state.chunks = [];
    const mimeType = chooseMime();
    const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64000 });
    state.recorder = recorder;
    recorder.addEventListener('error', () => { if (state.recording) stopRecording(); });
    recorder.ondataavailable = e => { if (e.data?.size) state.chunks.push(e.data); };
    recorder.start(500);
    state.recording = true; state.startedAt = Date.now(); setStep(0); setBusy(true);
    $('micBtn').setAttribute('aria-label', 'Stop recording'); $('micBtn').setAttribute('aria-pressed', 'true');
    $('micBtn').classList.add('recording'); $('micIcon').textContent = '■'; $('micLabel').textContent = 'Tap to stop'; show($('timer'), true);
    state.timerId = setInterval(updateTimer, 250); updateTimer();
    show($('transcriptSection'), true);
    recordingStatus('Recording… tap the microphone again when you’re finished.');
    startLevelMeter(stream);
  } catch (e) { state.stream?.getTracks().forEach(t => t.stop()); state.recording = false; setBusy(false); recordingStatus(`Microphone could not start: ${e.message}. Allow microphone access, or type your note.`, true); show($('transcriptSection'), true); $('transcript').focus(); }
}

function recordingStatus(message, error = false) {
  $('recordingStatus').textContent = message;
  $('recordingStatus').classList.toggle('recording-error', error);
  show($('recordingStatus'), Boolean(message));
}
function clearRecordingPreview() {
  if (state.recordingUrl) URL.revokeObjectURL(state.recordingUrl);
  state.recordingUrl = null; state.lastBlob = null;
  $('recordingPlayback').removeAttribute('src');
  show($('recordingPreview'), false);
}
function showRecordingPreview(blob, filename) {
  clearRecordingPreview();
  state.lastBlob = blob; state.recordingFileName = filename;
  state.recordingUrl = URL.createObjectURL(blob);
  $('recordingPlayback').src = state.recordingUrl;
  show($('recordingPreview'), true);
}
function stopLevelMeter() {
  clearInterval(state.levelTimer); state.levelTimer = null;
  state.audioContext?.close().catch(() => {}); state.audioContext = null;
  show($('recordingMeter'), false);
}
async function startLevelMeter(stream) {
  state.heardAudio = false;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext(); state.audioContext = context;
    await context.resume();
    if (!state.recording) { stopLevelMeter(); return; }
    const analyser = context.createAnalyser(); analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    show($('recordingMeter'), true);
    state.levelTimer = setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      const level = audioLevel(samples); $('micLevel').value = level;
      if (level > 0.025) state.heardAudio = true;
      $('micLevelHint').textContent = state.heardAudio ? 'Microphone is picking up sound' : Date.now() - state.startedAt > 4000 ? 'No sound detected — check your microphone' : 'Speak naturally — watch the level';
    }, 120);
  } catch { stopLevelMeter(); }
}
function releaseRecording() {
  clearInterval(state.timerId); state.timerId = null; stopLevelMeter();
  state.stream?.getTracks().forEach(track => track.stop()); state.stream = null;
  state.recording = false;
  $('micBtn').classList.remove('recording');
  $('micBtn').setAttribute('aria-label', 'Start recording'); $('micBtn').setAttribute('aria-pressed', 'false');
  $('micIcon').innerHTML = MIC_ICON; $('micLabel').textContent = 'Record again';
  show($('timer'), false);
}
async function transcribeRecording(blob, filename) {
  if (!blob?.size) throw new Error('No audio was captured. Check microphone access and record again.');
  // Keep the encoded JSON below the hosted function's request limit.
  if (blob.size > 3_000_000) throw new Error('This recording is too large. Use a shorter recording (up to 90 seconds).');
  recordingStatus('Preparing your English transcript… your words will appear below.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const result = await api('/api/transcribe', { method: 'POST', body: { audioBase64: btoa(binary), mimeType: blob.type || 'audio/webm', fileName: filename, contact: currentContact() } });
  const text = result.text?.trim() || '';
  if (!text) throw new Error('No speech was detected. Play the recording below to check the audio, then try again.');
  $('transcript').value = text;
  show($('emailSection'), false); setStep(1); saveComposer();
  recordingStatus('Your English text is ready. Read or edit it, then tap OK, create draft.');
}
async function stopRecording() {
  if (!state.recording) return;
  state.recording = false; setBusy(true);
  clearInterval(state.timerId); stopLevelMeter();
  $('micBtn').classList.remove('recording'); $('micIcon').textContent = '…'; $('micLabel').textContent = 'Transcribing';
  $('micBtn').setAttribute('aria-pressed', 'false');
  show($('transcriptSection'), true); recordingStatus('Finishing your recording…');
  try {
    const blob = await finishRecording(state.recorder, state.chunks);
    state.stream?.getTracks().forEach(track => track.stop());
    if (!blob.size) throw new Error('No audio was captured. Check microphone access and record again.');
    const filename = blob.type.includes('mp4') ? 'intro.mp4' : 'intro.webm';
    showRecordingPreview(blob, filename);
    await transcribeRecording(blob, filename);
  } catch (error) { recordingStatus(error.message, true); }
  finally { releaseRecording(); setBusy(false); scrollToElement($('transcriptSection')); }
}
async function retryRecording() {
  if (state.busy || !state.lastBlob) return;
  setBusy(true);
  try { await transcribeRecording(state.lastBlob, state.recordingFileName); }
  catch (error) { recordingStatus(error.message, true); }
  finally { setBusy(false); }
}

function localPreview(contact, cleanedNote) {
  const subject = state.settings.email_subject.replaceAll('{{FirstName}}', firstName(contact.name)).replaceAll('{{Name}}', contact.name || '').replaceAll('{{Company}}', contact.company || '');
  const body = [`Hi ${firstName(contact.name)},`, cleanedNote, state.settings.fixed_template, state.settings.signature, state.settings.founder_note ? `More about Shodh — from Arastu:\n\n${state.settings.founder_note}` : '', state.settings.deck_url ? `Company deck: ${state.settings.deck_url}` : ''].filter(part => String(part || '').trim()).join('\n\n').trim();
  return { subject, body };
}
async function createDraft() {
  const c = currentContact(); if (!c || state.busy || completed(c)) return;
  const reviewedNote = $('transcript').value.trim();
  if (!reviewedNote) { banner('Record or type your note first.', 'error'); $('transcript').focus(); return; }
  banner(''); setBusy(true); $('draftBtn').textContent = 'Creating draft…';
  try {
    let preview = localPreview(c, reviewedNote), draftWarning = '';
    if (state.mode === 'google') {
      let result;
      try {
        result = await api('/api/draft', { method: 'POST', body: { rowNumber: c.rowNumber, cleanedNote: reviewedNote, transcript: reviewedNote } });
      } catch (error) {
        if (!error.data?.draftCreated || !error.data?.draftId) throw error;
        result = error.data;
        draftWarning = 'Saved in Gmail, but the tracker could not update. Open Gmail to review your draft.';
      }
      Object.assign(c, result.contact || {}, { cleanedNote: reviewedNote, arunNote: reviewedNote, status: 'Draft Ready' });
      preview = { subject: result.subject ?? preview.subject, body: result.body ?? preview.body };
      if (result.warning) banner(result.warning);
      $('openGmailBtn').href = result.gmailUrl || 'https://mail.google.com/mail/u/0/#drafts'; show($('openGmailBtn'), true);
    } else { Object.assign(c, { cleanedNote: reviewedNote, arunNote: reviewedNote, status: 'Draft Ready' }); persistDemo(); show($('openGmailBtn'), false); }
    $('contactStatus').textContent = state.mode === 'demo' ? 'Demo draft saved' : 'Draft ready';
    $('successTitle').textContent = state.mode === 'demo' ? 'Demo draft saved' : 'Your introduction is ready';
    $('successMessage').textContent = state.mode === 'demo' ? 'Saved in this browser. Nothing was created in Gmail.' : draftWarning || 'Waiting in Gmail for your final review and Send.';
    $('emailSubject').textContent = preview.subject; $('emailBody').textContent = preview.body;
    ['voiceZone','transcriptSection'].forEach(id => show($(id), false));
    show($('emailSection'), true); setStep(2);
    show($('draftSuccess'), true); renderProgress(); renderQueue(); scrollToElement($('draftSuccess'));
  } catch (e) { banner(e.message, 'error'); }
  finally { setBusy(false); $('draftBtn').textContent = state.mode === 'demo' ? 'OK, save demo draft ↗' : 'OK, create draft ↗'; }
}
async function skipCurrent() {
  const c = currentContact(); if (!c || state.busy || completed(c)) return;
  setBusy(true);
  try {
    if (state.mode === 'google') await api('/api/update-contact', { method: 'POST', body: { rowNumber: c.rowNumber, patch: { status: 'Skipped' } } });
    c.status = 'Skipped'; persistDemo(); setBusy(false); nextContact();
  } catch (e) { banner(e.message, 'error'); }
  finally { setBusy(false); }
}
function nextContact() {
  if (state.busy || state.recording) return;
  const index = state.contacts.indexOf(currentContact());
  const ordered = [...state.contacts.slice(index + 1), ...state.contacts.slice(0, index + 1)];
  selectContact(ordered.find(c => !completed(c))?.rowNumber ?? null);
}
function resetDemo() {
  if (state.mode !== 'demo' || state.busy) return;
  state.contacts = FALLBACK_CONTACTS.map(c => ({...c})); state.notes.clear(); state.selectedId = state.contacts[0].rowNumber; persistDemo(); banner(''); renderContact();
}
async function createSheet() {
  if (state.busy || !state.google?.connected) return;
  setBusy(true); $('createSheetBtn').textContent = 'Creating…';
  try {
    await api('/api/google/setup-sheet', { method: 'POST', body: {} });
    await loadData(); await loadGoogleStatus(); closeDrawer(); banner('Tracker created. Add your contacts in Google Sheets to get started.');
  } catch (e) { banner(e.message, 'error'); }
  finally { setBusy(false); $('createSheetBtn').textContent = 'Create a new tracker sheet'; }
}
function openDrawer() {
  const drawer = $('settingsDrawer'); drawer.inert = false; drawer.classList.add('open'); drawer.setAttribute('aria-hidden','false');
  show($('drawerBackdrop'), true); $('appShell').inert = true; document.body.classList.add('drawer-open'); $('closeSettings').focus({ preventScroll: true }); loadGoogleStatus();
}
function closeDrawer() {
  const drawer = $('settingsDrawer'); $('appShell').inert = false; $('settingsBtn').focus(); drawer.classList.remove('open'); drawer.setAttribute('aria-hidden','true'); drawer.inert = true;
  show($('drawerBackdrop'), false); document.body.classList.remove('drawer-open');
}
$('settingsBtn').addEventListener('click', openDrawer);
$('trackerSettingsBtn').addEventListener('click', openDrawer);
$('closeSettings').addEventListener('click', closeDrawer);
$('drawerBackdrop').addEventListener('click', closeDrawer);
document.addEventListener('keydown', e => {
  if (!$('settingsDrawer').classList.contains('open')) return;
  if (e.key === 'Escape') { e.preventDefault(); closeDrawer(); }
  if (e.key === 'Tab') {
    if (!$('settingsDrawer').contains(document.activeElement)) { e.preventDefault(); $('closeSettings').focus(); return; }
    const items = [...$('settingsDrawer').querySelectorAll('button:not(:disabled), a[href]:not([aria-disabled="true"])')].filter(el => !el.classList.contains('hidden'));
    if (e.shiftKey && document.activeElement === items[0]) { e.preventDefault(); items.at(-1)?.focus(); }
    else if (!e.shiftKey && document.activeElement === items.at(-1)) { e.preventDefault(); items[0]?.focus(); }
  }
});
$('googleConnectBtn').addEventListener('click', e => { if (state.localPreview || !state.authenticated) e.preventDefault(); });
$('micBtn').addEventListener('click', startRecording);
$('typeNoteBtn').addEventListener('click', () => { setStep(1); show($('transcriptSection'), true); $('transcript').focus(); scrollToElement($('transcriptSection')); });
$('redoBtn').addEventListener('click', startRecording);
$('retryRecordingBtn').addEventListener('click', retryRecording);
$('transcript').addEventListener('input', () => { setStep(1); saveComposer(); setBusy(state.busy); });
$('draftBtn').addEventListener('click', createDraft);
$('skipBtn').addEventListener('click', skipCurrent);
$('nextBtn').addEventListener('click', nextContact);
$('emptyResetBtn').addEventListener('click', resetDemo);
$('createSheetBtn').addEventListener('click', createSheet);
$('unlockForm').addEventListener('submit', async e => {
  e.preventDefault(); const button = e.submitter; button.disabled = true;
  try { await api('/api/auth-login', { method: 'POST', body: { code: $('accessCode').value } }); $('accessCode').value = ''; show($('unlockCard'), false); state.authenticated = true; banner(''); await loadData(); await loadGoogleStatus(); }
  catch (err) { banner(err.message, 'error'); }
  finally { button.disabled = false; }
});
window.addEventListener('pagehide', () => { releaseRecording(); if (state.recordingUrl) URL.revokeObjectURL(state.recordingUrl); });
(async function init() {
  if (await checkAuth()) { await loadData(); await loadGoogleStatus(); }
  if (new URLSearchParams(location.search).get('connected') && state.google?.connected) { banner('Google connected. Open Settings to create or open your tracker.'); history.replaceState({}, '', location.pathname); }
})();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
