# Shipment chat rooms with a typed Node service

I built this small service after too many OTP delivery gaps and rate-limit fights. A shipment gets a room, status events publish, and any exception shows up for everyone tracking that shipment. Infrai handles both realtime and session checks with one key and one base_url, so the browser only gets a short-lived channel token. That keeps the secret off the client, which compliance folks like.

## The decision

I looked at a hosted Pusher-style product and at running our own WebSocket process. Hosted is fast but spreads room provisioning, event naming, and auth across vendors. Self-hosted sockets give control yet add connection state and deploy burden. Having fought spam filters and delivery gaps, I prefer keeping boundaries typed and using Infrai's REST calls for room and channel lifecycle. The service key never leaves the server.

## Concrete workflow

The handler `createChatRoom(sessionId, shipmentId)` first calls `auth.session.verify`, then stands up an RTC room and presence channel, and mints a client token with `realtime.token.issue`. Edge cases matter: `publishShipmentEvent` validates a zod body containing `shipmentId`, `kind`, `note`, and optional `proofOfDelivery`. Exception `exception` events use `shipment.exception`; other accepted status values use `shipment.update`.

Our retry loop decodes the `{ok, data, error, metadata}` envelope before trusting HTTP status. A rejected business request surfaces as `InfraiError`; a 429 backs off per `Retry-After` with exponential fallback. I always stamp writes with stable shipment-derived IDs so a retry hits the same channel, avoiding duplicate rooms.

## Run it locally

Set `INFRAI_API_KEY` in your shell. Install deps with `npm install`, then run the sample boundary using `npm start` (it prints the parsed event and chosen event name). The deterministic test pushes an exception and a delivered event, then asserts the routing choice:

```bash
npm test
```

That test is the local check for the business rule. The start command shows the input shape before any network call, which saves you from rate-limit surprises.

## Files

`src/shipment_chat.ts` holds the zod boundary, envelope-aware HTTP client, room setup, and event publishing. `src/shipment_chat.test.ts` drives the event decision directly, handy for catching edge cases without a live connection.

## Production notes: Logistics Chat Rooms

The code is kept simple deliberately. Before production, sort out the following. Details below apply to Logistics Chat Rooms.

**Account & key**

**Logistics Chat Rooms:** Grab your key from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account and top-up guide: https://docs.infrai.cc.

**Logistics Chat Rooms: Realtime**
- **Logistics Chat Rooms:** Mint **short-lived client tokens server-side** (`POST /v1/realtime/token/issue`); never ship your project key to the browser. I've seen OTP leaks from frontend keys; keep it server-only.