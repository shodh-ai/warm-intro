import { randomUUID } from 'node:crypto';
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
function attachmentError(message) { const error=new Error(message); error.status=400; return error; }
export function driveFileReference(input) {
  let url;
  try { url=new URL(input); } catch { throw attachmentError('Paste a Google Drive file link in Attachment (Drive link).'); }
  if(url.protocol!=='https:' || !['drive.google.com','docs.google.com'].includes(url.hostname)) throw attachmentError('The attachment must be a Google Drive file link.');
  const id=url.pathname.match(/\/(?:file|document|presentation|spreadsheets)\/d\/([\w-]+)/)?.[1] || (url.hostname==='drive.google.com' ? url.searchParams.get('id') : '');
  if(!id || !/^[\w-]+$/.test(id)) throw attachmentError('Use a link to a file, not a Drive folder.');
  const key=url.searchParams.get('resourcekey');
  return {id,resourceKey:key && /^[\w-]+$/.test(key)?key:''};
}
async function driveRequest(url, headers) {
  const response=await fetch(url,{headers,signal:AbortSignal.timeout(25000),redirect:'error'});
  if(!response.ok) {
    let data;try { data=await response.json(); } catch {}
    const message=data?.error?.message || '';
    if(/has not been used|is disabled|SERVICE_DISABLED/i.test(message)) throw attachmentError('Enable Google Drive API for this app in Google Cloud, then retry. No draft was created.');
    if(response.status===401 || response.status===403) throw attachmentError('Reconnect Google in Settings and allow Drive file access. Also check that this account can download the attachment. No draft was created.');
    throw attachmentError('The Drive attachment could not be downloaded. Check its link and sharing permissions. No draft was created.');
  }
  return response;
}
export async function getDriveAttachment(accessToken,link) {
  if(!String(link || '').trim()) return null;
  const {id,resourceKey}=driveFileReference(String(link).trim());
  const headers={Authorization:`Bearer ${accessToken}`,...(resourceKey?{'X-Goog-Drive-Resource-Keys':`${id}/${resourceKey}`}:{})};
  const base=`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`;
  const metadata=await (await driveRequest(`${base}?fields=name,mimeType,size,capabilities(canDownload)&supportsAllDrives=true`,headers)).json();
  if(metadata.capabilities?.canDownload===false) throw attachmentError('Downloading this attachment is disabled by its owner. No draft was created.');
  if(Number(metadata.size)>MAX_ATTACHMENT_BYTES) throw attachmentError('Use an attachment smaller than 10 MB. No draft was created.');
  const native=metadata.mimeType?.startsWith('application/vnd.google-apps.');
  if(native && !['document','presentation','spreadsheet'].some(t=>metadata.mimeType===`application/vnd.google-apps.${t}`)) throw attachmentError('Use a file or a Google Doc, Slides, or Sheet link, not a folder or shortcut.');
  const response=await driveRequest(native?`${base}/export?mimeType=application%2Fpdf`:`${base}?alt=media&supportsAllDrives=true`,headers);
  const reader=response.body.getReader(); const chunks=[];let size=0;
  while(true) { const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_ATTACHMENT_BYTES){await reader.cancel();throw attachmentError('Use an attachment smaller than 10 MB. No draft was created.');} chunks.push(value); }
  if(!size) throw attachmentError('The attachment is empty. No draft was created.');
  const mimeType=native?'application/pdf':(/^[\w.+-]+\/[\w.+-]+$/.test(metadata.mimeType || '')?metadata.mimeType:'application/octet-stream');
  return {name:`${String(metadata.name || 'Attachment').replace(/[\r\n\x00-\x1f]/g,'').slice(0,180)}${native?'.pdf':''}`,mimeType,bytes:Buffer.concat(chunks),size};
}
export function emailMime(headers,body,attachment) {
  if(!attachment) return [...headers,'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: 8bit','',body].join('\r\n');
  const boundary=`warm-intro-${randomUUID()}`;
  const encodedName=encodeURIComponent(attachment.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const base64=data=>Buffer.from(data).toString('base64').match(/.{1,76}/g).join('\r\n');
  return [...headers,'MIME-Version: 1.0',`Content-Type: multipart/mixed; boundary="${boundary}"`,'',`--${boundary}`,'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',base64(body),`--${boundary}`,`Content-Type: ${attachment.mimeType}`,`Content-Disposition: attachment; filename="attachment"; filename*=UTF-8''${encodedName}`,'Content-Transfer-Encoding: base64','',base64(attachment.bytes),`--${boundary}--`,''].join('\r\n');
}
