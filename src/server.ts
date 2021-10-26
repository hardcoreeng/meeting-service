//
// Copyright © 2021 Anticrm Platform Contributors.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import WebSocket, { Server as WebSocketServer } from 'ws'
import { createServer as createHttpsServer } from 'https'
import { IncomingMessage, Server as HttpServer } from 'http'

import { Incoming, ResponseMsg, unknownError } from './api'
import { MeetingServiceConfiguration, readCertificates } from './config'
import MeetingService from './meeting.service'
import { generateId } from './utils'
import { decodeToken } from './security'

function serialize (o: any): string {
  return JSON.stringify(o)
}

export interface ServerProtocol {
  shutdown: () => void
}

/**
 * @public
 */
export interface SecurityOptions {
  cert: string
  key: string
  ca?: string
}

class Server {
  connections = new Map<string /* clientId */, WebSocket>()
  server: WebSocketServer
  httpServer: HttpServer
  constructor (
    readonly port: number,
    readonly security: SecurityOptions,
    readonly meetingService: MeetingService,
    readonly serverToken: string
  ) {
    this.httpServer = createHttpsServer({ key: security.key, cert: security.cert, ca: security.ca }, (request, response) => {
      response.writeHead(200)
      response.end('Nothing here')
    })
    this.server = new WebSocketServer({
      noServer: true,
      perMessageDeflate: {
        zlibDeflateOptions: {
          // See zlib defaults.
          chunkSize: 1024,
          memLevel: 7,
          level: 3
        },
        zlibInflateOptions: {
          chunkSize: 10 * 1024
        },
        // Other options settable:
        clientNoContextTakeover: true, // Defaults to negotiated value.
        serverNoContextTakeover: true, // Defaults to negotiated value.
        serverMaxWindowBits: 10, // Defaults to negotiated value.
        // Below options specified as default values.
        concurrencyLimit: 10, // Limits zlib concurrency for perf.
        threshold: 1024 // Size (in bytes) below which messages
        // should not be compressed if context takeover is disabled.
      }
    })
    this.httpServer.on('upgrade', (request, socket, head) => {
      this.upgradeHandler(request, socket, head)
    })
  }

  private upgradeHandler (request: IncomingMessage, socket: any, head: Buffer): void {
    const token = request.url?.substring(1) // remove leading '/'
    if (token === undefined || token.trim().length === 0) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
      socket.destroy()
      return
    }
    this.server.handleUpgrade(request, socket, head, (ws) => {
      this.handleConnection(ws, token).catch((err) => {
        this.traceError(err)
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
        socket.destroy()
        // ws.close()
      })
    })
  }

  async listen (): Promise<void> {
    return await new Promise((resolve) => {
      this.httpServer.listen(this.port, () => {
        resolve()
      })
    })
  }

  shutdown (): void {
    console.log('Shutting down http server')

    for (const conn of this.connections.entries()) {
      conn[1].close()
    }
    this.server.close()
    this.httpServer.close()
  }

  private async handleConnection (ws: WebSocket, token: string): Promise<void> {
    const { accountId, workspaceId } = decodeToken(this.serverToken, token)

    const clientId = accountId + '-' + workspaceId + '-' + generateId()

    console.log('connected client', accountId, workspaceId, clientId)

    const { onWSMsg, onClose } = this.meetingService.onNewClient((msg: any) =>
      ws.send(JSON.stringify(msg))
    )

    this.registerOnMessage(ws, onWSMsg)

    this.connections.set(clientId, ws)

    this.registerOnClose(ws, clientId, onClose)
    this.registerOnError(ws, clientId, onClose)
  }

  private registerOnMessage (ws: WebSocket, wsOnMSG: (msg: Incoming) => Promise<ResponseMsg['result']>): void {
    ws.on('message', (msg: string): void => {
      let msgValue: Incoming
      try {
        msgValue = JSON.parse(msg)
      } catch (e) {
        console.error('Failed to parse incoming msg:', msg)
        return
      }

      wsOnMSG(msgValue)
        .then(result => {
          if (msgValue.id !== undefined) {
            ws.send(serialize({
              id: msgValue.id,
              result
            }))
          }
        })
        .catch((e) =>
          ws.send(serialize({
            id: msgValue.id,
            error: unknownError(e)
          }))
        )
    })
  }

  private registerOnError (ws: WebSocket, clientId: string, onClose: () => Promise<void>): void {
    ws.on('error', (error) => {
      console.error('communication error:', error)
      this.connections.delete(clientId)
      onClose()
    })
  }

  private registerOnClose (ws: WebSocket, clientId: string, onClose: () => Promise<void>): void {
    ws.on('close', () => {
      this.connections.delete(clientId)
      onClose()
    })
  }

  private traceError (err: Error): void {
    console.error(err)
  }
}

export async function start (
  config: MeetingServiceConfiguration
): Promise<ServerProtocol> {
  console.log(`Starting server on ${config.appPort}...`)

  const meetingService = new MeetingService(config.kmsUrl)
  const security = readCertificates()
  const server = new Server(config.appPort, security, meetingService, config.appSecret)

  await server.listen()

  return new Promise(resolve => {
    const serverProtocol: ServerProtocol = {
      shutdown: async () => {
        console.log('Shutting down meeting service...')

        await meetingService.close()

        await server.shutdown()
      }
    }
    resolve(serverProtocol)
  })
}
