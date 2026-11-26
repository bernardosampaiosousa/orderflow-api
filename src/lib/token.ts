import { SignJWT, jwtVerify } from 'jose';
import { HttpError } from './errors.js';

export type Identity = { id: string; role: 'CUSTOMER' | 'ADMIN' };
const encoder = new TextEncoder();

// Registration and login share the same two-hour JWT format.
export async function issueToken(user: Identity, secret: string): Promise<string> {
  return new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.id)
    .setIssuer('orderflow-api')
    .setAudience('orderflow-client')
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(encoder.encode(secret));
}

// Checks the signature and claims before a protected route trusts the account ID.
export async function readToken(token: string, secret: string): Promise<Identity> {
  try {
    const { payload } = await jwtVerify(token, encoder.encode(secret), {
      issuer: 'orderflow-api', audience: 'orderflow-client', algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string' || !/^[0-9a-f-]{36}$/i.test(payload.sub) ||
      (payload.role !== 'CUSTOMER' && payload.role !== 'ADMIN')) {
      throw new Error('Invalid claims');
    }
    return { id: payload.sub, role: payload.role };
  } catch {
    throw new HttpError(401, 'INVALID_TOKEN', 'Invalid or expired authentication token');
  }
}
