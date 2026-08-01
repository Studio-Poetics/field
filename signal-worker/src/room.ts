import { DurableObject } from 'cloudflare:workers';

// One PairingRoom = one 6-digit room code. Relays WebRTC offer/answer/ICE
// between exactly one "host" (desktop demo page) and one "guest" (phone),
// then gets out of the way once the direct P2P connection is up.
// Uses the WebSocket Hibernation API so the room costs nothing while idle
// between signaling messages.
export class PairingRoom extends DurableObject {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const role = url.searchParams.get('role');
		if (role !== 'host' && role !== 'guest') {
			return new Response('role must be host or guest', { status: 400 });
		}

		const existing = this.ctx.getWebSockets(role);
		if (existing.length > 0) {
			return new Response(`a ${role} is already connected to this room`, { status: 409 });
		}

		const otherRole = role === 'host' ? 'guest' : 'host';
		for (const peer of this.ctx.getWebSockets(otherRole)) {
			peer.send(JSON.stringify({ type: 'peer-joined' }));
		}

		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);
		this.ctx.acceptWebSocket(server, [role]);
		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
		const tags = this.ctx.getTags(ws);
		const otherRole = tags.includes('host') ? 'guest' : 'host';
		for (const peer of this.ctx.getWebSockets(otherRole)) {
			peer.send(message);
		}
	}

	async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
		const tags = this.ctx.getTags(ws);
		const otherRole = tags.includes('host') ? 'guest' : 'host';
		for (const peer of this.ctx.getWebSockets(otherRole)) {
			peer.send(JSON.stringify({ type: 'peer-left' }));
		}
		ws.close(code, reason);
	}

	async webSocketError(ws: WebSocket): Promise<void> {
		ws.close();
	}
}
