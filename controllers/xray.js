// controllers/xray.js
import express from 'express';
import multer from 'multer';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import requireAuth from '../middleware/requireAuth.js';

const router = express.Router();
router.use(requireAuth);

// Compute __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the service account key in your project root
const SERVICE_ACCOUNT_FILE = path.join(__dirname, '../dentgo-8d1f8abc329a.json');
const SCOPES = ['https://www.googleapis.com/auth/drive'];
const PARENT_FOLDER_ID = '1a2b3cD4EfghIJKlmnOPqrStUvWxYz9';

// Normalize patient name to lowercase-hyphen format
function normalize(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-]/g, '');
}

// Google Drive setup
const auth = new google.auth.GoogleAuth({
  keyFile: SERVICE_ACCOUNT_FILE,
  scopes: SCOPES,
});
const drive = google.drive({ version: 'v3', auth });

async function getOrCreateFolder(name, parentId) {
  const q = `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and name='${name}' and trashed=false`;
  const res = await drive.files.list({ q, fields: 'files(id,name)' });
  if (res.data.files.length > 0) return res.data.files[0].id;

  const createRes = await drive.files.create({
    resource: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
  });
  return createRes.data.id!;
}

// Multer setup
const upload = multer({ dest: 'uploads/' });

router.post('/xray-upload', upload.single('image'), async (req, res) => {
  try {
    const { name } = req.body;
    const file = req.file;
    if (!name || !file) {
      return res.status(400).json({ error: 'Missing name or image' });
    }

    const folderName = normalize(name);
    const folderId = await getOrCreateFolder(folderName, PARENT_FOLDER_ID);

    // Prepare metadata & media
    const fileMetadata = {
      name: file.originalname,
      parents: [folderId],
    };
    const media = {
      mimeType: file.mimetype,
      body: fs.createReadStream(file.path),
    };

    // Upload to Drive
    await drive.files.create({
      resource: fileMetadata,
      media,
      fields: 'id',
    });

    // Cleanup
    fs.unlinkSync(file.path);

    res.json({ success: true, message: `Uploaded to folder ${folderName}` });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

export default router;
