import { isAppAuthed } from './_lib/security.js';
export default function handler(req, res) {
  res.status(200).json({ authenticated: isAppAuthed(req), protected: Boolean(process.env.APP_ACCESS_CODE) });
}
