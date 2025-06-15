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

// Fetch service account credentials from environment variable
const SERVICE_ACCOUNT_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
if (!SERVICE_ACCOUNT_KEY) {
  throw new Error("Google service account key not set in environment variables.");
}

// Define the Google Drive API scope and folder ID
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

// Google Drive setup using the environment variable for credentials
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(SERVICE_ACCOUNT_KEY),
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

  // Ensure the ID is present before returning
  if (!createRes.data.id) {
    throw new Error("Folder creation failed: ID is missing");
  }
  return createRes.data.id;
}

// Multer setup for file upload
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

    // Prepare metadata & media for the file upload
    const fileMetadata = {
      name: file.originalname,
      parents: [folderId],
    };
    const media = {
      mimeType: file.mimetype,
      body: fs.createReadStream(file.path),
    };

    // Upload to Google Drive
    await drive.files.create({
      resource: fileMetadata,
      media,
      fields: 'id',
    });

    // Cleanup the local file after upload
    fs.unlinkSync(file.path);

    res.json({ success: true, message: `Uploaded to folder ${folderName}` });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

export default router;
