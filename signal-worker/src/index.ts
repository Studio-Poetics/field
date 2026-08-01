import { PairingRoom } from './room';

export { PairingRoom };

interface Env {
	ROOM: DurableObjectNamespace<PairingRoom>;
}

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: CORS_HEADERS });
		}

		// GET /room/:code/connect?role=host|guest — upgrade to a signaling WebSocket
		const match = url.pathname.match(/^\/room\/(\d{6})\/connect$/);
		if (match) {
			if (request.headers.get('Upgrade') !== 'websocket') {
				return new Response('expected websocket', { status: 426 });
			}
			const code = match[1];
			const id = env.ROOM.idFromName(code);
			const room = env.ROOM.get(id);
			return room.fetch(request);
		}

		return new Response('field-pair-signal: not found', { status: 404, headers: CORS_HEADERS });
	},
};
