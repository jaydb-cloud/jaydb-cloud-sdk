/**
 * TypeScript definitions for JayDB Cloud SDK (@jaydb/cloud)
 */

export interface ClientStats {
  reads: number;
  writes: number;
  deletes: number;
  lists: number;
  conflicts: number;
  totalRequests: number;
  totalLatencyMs: number;
  lastLatencyMs: number;
  avgLatencyMs: number;
}

export interface JayDBClientOptions {
  baseUrl: string;
  namespace: string;
  apiKey?: string | null;
  getToken?: (() => string | null | Promise<string | null>) | null;
  auth?: JayDBAuth | null;
  fetch?: typeof fetch;
}

export interface DocumentResult<T = any> {
  key: string;
  data: T;
  etag: string | null;
}

export interface PutResult {
  key: string;
  etag: string;
  modTime: string | null;
}

export interface DocumentMetadata {
  key: string;
  etag: string;
  mod_time: string;
  size: number;
}

export interface ListResult {
  items: DocumentMetadata[];
  nextCursor: string | null;
}

export interface GetOptions {
  signal?: AbortSignal;
  knownETag?: string;
}

export interface PutOptions {
  ifMatch?: string;
  createOnly?: boolean;
  signal?: AbortSignal;
}

export interface DeleteOptions {
  ifMatch?: string;
  signal?: AbortSignal;
}

export interface ListOptions {
  prefix?: string;
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}

export interface ListAllOptions {
  prefix?: string;
  pageLimit?: number;
  signal?: AbortSignal;
}

export class JayDBError extends Error {
  status: number;
  key: string | null;
  body: any;
  constructor(message: string, opts?: { status?: number; key?: string | null; body?: any });
}

export class ConflictError extends JayDBError {}
export class NotFoundError extends JayDBError {}
export class AuthError extends JayDBError {}

export class JayDBClient {
  baseUrl: string;
  namespace: string;
  apiKey: string | null;
  getToken: (() => string | null | Promise<string | null>) | null;
  auth: JayDBAuth | null;
  stats: ClientStats;

  constructor(opts: JayDBClientOptions);

  get<T = any>(key: string, opts?: GetOptions): Promise<DocumentResult<T> | null>;
  put<T = any>(key: string, data: T, opts?: PutOptions): Promise<PutResult>;
  delete(key: string, opts?: DeleteOptions): Promise<boolean>;
  list(opts?: ListOptions): Promise<ListResult>;
  listAll(opts?: ListAllOptions): Promise<DocumentMetadata[]>;
}

export { JayDBClient as JayDB };

export function encodeKey(key: string): string;
export function unquoteETag(value: string | null | undefined): string | null;

export interface AuthOptions {
  issuer?: string;
  clientId?: string;
  redirectUri?: string;
  scopes?: string[];
  storage?: Storage;
}

export interface SignInOptions {
  issuer?: string;
  clientId?: string;
  scopes?: string[];
  redirectUri?: string;
  idp?: 'google' | 'github' | 'microsoft' | string;
  context?: any;
  autoRedirect?: boolean;
}

export interface UserClaims {
  sub?: string;
  name?: string;
  email?: string;
  picture?: string;
  [key: string]: any;
}

export interface TokenRecord {
  accessToken: string | null;
  refreshToken: string | null;
  idToken: string | null;
  expiresAt: number;
  tokenEndpoint: string | null;
  clientId: string | null;
}

export class JayDBAuth {
  issuer: string | null;
  clientId: string | null;
  redirectUri: string | null;
  scopes: string[];
  storage: Storage;

  constructor(opts?: AuthOptions);

  discover(issuer?: string): Promise<any>;
  signIn(opts?: SignInOptions): Promise<{ authorizeUrl: string; state: string }>;
  beginLogin(opts?: SignInOptions): Promise<{ authorizeUrl: string; state: string }>;
  handleCallback(opts?: { clientId?: string; redirectUri?: string; url?: string }): Promise<any | null>;
  completeLoginIfCallback(opts?: { clientId?: string; redirectUri?: string; url?: string }): Promise<any | null>;
  storeTokens(tokens: any, tokenEndpoint?: string, clientId?: string): void;
  getTokens(): TokenRecord | null;
  isSignedIn(): boolean;
  getUser(): UserClaims | null;
  identityClaims(): UserClaims | null;
  signOut(): void;
  getToken(): Promise<string | null>;
  ensureToken(): Promise<string | null>;
  currentToken(): string | null;
}

export { JayDBAuth as Auth };

export function beginLogin(opts?: SignInOptions): Promise<{ authorizeUrl: string; state: string }>;
export function completeLoginIfCallback(opts?: { clientId?: string; redirectUri?: string; url?: string }): Promise<any | null>;
export function isSignedIn(): boolean;
export function identityClaims(): UserClaims | null;
export function ensureToken(): Promise<string | null>;
export function currentToken(): string | null;
export function signOut(): void;

export interface SignInviteOptions {
  treePath?: string;
  boardId?: string;
  role: 'read' | 'write' | 'own';
  inviterName?: string;
  expiresInMs?: number;
  secret?: string;
}

export interface VerifyInviteResult {
  treePath: string;
  boardId: string | null;
  role: 'read' | 'write' | 'own' | string;
  inviter: string;
  exp: number;
}

export class TreeACL {
  static signInvite(opts: SignInviteOptions): Promise<string>;
  static verifyInvite(rawToken: string, opts?: { secret?: string }): Promise<VerifyInviteResult | null>;
}

export function signBoardInvite(opts: SignInviteOptions): Promise<string>;
export function verifyBoardInvite(rawToken: string, opts?: { secret?: string }): Promise<VerifyInviteResult | null>;
export function b64url(buffer: ArrayBuffer | Uint8Array): string;
export function fromB64url(str: string): Uint8Array;
