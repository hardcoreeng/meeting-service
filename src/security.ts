import { decode } from 'jwt-simple'
/**
 * @public
 */
export interface SecurityOptions {
  cert: string
  key: string
  ca?: string
}

/**
 * @public
 */
export interface AccountDetails {
  firstName?: string
  lastName?: string
  email: string
}

/**
 * @public
 */
export function decodeToken(
  secret: string,
  token: string
): { accountId: string, workspaceId: string, details: AccountDetails } {
  return decode(token, secret)
}
