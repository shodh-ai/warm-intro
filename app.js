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
  pc: null, dc: null, liveText: '', lastBlob: null, authenticated: false, google: null,
  localPreview: false, notes: new Map(), audioContext: null, levelTimer: null, recordingUrl: null, recordingFileName: 'intro.webm', heardAudio: false
};
const MIC_ICON = $('micIcon').innerHTML;
const NOTE_HINT = 'Share why you’d like to connect them. Two or three natural lines are perfect.';
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
  ['skipBtn', 'nextBtn', 'resetDemoBtn', 'emptyResetBtn', 'typeNoteBtn', 'redoBtn', 'cleanBtn', 'useNoteBtn', 'editNoteBtn', 'createSheetBtn', 'draftBtn', 'retryRecordingBtn', 'audioUpload'].forEach(id => { $(id).disabled = busy; });
  $('transcript').readOnly = busy;
  $('cleanedNote').readOnly = busy;
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
  show($('resetDemoBtn'), state.mode === 'demo'); show($('emptyResetBtn'), state.mode === 'demo');
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
  if (c && !completed(c)) state.notes.set(c.rowNumber, { transcript: $('transcript').value, cleanedNote: $('cleanedNote').value, badge: $('cleanBadge').textContent });
}
function resetComposer() {
  clearRecordingPreview();
  recordingStatus(''); show($('recordingMeter'), false);
  $('transcript').value = ''; $('cleanedNote').value = ''; $('emailSubject').textContent = '—'; $('emailBody').textContent = '';
  ['transcriptSection','cleanedSection','emailSection','draftSuccess'].forEach(id => show($(id), false));
  show($('voiceZone'), true); show($('emailPreview'), true); show($('openGmailBtn'), state.mode === 'google');
  $('micBtn').classList.remove('recording'); $('micBtn').setAttribute('aria-label', 'Start recording'); $('micBtn').setAttribute('aria-pressed', 'false');
  $('micIcon').innerHTML = MIC_ICON; $('micLabel').textContent = 'Tap to speak'; show($('timer'), false);
  $('liveHint').classList.remove('live-transcript'); $('liveHint').textContent = NOTE_HINT;
  $('draftBtn').textContent = state.mode === 'demo' ? 'Save demo draft ↗' : 'Create Gmail draft ↗';
  $('draftHint').textContent = state.mode === 'demo' ? 'Saved in this browser only. No email will be created or sent.' : 'Saved as a draft. You decide when to send.';
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
  $('contactStatus').textContent = 'Needs your note'; $('emailTo').textContent = c.email || 'No email added';
  $('contactPosition').textContent = `${state.contacts.indexOf(c) + 1} / ${state.contacts.length}`;
  const saved = state.notes.get(c.rowNumber) || { transcript: c.arunNote || '', cleanedNote: c.cleanedNote || '' };
  $('transcript').value = saved.transcript; $('cleanedNote').value = saved.cleanedNote;
  $('cleanBadge').textContent = saved.badge || 'Saved note';
  show($('transcriptSection'), Boolean(saved.transcript)); show($('cleanedSection'), Boolean(saved.cleanedNote));
  if (saved.cleanedNote) setStep(1);
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
  if (!r.ok) { const err = new Error(typeof data === 'string' ? data : data.error || `Request failed (${r.status})`); err.status = r.status; throw err; }
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
    if (state.mode === 'demo') state.contacts = readDemo() || state.contacts;
    state.selectedId = pendingContacts()[0]?.rowNumber ?? null;
    show($('workspace'), true); renderContact();
    if (state.mode === 'google' && !state.synced) {
      state.synced = true; api('/api/sync-status', { method: 'POST', body: {} }).catch(() => {});
    }
  } catch (e) {
    show($('workspace'), false);
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

async function waitIceComplete(pc) {
  if (pc.iceGatheringState === 'complete') return;
  await new Promise(resolve => {
    const timeout = setTimeout(resolve, 2000);
    const fn = () => { if (pc.iceGatheringState === 'complete') { clearTimeout(timeout); pc.removeEventListener('icegatheringstatechange', fn); resolve(); } };
    pc.addEventListener('icegatheringstatechange', fn);
  });
}

async function startLiveTranscription(stream) {
  let pc;
  try {
    pc = new RTCPeerConnection();
    state.pc = pc;
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    const dc = pc.createDataChannel('oai-events');
    state.dc = dc;
    dc.addEventListener('message', (evt) => {
      try {
        if (!state.recording && !state.busy) return;
        const event = JSON.parse(evt.data);
        if (event.type === 'conversation.item.input_audio_transcription.delta') {
          state.liveText += event.delta || '';
          $('liveHint').textContent = state.liveText || 'Listening…';
          $('liveHint').classList.add('live-transcript');
        }
        if (event.type === 'conversation.item.input_audio_transcription.completed') {
          state.liveText = event.transcript || state.liveText;
          $('liveHint').textContent = state.liveText;
        }
      } catch {}
    });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitIceComplete(pc);
    if (!state.recording || state.pc !== pc) { pc.close(); return; }
    const r = await fetch('/api/live-session', { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: pc.localDescription.sdp });
    if (!r.ok) throw new Error(await r.text());
    const answer = await r.text();
    if (!state.recording || state.pc !== pc) { pc.close(); return; }
    await pc.setRemoteDescription({ type: 'answer', sdp: answer });
  } catch (e) {
    // Live captions are an enhancement; final file transcription remains authoritative.
    pc?.close();
    if (state.pc !== pc) return;
    state.pc = null; state.dc = null;
    if (state.recording) $('liveHint').textContent = 'Listening… your transcript will appear when you stop.';
  }
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
    state.stream = stream; state.chunks = []; state.liveText = '';
    const mimeType = chooseMime();
    const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64000 });
    state.recorder = recorder;
    recorder.addEventListener('error', () => { if (state.recording) stopRecording(); });
    recorder.ondataavailable = e => { if (e.data?.size) state.chunks.push(e.data); };
    recorder.start(500);
    state.recording = true; state.startedAt = Date.now(); setBusy(true);
    $('micBtn').setAttribute('aria-label', 'Stop recording'); $('micBtn').setAttribute('aria-pressed', 'true');
    $('micBtn').classList.add('recording'); $('micIcon').textContent = '■'; $('micLabel').textContent = 'Tap to stop'; show($('timer'), true);
    $('liveHint').textContent = 'Listening…';
    state.timerId = setInterval(updateTimer, 250); updateTimer();
    show($('transcriptSection'), true);
    recordingStatus('Recording… tap the microphone again when you’re finished.');
    startLevelMeter(stream);
    startLiveTranscription(stream);
  } catch (e) { state.stream?.getTracks().forEach(t => t.stop()); state.recording = false; setBusy(false); recordingStatus(`Microphone could not start: ${e.message}. Allow microphone access, or type or upload your note.`, true); show($('transcriptSection'), true); $('transcript').focus(); }
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
  try { state.pc?.close(); } catch {} state.pc = null; state.dc = null;
  state.recording = false;
  $('micBtn').classList.remove('recording');
  $('micBtn').setAttribute('aria-label', 'Start recording'); $('micBtn').setAttribute('aria-pressed', 'false');
  $('micIcon').innerHTML = MIC_ICON; $('micLabel').textContent = 'Record again';
  show($('timer'), false); $('liveHint').textContent = NOTE_HINT;
}
async function transcribeRecording(blob, filename) {
  if (!blob?.size) throw new Error('No audio was captured. Check microphone access or upload an audio file.');
  // Keep the encoded JSON below the hosted function's request limit.
  if (blob.size > 3_000_000) throw new Error('This recording is too large. Use a shorter recording (up to 90 seconds).');
  recordingStatus('Transcribing your recording… your words will appear below.');
  let text = '';
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const result = await api('/api/transcribe', { method: 'POST', body: { audioBase64: btoa(binary), mimeType: blob.type || 'audio/webm', fileName: filename, contact: currentContact() } });
    text = result.text?.trim() || '';
    if (!text) throw new Error('No speech was detected. Play the recording below to check the audio, then try again.');
  } catch (error) {
    if (state.liveText.trim()) {
      text = state.liveText.trim();
      recordingStatus('Using live captions because final transcription was unavailable. Please review the words.');
    } else throw error;
  }
  $('transcript').value = text; $('cleanedNote').value = '';
  show($('cleanedSection'), false); show($('emailSection'), false); setStep(0); saveComposer();
  recordingStatus('Your recording is transcribed. Review your words, then polish the note.');
}
async function stopRecording() {
  if (!state.recording) return;
  state.recording = false; setBusy(true);
  clearInterval(state.timerId); stopLevelMeter();
  $('micBtn').classList.remove('recording'); $('micIcon').textContent = '…'; $('micLabel').textContent = 'Transcribing';
  $('micBtn').setAttribute('aria-pressed', 'false');
  show($('transcriptSection'), true); recordingStatus('Finishing your recording…');
  try {
    try { if (state.dc?.readyState === 'open') state.dc.send(JSON.stringify({ type: 'input_audio_buffer.commit' })); } catch {}
    const blob = await finishRecording(state.recorder, state.chunks);
    state.stream?.getTracks().forEach(track => track.stop());
    if (!blob.size) throw new Error('No audio was captured. Check microphone access, or upload an audio file.');
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
async function uploadRecording(event) {
  const file = event.target.files?.[0]; if (!file || state.busy) return;
  show($('transcriptSection'), true); state.liveText = '';
  showRecordingPreview(file, file.name); setBusy(true);
  try { await transcribeRecording(file, file.name); }
  catch (error) { recordingStatus(error.message, true); }
  finally { setBusy(false); event.target.value = ''; scrollToElement($('transcriptSection')); }
}

async function cleanNote() {
  if (state.busy) return;
  const transcript = $('transcript').value.trim();
  if (!transcript) { banner('Type or record a note first.', 'error'); $('transcript').focus(); return; }
  banner(''); setBusy(true); $('cleanBtn').textContent = 'Polishing…';
  try {
    let text = transcript, polished = false;
    if (!state.localPreview) {
      try { const result = await api('/api/clean', { method: 'POST', body: { transcript, contact: currentContact() } }); if (result.text?.trim()) { text = result.text.trim(); polished = !result.fallback; } }
      catch (error) {
        const noCredits = /no credits|insufficient.quota|exceeded.*quota/i.test(error.message);
        banner(noCredits ? 'OpenAI API credits are exhausted. Add credits to enable note cleanup. Your original words are ready to review.' : 'Note cleanup is unavailable. Your original words are ready to review.');
      }
    }
    $('cleanedNote').value = text;
    $('cleanBadge').textContent = polished ? 'Lightly polished' : 'Your original words';
    show($('cleanedSection'), true); show($('emailSection'), false); setStep(1); saveComposer(); scrollToElement($('cleanedSection'));
  } finally { setBusy(false); $('cleanBtn').textContent = 'Polish my note ↗'; }
}
function localPreview(contact, cleanedNote) {
  const subject = state.settings.email_subject.replaceAll('{{FirstName}}', firstName(contact.name)).replaceAll('{{Name}}', contact.name || '').replaceAll('{{Company}}', contact.company || '');
  const body = `Hi ${firstName(contact.name)},\n\n${cleanedNote}\n\n${state.settings.fixed_template}\n\n${state.settings.signature}`.trim();
  return { subject, body };
}
function useNote() {
  const c = currentContact(); if (!c || state.busy || completed(c)) return;
  const note = $('cleanedNote').value.trim(); if (!note) return banner('Add a note before continuing.', 'error');
  const preview = localPreview(c, note); $('emailSubject').textContent = preview.subject; $('emailBody').textContent = preview.body;
  show($('emailSection'), true); show($('emailPreview'), true); $('previewToggle').textContent = 'Hide preview'; $('previewToggle').setAttribute('aria-expanded', 'true');
  setStep(2); saveComposer(); scrollToElement($('emailSection'));
}
async function createDraft() {
  const c = currentContact(); if (!c || state.busy || completed(c)) return;
  const cleanedNote = $('cleanedNote').value.trim(), transcript = $('transcript').value.trim();
  if (!cleanedNote) return banner('Add and review your note first.', 'error');
  if (state.mode === 'google' && !c.email) return banner('This contact needs an email address in your tracker before a draft can be created.', 'error');
  setBusy(true); $('draftBtn').textContent = 'Creating draft…';
  try {
    if (state.mode === 'google') {
      const result = await api('/api/draft', { method: 'POST', body: { rowNumber: c.rowNumber, cleanedNote, transcript } });
      Object.assign(c, result.contact || {}, { status: 'Draft Ready' });
      $('openGmailBtn').href = result.gmailUrl || 'https://mail.google.com/mail/u/0/#drafts'; show($('openGmailBtn'), true);
    } else { Object.assign(c, { cleanedNote, arunNote: transcript, status: 'Draft Ready' }); persistDemo(); show($('openGmailBtn'), false); }
    $('contactStatus').textContent = state.mode === 'demo' ? 'Demo draft saved' : 'Draft ready';
    $('successTitle').textContent = state.mode === 'demo' ? 'Demo draft saved' : 'Your introduction is ready';
    $('successMessage').textContent = state.mode === 'demo' ? 'Saved in this browser. Nothing was created in Gmail.' : 'Waiting in Gmail for your final review and Send.';
    ['voiceZone','transcriptSection','cleanedSection','emailSection'].forEach(id => show($(id), false));
    show($('draftSuccess'), true); renderProgress(); renderQueue(); scrollToElement($('draftSuccess'));
  } catch (e) { banner(e.message, 'error'); }
  finally { setBusy(false); $('draftBtn').textContent = state.mode === 'demo' ? 'Save demo draft ↗' : 'Create Gmail draft ↗'; }
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
$('typeNoteBtn').addEventListener('click', () => { show($('transcriptSection'), true); $('transcript').focus(); scrollToElement($('transcriptSection')); });
$('redoBtn').addEventListener('click', startRecording);
$('retryRecordingBtn').addEventListener('click', retryRecording);
$('audioUpload').addEventListener('change', uploadRecording);
$('transcript').addEventListener('input', () => { $('cleanedNote').value = ''; show($('cleanedSection'), false); show($('emailSection'), false); setStep(0); saveComposer(); });
$('cleanedNote').addEventListener('input', () => { show($('emailSection'), false); setStep(1); saveComposer(); });
$('cleanBtn').addEventListener('click', cleanNote);
$('useNoteBtn').addEventListener('click', useNote);
$('editNoteBtn').addEventListener('click', () => { $('cleanedNote').focus(); show($('emailSection'), false); setStep(1); });
$('previewToggle').addEventListener('click', () => { const visible = $('emailPreview').classList.contains('hidden'); show($('emailPreview'), visible); $('previewToggle').textContent = visible ? 'Hide preview' : 'Show preview'; $('previewToggle').setAttribute('aria-expanded', String(visible)); });
$('draftBtn').addEventListener('click', createDraft);
$('skipBtn').addEventListener('click', skipCurrent);
$('nextBtn').addEventListener('click', nextContact);
$('resetDemoBtn').addEventListener('click', resetDemo);
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
