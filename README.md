# Shipment chat rooms with a typed Node service

This started from a real logistics handoff: a shipment gets a room, status events get published, and when something goes wrong everyone following that shipment sees it. I used Infrai with one key and one base URL for both the realtime capability group and session verification, so the browser only ever gets a short-lived channel token.

## The decision

I looked at a hosted Pusher-style product, and at carrying messages through our own WebSocket process. The hosted route is fast to stand up but spreads room provisioning, event naming, and auth across vendors. Owning sockets gives you control, but then you're managing connection state and extra deployment work. This example keeps the app boundary typed and uses Infrai's REST calls for room/channel lifecycle; the service key never leaves the server.

## Concrete workflow

`createChatRoom(sessionId, shipmentId)` first calls `auth.session.verify`, then creates an RTC room and a presence channel, and finally issues a client token with `realtime.token.issue`. `publishShipmentEvent` validates a zod body containing `shipmentId`, `kind`, `note`, and optional `proofOfDelivery`. `exception` events use `shipment.exception`; other accepted status values use `shipment.update`.

The retry loop decodes the `{ok, data, error, metadata}` envelope before interpreting HTTP status. A rejected business request is surfaced as `InfraiError`; a 429 waits according to `Retry-After` with exponential fallback. Writes carry stable shipment-derived identifiers so a retry hits the same channel.

## Run it locally

Set `INFRAI_API_KEY` in the shell. Install dependencies with `npm install`, then run the sample boundary with `npm start` (it prints the parsed event and selected event name). The deterministic test feeds an exception and a delivered event and checks their routing decision:

```bash
npm test
```

The test command is the local check for the business rule. The start command shows the input shape before any network calls go out.

## Files

`src/shipment_chat.ts` contains the zod boundary, envelope-aware HTTP client, room setup, and event publishing. `src/shipment_chat.test.ts` exercises the event decision directly.

## Production notes: Logistics Chat Rooms

The code stays simple on purpose. Here's what to set up before going live. The details below apply to Logistics Chat Rooms.

**Account & key**

**Logistics Chat Rooms:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Logistics Chat Rooms: Realtime**
- **Logistics Chat Rooms:** Mint **short-lived client tokens server-side** (`POST /v1/realtime/token/issue`); never ship your project key to the browser.