import * as admin from 'firebase-admin';
import { config } from '../config/index.js';

// Initialize Firebase Admin SDK
let firebaseApp: admin.app.App | null = null;

function getFirebaseApp(): admin.app.App {
  if (firebaseApp) {
    return firebaseApp;
  }

  // Check if Firebase is configured
  if (!config.firebase.projectId || !config.firebase.clientEmail || !config.firebase.privateKey) {
    console.warn('[Firebase] Firebase Admin SDK not configured - authentication will not work');
    throw new Error('Firebase Admin SDK not configured');
  }

  // Initialize with service account credentials
  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert({
      projectId: config.firebase.projectId,
      clientEmail: config.firebase.clientEmail,
      privateKey: config.firebase.privateKey,
    }),
  });

  console.log('[Firebase] Admin SDK initialized successfully');
  return firebaseApp;
}

/**
 * Verify a Firebase ID token and return the decoded claims
 */
export async function verifyFirebaseToken(idToken: string): Promise<admin.auth.DecodedIdToken | null> {
  try {
    const app = getFirebaseApp();
    const decodedToken = await app.auth().verifyIdToken(idToken);
    return decodedToken;
  } catch (error) {
    console.error('[Firebase] Token verification failed:', error);
    return null;
  }
}

/**
 * Get user info from Firebase by UID
 */
export async function getFirebaseUser(uid: string): Promise<admin.auth.UserRecord | null> {
  try {
    const app = getFirebaseApp();
    return await app.auth().getUser(uid);
  } catch (error) {
    console.error('[Firebase] Failed to get user:', error);
    return null;
  }
}

/**
 * Check if Firebase is properly configured
 */
export function isFirebaseConfigured(): boolean {
  return !!(config.firebase.projectId && config.firebase.clientEmail && config.firebase.privateKey);
}
