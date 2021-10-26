import { SecurityOptions } from './security'
import dotenv from 'dotenv'
import { existsSync, readFileSync } from 'fs'

if (existsSync('./config/config.env')) {
  console.info('Loading Configuration from file: ./config/config.env')
  dotenv.config({ path: './config/config.env' })
}

export interface MeetingServiceConfiguration {
  webHost: string
  appPort: number
  appSecret: string

  kmsUrl: string // Kurento URL.

  SECURITY_CERT_FILE: string
  SECURITY_KEY_FILE: string
  SECURITY_CA_FILE: string
}

export const config: MeetingServiceConfiguration = {
  webHost: process.env.WEB_HOST ?? 'localhost', // A public available host name
  appPort: parseInt(process.env.SERVER_PORT ?? '18081'),
  appSecret: process.env.SERVER_SECRET ?? 'secret',
  kmsUrl: process.env.KMS_URL ?? 'ws://localhost:8888/kurento',

  SECURITY_CERT_FILE: process.env.SECURITY_CERT_FILE ?? './cert.pem',
  SECURITY_KEY_FILE: process.env.SECURITY_KEY_FILE ?? './privkey.pem',
  SECURITY_CA_FILE: process.env.SECURITY_CA_FILE ?? './chain.pem'
}

export function readCertificates (): SecurityOptions {
  const filesExists = existsSync(config.SECURITY_CERT_FILE) && existsSync(config.SECURITY_KEY_FILE)
  if (!filesExists) {
    console.error(
      `Valid certificates are required for SSL/TLS.
                  Passed certificates: cert: ${config.SECURITY_CERT_FILE} key: ${config.SECURITY_KEY_FILE}\n
                  Could not continue...`
    )
    process.exit(1)
  }

  const certificate = readFileSync(config.SECURITY_CERT_FILE).toString()
  console.info('Running with certificate:', certificate)

  return {
    cert: certificate,
    key: readFileSync(config.SECURITY_KEY_FILE).toString(),
    ca: existsSync(config.SECURITY_CA_FILE) ? readFileSync(config.SECURITY_CA_FILE).toString() : undefined
  }
}
